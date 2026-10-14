// WebAuthn, through @simplewebauthn/server (PD-17). Attestation is `none`.
// Registration needs a resident key and user verification, and sends
// `excludeCredentials`, so a passkey provider that already holds this site's
// credential refuses to make a second one. Sign-in is discoverable: the
// browser shows the passkeys it has, and the site never says which exist.
//
// Challenges live in memory for 5 minutes and work once. A restart loses them,
// which only means retrying. Nothing here logs: a challenge is a secret until it
// is spent, and the library's own errors can quote it, so every failure is
// swallowed into a null.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { randomBytes } from 'node:crypto';
import { now } from './clock.ts';
import type { Db } from './db.ts';
import type { Env } from './env.ts';
import { limits } from './limits.ts';

export type CeremonyKind = 'signin' | 'reauth' | 'register';

interface Pending {
  kind: CeremonyKind;
  /** What the ceremony is tied to: a code's hash, or a session's id hash. Empty for a plain sign-in. */
  bind: string;
  expiresAt: number;
}

// Options calls are open to anyone, so the map is capped: past the cap the
// oldest challenge is dropped. A real sign-in needs one entry for a few seconds.
const MAX_PENDING = 200;
const pending = new Map<string, Pending>();

function remember(challenge: string, kind: CeremonyKind, bind: string): void {
  const t = now();
  for (const [key, value] of pending) if (value.expiresAt <= t) pending.delete(key);
  while (pending.size >= MAX_PENDING) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) break;
    pending.delete(oldest);
  }
  pending.set(challenge, { kind, bind, expiresAt: t + limits.webauthnChallengeMs });
}

/** Take a challenge out of the store: true once, for the right kind and binding, inside its 5 minutes. */
function take(challenge: string, kind: CeremonyKind, bind: string): boolean {
  const found = pending.get(challenge);
  if (!found) return false;
  pending.delete(challenge);
  return found.kind === kind && found.bind === bind && found.expiresAt > now();
}

/** Forget every challenge. Tests only: a restart does this in production. */
export function clearChallenges(): void {
  pending.clear();
}

/** The challenge a browser signed, read from its clientDataJSON; null if that isn't JSON with one. */
function challengeOf(clientDataJSON: unknown): string | null {
  if (typeof clientDataJSON !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8'));
    const challenge = typeof parsed === 'object' && parsed !== null ? (parsed as { challenge?: unknown }).challenge : null;
    return typeof challenge === 'string' ? challenge : null;
  } catch {
    return null;
  }
}

// ES256 first, then RS256 and EdDSA. The library's default also offers ML-DSA
// where the runtime has it; a post-quantum passkey is new ground this site
// doesn't need to break.
const ALGORITHMS = [-7, -257, -8];

const RP_NAME = 'IMNSTR';

interface CredentialRow {
  id: string;
  public_key: Buffer;
  sign_count: number;
  transports: string | null;
}

/**
 * The WebAuthn user handle. There is one account, so one handle, made on first
 * use and kept. A passkey provider treats (site, handle) as one slot and
 * replaces what is in it, which is exactly why `excludeCredentials` matters.
 */
function userHandle(db: Db): Uint8Array<ArrayBuffer> {
  db.prepare("INSERT OR IGNORE INTO setting (key, value) VALUES ('webauthn_user_handle', ?)").run(randomBytes(16).toString('base64url'));
  const { value } = db.prepare("SELECT value FROM setting WHERE key = 'webauthn_user_handle'").get() as { value: string };
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

const parseTransports = (text: string | null): string[] | undefined => {
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : undefined;
  } catch {
    return undefined;
  }
};

export async function registrationOptions(db: Db, env: Env, bind: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const existing = db.prepare('SELECT id, transports FROM credential ORDER BY created_at, rowid').all() as { id: string; transports: string | null }[];
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: env.rpId,
    userName: 'imnstr',
    userDisplayName: 'IMNSTR',
    userID: userHandle(db),
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: parseTransports(c.transports) })),
    supportedAlgorithmIDs: ALGORITHMS,
  });
  remember(options.challenge, 'register', bind);
  return options;
}

export interface VerifiedRegistration {
  id: string;
  publicKey: Uint8Array;
  signCount: number;
  transports: string[] | null;
  aaguid: string;
  backupEligible: boolean;
  backedUp: boolean;
}

/** Check a registration response against its challenge. Does not store anything. Null on any failure. */
export async function verifyRegistration(env: Env, response: unknown, bind: string): Promise<VerifiedRegistration | null> {
  const body = response as RegistrationResponseJSON | null;
  const challenge = challengeOf(body?.response?.clientDataJSON);
  if (challenge === null || !take(challenge, 'register', bind)) return null;
  try {
    const result = await verifyRegistrationResponse({
      response: body as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: env.origin,
      expectedRPID: env.rpId,
      requireUserPresence: true,
      requireUserVerification: true,
      supportedAlgorithmIDs: ALGORITHMS,
    });
    if (!result.verified) return null;
    const { credential, aaguid, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
    return {
      id: credential.id,
      publicKey: credential.publicKey,
      signCount: credential.counter,
      transports: credential.transports ?? body?.response.transports ?? null,
      aaguid,
      backupEligible: credentialDeviceType === 'multiDevice',
      backedUp: credentialBackedUp,
    };
  } catch {
    return null;
  }
}

/** Discoverable: no `allowCredentials`, user verification required. `bind` is a session's id hash for a re-authentication. */
export async function authenticationOptions(env: Env, kind: 'signin' | 'reauth', bind = ''): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const options = await generateAuthenticationOptions({ rpID: env.rpId, userVerification: 'required' });
  remember(options.challenge, kind, bind);
  return options;
}

/**
 * Check an assertion against its challenge and the stored credential, and on
 * success store the new sign count and backup state. Returns the credential id,
 * or null on any failure, whatever it was: the caller answers one body.
 */
export async function verifyAssertion(
  db: Db,
  env: Env,
  response: unknown,
  kind: 'signin' | 'reauth',
  bind = '',
): Promise<string | null> {
  const body = response as AuthenticationResponseJSON | null;
  const challenge = challengeOf(body?.response?.clientDataJSON);
  if (challenge === null || !take(challenge, kind, bind)) return null;
  try {
    const id = body?.id;
    if (typeof id !== 'string') return null;
    const row = db.prepare('SELECT id, public_key, sign_count, transports FROM credential WHERE id = ?').get(id) as CredentialRow | undefined;
    if (!row) return null;
    const result = await verifyAuthenticationResponse({
      response: body as AuthenticationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: env.origin,
      expectedRPID: env.rpId,
      credential: {
        id: row.id,
        publicKey: new Uint8Array(row.public_key),
        counter: row.sign_count,
        transports: parseTransports(row.transports),
      },
      requireUserVerification: true,
    });
    if (!result.verified) return null;
    db.prepare('UPDATE credential SET sign_count = ?, backed_up = ? WHERE id = ?').run(
      result.authenticationInfo.newCounter,
      result.authenticationInfo.credentialBackedUp ? 1 : 0,
      row.id,
    );
    return row.id;
  } catch {
    return null;
  }
}

export function insertCredential(db: Db, name: string, verified: VerifiedRegistration): void {
  db.prepare(
    `INSERT INTO credential (id, public_key, sign_count, transports, name, aaguid, backup_eligible, backed_up, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    verified.id,
    Buffer.from(verified.publicKey),
    verified.signCount,
    verified.transports ? JSON.stringify(verified.transports) : null,
    name,
    verified.aaguid,
    verified.backupEligible ? 1 : 0,
    verified.backedUp ? 1 : 0,
    now(),
  );
}

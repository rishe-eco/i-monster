// The four passkey ceremonies, each as the server's options, the browser's
// answer through @simplewebauthn/browser, and the server's verdict. Every
// failure leaves here as a code: either the server's refusal, or a client code
// for what the browser said (the passkey sheet closed, the device already has a
// passkey for this site). The browser's own words are never shown.
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { cleanPasskeyName, type NameRefusal } from '../lib/passkey-name.ts';
import { api, type ClientCode, type Result, type SessionInfo } from './api.ts';

/** What the browser's error means for the person at the screen. */
function clientCode(error: unknown): ClientCode {
  const name = error instanceof Error ? error.name : '';
  // `InvalidStateError` is the authenticator saying it already holds a passkey for this
  // site, which is what `excludeCredentials` asks it to say (PD-17, AC-24).
  if (name === 'InvalidStateError') return 'ALREADY_REGISTERED';
  // The sheet was closed, timed out, or the person didn't verify: not a fault.
  if (name === 'NotAllowedError' || name === 'AbortError') return 'CANCELLED';
  return 'UNEXPECTED';
}

async function ceremony<O, R, T>(
  optionsPath: string,
  optionsBody: Record<string, unknown>,
  run: (options: O) => Promise<R>,
  verifyPath: string,
  verifyBody: Record<string, unknown>,
): Promise<Result<T>> {
  if (!browserSupportsWebAuthn()) return { ok: false, code: 'UNSUPPORTED' };
  const options = await api<O>('POST', optionsPath, optionsBody);
  if (!options.ok) return options;
  let response: R;
  try {
    response = await run(options.data);
  } catch (error) {
    return { ok: false, code: clientCode(error) };
  }
  return api<T>('POST', verifyPath, { response, ...verifyBody });
}

/** Sign in with a passkey this browser offers; discoverable, so no username (AC-9). */
export const signIn = () =>
  ceremony<PublicKeyCredentialRequestOptionsJSON, unknown, SessionInfo>(
    'auth/signin/options',
    {},
    (optionsJSON) => startAuthentication({ optionsJSON }),
    'auth/signin/verify',
    {},
  );

/** Show it's you again on a live session (AC-11). The server rotates the session and the token. */
export const reauthenticate = () =>
  ceremony<PublicKeyCredentialRequestOptionsJSON, unknown, SessionInfo>(
    'auth/reauth/options',
    {},
    (optionsJSON) => startAuthentication({ optionsJSON }),
    'auth/reauth/verify',
    {},
  );

/** Register this device with a setup token or an enrolment code, and sign in with it. */
export const registerWithCode = (code: string, name: string) =>
  ceremony<PublicKeyCredentialCreationOptionsJSON, unknown, SessionInfo>(
    'auth/register/options',
    { code },
    (optionsJSON) => startRegistration({ optionsJSON }),
    'auth/register/verify',
    { code, name },
  );

/** Add a passkey on this device from a fresh session. */
export const registerHere = (name: string) =>
  ceremony<PublicKeyCredentialCreationOptionsJSON, unknown, SessionInfo>(
    'auth/register/options',
    {},
    (optionsJSON) => startRegistration({ optionsJSON }),
    'auth/register/verify',
    { name },
  );

/**
 * The server's rule for a passkey's name (lib/passkey-name.ts), asked before the
 * ceremony starts: the server only sees the name when it verifies, which is after
 * the passkey exists on the device, and a refusal then would leave one behind.
 * The server still decides; this only spares the person that.
 */
export function nameProblem(name: string): NameRefusal | null {
  const result = cleanPasskeyName(name);
  return 'refusal' in result ? result.refusal : null;
}

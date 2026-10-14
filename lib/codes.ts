// Setup tokens and enrolment codes (PD-16). Both are stored hashed in
// `auth_code`, so a copy of the database holds nothing that can be redeemed.
// A used, expired or unknown value of either kind gets the one refusal
// `CODE_REFUSED` (AC-20, AC-21), and each refusal counts toward back-off
// (PD-15), so guessing a code is as slow as guessing a passkey.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { now } from './clock.ts';
import type { Db } from './db.ts';
import type { Env } from './env.ts';
import { limits } from './limits.ts';
import { isFresh, type Session } from './sessions.ts';
import { recordFailure, recordSuccess, waitRemainingMs } from './throttle.ts';

export type CodeKind = 'setup' | 'enrol';
export type CodeRefusal = 'CODE_REFUSED';
export interface CodeRef {
  id: string;
  kind: CodeKind;
  /** The stored hash. A registration challenge is bound to it, so one code can't redeem another's ceremony. */
  hash: string;
}

// Crockford base32 again (see lib/ids.ts): no i, l, o or u, so a code survives
// being read aloud or typed from a phone screen.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENROL_PATTERN = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{12}$/;

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
// Compared against when no row matched, so a miss does the same work as a hit.
const NO_ROW_HASH = sha256('no such code');

/** 60 random bits as `K7FQ-2MXP-R9TD`. */
function newEnrolmentCode(): string {
  const bytes = randomBytes(12);
  let code = '';
  for (const byte of bytes) code += ALPHABET[byte & 31];
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}

/**
 * What a typed value is, before hashing. An enrolment code is read the way
 * Crockford says (any case, hyphens and spaces ignored, O for 0, I and L for 1);
 * a setup token is 22 base64url characters and is taken exactly. The two shapes
 * can't overlap, so one lookup serves both.
 */
export function normaliseCode(value: string): string {
  const trimmed = value.trim().slice(0, 200);
  const crockford = trimmed
    .replace(/[\s-]/g, '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return ENROL_PATTERN.test(crockford) ? crockford : trimmed;
}

export const codeHash = (value: string): string => sha256(normaliseCode(value));

function insert(db: Db, kind: CodeKind, value: string): number {
  const expiresAt = now() + (kind === 'setup' ? limits.setupTokenMs : limits.enrolmentCodeMs);
  db.prepare('INSERT INTO auth_code (id, kind, hash, expires_at) VALUES (?, ?, ?, ?)').run(
    randomBytes(8).toString('hex'),
    kind,
    codeHash(value),
    expiresAt,
  );
  return expiresAt;
}

/** Used and expired codes have no further use, and a gone one is refused exactly as a used one is. */
function sweep(db: Db): void {
  db.prepare('DELETE FROM auth_code WHERE used_at IS NOT NULL OR expires_at <= ?').run(now());
}

/**
 * A setup token: 128 bits, dead after one use or 30 min. Used only by the CLI,
 * which prints it and writes it nowhere. Earlier unused tokens stay valid until
 * they expire: the CLI can't know which one the founder still has open.
 */
export function issueSetupToken(db: Db, env: Env): { token: string; link: string; expiresAt: number } {
  sweep(db);
  const token = randomBytes(16).toString('base64url');
  const expiresAt = insert(db, 'setup', token);
  return { token, link: `${env.origin}/admin/setup/${token}`, expiresAt };
}

/**
 * An enrolment code for one new passkey, from a session that signed in within
 * the last 5 minutes (AC-20). A new code voids the unused ones before it, so
 * at most one is ever live.
 */
export function issueEnrolmentCode(
  db: Db,
  env: Env,
  session: Session,
): { code: string; link: string; expiresAt: number } | 'REAUTH_REQUIRED' {
  if (!isFresh(session)) return 'REAUTH_REQUIRED';
  sweep(db);
  db.prepare("DELETE FROM auth_code WHERE kind = 'enrol'").run();
  const code = newEnrolmentCode();
  const expiresAt = insert(db, 'enrol', code);
  return { code, link: `${env.origin}/admin/setup/${code}`, expiresAt };
}

interface Row {
  id: string;
  kind: CodeKind;
  hash: string;
  expires_at: number;
  used_at: number | null;
}

/**
 * The same lookup and the same hash comparison whether or not the value
 * exists, with no early return between them: a miss costs what a hit does.
 */
function check(db: Db, value: unknown): CodeRef | null {
  const hash = typeof value === 'string' ? codeHash(value) : NO_ROW_HASH;
  const row = db.prepare('SELECT id, kind, hash, expires_at, used_at FROM auth_code WHERE hash = ?').get(hash) as Row | undefined;
  const same = timingSafeEqual(Buffer.from(hash), Buffer.from(row?.hash ?? NO_ROW_HASH));
  const live = row !== undefined && row.used_at === null && row.expires_at > now();
  const known = typeof value === 'string' && same && live;
  return known && row ? { id: row.id, kind: row.kind, hash: row.hash } : null;
}

/**
 * Is this a live code? Used before a registration ceremony starts. A refusal
 * counts as a failure; a success doesn't reset the count, only a redemption does.
 * Inside a back-off wait it refuses without looking at the value.
 */
export function peekCode(db: Db, value: unknown): CodeRef | CodeRefusal {
  if (waitRemainingMs(db) > 0) return 'CODE_REFUSED';
  const found = check(db, value);
  if (!found) {
    recordFailure(db);
    return 'CODE_REFUSED';
  }
  return found;
}

/**
 * Spend the code, once. The UPDATE is the lock: two requests with the same
 * value race, and exactly one changes a row. Counts toward back-off like
 * `peekCode`, and a success resets it.
 */
export function redeemCode(db: Db, value: unknown): CodeRef | CodeRefusal {
  if (waitRemainingMs(db) > 0) return 'CODE_REFUSED';
  const found = check(db, value);
  const spent =
    found !== null &&
    db.prepare('UPDATE auth_code SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?').run(now(), found.id, now())
      .changes === 1;
  if (!found || !spent) {
    recordFailure(db);
    return 'CODE_REFUSED';
  }
  recordSuccess(db);
  return found;
}

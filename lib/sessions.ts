// Sessions live on the server (PD-13). The cookie holds 128 random bits and only
// its SHA-256 is stored, so a copy of the database can't sign anyone in.
// Nothing here runs on a public route: `touchSession` is called only by the
// /admin/api guard, so a page request never refreshes, reads or sets a session
// (D-8). There is no "remember me", no heartbeat and no sliding of the 24 h limit.
import { createHash, randomBytes } from 'node:crypto';
import { now } from './clock.ts';
import { newCsrfToken } from './csrf.ts';
import type { Db } from './db.ts';
import { limits } from './limits.ts';

/** The cookie is `__Host-imnstr_session`: Hono adds the prefix, which also forces Secure and Path=/. */
export const SESSION_COOKIE = 'imnstr_session';

export interface Session {
  idHash: string;
  /** The passkey that signed in. Removing it ends the session (AC-22). */
  openedBy: string;
  /** The passkey that marks "this device". Removing it ends the session too (AC-45). */
  deviceCredential: string;
  csrf: string;
  createdAt: number;
  lastSeenAt: number;
  /** The last passkey assertion, for the 5-minute window (AC-11). */
  authAt: number;
}

interface Row {
  id_hash: string;
  opened_by: string;
  device_credential: string;
  csrf: string;
  created_at: number;
  last_seen_at: number;
  auth_at: number;
}

const toSession = (r: Row): Session => ({
  idHash: r.id_hash,
  openedBy: r.opened_by,
  deviceCredential: r.device_credential,
  csrf: r.csrf,
  createdAt: r.created_at,
  lastSeenAt: r.last_seen_at,
  authAt: r.auth_at,
});

export const hashSessionId = (cookieValue: string): string => createHash('sha256').update(cookieValue).digest('hex');
const newCookieValue = (): string => randomBytes(16).toString('base64url');

/** Sign in: a new session, a new id. Expired rows are swept here, so the table never fills with them. */
export function createSession(
  db: Db,
  openedBy: string,
  deviceCredential = openedBy,
): { cookieValue: string; session: Session } {
  const t = now();
  db.prepare('DELETE FROM session WHERE last_seen_at <= ? OR created_at <= ?').run(
    t - limits.sessionIdleMs,
    t - limits.sessionAbsoluteMs,
  );
  const cookieValue = newCookieValue();
  const session: Session = {
    idHash: hashSessionId(cookieValue),
    openedBy,
    deviceCredential,
    csrf: newCsrfToken(),
    createdAt: t,
    lastSeenAt: t,
    authAt: t,
  };
  db.prepare(
    'INSERT INTO session (id_hash, opened_by, device_credential, csrf, created_at, last_seen_at, auth_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(session.idHash, openedBy, deviceCredential, session.csrf, t, t, t);
  return { cookieValue, session };
}

/** The live session for a cookie value, or null. An idle or over-age one is deleted as it is found. */
export function validateSession(db: Db, cookieValue: string | undefined): Session | null {
  if (!cookieValue) return null;
  const found = db.prepare('SELECT * FROM session WHERE id_hash = ?').get(hashSessionId(cookieValue)) as Row | undefined;
  if (!found) return null;
  const t = now();
  if (t - found.last_seen_at >= limits.sessionIdleMs || t - found.created_at >= limits.sessionAbsoluteMs) {
    destroySession(db, found.id_hash);
    return null;
  }
  return toSession(found);
}

/** Record an /admin/api request. Moves the idle clock only; the absolute limit never slides. */
export function touchSession(db: Db, idHash: string): void {
  db.prepare('UPDATE session SET last_seen_at = ? WHERE id_hash = ?').run(now(), idHash);
}

/** A fresh passkey assertion on a live session: the id and the CSRF token change, `auth_at` moves, `created_at` doesn't. */
export function reauthSession(db: Db, session: Session): { cookieValue: string; session: Session } {
  const t = now();
  const cookieValue = newCookieValue();
  const next: Session = { ...session, idHash: hashSessionId(cookieValue), csrf: newCsrfToken(), lastSeenAt: t, authAt: t };
  db.prepare('UPDATE session SET id_hash = ?, csrf = ?, last_seen_at = ?, auth_at = ? WHERE id_hash = ?').run(
    next.idHash,
    next.csrf,
    t,
    t,
    session.idHash,
  );
  return { cookieValue, session: next };
}

/** A sign-in within the last 5 minutes (AC-11): 4:59 counts, 5:01 doesn't. */
export function isFresh(session: Session): boolean {
  return now() - session.authAt < limits.freshSignInMs;
}

export function destroySession(db: Db, idHash: string): void {
  db.prepare('DELETE FROM session WHERE id_hash = ?').run(idHash);
}

/** "This device" is now `credentialId`: adding this device's own passkey after a cross-device sign-in (PD-13). */
export function setDeviceCredential(db: Db, idHash: string, credentialId: string): void {
  db.prepare('UPDATE session SET device_credential = ? WHERE id_hash = ?').run(credentialId, idHash);
}

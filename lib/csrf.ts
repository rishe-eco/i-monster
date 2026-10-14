// The CSRF token (PD-14). One per session, random, rotated whenever the session
// id is. SameSite=Strict is a second line of defence, not a substitute (AC-11).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const CSRF_HEADER = 'X-CSRF-Token';

export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Constant-time comparison. Both sides are hashed first, so a length difference leaks nothing either. */
export function csrfMatches(expected: string, given: string | null | undefined): boolean {
  if (!given) return false;
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(given).digest();
  return timingSafeEqual(a, b);
}

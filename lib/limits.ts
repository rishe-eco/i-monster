// Every time limit and size limit, in one file (house rule 4; plan §6.4).
// Durations are milliseconds unless the name says otherwise.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export const limits = {
  /** A session with no `/admin/api` request for this long ends (AC-10). */
  sessionIdleMs: 1 * HOUR,
  /** A session ends this long after it opened, however busy (AC-10). */
  sessionAbsoluteMs: 24 * HOUR,
  /** A passkey assertion this recent counts as a fresh sign-in (AC-11). */
  freshSignInMs: 5 * MINUTE,
  /** The setup token from the CLI (AC-21). */
  setupTokenMs: 30 * MINUTE,
  /** An enrolment code (AC-20). */
  enrolmentCodeMs: 10 * MINUTE,
  /** A WebAuthn challenge (PD-17). */
  webauthnChallengeMs: 5 * MINUTE,
  /** Entries and episodes per public page (AC-30). */
  pageSize: 20,
  /** Entries in the Atom feed (AC-3). */
  feedSize: 20,
  /** How long "Copied" shows (change note 03). */
  copiedMs: 2 * SECOND,
  /**
   * The largest entry body the API accepts. A guard against accidents, not a
   * rule: no message names it (plan §6.4, a proposal).
   */
  bodyMaxBytes: 64 * 1024,
} as const;

/** Failures at which waiting starts, and the longest wait (PD-15). */
const BACKOFF_FROM_FAILURE = 4;
const BACKOFF_CAP_SECONDS = 30;

/**
 * Seconds an attempt must wait before it is checked, after `failures`
 * consecutive failures. None for the first three; then min(2^(n-3), 30).
 */
export function backoffSeconds(failures: number): number {
  if (!Number.isInteger(failures) || failures < 0) {
    throw new RangeError('failures must be a non-negative integer');
  }
  if (failures < BACKOFF_FROM_FAILURE) return 0;
  return Math.min(2 ** (failures - 3), BACKOFF_CAP_SECONDS);
}

// Every time limit and size limit, in one file (house rule 4; plan §6.4).
// Durations are milliseconds unless the name says otherwise.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const limits = {
  /**
   * A session with no `/admin/api` request for this long ends (AC-10). Change note 06: 7 days, not 1 h, so the passkey
   * (and the device's PIN prompt) is asked for once in a while, not at every visit. The founder's call, 2026-10-18.
   */
  sessionIdleMs: 7 * DAY,
  /** A session ends this long after it opened, however busy (AC-10; change note 06: 30 days, not 24 h). */
  sessionAbsoluteMs: 30 * DAY,
  /** A passkey assertion this recent counts as a fresh sign-in (AC-11). */
  freshSignInMs: 5 * MINUTE,
  /** The setup token from the CLI (AC-21). */
  setupTokenMs: 30 * MINUTE,
  /** An enrolment code (AC-20). */
  enrolmentCodeMs: 10 * MINUTE,
  /** A WebAuthn challenge (PD-17). */
  webauthnChallengeMs: 5 * MINUTE,
  /** After repeated sign-in failures the admin's button waits this long before it comes back (plate 6). */
  signInPauseMs: 5 * SECOND,
  /** The longest passkey name, in characters (B4a; the admin field and the API both read it). */
  passkeyNameMax: 60,
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
  /**
   * The longest entry title, in UTF-16 code units after trimming, the unit the admin field's
   * `maxlength` counts. Large on purpose: a guard against a pasted page, not a rule about titles (F-16).
   */
  titleMaxChars: 1000,
  /**
   * The longest episode name, description, tag, link label and link address, in UTF-16 code units after
   * trimming (the unit a field's `maxlength` counts), and the most links one episode holds. Large on purpose,
   * like the title's: guards against a pasted page, not rules about episodes (B7). A name is a title, so it
   * takes the title's number.
   */
  episodeNameMaxChars: 1000,
  episodeDescriptionMaxChars: 10_000,
  episodeTagMaxChars: 100,
  episodeLinkLabelMaxChars: 100,
  episodeLinkUrlMaxChars: 2000,
  episodeLinksMax: 20,
  /**
   * Rows one record table may hold for one month and language (PD-20). A
   * client chooses its own Referer and user agent, so without a cap it could
   * grow the table without end; past it a new key is dropped, old ones count on.
   */
  recordKeysPerMonth: 500,
  /**
   * The contact form's fields, in characters (code points) after trimming: the unit SQLite's `length()` counts, so the
   * table's CHECKs and the code agree (CT-4, CT-10).
   */
  contactSubjectMax: 120,
  contactMessageMax: 5000,
  contactReachMax: 200,
  /**
   * The most messages the site stores in any rolling 24 hours (CT-5). Site-wide, not per sender: the app never reads
   * the client address (house rule 9), so it can't tell senders apart.
   */
  contactCap: 30,
  contactCapWindowMs: DAY,
  /**
   * The largest form post read. A field at its limit in a four-byte script, percent-encoded, is about 64 KiB, so this
   * is twice that: it refuses a pasted file before the server reads it, and Nginx's 1 MiB never decides first.
   */
  contactBodyMaxBytes: 128 * 1024,
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

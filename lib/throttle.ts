// Back-off for sign-in and code redemption (PD-15, D-3). The site has one
// account, so one row counts consecutive failures of both. From the 4th failure
// the next attempt must wait min(2^(n-3), 30) s (`backoffSeconds`), measured
// on the clock. The cap is what makes this safe: a stranger can slow the
// founder's sign-in by at most 30 s, never lock it.
import { now } from './clock.ts';
import type { Db } from './db.ts';
import { backoffSeconds } from './limits.ts';

interface Row {
  failures: number;
  last_failure_at: number | null;
}

function row(db: Db): Row {
  return db.prepare('SELECT failures, last_failure_at FROM auth_throttle WHERE id = 1').get() as Row;
}

/**
 * Milliseconds an attempt must still wait, 0 when it may be checked. An attempt
 * made inside the wait is refused unchecked and changes nothing, so hammering
 * can't stretch the wait: only a checked failure moves the timer.
 */
export function waitRemainingMs(db: Db): number {
  const { failures, last_failure_at: last } = row(db);
  if (last === null) return 0;
  return Math.max(0, last + backoffSeconds(failures) * 1000 - now());
}

export function recordFailure(db: Db): void {
  db.prepare('UPDATE auth_throttle SET failures = failures + 1, last_failure_at = ? WHERE id = 1').run(now());
}

/** A success resets the count (D-3). */
export function recordSuccess(db: Db): void {
  db.prepare('UPDATE auth_throttle SET failures = 0, last_failure_at = NULL WHERE id = 1').run();
}

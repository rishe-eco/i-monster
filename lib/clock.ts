// The one place the wall clock is read. Everything else asks `now()`, so tests
// and the e2e suite can fix time (house rule 5). Instants are UTC milliseconds.

let fixed: number | null = null;

export function now(): number {
  return fixed ?? Date.now();
}

/** Fix the clock at an instant, or pass null to follow the wall clock again. */
export function setNow(instant: number | null): void {
  if (instant !== null && !Number.isSafeInteger(instant)) {
    throw new RangeError('The clock takes whole milliseconds');
  }
  fixed = instant;
}

export function resetClock(): void {
  fixed = null;
}

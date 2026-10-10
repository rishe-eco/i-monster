import { afterEach, describe, expect, it } from 'vitest';
import { now, resetClock, setNow } from '../../lib/clock.ts';
import { NOW } from '../helpers.ts';

afterEach(resetClock);

describe('clock', () => {
  it('follows the wall clock until it is set', () => {
    const before = now();
    const after = now();
    expect(after).toBeGreaterThanOrEqual(before);
    expect(Number.isSafeInteger(after)).toBe(true);
  });

  it('can be fixed at an instant, and let go', () => {
    setNow(NOW);
    expect(now()).toBe(NOW);
    expect(now()).toBe(NOW);
    setNow(null);
    expect(now()).not.toBe(NOW);
  });

  it('refuses an instant that is not whole milliseconds', () => {
    expect(() => setNow(1.5)).toThrow(RangeError);
    expect(() => setNow(Number.NaN)).toThrow(RangeError);
  });
});

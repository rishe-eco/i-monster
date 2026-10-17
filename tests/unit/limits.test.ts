import { describe, expect, it } from 'vitest';
import { backoffSeconds, limits } from '../../lib/limits.ts';

describe('limits', () => {
  it('holds the values of plan §6.4', () => {
    expect(limits.sessionIdleMs).toBe(60 * 60_000);
    expect(limits.sessionAbsoluteMs).toBe(24 * 60 * 60_000);
    expect(limits.freshSignInMs).toBe(5 * 60_000);
    expect(limits.setupTokenMs).toBe(30 * 60_000);
    expect(limits.enrolmentCodeMs).toBe(10 * 60_000);
    expect(limits.webauthnChallengeMs).toBe(5 * 60_000);
    expect(limits.pageSize).toBe(20);
    expect(limits.feedSize).toBe(20);
    expect(limits.copiedMs).toBe(2000);
    expect(limits.signInPauseMs).toBe(5000);
    expect(limits.passkeyNameMax).toBe(60);
    expect(limits.bodyMaxBytes).toBe(64 * 1024);
    expect(limits.recordKeysPerMonth).toBe(500);
  });
});

describe('backoffSeconds', () => {
  it('does not wait for the first three failures', () => {
    expect([0, 1, 2, 3].map(backoffSeconds)).toEqual([0, 0, 0, 0]);
  });

  it('starts at the 4th failure with min(2^(n-3), 30)', () => {
    expect([4, 5, 6, 7, 8].map(backoffSeconds)).toEqual([2, 4, 8, 16, 30]);
  });

  it('is capped at 30 seconds however many failures', () => {
    expect(backoffSeconds(9)).toBe(30);
    expect(backoffSeconds(1000)).toBe(30);
  });

  it('refuses a count that is not a whole non-negative number', () => {
    expect(() => backoffSeconds(-1)).toThrow(RangeError);
    expect(() => backoffSeconds(1.5)).toThrow(RangeError);
  });
});

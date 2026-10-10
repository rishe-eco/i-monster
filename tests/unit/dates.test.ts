import { describe, expect, it } from 'vitest';
import { feedDate, formatAdminDate, formatEntryDate } from '../../lib/dates.ts';
import { NOW } from '../helpers.ts';

const TEHRAN = 'Asia/Tehran'; // UTC+03:30 all year since 2022
const utc = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min);

// These strings are pinned on purpose: Intl output depends on the ICU version,
// and a Node upgrade that changes one should fail here, loudly.
describe('formatEntryDate', () => {
  it('writes English as "2 Nov 2026, 21:14"', () => {
    expect(formatEntryDate(utc(2026, 11, 2, 17, 44), 'en', TEHRAN)).toBe('2 Nov 2026, 21:14');
  });

  it('writes Persian in Solar Hijri with Persian digits and the Persian comma', () => {
    expect(formatEntryDate(utc(2026, 11, 2, 17, 44), 'fa', TEHRAN)).toBe('۱۱ آبان ۱۴۰۵، ۲۱:۱۴');
  });

  it('keeps two digits in the hour and minute', () => {
    expect(formatEntryDate(utc(2026, 9, 15, 5, 35), 'en', TEHRAN)).toBe('15 Sep 2026, 09:05');
    expect(formatEntryDate(utc(2026, 9, 15, 5, 35), 'fa', TEHRAN)).toBe('۲۴ شهریور ۱۴۰۵، ۰۹:۰۵');
  });

  describe('Nowruz, the Solar Hijri new year', () => {
    // 1 Farvardin 1405 began at 00:00 Tehran on 21 March 2026 (20:30 UTC the day before).
    it('is still 29 Esfand 1404 one minute before', () => {
      const instant = utc(2026, 3, 20, 20, 29);
      expect(formatEntryDate(instant, 'fa', TEHRAN)).toBe('۲۹ اسفند ۱۴۰۴، ۲۳:۵۹');
      expect(formatEntryDate(instant, 'en', TEHRAN)).toBe('20 Mar 2026, 23:59');
    });

    it('is 1 Farvardin 1405 at midnight', () => {
      const instant = utc(2026, 3, 20, 20, 30);
      expect(formatEntryDate(instant, 'fa', TEHRAN)).toBe('۱ فروردین ۱۴۰۵، ۰۰:۰۰');
      expect(formatEntryDate(instant, 'en', TEHRAN)).toBe('21 Mar 2026, 00:00');
    });
  });

  describe('the site timezone against UTC', () => {
    it('is still 31 December in UTC when it is already 1 January in Tehran', () => {
      const instant = utc(2026, 12, 31, 20, 30); // 00:00 on 1 January in Tehran
      expect(formatEntryDate(instant, 'en', TEHRAN)).toBe('1 Jan 2027, 00:00');
      expect(formatEntryDate(instant, 'en', 'UTC')).toBe('31 Dec 2026, 20:30');
    });

    it('is 31 December in both one minute earlier, with different clocks', () => {
      const instant = utc(2026, 12, 31, 20, 29);
      expect(formatEntryDate(instant, 'en', TEHRAN)).toBe('31 Dec 2026, 23:59');
      expect(formatEntryDate(instant, 'en', 'UTC')).toBe('31 Dec 2026, 20:29');
    });
  });

  it('puts a 23:59 publish in Tehran on a different clock from UTC, and a day on at 00:01', () => {
    const instant = utc(2026, 6, 10, 20, 29); // 23:59 on 10 June in Tehran
    expect(formatEntryDate(instant, 'en', TEHRAN)).toBe('10 Jun 2026, 23:59');
    expect(formatEntryDate(utc(2026, 6, 10, 20, 31), 'en', TEHRAN)).toBe('11 Jun 2026, 00:01');
    // In UTC the same instant is still 20:29, on the 10th.
    expect(formatEntryDate(instant, 'en', 'UTC')).toBe('10 Jun 2026, 20:29');
  });

  it('uses SITE_TZ (Asia/Tehran by default) when no zone is given', () => {
    expect(formatEntryDate(utc(2026, 11, 2, 17, 44), 'en')).toBe('2 Nov 2026, 21:14');
  });
});

describe('formatAdminDate', () => {
  it('is Gregorian and English, and leaves out the current year', () => {
    expect(formatAdminDate(utc(2026, 11, 2, 17, 44), NOW, TEHRAN)).toBe('2 Nov, 21:14');
  });

  it('shows the year for an older item', () => {
    expect(formatAdminDate(utc(2025, 11, 2, 17, 44), NOW, TEHRAN)).toBe('2 Nov 2025, 21:14');
  });

  it('compares years in the site timezone, not in UTC', () => {
    const justIntoNewYear = utc(2026, 12, 31, 20, 30); // 1 Jan 2027 in Tehran
    const now = utc(2026, 12, 31, 12, 0); // still 2026 in both
    expect(formatAdminDate(justIntoNewYear, now, TEHRAN)).toBe('1 Jan 2027, 00:00');
    expect(formatAdminDate(justIntoNewYear, now, 'UTC')).toBe('31 Dec, 20:30');
  });
});

describe('feedDate', () => {
  it('is RFC 3339 with the site offset', () => {
    expect(feedDate(utc(2026, 11, 2, 17, 44), TEHRAN)).toBe('2026-11-02T21:14:00+03:30');
  });

  it('carries the day change across midnight', () => {
    expect(feedDate(utc(2026, 12, 31, 20, 30), TEHRAN)).toBe('2027-01-01T00:00:00+03:30');
  });

  it('writes a zero offset as +00:00', () => {
    expect(feedDate(utc(2026, 11, 2, 17, 44), 'UTC')).toBe('2026-11-02T17:44:00+00:00');
  });

  it('writes a negative offset', () => {
    expect(feedDate(utc(2026, 12, 31, 20, 29), 'America/New_York')).toBe('2026-12-31T15:29:00-05:00');
  });
});

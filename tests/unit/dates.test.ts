import { describe, expect, it } from 'vitest';
import { feedDate, formatAdminDate, formatAdminDay, formatAdminListDate, formatEntryDate, recordMonth } from '../../lib/dates.ts';
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

describe('formatAdminDay', () => {
  it('names the day with its year, in the site timezone, and no time', () => {
    expect(formatAdminDay(utc(2026, 10, 10, 12), TEHRAN)).toBe('10 Oct 2026');
    // 22:00 UTC is already the next day in Tehran.
    expect(formatAdminDay(utc(2026, 12, 31, 22), TEHRAN)).toBe('1 Jan 2027');
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

describe('formatAdminListDate (the entries list, plate 8, AC-31)', () => {
  it('leaves out the year in the current year, and writes the day and the month only', () => {
    expect(formatAdminListDate(utc(2026, 11, 2, 17, 44), NOW, TEHRAN)).toBe('2 Nov');
    expect(formatAdminListDate(utc(2026, 1, 1, 0, 0), NOW, TEHRAN)).toBe('1 Jan');
  });

  it('writes the year for any other year', () => {
    expect(formatAdminListDate(utc(2025, 12, 14, 9, 0), NOW, TEHRAN)).toBe('14 Dec 2025');
    expect(formatAdminListDate(utc(2027, 3, 1, 9, 0), NOW, TEHRAN)).toBe('1 Mar 2027');
  });

  describe('around 1 January in Tehran, where the year turns 3.5 hours before UTC does', () => {
    const lastMinute = utc(2026, 12, 31, 20, 29); // 23:59 on 31 December in Tehran
    const firstMinute = utc(2026, 12, 31, 20, 30); // 00:00 on 1 January in Tehran

    it("is still this year in the last minute of 2026, and the next minute's row has the year", () => {
      expect(formatAdminListDate(lastMinute, lastMinute, TEHRAN)).toBe('31 Dec');
      expect(formatAdminListDate(firstMinute, lastMinute, TEHRAN)).toBe('1 Jan 2027');
    });

    it('gives every row of 2026 its year the moment the new year starts in Tehran', () => {
      expect(formatAdminListDate(lastMinute, firstMinute, TEHRAN)).toBe('31 Dec 2026');
      expect(formatAdminListDate(utc(2026, 3, 1), firstMinute, TEHRAN)).toBe('1 Mar 2026');
      expect(formatAdminListDate(firstMinute, firstMinute, TEHRAN)).toBe('1 Jan');
    });

    it('is not decided by UTC: at 21:00 UTC on 31 December it is already 2027 in Tehran and still 2026 in UTC', () => {
      const instant = utc(2026, 12, 31, 21, 0);
      expect(formatAdminListDate(instant, instant, TEHRAN)).toBe('1 Jan');
      expect(formatAdminListDate(utc(2026, 6, 1), instant, TEHRAN)).toBe('1 Jun 2026');
      expect(formatAdminListDate(utc(2026, 6, 1), instant, 'UTC')).toBe('1 Jun');
    });
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

describe('formatFeedTitleDate (AC-40)', () => {
  it('writes the date in full, Gregorian in English', async () => {
    const { formatFeedTitleDate } = await import('../../lib/dates.ts');
    expect(formatFeedTitleDate(Date.UTC(2026, 9, 13, 4, 0, 0), 'en', 'Asia/Tehran')).toBe('13 October 2026');
  });

  it('writes Solar Hijri with Persian digits in Persian', async () => {
    const { formatFeedTitleDate } = await import('../../lib/dates.ts');
    expect(formatFeedTitleDate(Date.UTC(2026, 9, 20, 18, 30, 0), 'fa', 'Asia/Tehran')).toBe('۲۸ مهر ۱۴۰۵');
  });
});

describe('recordMonth (PD-20)', () => {
  it('files an instant under its Tehran month: 31 Oct 20:29 UTC is October, 20:31 is November', () => {
    expect(recordMonth(Date.UTC(2026, 9, 31, 20, 29, 59), TEHRAN)).toBe('2026-10');
    expect(recordMonth(Date.UTC(2026, 9, 31, 20, 30, 0), TEHRAN)).toBe('2026-11');
    expect(recordMonth(Date.UTC(2026, 9, 31, 20, 31, 0), TEHRAN)).toBe('2026-11');
  });

  it('turns the year in the site timezone, and writes Latin digits', () => {
    expect(recordMonth(Date.UTC(2026, 11, 31, 20, 31, 0), TEHRAN)).toBe('2027-01');
    expect(recordMonth(Date.UTC(2026, 11, 31, 20, 31, 0), 'UTC')).toBe('2026-12');
    expect(recordMonth(NOW, TEHRAN)).toBe('2026-10');
  });
});

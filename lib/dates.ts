// Every date the site shows, in one file (house rule 4; PD-9). No date library:
// everything goes through Intl. Instants are UTC milliseconds, shown in SITE_TZ.
//
// Intl output varies with the ICU version, so no string here is cut up or
// patched. Each result is assembled from formatToParts, and the unit tests pin
// exact strings so a Node upgrade that changes one fails loudly.
import { env } from './env.ts';
import type { Lang } from './i18n.ts';

type Parts = Record<string, string>;

function partsOf(instant: number, locale: string, options: Intl.DateTimeFormatOptions): Parts {
  const parts: Parts = {};
  for (const part of new Intl.DateTimeFormat(locale, options).formatToParts(instant)) {
    parts[part.type] = part.value;
  }
  return parts;
}

// 24-hour clock, always two digits, so "09:05" and "21:14" line up.
const CLOCK: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
};

/**
 * An entry's date and time as a public page shows it, with the year (AC-31).
 * English: "2 Nov 2026, 21:14". Persian: Solar Hijri, Persian digits,
 * "۲۸ مهر ۱۴۰۵، ۲۱:۱۴".
 */
export function formatEntryDate(instant: number, lang: Lang, timeZone: string = env.siteTz): string {
  if (lang === 'fa') {
    // `fa-IR` is Solar Hijri with Persian digits by default; naming both keeps
    // that true if a runtime's default ever changes.
    const p = partsOf(instant, 'fa-IR-u-ca-persian-nu-arabext', {
      timeZone,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      ...CLOCK,
    });
    // The comma after the year is the Persian one, U+060C.
    return `${p.day} ${p.month} ${p.year}، ${p.hour}:${p.minute}`;
  }
  const p = partsOf(instant, 'en-US', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...CLOCK,
  });
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`;
}

/**
 * A date in the admin, which is English and Gregorian whatever the item's
 * language (PD-9). The year is left out when it is the current year in the
 * site's timezone (AC-31): "2 Nov, 21:14" now, "2 Nov 2025, 21:14" a year on.
 */
export function formatAdminDate(instant: number, now: number, timeZone: string = env.siteTz): string {
  const p = partsOf(instant, 'en-US', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...CLOCK,
  });
  const currentYear = partsOf(now, 'en-US', { timeZone, year: 'numeric' }).year;
  const date = p.year === currentYear ? `${p.day} ${p.month}` : `${p.day} ${p.month} ${p.year}`;
  return `${date}, ${p.hour}:${p.minute}`;
}

/**
 * The date on an entries-list row (plate 8, AC-31): "2 Nov" in the current
 * year of the site's timezone and "14 Dec 2025" in any other. The list has no
 * room for the time, and the year rule is the one `formatAdminDate` applies.
 */
export function formatAdminListDate(instant: number, now: number, timeZone: string = env.siteTz): string {
  const p = partsOf(instant, 'en-US', { timeZone, day: 'numeric', month: 'short', year: 'numeric' });
  const currentYear = partsOf(now, 'en-US', { timeZone, year: 'numeric' }).year;
  return p.year === currentYear ? `${p.day} ${p.month}` : `${p.day} ${p.month} ${p.year}`;
}

/**
 * A day as the admin names it where the time of day adds nothing, with the
 * year always: "10 Oct 2026". The passkey list uses it for "added" (AC-22).
 */
export function formatAdminDay(instant: number, timeZone: string = env.siteTz): string {
  const p = partsOf(instant, 'en-US', { timeZone, day: 'numeric', month: 'short', year: 'numeric' });
  return `${p.day} ${p.month} ${p.year}`;
}

/** The offset of a timezone at an instant, as "+03:30" or "-05:00". */
function offsetOf(instant: number, timeZone: string): string {
  const name = partsOf(instant, 'en-US', { timeZone, timeZoneName: 'longOffset', hour: 'numeric' })
    .timeZoneName;
  // ICU writes "GMT+03:30", or a bare "GMT" at zero offset.
  const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name ?? '');
  if (!match) throw new Error(`Unexpected timezone offset text: "${name}"`);
  return match[1] ? `${match[1]}${match[2]}:${match[3]}` : '+00:00';
}

/** An instant as RFC 3339 with the site's offset, for the feed: "2026-11-02T21:14:00+03:30". */
export function feedDate(instant: number, timeZone: string = env.siteTz): string {
  const p = partsOf(instant, 'en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${offsetOf(instant, timeZone)}`;
}

/**
 * An untitled entry's title in the feed (AC-40): its date alone, written in
 * full. English: "13 October 2026". Persian: Solar Hijri, Persian digits,
 * "۲۸ مهر ۱۴۰۵".
 */
export function formatFeedTitleDate(instant: number, lang: Lang, timeZone: string = env.siteTz): string {
  const p =
    lang === 'fa'
      ? partsOf(instant, 'fa-IR-u-ca-persian-nu-arabext', { timeZone, day: 'numeric', month: 'long', year: 'numeric' })
      : partsOf(instant, 'en-US', { timeZone, day: 'numeric', month: 'long', year: 'numeric' });
  return `${p.day} ${p.month} ${p.year}`;
}

/**
 * The month the reader record files an instant under (PD-20): `YYYY-MM`,
 * Gregorian, Latin digits, in the site's timezone, so a visit at 00:10 on the
 * 1st in Tehran belongs to the new month even though UTC is still the old one.
 */
export function recordMonth(instant: number, timeZone: string = env.siteTz): string {
  const p = partsOf(instant, 'en-US', { timeZone, year: 'numeric', month: '2-digit' });
  return `${p.year}-${p.month}`;
}

// ── Calendar dates (B7) ────────────────────────────────────────────────────
// An episode's date is a day, `YYYY-MM-DD`, never an instant (plan B7, traps). Nothing below converts a
// zone: the day is read as the digits it is, so it can't slip across midnight in any timezone.

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether the text is a real calendar day written `YYYY-MM-DD` (not "2026-02-30"). */
export function isCalendarDay(text: string): boolean {
  const match = DAY_PATTERN.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

/** The calendar day it is in `timeZone` at an instant: `YYYY-MM-DD`. The default date of a new episode. */
export function todayIn(instant: number, timeZone: string = env.siteTz): string {
  const p = partsOf(instant, 'en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * A calendar day as an instant in UTC at noon, formatted in UTC: the same day whatever the zone of the
 * machine or of the site, since no offset can move noon to another date.
 */
function dayInstant(day: string): number {
  const match = DAY_PATTERN.exec(day);
  if (!match) throw new RangeError(`Not a YYYY-MM-DD day: "${day}"`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

/**
 * An episode's date as a public page shows it, with the year (AC-31). English: "10 Oct 2026". Persian:
 * Solar Hijri with Persian digits, "۱۸ مهر ۱۴۰۵".
 */
export function formatDay(day: string, lang: Lang): string {
  const instant = dayInstant(day);
  if (lang === 'fa') {
    const p = partsOf(instant, 'fa-IR-u-ca-persian-nu-arabext', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
    return `${p.day} ${p.month} ${p.year}`;
  }
  const p = partsOf(instant, 'en-US', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
  return `${p.day} ${p.month} ${p.year}`;
}

/**
 * An episode's date on an admin list row (AC-31): "10 Oct" in the current year and "10 Oct 2025" in any
 * other. The admin is English and Gregorian whatever the episode's language (PD-9). `today` is the server's
 * day, so the bundle never reads the browser's clock.
 */
export function formatAdminListDay(day: string, today: string): string {
  const p = partsOf(dayInstant(day), 'en-US', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
  return p.year === today.slice(0, 4) ? `${p.day} ${p.month}` : `${p.day} ${p.month} ${p.year}`;
}

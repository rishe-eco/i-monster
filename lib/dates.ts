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

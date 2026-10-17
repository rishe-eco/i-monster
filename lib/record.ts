// The reader record (spec §3.1, PD-20; house rule 4: this is its one file, and
// only its middleware and the two CLIs import it). It keeps three kinds of
// counts and nothing that could describe one visitor:
//   R1  page views, per month, language and page;
//   R2  the highest subscriber count a feed reader reported, per aggregator;
//   R3  the domain of the Referer, per month and language.
// The user agent and the Referer are read in memory by the parsers below and
// are never stored: only a number, and a name from a fixed table or a short
// token, ever reaches the database.
import type { Db } from './db.ts';
import { LANGS, type Lang } from './i18n.ts';
import { limits } from './limits.ts';
import { isId } from './ids.ts';

// ── What a request is ──────────────────────────────────────────────────────

export type Target = { kind: 'view'; page: string } | { kind: 'feed' };

/**
 * What a public GET counts as, by path alone and from a whitelist. `path` is
 * the path without its language prefix. Anything not named here (the admin,
 * assets, `/healthz`, a 404) is not counted.
 */
export function targetOf(path: string): Target | null {
  if (path === '/') return { kind: 'view', page: 'landing' };
  if (path === '/log') return { kind: 'view', page: 'log' };
  if (path === '/podcast') return { kind: 'view', page: 'podcast' };
  if (path === '/log/feed.xml') return { kind: 'feed' };
  if (path.startsWith('/log/')) {
    const id = path.slice('/log/'.length);
    if (isId(id)) return { kind: 'view', page: id };
  }
  return null;
}

// ── Bots (R1 and R3) ───────────────────────────────────────────────────────

const BOT_PATTERN = new RegExp(
  [
    'bot', 'crawl', 'spider', 'slurp', 'preview', 'monitor', 'uptime', 'headless', 'lighthouse', 'curl', 'wget',
    'python', 'go-http-client', 'java/', 'okhttp', 'node-fetch', 'axios', 'facebookexternalhit', 'feed',
    'scan', 'probe', 'libwww', 'httpclient', 'pingdom',
    // Link-preview fetchers that name themselves without "bot". A post shared on
    // Mastodon is fetched once by every server that receives it, so one share
    // would otherwise read as dozens of views.
    'whatsapp', 'mastodon', 'http\\.rb', 'pleroma', 'akkoma', 'misskey', 'cardyb', 'iframely', 'embedly', 'vkshare',
  ].join('|'),
  'i',
);

/** An empty user agent, or one that names a robot. Skipped for R1 and R3, never for R2. */
export function isBot(userAgent: string | undefined): boolean {
  const ua = userAgent?.trim() ?? '';
  return ua === '' || BOT_PATTERN.test(ua);
}

// ── R2: subscribers in a feed reader's user agent ──────────────────────────
// Every format in tests/unit/record.test.ts is a GUESS at what each aggregator
// sends, to be confirmed by real fetches once the founder has subscribed in two
// of them (plan §5 B8, trap 1). The count is the same pattern for all of them.

const SUBSCRIBERS = /(\d+)\s+(?:subscribers?|readers?)/i;
const MAX_SUBSCRIBERS = 1_000_000;

/** The subscriber count a user agent reports, or null when it reports none or an absurd one. */
export function subscribersOf(userAgent: string | undefined): number | null {
  const match = SUBSCRIBERS.exec(userAgent ?? '');
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isSafeInteger(n) && n >= 1 && n <= MAX_SUBSCRIBERS ? n : null;
}

const KNOWN_AGGREGATORS: [needle: string, name: string][] = [
  ['feedly', 'Feedly'],
  ['inoreader', 'Inoreader'],
  ['newsblur', 'NewsBlur'],
  ['feedbin', 'Feedbin'],
  ['theoldreader', 'The Old Reader'],
  ['the old reader', 'The Old Reader'],
  ['bazqux', 'BazQux'],
  ['miniflux', 'Miniflux'],
  ['tiny tiny rss', 'Tiny Tiny RSS'],
  ['tt-rss', 'Tiny Tiny RSS'],
];

// Words that open nearly every browser-style agent and say nothing about the reader.
const BOILERPLATE = new Set(['mozilla', 'compatible']);

/** The aggregator a feed user agent comes from: a known name, else its first product token, else `other`. */
export function aggregatorOf(userAgent: string): string {
  const lower = userAgent.toLowerCase();
  for (const [needle, name] of KNOWN_AGGREGATORS) {
    if (lower.includes(needle)) return name;
  }
  for (const match of userAgent.matchAll(/[A-Za-z][\w.-]{0,39}/g)) {
    if (!BOILERPLATE.has(match[0].toLowerCase())) return match[0];
  }
  return 'other';
}

// ── R3: the referring domain ───────────────────────────────────────────────

const MAX_REFERER_LENGTH = 8192;
const MAX_HOST_LENGTH = 253;

function withoutWww(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : host;
}

// Names that only resolve inside a reader's own network, like an IP literal:
// a single label (`intranet`) or a suffix no public domain can have.
const LOCAL_SUFFIXES = ['.localhost', '.local', '.lan', '.internal', '.home.arpa'];

function isLocalName(host: string): boolean {
  return !host.includes('.') || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * The domain a `Referer` stands for, or null when it must not be counted: no
 * header, a scheme other than http(s), the site's own host, an IP literal or a
 * local name (either could be a reader's own network) or an absurd host.
 * `ownHost` is the site's hostname.
 */
export function refererDomain(referer: string | undefined, ownHost: string): string | null {
  if (!referer || referer.length > MAX_REFERER_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // URL normalises odd spellings of an address (hex, decimal) to dotted form, so one test covers them.
  if (url.hostname.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) return null;
  let host = withoutWww(url.hostname.toLowerCase());
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host === '' || host.length > MAX_HOST_LENGTH || isLocalName(host)) return null;
  if (host === withoutWww(ownHost.toLowerCase())) return null;
  return host;
}

// ── Writes: single upserts ─────────────────────────────────────────────────

export function countView(db: Db, month: string, lang: Lang, page: string): void {
  db.prepare(
    `INSERT INTO record_view (month, lang, page, views) VALUES (?, ?, ?, 1)
     ON CONFLICT (month, lang, page) DO UPDATE SET views = views + 1`,
  ).run(month, lang, page);
}

// For feed and referrer a client chooses the key, so a new key is let in only
// while the month holds fewer than the cap for this table and language. A key
// already there always counts on.

/** Keep the month's highest `subscribers` for this aggregator: a maximum, never a sum. */
export function countFeed(db: Db, month: string, lang: Lang, aggregator: string, subscribers: number): void {
  db.prepare(
    `INSERT INTO record_feed (month, lang, aggregator, subscribers)
     SELECT @month, @lang, @key, @n
     WHERE EXISTS (SELECT 1 FROM record_feed WHERE month = @month AND lang = @lang AND aggregator = @key)
        OR (SELECT count(*) FROM record_feed WHERE month = @month AND lang = @lang) < @cap
     ON CONFLICT (month, lang, aggregator) DO UPDATE SET subscribers = max(subscribers, excluded.subscribers)`,
  ).run({ month, lang, key: aggregator, n: subscribers, cap: limits.recordKeysPerMonth });
}

export function countReferrer(db: Db, month: string, lang: Lang, domain: string): void {
  db.prepare(
    `INSERT INTO record_referrer (month, lang, domain, count)
     SELECT @month, @lang, @key, 1
     WHERE EXISTS (SELECT 1 FROM record_referrer WHERE month = @month AND lang = @lang AND domain = @key)
        OR (SELECT count(*) FROM record_referrer WHERE month = @month AND lang = @lang) < @cap
     ON CONFLICT (month, lang, domain) DO UPDATE SET count = count + 1`,
  ).run({ month, lang, key: domain, cap: limits.recordKeysPerMonth });
}

/** Empty the record. `reset-content` calls this inside its own transaction. */
export function clearRecord(db: Db): void {
  db.prepare('DELETE FROM record_view').run();
  db.prepare('DELETE FROM record_feed').run();
  db.prepare('DELETE FROM record_referrer').run();
}

// ── The report ─────────────────────────────────────────────────────────────

export interface EntryViews {
  id: string;
  /** The entry's title, else its opening words; null once the row is gone. */
  label: string | null;
  views: number;
}

export interface LangReport {
  /** `landing`, `log` and `podcast`, most viewed first. */
  pages: { page: string; views: number }[];
  entries: EntryViews[];
  /** The highest subscribers any month in the period reported, per aggregator, most first. */
  aggregators: { aggregator: string; subscribers: number }[];
  referrers: { domain: string; count: number }[];
}

export interface Report {
  from: string;
  to: string;
  langs: Record<Lang, LangReport>;
  /** Months in which a table reached the key cap, so some domains or aggregators were dropped. */
  capped: { table: 'feed' | 'referrer'; month: string; lang: Lang }[];
}

const PAGE_NAMES = new Set(['landing', 'log', 'podcast']);
const LABEL_MAX = 60;

function openingWords(bodyJson: string): string {
  let text = '';
  try {
    const doc = JSON.parse(bodyJson) as { content?: { content?: { text?: string }[] }[] };
    for (const paragraph of doc.content ?? []) {
      for (const node of paragraph.content ?? []) text += node.text ?? '';
      text += ' ';
      if (text.length > LABEL_MAX * 2) break;
    }
  } catch {
    return '';
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length <= LABEL_MAX) return text;
  const cut = text.slice(0, LABEL_MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 1))}…`;
}

/** Totals for the months `from` to `to`, both `YYYY-MM` and both inclusive. Strings of that shape sort as dates. */
export function report(db: Db, from: string, to: string): Report {
  const langs = {} as Record<Lang, LangReport>;
  for (const lang of LANGS) {
    const views = db
      .prepare('SELECT page, sum(views) AS views FROM record_view WHERE lang = ? AND month BETWEEN ? AND ? GROUP BY page ORDER BY views DESC, page')
      .all(lang, from, to) as { page: string; views: number }[];
    const entries: EntryViews[] = [];
    for (const row of views.filter((v) => !PAGE_NAMES.has(v.page))) {
      const found = db.prepare('SELECT title, body FROM entry WHERE id = ?').get(row.page) as { title: string | null; body: string } | undefined;
      entries.push({ id: row.page, label: found ? found.title?.trim() || openingWords(found.body) : null, views: row.views });
    }
    langs[lang] = {
      pages: views.filter((v) => PAGE_NAMES.has(v.page)),
      entries,
      aggregators: db
        .prepare('SELECT aggregator, max(subscribers) AS subscribers FROM record_feed WHERE lang = ? AND month BETWEEN ? AND ? GROUP BY aggregator ORDER BY subscribers DESC, aggregator')
        .all(lang, from, to) as { aggregator: string; subscribers: number }[],
      referrers: db
        .prepare('SELECT domain, sum(count) AS count FROM record_referrer WHERE lang = ? AND month BETWEEN ? AND ? GROUP BY domain ORDER BY count DESC, domain')
        .all(lang, from, to) as { domain: string; count: number }[],
    };
  }
  const capped: Report['capped'] = [];
  for (const [table, name] of [['feed', 'record_feed'], ['referrer', 'record_referrer']] as const) {
    const rows = db
      .prepare(`SELECT month, lang FROM ${name} WHERE month BETWEEN ? AND ? GROUP BY month, lang HAVING count(*) >= ? ORDER BY month, lang`)
      .all(from, to, limits.recordKeysPerMonth) as { month: string; lang: Lang }[];
    for (const row of rows) capped.push({ table, ...row });
  }
  return { from, to, langs, capped };
}

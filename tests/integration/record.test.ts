// The reader record (plan B8; PD-20, D-8, AC-46, AC-47): what is counted, what
// is skipped, that a failure never reaches the page, and that nothing shows it.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetClock, setNow } from '../../lib/clock.ts';
import { clearEntries, insertPublished } from '../../lib/entries.ts';
import { clearEpisodes, insertEpisodeFixture } from '../../lib/episodes.ts';
import { limits } from '../../lib/limits.ts';
import { docFromText } from '../../shared/doc.ts';
import { COOKIE_NAME, resetAuth, signedIn } from '../authHelpers.ts';
import { NOW, tempDb, testApp, testEnv } from '../helpers.ts';

const t = tempDb();
afterAll(() => {
  resetClock();
  t.cleanup();
});
const env = testEnv({ ORIGIN: 'https://imnstr.com' });
const app = testApp(t.db, { ORIGIN: 'https://imnstr.com' });

const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
// A guess at Feedly's agent (plan B8, trap 1).
const FEEDLY = 'Feedly/1.0 (+http://www.feedly.com/fetcher.html; 12 subscribers; like FeedFetcher-Google)';
const MONTH = '2026-10';
const ENTRY = 'a000000001';

interface Counts {
  views: Record<string, number>;
  feed: Record<string, number>;
  referrers: Record<string, number>;
}

/** Everything the record holds, keyed `lang:key`, so a test reads it in one line. */
function record(): Counts {
  const out: Counts = { views: {}, feed: {}, referrers: {} };
  for (const r of t.db.prepare('SELECT * FROM record_view').all() as { month: string; lang: string; page: string; views: number }[]) {
    out.views[`${r.lang}:${r.page}`] = r.views;
    expect(r.month).toBe(MONTH);
  }
  for (const r of t.db.prepare('SELECT * FROM record_feed').all() as { lang: string; aggregator: string; subscribers: number }[]) {
    out.feed[`${r.lang}:${r.aggregator}`] = r.subscribers;
  }
  for (const r of t.db.prepare('SELECT * FROM record_referrer').all() as { lang: string; domain: string; count: number }[]) {
    out.referrers[`${r.lang}:${r.domain}`] = r.count;
  }
  return out;
}

const empty: Counts = { views: {}, feed: {}, referrers: {} };

const get = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
  app.request(path, { method, headers: { 'User-Agent': BROWSER, ...headers } });

beforeEach(() => {
  setNow(NOW);
  clearEntries(t.db);
  resetAuth(t.db);
  clearEpisodes(t.db);
  t.db.exec('DELETE FROM record_view; DELETE FROM record_feed; DELETE FROM record_referrer;');
  insertPublished(t.db, { lang: 'en', id: ENTRY, body: docFromText('Hello.') });
  insertPublished(t.db, { lang: 'fa', id: ENTRY.replace('a', 'b'), body: docFromText('سلام.') });
});

describe('R1: page views, in both languages', () => {
  it('counts the landing page, the log and an entry, per language', async () => {
    for (const path of ['/', '/log', `/log/${ENTRY}`, '/fa/', '/fa/log', '/fa/log/b000000001']) {
      expect((await get(path)).status, path).toBe(200);
    }
    expect(record()).toEqual({
      views: { 'en:landing': 1, 'en:log': 1, [`en:${ENTRY}`]: 1, 'fa:landing': 1, 'fa:log': 1, 'fa:b000000001': 1 },
      feed: {},
      referrers: {},
    });
  });

  it('adds one for each GET, and counts a log page behind ?before= as the log', async () => {
    await get('/log');
    await get('/log');
    await get(`/log?before=${ENTRY}`);
    expect(record().views).toEqual({ 'en:log': 3 });
  });

  it('counts the podcast page in both languages, and a page behind ?before= as the podcast (S-18)', async () => {
    const english = insertEpisodeFixture(t.db, { lang: 'en', name: 'One', description: 'x', tags: ['t'], links: [{ label: 'YouTube', url: 'https://youtu.be/a' }] });
    const persian = insertEpisodeFixture(t.db, { lang: 'fa', name: 'یک', description: 'x', tags: ['t'], links: [{ label: 'YouTube', url: 'https://youtu.be/a' }] });
    for (const path of ['/podcast', '/fa/podcast', `/podcast?before=${english}`, `/fa/podcast?before=${persian}`, '/podcast']) {
      expect((await get(path)).status, path).toBe(200);
    }
    expect(record()).toEqual({ views: { 'en:podcast': 3, 'fa:podcast': 2 }, feed: {}, referrers: {} });
  });

  it('files the count under the Tehran month', async () => {
    // 20:31 UTC on 31 October is already November in Tehran.
    setNow(Date.UTC(2026, 9, 31, 20, 31, 0));
    await get('/');
    const row = t.db.prepare('SELECT month FROM record_view').get() as { month: string };
    expect(row.month).toBe('2026-11');
  });
});

describe('R2: feed readers', () => {
  it('keeps the highest subscriber count per aggregator and language, not a sum', async () => {
    await get('/log/feed.xml', { 'User-Agent': FEEDLY });
    await get('/log/feed.xml', { 'User-Agent': FEEDLY.replace('12 subscribers', '15 subscribers') });
    await get('/log/feed.xml', { 'User-Agent': FEEDLY.replace('12 subscribers', '9 subscribers') });
    await get('/fa/log/feed.xml', { 'User-Agent': FEEDLY.replace('12 subscribers', '4 subscribers') });
    expect(record()).toEqual({ ...empty, feed: { 'en:Feedly': 15, 'fa:Feedly': 4 } });
  });

  it('ignores the bot pattern (every feed reader is a bot), and counts no page view for a feed', async () => {
    expect(FEEDLY.toLowerCase()).toContain('feed');
    await get('/log/feed.xml', { 'User-Agent': FEEDLY });
    expect(record().views).toEqual({});
    expect(record().feed).toEqual({ 'en:Feedly': 12 });
  });

  it('counts nothing for a feed agent that reports no subscribers, or an absurd number', async () => {
    await get('/log/feed.xml', { 'User-Agent': 'Feedly/1.0' });
    await get('/log/feed.xml', { 'User-Agent': 'Thing/1.0 (1000001 subscribers)' });
    await get('/log/feed.xml');
    expect(record()).toEqual(empty);
  });

  it('keeps any other reader under its own first token', async () => {
    await get('/log/feed.xml', { 'User-Agent': 'Newsie/3.1 (8 subscribers)' });
    expect(record().feed).toEqual({ 'en:Newsie': 8 });
  });
});

describe('R3: referring domains', () => {
  it('counts the referring domain with a counted view, per language', async () => {
    await get('/', { Referer: 'https://www.News.Example.org/story?id=1' });
    await get('/log', { Referer: 'https://news.example.org/' });
    await get('/fa/', { Referer: 'http://other.example.net/x' });
    expect(record().referrers).toEqual({ 'en:news.example.org': 2, 'fa:other.example.net': 1 });
  });

  it('skips the site itself, an IP literal, a non-http scheme and a missing Referer', async () => {
    for (const referer of ['https://imnstr.com/log', 'https://www.imnstr.com/', 'http://192.168.0.7/', 'http://[::1]:8080/', 'android-app://com.example', undefined]) {
      await get('/', referer ? { Referer: referer } : {});
    }
    expect(record().referrers).toEqual({});
    expect(record().views).toEqual({ 'en:landing': 6 });
  });

  it('counts a referrer only together with a counted view', async () => {
    await get('/', { Referer: 'https://example.org/', 'User-Agent': 'Googlebot/2.1' });
    await get('/log/feed.xml', { Referer: 'https://example.org/', 'User-Agent': FEEDLY });
    await get('/nowhere', { Referer: 'https://example.org/' });
    expect(record().referrers).toEqual({});
  });
});

describe('what is not counted', () => {
  it('skips a bot, an empty agent and the deploy check (curl)', async () => {
    for (const ua of ['Googlebot/2.1', 'curl/8.4.0', 'python-requests/2.31', 'UptimeRobot/2.0', '']) {
      await get('/', { 'User-Agent': ua });
      await get(`/log/${ENTRY}`, { 'User-Agent': ua });
    }
    expect(record()).toEqual(empty);
  });

  it('skips HEAD', async () => {
    const res = await get('/log', {}, 'HEAD');
    expect(res.status).toBe(200);
    expect(record()).toEqual(empty);
  });

  it('skips a 404, an unknown entry and a draft', async () => {
    for (const path of ['/nope', '/log/zzzzzzzzzz', `/fa/log/${ENTRY}`, '/podcast?before=zzzzzzzzzz', '/fa/podcast?before=zzzzzzzzzz', '/log?before=zzzzzzzzzz']) {
      expect((await get(path)).status, path).toBe(404);
    }
    expect(record()).toEqual(empty);
  });

  it('skips /admin, /assets, /healthz and /robots.txt', async () => {
    const html = await (await get('/')).text();
    const asset = /href="(\/assets\/[^"]+\.css)"/.exec(html)?.[1];
    expect(asset).toBeDefined();
    t.db.exec('DELETE FROM record_view');
    for (const path of ['/admin', '/admin/', '/admin/setup/abc', '/admin/api/session', asset ?? '', '/healthz', '/robots.txt']) {
      await get(path);
    }
    expect(record()).toEqual(empty);
  });

  it('skips a request carrying the session cookie, and answers it byte for byte as without', async () => {
    const send = async (path: string, withCookie: boolean, agent: string, referer: string) => {
      const headers: Record<string, string> = { 'User-Agent': agent, Referer: referer };
      if (withCookie) headers.Cookie = `${COOKIE_NAME}=whatever`;
      return get(path, headers);
    };
    for (const path of ['/', '/log', `/log/${ENTRY}`]) {
      const without = await send(path, false, BROWSER, 'https://example.org/');
      const withCookie = await send(path, true, BROWSER, 'https://other.example/');
      expect(withCookie.status).toBe(without.status);
      expect(await withCookie.text()).toBe(await without.text());
      expect([...withCookie.headers].sort()).toEqual([...without.headers].sort());
    }
    const feedWithout = await send('/log/feed.xml', false, FEEDLY, '');
    const feedWith = await send('/log/feed.xml', true, FEEDLY.replace('12 subscribers', '99 subscribers'), '');
    expect(await feedWith.text()).toBe(await feedWithout.text());
    // Only the cookie-less requests counted: one view of each page, one referrer, and the feed's 12, not 99.
    expect(record()).toEqual({
      views: { 'en:landing': 1, 'en:log': 1, [`en:${ENTRY}`]: 1 },
      feed: { 'en:Feedly': 12 },
      referrers: { 'en:example.org': 3 },
    });
  });

  it('counts a request whose cookie is merely named something else', async () => {
    await get('/', { Cookie: 'theme=dark; other=1' });
    expect(record().views).toEqual({ 'en:landing': 1 });
  });
});

describe('a conditional request (304) counts like the 200 it stands for', () => {
  it('counts a page that leaves as a 304', async () => {
    const first = await get('/log');
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    const second = await get('/log', { 'If-None-Match': etag ?? '' });
    expect(second.status).toBe(304);
    expect(record().views).toEqual({ 'en:log': 2 });
  });

  it('counts a feed fetch that leaves as a 304, so R2 does not go stale', async () => {
    const first = await get('/fa/log/feed.xml', { 'User-Agent': FEEDLY });
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    const second = await get('/fa/log/feed.xml', { 'User-Agent': FEEDLY.replace('12 subscribers', '20 subscribers'), 'If-None-Match': etag ?? '' });
    expect(second.status).toBe(304);
    expect(record().feed).toEqual({ 'fa:Feedly': 20 });
  });
});

describe('bounded growth', () => {
  it('drops a new referring domain past the cap, and keeps counting the ones already there', async () => {
    t.db.transaction(() => {
      const insert = t.db.prepare('INSERT INTO record_referrer VALUES (?, ?, ?, 1)');
      for (let i = 0; i < limits.recordKeysPerMonth; i += 1) insert.run(MONTH, 'en', `site${i}.example`);
    })();
    await get('/', { Referer: 'https://brand-new.example/' });
    await get('/', { Referer: 'https://site7.example/' });
    const rows = t.db.prepare("SELECT count(*) AS n FROM record_referrer WHERE lang = 'en'").get() as { n: number };
    expect(rows.n).toBe(limits.recordKeysPerMonth);
    expect(record().referrers['en:brand-new.example']).toBeUndefined();
    expect(record().referrers['en:site7.example']).toBe(2);
    // The cap is per language: Persian still has room.
    await get('/fa/', { Referer: 'https://brand-new.example/' });
    expect(record().referrers['fa:brand-new.example']).toBe(1);
  });

  it('drops a new aggregator past the cap, and keeps the highest count of the ones already there', async () => {
    t.db.transaction(() => {
      const insert = t.db.prepare('INSERT INTO record_feed VALUES (?, ?, ?, 1)');
      for (let i = 0; i < limits.recordKeysPerMonth; i += 1) insert.run(MONTH, 'en', `Reader${i}`);
    })();
    await get('/log/feed.xml', { 'User-Agent': 'Fresh/1.0 (5 subscribers)' });
    await get('/log/feed.xml', { 'User-Agent': 'Reader3/1.0 (6 subscribers)' });
    expect(record().feed['en:Fresh']).toBeUndefined();
    expect(record().feed['en:Reader3']).toBe(6);
  });
});

describe('it never breaks the page', () => {
  it('answers 200 with the same body when the record table is gone, and logs the error alone', async () => {
    const other = tempDb();
    try {
      const broken = testApp(other.db, { ORIGIN: 'https://imnstr.com' });
      insertPublished(other.db, { lang: 'en', id: ENTRY, body: docFromText('Hello.') });
      const before = await broken.request('/log', { headers: { 'User-Agent': BROWSER, Referer: 'https://example.org/' } });
      const expected = await before.text();
      other.db.exec('DROP TABLE record_view; DROP TABLE record_referrer; DROP TABLE record_feed;');
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const res = await broken.request('/log', { headers: { 'User-Agent': BROWSER, Referer: 'https://example.org/' } });
        const feed = await broken.request('/log/feed.xml', { headers: { 'User-Agent': FEEDLY } });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe(expected);
        expect(feed.status).toBe(200);
        expect(logged).toHaveBeenCalled();
        // Only errors are logged: never the request, its agent or its Referer (house rule 9).
        const text = JSON.stringify(logged.mock.calls.map((call) => call.map((arg) => (arg instanceof Error ? arg.message : String(arg)))));
        expect(text).not.toContain('example.org');
        expect(text).not.toContain('Feedly');
        expect(text).not.toContain('Mozilla');
      } finally {
        logged.mockRestore();
      }
    } finally {
      other.cleanup();
    }
  });
});

describe('AC-46: the record holds counts and no one', () => {
  const columns = (table: string) =>
    (t.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

  it('has exactly the expected columns', () => {
    expect(columns('record_view')).toEqual(['month', 'lang', 'page', 'views']);
    expect(columns('record_feed')).toEqual(['month', 'lang', 'aggregator', 'subscribers']);
    expect(columns('record_referrer')).toEqual(['month', 'lang', 'domain', 'count']);
  });

  it('has no column named like an address, agent, cookie, session, visitor or user', () => {
    for (const table of ['record_view', 'record_feed', 'record_referrer']) {
      for (const name of columns(table)) expect(name, table).not.toMatch(/ip|addr|agent|ua|cookie|session|visitor|user/i);
    }
  });

  it('stores neither the agent nor the Referer: a request leaves only its counts', async () => {
    await get('/', { Referer: 'https://example.org/secret/path?token=abc', 'User-Agent': `${BROWSER} unique-marker-71` });
    await get('/log/feed.xml', { 'User-Agent': 'Newsie/3.1 (8 subscribers) unique-marker-72' });
    const dump = JSON.stringify([
      t.db.prepare('SELECT * FROM record_view').all(),
      t.db.prepare('SELECT * FROM record_feed').all(),
      t.db.prepare('SELECT * FROM record_referrer').all(),
    ]);
    expect(dump).not.toMatch(/unique-marker|secret|token|Mozilla|Windows/);
  });
});

// ── AC-47 ──────────────────────────────────────────────────────────────────

const ROOT = join(import.meta.dirname, '..', '..');
const SKIP = new Set(['node_modules', '.tmp', '.claude', 'dist', 'test-results', 'playwright-report', '.git']);

function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sources(full));
    else if (/\.(ts|tsx)$/.test(entry)) found.push(full);
  }
  return found;
}

const rel = (path: string) => relative(ROOT, path).split(sep).join('/');

describe('AC-47: the record is shown by the CLI and nowhere else', () => {
  const OWNERS = ['lib/record.ts', 'lib/record-middleware.ts', 'scripts/report.ts', 'scripts/reset-content.ts'];
  const files = sources(ROOT).map((path) => ({ path: rel(path), text: readFileSync(path, 'utf8') }));

  it('imports lib/record.ts only from the middleware and the two CLIs', () => {
    const importers = files
      .filter((f) => !f.path.startsWith('tests/'))
      .filter((f) => /from\s+['"][^'"]*\brecord\.ts['"]|import\(\s*['"][^'"]*\brecord\.ts['"]/.test(f.text))
      .map((f) => f.path)
      .sort();
    expect(importers).toEqual(['lib/record-middleware.ts', 'scripts/report.ts', 'scripts/reset-content.ts']);
  });

  it('names the record tables nowhere else (the migration and the tests apart)', () => {
    const offenders = files
      .filter((f) => !OWNERS.includes(f.path) && !f.path.startsWith('tests/'))
      .filter((f) => /record_view|record_feed|record_referrer/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('shows no figure from the record on any public page, the admin or a signed-in admin API read', async () => {
    const MARK = 731942;
    const seed = () => {
      for (const lang of ['en', 'fa']) {
        t.db.prepare('INSERT INTO record_view VALUES (?, ?, ?, ?)').run(MONTH, lang, 'landing', MARK);
        t.db.prepare('INSERT INTO record_view VALUES (?, ?, ?, ?)').run(MONTH, lang, 'log', MARK + 1);
        t.db.prepare('INSERT INTO record_view VALUES (?, ?, ?, ?)').run(MONTH, lang, 'podcast', MARK + 3);
        t.db.prepare('INSERT INTO record_view VALUES (?, ?, ?, ?)').run(MONTH, lang, lang === 'en' ? ENTRY : 'b000000001', MARK + 2);
        t.db.prepare('INSERT INTO record_feed VALUES (?, ?, ?, ?)').run(MONTH, lang, 'Feedly', MARK + 3);
        t.db.prepare('INSERT INTO record_referrer VALUES (?, ?, ?, ?)').run(MONTH, lang, 'example.org', MARK + 4);
      }
    };
    seed();
    // An episode under the entry's id, so the admin's read by id (`:id` below) finds one.
    insertEpisodeFixture(t.db, { lang: 'en', id: ENTRY, name: 'An episode', description: 'x', tags: ['t'], links: [{ label: 'YouTube', url: 'https://youtu.be/a' }] });
    const paths = ['/', '/fa/', '/log', '/fa/log', '/podcast', '/fa/podcast', `/log/${ENTRY}`, '/fa/log/b000000001', '/log/feed.xml', '/fa/log/feed.xml', '/nope', '/fa/nope', '/admin', '/healthz', '/robots.txt'];
    for (const path of paths) {
      const body = await (await get(path)).text();
      for (let n = MARK; n <= MARK + 4; n += 1) expect(body, `${path} shows ${n}`).not.toContain(String(n));
    }
    const { client } = await signedIn(app, t.db, env);
    // Every admin API read the router has, found by enumerating it as the 401 test does, so a later stage's GET is checked too.
    const apiReads = [...new Set(app.routes.filter((r) => r.method === 'GET' && r.path.startsWith('/admin/api/')).map((r) => r.path.replace(/:[A-Za-z]+/g, ENTRY)))];
    expect(apiReads).toEqual(expect.arrayContaining(['/admin/api/session', '/admin/api/passkeys', '/admin/api/settings', '/admin/api/entries', `/admin/api/entries/${ENTRY}`, '/admin/api/episodes', `/admin/api/episodes/${ENTRY}`]));
    for (const path of [...apiReads, '/admin', '/admin/']) {
      const reply = await client.get(path);
      // A refusal would pass the check below without reading anything.
      expect(reply.status, path).toBe(200);
      for (let n = MARK; n <= MARK + 4; n += 1) expect(reply.text, `${path} shows ${n}`).not.toContain(String(n));
    }
  });
});

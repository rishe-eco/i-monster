// The log, an entry page and paging (plan B3; AC-2, AC-4, AC-5, AC-14, AC-28,
// AC-30, AC-31, AC-39, AC-42), in both languages.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { clearEntries, getPublished, insertPublished, listPublished } from '../../lib/entries.ts';
import { docFromText } from '../../shared/doc.ts';
import { DAY, NOW, tempDb, testApp } from '../helpers.ts';

const t = tempDb();
afterAll(() => t.cleanup());
const app = testApp(t.db);
beforeEach(() => clearEntries(t.db));

type Lang = 'en' | 'fa';
const prefix = (lang: Lang) => (lang === 'fa' ? '/fa' : '');
const html = async (path: string) => (await app.request(path)).text();

/** An id that sorts in the order given, so fixtures are deterministic. */
const id = (n: number) => `e${String(n).padStart(9, '0')}`;

/** Text in the entry's own language, so no run needs isolating unless a test says so. */
const sample = (lang: Lang, n: number) => (lang === 'fa' ? `نوشتهٔ شماره ${n}.` : `Body number ${n}.`);
const visibleText = (page: string) => page.replace(/<[^>]*>/g, ' ');

function seed(lang: Lang, n: number, extra: { title?: string; text?: string } = {}) {
  // Newest is n = 1: each is a day older than the last.
  return insertPublished(t.db, {
    lang,
    id: id(n),
    title: extra.title,
    body: docFromText(extra.text ?? sample(lang, n)),
    firstPublishedAt: NOW - n * DAY,
  });
}

describe.each<Lang>(['en', 'fa'])('the log, %s', (lang) => {
  const log = `${prefix(lang)}/log`;

  it('lists published entries newest first by first publish (AC-2)', async () => {
    // Inserted out of order; the order is by first_published_at.
    seed(lang, 3);
    seed(lang, 1);
    seed(lang, 2);
    const body = await html(log);
    const at = (n: number) => body.indexOf(sample(lang, n));
    expect(at(1)).toBeGreaterThan(-1);
    expect(at(1)).toBeLessThan(at(2));
    expect(at(2)).toBeLessThan(at(3));
    for (const n of [1, 2, 3]) expect(body).toContain(`href="${log}/${id(n)}"`);
  });

  it('shows the title inline when there is one, and not when there is none', async () => {
    const title = lang === 'fa' ? 'عنوان' : 'A title';
    seed(lang, 1, { title });
    seed(lang, 2);
    const body = await html(log);
    expect(body).toContain(`<strong class="entry__title">${title}</strong>`);
    expect(body.match(/entry__title/g)?.length).toBe(1);
  });

  it('indents later paragraphs and keeps the first with the date', async () => {
    seed(lang, 1, { text: 'First.\n\nSecond.\n\nThird.' });
    const body = await html(log);
    expect(body.match(/<p class="entry__more">/g)?.length).toBe(2);
    expect(body.match(/<p class="entry__first">/g)?.length).toBe(1);
  });

  it('renders <mark> and escapes markup in a body', async () => {
    seed(lang, 1, { text: lang === 'fa' ? '==روشن== و <>' : '==Bright== and <b>bold</b>' });
    const body = await html(log);
    expect(body).toContain(lang === 'fa' ? '<mark>روشن</mark>' : '<mark>Bright</mark>');
    expect(body).toContain(lang === 'fa' ? '&lt;&gt;' : '&lt;b&gt;bold&lt;/b&gt;');
    expect(body).not.toContain('<b>bold</b>');
  });

  it('shows the designed empty state with the feed link, no error and no count (AC-4, AC-27)', async () => {
    const res = await app.request(log);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('class="empty"');
    expect(body).toContain(`href="${log}/feed.xml"`);
    expect(body).not.toContain('class="entries"');
    expect(body).not.toContain('class="older"');
  });

  it('keeps a log of one to three entries free of any pager', async () => {
    for (const n of [1, 2, 3]) seed(lang, n);
    const body = await html(log);
    expect(body).not.toContain('class="older"');
    expect(body.match(/<article class="entry">/g)?.length).toBe(3);
  });

  it('gives 21 entries two pages, and the cursor reaches the 21st (AC-30)', async () => {
    for (let n = 1; n <= 21; n++) seed(lang, n);
    const first = await html(log);
    expect(first.match(/<article class="entry">/g)?.length).toBe(20);
    expect(first).toContain(`href="${log}?before=${id(20)}"`);
    expect(first).not.toContain(`/log/${id(21)}`);
    const second = await app.request(`${log}?before=${id(20)}`);
    expect(second.status).toBe(200);
    const body = await second.text();
    expect(body.match(/<article class="entry">/g)?.length).toBe(1);
    expect(body).toContain(`/log/${id(21)}`);
    // The last page has no way further back in time, only the way to the newer page (PL-10).
    expect(body).not.toContain('rel="next"');
    expect(body).toContain(`<a class="big-row" href="${log}" rel="prev">`);
  });

  it('gives the first page no Newer row, page 2 the bare path, and page 3 the cursor of page 2 (PL-10)', async () => {
    for (let n = 1; n <= 45; n++) seed(lang, n);
    const newer = lang === 'fa' ? 'نوشته‌های تازه‌تر' : 'Newer entries';
    const first = await html(log);
    expect(first).not.toContain('rel="prev"');
    expect(first).not.toContain(newer);
    // Page 2 starts after the 20th; its Newer is the bare path, with no cursor.
    const second = await html(`${log}?before=${id(20)}`);
    expect(second).toContain(`<a class="big-row" href="${log}" rel="prev">`);
    expect(second).toContain(newer);
    // Page 3 starts after the 40th; its Newer is page 2's cursor, the 20th.
    const third = await html(`${log}?before=${id(40)}`);
    expect(third).toContain(`href="${log}?before=${id(20)}" rel="prev"`);
    // The Newer row comes before the Older one, in the one block.
    expect(second.indexOf('rel="prev"')).toBeLessThan(second.indexOf('rel="next"'));
    // No digits in the rows' text beyond the dates: nothing counts (AC-30, house rule 1).
    for (const body of [second, third]) {
      const block = body.slice(body.indexOf('class="older"'), body.indexOf('</main>')).replace(/<[^>]*>/g, ' ');
      expect(block).not.toMatch(/\d/);
    }
  });

  it('walks Newer from the last page through the same items, page by page, as Older did (PL-10)', () => {
    for (let n = 1; n <= 45; n++) seed(lang, n);
    const older: string[][] = [];
    let cursor: string | null = null;
    let page = listPublished(t.db, lang, null);
    older.push(page.entries.map((e) => e.id));
    for (cursor = page.olderBefore; cursor; cursor = page.olderBefore) {
      page = listPublished(t.db, lang, getPublished(t.db, lang, cursor));
      older.push(page.entries.map((e) => e.id));
    }
    expect(older.map((p) => p.length)).toEqual([20, 20, 5]);
    // Newer from the last page: each page's `newer` is the cursor of the page before it.
    const walked: string[][] = [page.entries.map((e) => e.id)];
    while (page.newer) {
      page = listPublished(t.db, lang, page.newer === 'first' ? null : getPublished(t.db, lang, page.newer));
      walked.unshift(page.entries.map((e) => e.id));
    }
    expect(walked).toEqual(older);
  });

  it('pages and walks back across entries at the same instant, the tie broken by id (PL-10)', () => {
    for (let n = 1; n <= 19; n++) seed(lang, n);
    for (const n of [20, 21, 22]) {
      insertPublished(t.db, { lang, id: id(n), body: docFromText(`Tie ${n}.`), firstPublishedAt: NOW - 20 * DAY });
    }
    const second = listPublished(t.db, lang, getPublished(t.db, lang, id(20)));
    expect(second.entries.map((e) => e.id)).toEqual([id(21), id(22)]);
    expect(second.newer).toBe('first');
    // A page of two, walked from the middle of the tie: the cursor lands on the right entry.
    const mid = listPublished(t.db, lang, getPublished(t.db, lang, id(21)), 2);
    expect(mid.entries.map((e) => e.id)).toEqual([id(22)]);
    // A page of two: the page before this one ends at the 21st, and the one before that at the 19th.
    expect(mid.newer).toBe(id(19));
    const back = listPublished(t.db, lang, getPublished(t.db, lang, id(22)), 2);
    expect(back.newer).toBe(id(20));
  });

  it('shows "Older entries" only when there are more, with exactly 20 giving none', async () => {
    for (let n = 1; n <= 20; n++) seed(lang, n);
    expect(await html(log)).not.toContain('class="older"');
  });

  it('pages correctly across two entries in the same millisecond', () => {
    // Entries 20 and 21 share one instant; the tiebreak is the id.
    for (let n = 1; n <= 19; n++) seed(lang, n);
    for (const n of [20, 21]) {
      insertPublished(t.db, { lang, id: id(n), body: docFromText(`Tie ${n}.`), firstPublishedAt: NOW - 20 * DAY });
    }
    const first = listPublished(t.db, lang, null);
    expect(first.entries.map((e) => e.id)).toEqual(Array.from({ length: 20 }, (_, i) => id(i + 1)));
    expect(first.olderBefore).toBe(id(20));
    const cursor = getPublished(t.db, lang, id(20));
    const second = listPublished(t.db, lang, cursor);
    expect(second.entries.map((e) => e.id)).toEqual([id(21)]);
    expect(second.olderBefore).toBeNull();
    // Page of three over ties: nothing repeated, nothing missed.
    const small1 = listPublished(t.db, lang, null, 19);
    const small2 = listPublished(t.db, lang, getPublished(t.db, lang, small1.olderBefore ?? ''), 19);
    expect([...small1.entries, ...small2.entries].map((e) => e.id)).toEqual(Array.from({ length: 21 }, (_, i) => id(i + 1)));
  });

  it.each([
    ['malformed', 'nope'],
    ['empty', ''],
    ['unknown', 'abcdefghjk'],
    ['too long', 'abcdefghjkm'],
  ])('answers a %s cursor with the 404', async (_name, cursor) => {
    seed(lang, 1);
    const res = await app.request(`${log}?before=${cursor}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain(`<html lang="${lang}"`);
  });

  it('answers the cursor of a draft, an unpublished entry and the other language with the 404', async () => {
    seed(lang, 1);
    t.db
      .prepare("INSERT INTO entry (id, lang, body, state, created_at, updated_at) VALUES (?, ?, '{}', 'draft', 1, 1)")
      .run(id(90), lang);
    const other: Lang = lang === 'en' ? 'fa' : 'en';
    insertPublished(t.db, { lang: other, id: id(91), body: docFromText('Other.'), firstPublishedAt: NOW });
    for (const cursor of [id(90), id(91)]) {
      expect((await app.request(`${log}?before=${cursor}`)).status).toBe(404);
    }
  });

  it('leaves a draft and an unpublished entry out of the list and 404s their pages (AC-14)', async () => {
    seed(lang, 1);
    t.db
      .prepare("INSERT INTO entry (id, lang, body, state, created_at, updated_at) VALUES (?, ?, ?, 'draft', 1, 1)")
      .run(id(80), lang, JSON.stringify(docFromText('Secret draft.')));
    // Unpublished after being live: back to draft, date kept.
    seed(lang, 2, { text: 'Taken down.' });
    t.db.prepare("UPDATE entry SET state = 'draft' WHERE id = ?").run(id(2));
    const body = await html(log);
    expect(body).not.toContain('Secret draft.');
    expect(body).not.toContain('Taken down.');
    for (const gone of [id(80), id(2)]) {
      const res = await app.request(`${log}/${gone}`);
      expect(res.status).toBe(404);
      expect(await res.text()).toContain(`<html lang="${lang}"`);
    }
  });

  it('has no count, page number or "latest" anywhere (AC-5, AC-30)', async () => {
    for (let n = 1; n <= 21; n++) seed(lang, n);
    for (const path of [log, `${log}?before=${id(20)}`]) {
      const body = await html(path);
      expect(visibleText(body)).not.toMatch(/\bpage\s*\d|\bof\s+\d+\b|\b\d+\s+(entries|learnings|writings|posts)\b|\blatest\b|total/i);
      expect(visibleText(body)).not.toMatch(/(صفحهٔ\s*[\d۰-۹]|مجموع|جمعاً|آخرین)/);
      expect(body).not.toMatch(/[?&](page|p|offset)=/);
    }
  });
});

describe.each<Lang>(['en', 'fa'])('an entry page, %s', (lang) => {
  const log = `${prefix(lang)}/log`;

  it('shows the entry, its date as a link to itself and the way back, with no previous or next (W4)', async () => {
    seed(lang, 1);
    const mid = seed(lang, 2, { title: 'Middle one', text: lang === 'fa' ? 'نخست.\n\nدوم.' : 'First.\n\nSecond.' });
    seed(lang, 3);
    const res = await app.request(`${log}/${mid}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Middle one');
    expect(body).toContain(lang === 'fa' ? '<p>نخست.</p><p>دوم.</p>' : '<p>First.</p><p>Second.</p>');
    expect(body).toContain(`<a class="entry-page__date" href="${log}/${mid}">`);
    expect(body).toContain(`href="${log}"`);
    expect(body).not.toContain(id(1));
    expect(body).not.toContain(id(3));
    expect(visibleText(body)).not.toMatch(/\b(previous|next|older|newer|edited|updated)\b/i);
  });

  it('is titled by the entry title in the tab, or by its date when untitled', async () => {
    const titled = seed(lang, 1, { title: 'Hello' });
    const plain = seed(lang, 2);
    expect(await html(`${log}/${titled}`)).toContain('<title>Hello · iMNSTR</title>');
    expect(await html(`${log}/${plain}`)).toMatch(/<h1 class="visually-hidden">[^<]+<\/h1>/);
  });

  it('answers the other language\'s id, an unknown id and a malformed one with that language\'s 404 (AC-28)', async () => {
    const other: Lang = lang === 'en' ? 'fa' : 'en';
    const elsewhere = seed(other, 1);
    for (const path of [`${log}/${elsewhere}`, `${log}/abcdefghjk`, `${log}/short`, `${log}/${elsewhere}/x`]) {
      const res = await app.request(path);
      expect(res.status).toBe(404);
      expect(res.headers.get('Location')).toBeNull();
      expect(await res.text()).toContain(`<html lang="${lang}"`);
    }
  });

  it('shows no sign of an edit: updating the row changes the text and nothing else (AC-13)', async () => {
    const [was, now] = lang === 'fa' ? ['پیش.', 'پس.'] : ['Before.', 'After.'];
    const entry = seed(lang, 1, { text: was });
    const before = await html(`${log}/${entry}`);
    t.db
      .prepare('UPDATE entry SET body = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(docFromText(now)), NOW, entry);
    const after = await html(`${log}/${entry}`);
    expect(after).toBe(before.replace(was, now));
  });
});

describe('both languages stand alone (AC-39, AC-42)', () => {
  it('keeps English entries out of /fa/log, which is the empty state and mentions nothing of them', async () => {
    for (let n = 1; n <= 40; n++) seed('en', n, { text: `English entry ${n}.` });
    const body = await html('/fa/log');
    expect(body).toContain('class="empty"');
    expect(body).not.toContain('English entry');
    expect(body).not.toContain('/log/e0');
    expect(body).not.toContain('class="older"');
  });

  it('keeps each language\'s entries on its own log', async () => {
    seed('en', 1, { text: 'English one.' });
    seed('fa', 2, { text: 'نوشتهٔ فارسی.' });
    const en = await html('/log');
    const fa = await html('/fa/log');
    expect(en).toContain('English one.');
    expect(en).not.toContain('نوشتهٔ فارسی.');
    expect(fa).toContain('نوشتهٔ فارسی.');
    expect(fa).not.toContain('English one.');
  });

  it('shows each entry\'s date in its page language: Gregorian in English, Solar Hijri in Persian (AC-31)', async () => {
    seed('en', 1);
    seed('fa', 2);
    // A day before NOW is 9 Oct, 15:30 in Tehran; two days before is 8 Oct, ۱۶ مهر.
    expect(await html('/log')).toContain('9 Oct 2026, 15:30');
    expect(await html('/fa/log')).toContain('۱۶ مهر ۱۴۰۵، ۱۵:۳۰');
  });

  it('draws the page language and direction (AC-40) and the switch from a log and from an entry (AC-41)', async () => {
    const en = seed('en', 1);
    const fa = seed('fa', 2);
    expect(await html('/log')).toContain('<html lang="en" dir="ltr">');
    expect(await html('/fa/log')).toContain('<html lang="fa" dir="rtl">');
    expect(await html('/log')).toContain('<a href="/fa/log" lang="fa" hreflang="fa">فارسی</a>');
    expect(await html('/fa/log')).toContain('<a href="/log" lang="en" hreflang="en">English</a>');
    // From an entry the switch goes to the other language's log, first page.
    expect(await html(`/log/${en}`)).toContain('<a href="/fa/log" lang="fa" hreflang="fa">فارسی</a>');
    expect(await html(`/fa/log/${fa}`)).toContain('<a href="/log" lang="en" hreflang="en">English</a>');
  });

  it('carries hreflang alternates on the log pages and none on an entry (AC-41)', async () => {
    const entry = seed('en', 1);
    for (const path of ['/log', '/fa/log']) {
      const body = await html(path);
      expect(body).toContain('<link rel="alternate" hreflang="en" href="https://imnstr.com/log"/>');
      expect(body).toContain('<link rel="alternate" hreflang="fa" href="https://imnstr.com/fa/log"/>');
    }
    expect(await html(`/log/${entry}`)).not.toContain('hreflang="en" href="https');
  });
});

describe('public pages (house rule 2, AC-7)', () => {
  it('set no cookie, and look the same with a session cookie (D-8)', async () => {
    const entry = seed('en', 1);
    for (const path of ['/log', '/fa/log', `/log/${entry}`, '/log/feed.xml']) {
      const plain = await app.request(path);
      const withCookie = await app.request(path, { headers: { Cookie: '__Host-session=abc' } });
      expect(plain.headers.get('Set-Cookie')).toBeNull();
      expect(withCookie.headers.get('Set-Cookie')).toBeNull();
      expect(await withCookie.text()).toBe(await plain.text());
    }
  });

  it('carry no inline script or style attribute, and the CSP header (PD-18)', async () => {
    seed('en', 1, { text: '==x== [y](https://a.example)' });
    const res = await app.request('/log');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    const body = await res.text();
    // The one script is the external wordmark.js (B9): nothing inline.
    expect(body).not.toMatch(/<script(?![^>]*\ssrc=)|\sstyle=|\son[a-z]+=/);
    expect([...body.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1])).toEqual([
      expect.stringMatching(/^\/assets\/wordmark\.[0-9a-f]{10}\.js$/),
    ]);
  });

  it('answer a conditional request with 304', async () => {
    seed('en', 1);
    const first = await app.request('/log');
    const again = await app.request('/log', { headers: { 'If-None-Match': first.headers.get('ETag') as string } });
    expect(again.status).toBe(304);
  });

  it('give the log and the feed links their own nav entries that now resolve', async () => {
    for (const path of ['/log', '/log/feed.xml', '/fa/log', '/fa/log/feed.xml']) {
      expect((await app.request(path)).status).toBe(200);
    }
  });
});

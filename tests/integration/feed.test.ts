// The Atom feed (plan B3; AC-3, AC-27, AC-39, AC-40, AC-48, PD-24).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { clearEntries, insertPublished } from '../../lib/entries.ts';
import { docFromText } from '../../shared/doc.ts';
import { DAY, NOW, tempDb, testApp, xmlProblem } from '../helpers.ts';
import { resetClock, setNow } from '../../lib/clock.ts';

const t = tempDb();
afterAll(() => {
  resetClock();
  t.cleanup();
});
const app = testApp(t.db);
beforeEach(() => {
  clearEntries(t.db);
  setNow(NOW);
});

const feed = async (path: string) => (await app.request(path)).text();

describe('the feed, as exact strings (two untitled entries, one per language)', () => {
  it('writes the English feed', async () => {
    // 04:00 UTC is 07:30 in Tehran.
    const at = Date.UTC(2026, 9, 13, 4, 0, 0);
    insertPublished(t.db, { lang: 'en', id: 'a000000001', body: docFromText('Hello ==world==.'), firstPublishedAt: at });
    expect(await feed('/log/feed.xml')).toBe(
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">',
        '  <id>tag:imnstr.com,2026:log/en</id>',
        '  <title>iMNSTR — Learnings</title>',
        '  <link rel="self" type="application/atom+xml" href="https://imnstr.com/log/feed.xml"/>',
        '  <link rel="alternate" type="text/html" href="https://imnstr.com/log"/>',
        '  <updated>2026-10-13T07:30:00+03:30</updated>',
        '  <author><name>iMNSTR</name></author>',
        '  <entry>',
        '    <id>tag:imnstr.com,2026:entry/a000000001</id>',
        '    <title>13 October 2026</title>',
        '    <link rel="alternate" type="text/html" href="https://imnstr.com/log/a000000001"/>',
        '    <published>2026-10-13T07:30:00+03:30</published>',
        '    <updated>2026-10-13T07:30:00+03:30</updated>',
        '    <content type="html">&lt;p&gt;Hello &lt;mark&gt;world&lt;/mark&gt;.&lt;/p&gt;</content>',
        '  </entry>',
        '</feed>',
        '',
      ].join('\n'),
    );
  });

  it('writes the Persian feed: Solar Hijri title in Persian digits, content in a right-to-left wrapper', async () => {
    // 18:30 UTC on 20 Oct is 22:00 in Tehran, 28 Mehr 1405.
    const at = Date.UTC(2026, 9, 20, 18, 30, 0);
    insertPublished(t.db, { lang: 'fa', id: 'b000000001', body: docFromText('سلام Root.'), firstPublishedAt: at });
    expect(await feed('/fa/log/feed.xml')).toBe(
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="fa">',
        '  <id>tag:imnstr.com,2026:log/fa</id>',
        '  <title>iMNSTR — آموخته‌ها</title>',
        '  <link rel="self" type="application/atom+xml" href="https://imnstr.com/fa/log/feed.xml"/>',
        '  <link rel="alternate" type="text/html" href="https://imnstr.com/fa/log"/>',
        '  <updated>2026-10-20T22:00:00+03:30</updated>',
        '  <author><name>iMNSTR</name></author>',
        '  <entry>',
        '    <id>tag:imnstr.com,2026:entry/b000000001</id>',
        '    <title>۲۸ مهر ۱۴۰۵</title>',
        '    <link rel="alternate" type="text/html" href="https://imnstr.com/fa/log/b000000001"/>',
        '    <published>2026-10-20T22:00:00+03:30</published>',
        '    <updated>2026-10-20T22:00:00+03:30</updated>',
        '    <content type="html">&lt;div dir=&quot;rtl&quot;&gt;&lt;p&gt;سلام &lt;bdi lang=&quot;en&quot;&gt;Root&lt;/bdi&gt;.&lt;/p&gt;&lt;/div&gt;</content>',
        '  </entry>',
        '</feed>',
        '',
      ].join('\n'),
    );
  });
});

describe.each(['en', 'fa'] as const)('the %s feed', (lang) => {
  const path = lang === 'fa' ? '/fa/log/feed.xml' : '/log/feed.xml';
  const sample = (n: number) => (lang === 'fa' ? `نوشتهٔ ${n}` : `Entry ${n}`);

  it('is Atom, UTF-8, well-formed, and declares its language (AC-3, AC-40)', async () => {
    insertPublished(t.db, { lang, body: docFromText(sample(1)), firstPublishedAt: NOW - DAY });
    const res = await app.request(path);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/atom+xml; charset=utf-8');
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(res.headers.get('ETag')).not.toBeNull();
    const body = await res.text();
    expect(xmlProblem(body)).toBeNull();
    expect(body).toContain(`xml:lang="${lang}"`);
  });

  it('holds the 20 most recent entries, newest first, and nothing older (AC-3)', async () => {
    for (let n = 1; n <= 25; n++) {
      insertPublished(t.db, { lang, id: `c${String(n).padStart(9, '0')}`, body: docFromText(sample(n)), firstPublishedAt: NOW - n * DAY });
    }
    const body = await feed(path);
    const ids = [...body.matchAll(/<id>tag:imnstr\.com,2026:entry\/(\w+)<\/id>/g)].map((m) => m[1]);
    expect(ids).toEqual(Array.from({ length: 20 }, (_, i) => `c${String(i + 1).padStart(9, '0')}`));
  });

  it('carries no draft, no unpublished entry and nothing of the other language (AC-14, AC-39)', async () => {
    const other = lang === 'en' ? 'fa' : 'en';
    insertPublished(t.db, { lang: other, id: 'd000000001', body: docFromText('Elsewhere'), firstPublishedAt: NOW });
    const gone = insertPublished(t.db, { lang, id: 'd000000002', body: docFromText(sample(2)), firstPublishedAt: NOW });
    t.db.prepare("UPDATE entry SET state = 'draft' WHERE id = ?").run(gone);
    t.db
      .prepare("INSERT INTO entry (id, lang, body, state, created_at, updated_at) VALUES ('d000000003', ?, ?, 'draft', 1, 1)")
      .run(lang, JSON.stringify(docFromText('Never live')));
    const body = await feed(path);
    expect(body).not.toContain('d000000001');
    expect(body).not.toContain('d000000002');
    expect(body).not.toContain('Never live');
    expect(body).not.toContain('<entry>');
  });

  it('titles an entry by its own title when it has one, escaped', async () => {
    insertPublished(t.db, { lang, title: 'Tom & "Jerry" <3', body: docFromText(sample(1)), firstPublishedAt: NOW });
    const body = await feed(path);
    expect(body).toContain('<title>Tom &amp; &quot;Jerry&quot; &lt;3</title>');
    expect(xmlProblem(body)).toBeNull();
  });

  it('drops the control characters XML forbids, which pasted text can carry (found at B3 verify)', async () => {
    const body = { type: 'doc' as const, content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'one\u000Btwo\u0008' }] }] };
    insertPublished(t.db, { lang, title: 'A\u0001B', body, firstPublishedAt: NOW });
    const xml = await feed(path);
    expect(xml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
    expect(xml).toContain('<title>AB</title>');
    expect(xml).toMatch(/one.*two/);
  });

  it('is an empty but valid feed with no entries', async () => {
    const body = await feed(path);
    expect(xmlProblem(body)).toBeNull();
    expect(body).not.toContain('<entry>');
    expect(body).toContain('<updated>2026-10-10T15:30:00+03:30</updated>');
  });

  it('moves its own <updated> and the entry\'s on an edit, and leaves <published> (PD-24, AC-13)', async () => {
    const id = insertPublished(t.db, { lang, body: docFromText(sample(1)), firstPublishedAt: NOW - 3 * DAY });
    const before = await feed(path);
    t.db
      .prepare('UPDATE entry SET body = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(docFromText(sample(9))), NOW - DAY, id);
    const after = await feed(path);
    expect(before).toContain('<updated>2026-10-07T15:30:00+03:30</updated>\n  <author>');
    expect(after).toContain('<updated>2026-10-09T15:30:00+03:30</updated>\n  <author>');
    expect(after.match(/<published>[^<]+<\/published>/)?.[0]).toBe(before.match(/<published>[^<]+<\/published>/)?.[0]);
    expect(after).toContain(sample(9).slice(0, 4));
  });

  it('answers a conditional request with 304 when nothing changed', async () => {
    insertPublished(t.db, { lang, body: docFromText(sample(1)), firstPublishedAt: NOW - DAY });
    const first = await app.request(path);
    const again = await app.request(path, { headers: { 'If-None-Match': first.headers.get('ETag') as string } });
    expect(again.status).toBe(304);
  });
});

describe('AC-48 in the feed', () => {
  it('keeps the English word and the URL isolated in a Persian entry, inside the right-to-left wrapper', async () => {
    insertPublished(t.db, {
      lang: 'fa',
      body: docFromText('Passkeyها همگام می‌شوند. ببینید https://example.org/passkeys.'),
      firstPublishedAt: NOW,
    });
    const body = await feed('/fa/log/feed.xml');
    expect(xmlProblem(body)).toBeNull();
    expect(body).toContain('&lt;div dir=&quot;rtl&quot;&gt;');
    expect(body).toContain('&lt;bdi lang=&quot;en&quot;&gt;Passkey&lt;/bdi&gt;');
    expect(body).toContain('&lt;bdi dir=&quot;ltr&quot;&gt;https://example.org/passkeys&lt;/bdi&gt;.');
  });

  it('isolates Persian inside an English entry', async () => {
    insertPublished(t.db, { lang: 'en', body: docFromText('The word «سلام» means hello.'), firstPublishedAt: NOW });
    expect(await feed('/log/feed.xml')).toContain('&lt;bdi lang=&quot;fa&quot; dir=&quot;rtl&quot;&gt;سلام&lt;/bdi&gt;');
  });
});

describe('xmlProblem (the test helper itself)', () => {
  it('finds what a hand-built feed could get wrong', () => {
    expect(xmlProblem('<a><b>x</b></a>')).toBeNull();
    expect(xmlProblem('<a><b>x</a></b>')).not.toBeNull();
    expect(xmlProblem('<a>x & y</a>')).not.toBeNull();
    expect(xmlProblem('<a>x < y</a>')).not.toBeNull();
    expect(xmlProblem('<a>')).not.toBeNull();
    expect(xmlProblem('<a x=1></a>')).not.toBeNull();
  });
});

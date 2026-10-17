// The entries API (plan B5): save, edit, publish, unpublish and the list, behind
// the guard. AC-12, AC-13, AC-14, AC-25, AC-42, AC-44, and the refusals of §6.2,
// each asserted by the bytes of the body, not only the status (house rule 3).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetClock, setNow } from '../../lib/clock.ts';
import { clearEntries, insertFixture } from '../../lib/entries.ts';
import { limits } from '../../lib/limits.ts';
import { docFromText, type Doc } from '../../shared/doc.ts';
import { Client, resetAuth, signedIn } from '../authHelpers.ts';
import { DAY, NOW, tempDb, testApp, testEnv } from '../helpers.ts';

const t = tempDb();
const env = testEnv();
const app = testApp(t.db);
afterAll(() => {
  resetClock();
  t.cleanup();
});

let client: Client;
beforeEach(async () => {
  setNow(NOW);
  resetAuth(t.db);
  clearEntries(t.db);
  client = (await signedIn(app, t.db, env)).client;
});

/**
 * Move the clock and sign in again: a session idles out after an hour, and these tests jump by days.
 * The entries' own dates are what is under test, not the session's.
 */
async function clockTo(instant: number): Promise<void> {
  setNow(instant);
  client = (await signedIn(app, t.db, env)).client;
}

const body = (text: string): Doc => docFromText(text);
const codeBody = (code: string) => JSON.stringify({ code });
const count = () => (t.db.prepare('SELECT count(*) AS n FROM entry').get() as { n: number }).n;
const rowOf = (id: string) => t.db.prepare('SELECT * FROM entry WHERE id = ?').get(id) as Record<string, unknown>;
const lastLanguage = async (c: Client = client) => (await c.get('/admin/api/settings')).json.lastLanguage;

/** Save a new entry; returns the entry the API answered with. */
async function save(fields: Record<string, unknown> = {}, c: Client = client) {
  const res = await c.post('/admin/api/entries', { publishKey: randomUUID(), lang: 'en', body: body('Hello.'), publish: false, ...fields });
  expect(res.status, res.text).toBe(200);
  return res.json.entry as { id: string; lang: string; title: string | null; body: Doc; state: string; wasLive: boolean; firstPublishedAt: number | null };
}

const never = 'a000000099';
const publicPage = async (lang: 'en' | 'fa', id: string) => app.request(`${lang === 'fa' ? '/fa' : ''}/log/${id}`);

describe('AC-12: an untitled entry publishes, dated by the server', () => {
  it('publishes with a body alone, at the clock, on the log, at its URL and in the feed', async () => {
    const entry = await save({ publish: true });
    expect(entry).toMatchObject({ lang: 'en', title: null, state: 'published', wasLive: false, firstPublishedAt: NOW });
    expect(await (await app.request('/log')).text()).toContain('Hello.');
    expect((await publicPage('en', entry.id)).status).toBe(200);
    expect(await (await app.request('/log/feed.xml')).text()).toContain(`entry/${entry.id}`);
  });

  it('ignores a date, a state and an id in the request: no date can be typed', async () => {
    const entry = await save({ publish: false, firstPublishedAt: 5, createdAt: 5, updatedAt: 5, state: 'published', id: 'zzzzzzzzzz' });
    expect(entry).toMatchObject({ state: 'draft', firstPublishedAt: null });
    expect(entry.id).not.toBe('zzzzzzzzzz');
    const row = rowOf(entry.id);
    expect(row).toMatchObject({ created_at: NOW, updated_at: NOW, first_published_at: null });
    await clockTo(NOW + DAY);
    const published = await save({ publish: true, firstPublishedAt: 5 });
    expect(published.firstPublishedAt).toBe(NOW + DAY);
  });

  it('keeps a title up to limits.titleMaxChars, counted after trimming (F-16)', async () => {
    const longest = 'x'.repeat(limits.titleMaxChars);
    expect((await save({ title: `  ${longest}  ` })).title).toBe(longest);
  });

  it('keeps a title, trimmed, and drops a blank one', async () => {
    expect((await save({ title: '  A title  ' })).title).toBe('A title');
    expect((await save({ title: '   ' })).title).toBeNull();
    expect((await save({ title: null })).title).toBeNull();
  });

  it('answers a Persian entry under /fa/log', async () => {
    const entry = await save({ lang: 'fa', body: body('سلام.'), publish: true });
    expect((await publicPage('fa', entry.id)).status).toBe(200);
    expect((await publicPage('en', entry.id)).status).toBe(404);
  });
});

describe('AC-13: an edit changes the text and nothing else', () => {
  it('changes the text on the page and in the feed, and leaves the URL, date, state and language alone', async () => {
    const entry = await save({ publish: true, title: 'Before', body: body('Old words.') });
    const before = rowOf(entry.id);
    const feedBefore = await (await app.request('/log/feed.xml')).text();
    await clockTo(NOW + 3 * DAY);
    const res = await client.call('PUT', `/admin/api/entries/${entry.id}`, {
      title: 'After',
      body: body('New words.'),
      lang: 'fa',
      state: 'draft',
      firstPublishedAt: 1,
      publishKey: randomUUID(),
    });
    expect(res.status).toBe(200);
    expect(res.json.entry).toMatchObject({ id: entry.id, title: 'After', lang: 'en', state: 'published', firstPublishedAt: NOW });
    const after = rowOf(entry.id);
    expect(after).toMatchObject({
      id: entry.id,
      lang: 'en',
      state: 'published',
      first_published_at: before.first_published_at,
      created_at: before.created_at,
      publish_key: before.publish_key,
      updated_at: NOW + 3 * DAY,
    });
    const page = await (await publicPage('en', entry.id)).text();
    expect(page).toContain('New words.');
    expect(page).not.toContain('Old words.');
    const feed = await (await app.request('/log/feed.xml')).text();
    expect(feed).toContain('New words.');
    expect(feed).not.toContain('Old words.');
    expect(feed).not.toBe(feedBefore);
    // The feed's <published> is the first publish, still, and the entry keeps its id.
    expect(feed).toContain('<published>2026-10-10T15:30:00+03:30</published>');
    expect(feed).toContain(`entry/${entry.id}`);
  });

  it('can clear a title, and moves updated_at on a draft too', async () => {
    const entry = await save({ title: 'Named' });
    await clockTo(NOW + DAY);
    const res = await client.call('PUT', `/admin/api/entries/${entry.id}`, { body: body('Same.') });
    expect(res.json.entry).toMatchObject({ title: null, state: 'draft' });
    expect(rowOf(entry.id)).toMatchObject({ updated_at: NOW + DAY, first_published_at: null });
  });
});

describe('AC-14: unpublish, "was live", republish', () => {
  it('takes a published entry off the log and the feed, and its URL is byte for byte the 404 of an id that never existed, in both languages', async () => {
    for (const lang of ['en', 'fa'] as const) {
      const entry = await save({ lang, body: body(lang === 'fa' ? 'سلام.' : 'Hello.'), publish: true });
      expect((await publicPage(lang, entry.id)).status).toBe(200);
      const res = await client.post(`/admin/api/entries/${entry.id}/unpublish`);
      expect(res.status).toBe(200);
      const gone = await publicPage(lang, entry.id);
      const nothing = await publicPage(lang, never);
      expect(gone.status).toBe(404);
      expect(await gone.text()).toBe(await nothing.text());
      // And through the other language's path, which never had it.
      const other = await publicPage(lang === 'en' ? 'fa' : 'en', entry.id);
      expect(await other.text()).toBe(await (await publicPage(lang === 'en' ? 'fa' : 'en', never)).text());
      expect(await (await app.request(lang === 'fa' ? '/fa/log' : '/log')).text()).not.toContain(entry.id);
      expect(await (await app.request(lang === 'fa' ? '/fa/log/feed.xml' : '/log/feed.xml')).text()).not.toContain(entry.id);
    }
  });

  it('keeps it in the admin as a draft that was live, with its original date', async () => {
    const entry = await save({ publish: true });
    await clockTo(NOW + 5 * DAY);
    const res = await client.post(`/admin/api/entries/${entry.id}/unpublish`);
    expect(res.json.entry).toMatchObject({ id: entry.id, state: 'draft', wasLive: true, firstPublishedAt: NOW });
    expect(rowOf(entry.id)).toMatchObject({ state: 'draft', first_published_at: NOW, updated_at: NOW + 5 * DAY });
    const list = (await client.get('/admin/api/entries')).json.entries as { id: string; state: string; wasLive: boolean }[];
    expect(list.find((e) => e.id === entry.id)).toMatchObject({ state: 'draft', wasLive: true });
  });

  it('labels a never-published draft "draft" with no date, and a second unpublish changes nothing', async () => {
    const entry = await save();
    expect(entry).toMatchObject({ state: 'draft', wasLive: false, firstPublishedAt: null });
    const again = await client.post(`/admin/api/entries/${entry.id}/unpublish`);
    expect(again.json.entry).toMatchObject({ state: 'draft', wasLive: false, firstPublishedAt: null });
    expect(rowOf(entry.id).updated_at).toBe(NOW);
  });

  it('republishes at the original date, with the same URL, and the feed holds it again', async () => {
    const entry = await save({ publish: true });
    await client.post(`/admin/api/entries/${entry.id}/unpublish`);
    await clockTo(NOW + 9 * DAY);
    const put = await client.call('PUT', `/admin/api/entries/${entry.id}`, { body: body('Rewritten.') });
    expect(put.json.entry).toMatchObject({ state: 'draft', wasLive: true, firstPublishedAt: NOW });
    const res = await client.post(`/admin/api/entries/${entry.id}/publish`);
    expect(res.status).toBe(200);
    expect(res.json.entry).toMatchObject({ id: entry.id, state: 'published', wasLive: false, firstPublishedAt: NOW });
    expect(rowOf(entry.id)).toMatchObject({ state: 'published', first_published_at: NOW, updated_at: NOW + 9 * DAY });
    const page = await (await publicPage('en', entry.id)).text();
    expect(page).toContain('Rewritten.');
    expect(page).toContain('10 Oct 2026');
    expect(await (await app.request('/log/feed.xml')).text()).toContain('<published>2026-10-10T15:30:00+03:30</published>');
  });

  it('does nothing when a published entry is published again, and sets the date once for a first publish', async () => {
    const entry = await save();
    await clockTo(NOW + DAY);
    const first = await client.post(`/admin/api/entries/${entry.id}/publish`);
    expect(first.json.entry).toMatchObject({ state: 'published', firstPublishedAt: NOW + DAY });
    await clockTo(NOW + 4 * DAY);
    const second = await client.post(`/admin/api/entries/${entry.id}/publish`);
    expect(second.text).toBe(first.text);
    expect(rowOf(entry.id)).toMatchObject({ first_published_at: NOW + DAY, updated_at: NOW + DAY });
  });
});

describe('AC-25: one publish key, one row', () => {
  it('answers the same key twice with one row, and the second answer is the first', async () => {
    const publishKey = randomUUID();
    const first = await client.post('/admin/api/entries', { publishKey, lang: 'en', body: body('One.'), publish: true });
    await clockTo(NOW + DAY);
    const second = await client.post('/admin/api/entries', { publishKey, lang: 'en', body: body('One.'), publish: true });
    expect(second.status).toBe(200);
    expect(second.text).toBe(first.text);
    expect(count()).toBe(1);
    expect(rowOf((first.json.entry as { id: string }).id)).toMatchObject({ first_published_at: NOW, updated_at: NOW });
  });

  it('gives one row for requests in parallel', async () => {
    const publishKey = randomUUID();
    const replies = await Promise.all(
      Array.from({ length: 6 }, () => client.post('/admin/api/entries', { publishKey, lang: 'en', body: body('Racing.'), publish: true })),
    );
    expect(count()).toBe(1);
    for (const reply of replies) expect(reply.text).toBe(replies[0]?.text);
    expect((replies[0]?.json.entry as { state: string }).state).toBe('published');
  });

  it('treats the key without regard to case', async () => {
    const publishKey = randomUUID();
    await client.post('/admin/api/entries', { publishKey, lang: 'en', body: body('One.') });
    await client.post('/admin/api/entries', { publishKey: publishKey.toUpperCase(), lang: 'en', body: body('One.') });
    expect(count()).toBe(1);
  });

  it('changes nothing for an existing key: not the text, the language, the state or the last language', async () => {
    const publishKey = randomUUID();
    const first = await client.post('/admin/api/entries', { publishKey, lang: 'en', title: 'First', body: body('First.'), publish: false });
    const id = (first.json.entry as { id: string }).id;
    await clockTo(NOW + DAY);
    const second = await client.post('/admin/api/entries', { publishKey, lang: 'fa', title: 'Second', body: body('Second.'), publish: true });
    expect(second.text).toBe(first.text);
    expect(rowOf(id)).toMatchObject({ lang: 'en', title: 'First', state: 'draft', first_published_at: null, updated_at: NOW });
    expect(await lastLanguage()).toBe('en');
    expect(count()).toBe(1);
  });

  it('gives a different key its own row', async () => {
    await save();
    await save();
    expect(count()).toBe(2);
  });
});

describe('AC-44: a draft saved on one device is listed and published on another', () => {
  it('shows a second session the draft, lets it edit and publish, and shows the public nothing before', async () => {
    const entry = await save({ title: 'Draft', body: body('Unfinished.') });
    expect((await publicPage('en', entry.id)).status).toBe(404);
    expect(await (await app.request('/log')).text()).not.toContain('Unfinished.');
    expect(await (await app.request('/log/feed.xml')).text()).not.toContain(entry.id);

    const second = (await signedIn(app, t.db, env)).client;
    const list = (await second.get('/admin/api/entries')).json.entries as { id: string; state: string }[];
    expect(list.map((e) => [e.id, e.state])).toEqual([[entry.id, 'draft']]);
    const got = await second.get(`/admin/api/entries/${entry.id}`);
    expect(got.json.entry).toMatchObject({ title: 'Draft', body: body('Unfinished.') });
    await second.call('PUT', `/admin/api/entries/${entry.id}`, { title: 'Draft', body: body('Finished.') });
    const published = await second.post(`/admin/api/entries/${entry.id}/publish`);
    expect(published.json.entry).toMatchObject({ state: 'published' });
    expect(await (await publicPage('en', entry.id)).text()).toContain('Finished.');
  });
});

describe('AC-42: the last language', () => {
  it('starts in English, and follows the last save or publish', async () => {
    expect((await client.get('/admin/api/settings')).json).toEqual({ lastLanguage: 'en', independenceNoteDismissed: false });
    const fa = await save({ lang: 'fa', body: body('سلام.') });
    expect(await lastLanguage()).toBe('fa');
    await save({ lang: 'en' });
    expect(await lastLanguage()).toBe('en');
    // An edit is a save, in the entry's own language.
    await client.call('PUT', `/admin/api/entries/${fa.id}`, { body: body('سلام دوباره.') });
    expect(await lastLanguage()).toBe('fa');
    // So is a publish, of an entry saved earlier in the other language.
    const en = await save({ lang: 'en' });
    await save({ lang: 'fa' });
    await client.post(`/admin/api/entries/${en.id}/publish`);
    expect(await lastLanguage()).toBe('en');
  });

  it('is left alone by an unpublish and by a refused save', async () => {
    const en = await save({ lang: 'en', publish: true });
    await save({ lang: 'fa' });
    await client.post(`/admin/api/entries/${en.id}/unpublish`);
    expect(await lastLanguage()).toBe('fa');
    const refused = await client.post('/admin/api/entries', { publishKey: randomUUID(), lang: 'en', body: { type: 'doc', content: [] } });
    expect(refused.status).toBe(400);
    expect(await lastLanguage()).toBe('fa');
  });
});

describe('the refusals, by the bytes of the body (§6.2)', () => {
  const valid = () => ({ publishKey: randomUUID(), lang: 'en', body: body('Hello.') });
  const refused = async (fields: Record<string, unknown>, code: string, status = 400) => {
    const before = count();
    const res = await client.post('/admin/api/entries', { ...valid(), ...fields });
    expect(res.status, JSON.stringify(fields)).toBe(status);
    expect(res.text, JSON.stringify(fields)).toBe(codeBody(code));
    expect(count()).toBe(before);
  };

  it.each([['missing', undefined], ['German', 'de'], ['a number', 1], ['uppercase', 'EN'], ['null', null]])('says LANG_INVALID for a language that is %s', async (_n, lang) => {
    await refused({ lang }, 'LANG_INVALID');
  });

  it('checks the language before anything else', async () => {
    await refused({ lang: 'de', publishKey: 'nope', title: 5, publish: 'yes', body: 'junk' }, 'LANG_INVALID');
  });

  it.each([
    ['a publish key that is not a UUID', { publishKey: 'not-a-uuid' }],
    ['no publish key', { publishKey: undefined }],
    ['a publish key that is a number', { publishKey: 7 }],
    ['a title that is a number', { title: 5 }],
    ['a title that is an object', { title: {} }],
    ['a title over limits.titleMaxChars', { title: 'x'.repeat(limits.titleMaxChars + 1) }],
    ['a title with a line break', { title: 'two\nlines' }],
    ['a title with a control character', { title: 'a\u0007b' }],
    ['a publish flag that is a string', { publish: 'true' }],
  ])('says REQUEST_INVALID for %s, before it looks at the body', async (_n, fields) => {
    await refused({ ...fields, body: 'junk' }, 'REQUEST_INVALID');
  });

  it('says REQUEST_INVALID for a request that is not a JSON object', async () => {
    for (const payload of [null, [], 'x', 4]) {
      const res = await client.call('POST', '/admin/api/entries', payload);
      expect(res.text).toBe(codeBody('REQUEST_INVALID'));
    }
    expect(count()).toBe(0);
  });

  const para = (...content: unknown[]) => ({ type: 'paragraph', content });
  const text = (value: string, marks?: unknown) => (marks ? { type: 'text', text: value, marks } : { type: 'text', text: value });

  it.each([
    ['no body', undefined],
    ['a string', 'text'],
    ['a heading', { type: 'doc', content: [{ type: 'heading', content: [text('x')] }] }],
    ['a javascript: link', { type: 'doc', content: [para(text('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]))] }],
    ['an unknown mark', { type: 'doc', content: [para(text('x', [{ type: 'bold' }]))] }],
    ['an empty text node', { type: 'doc', content: [para(text(''))] }],
    ['a vertical tab in the text (S-5)', { type: 'doc', content: [para(text('one\u000Btwo'))] }],
    ['a null character in the text', { type: 'doc', content: [para(text('one\u0000two'))] }],
    ['U+FFFE in the text', { type: 'doc', content: [para(text('one￾two'))] }],
    ['a control character in a link address', { type: 'doc', content: [para(text('x', [{ type: 'link', attrs: { href: 'https://example.org/\u0001' } }]))] }],
  ])('says DOC_INVALID for a body that is %s', async (_n, doc) => {
    await refused({ body: doc }, 'DOC_INVALID');
  });

  it('allows a tab, a line feed and a carriage return in the text, which XML allows', async () => {
    const entry = await save({ body: { type: 'doc', content: [para(text('a\tb\nc\rd'))] } });
    expect(entry.state).toBe('draft');
  });

  it('says DOC_INVALID for a body over the size limit, and accepts one at it', async () => {
    const wrap = (n: number) => ({ type: 'doc', content: [para(text('x'.repeat(n)))] });
    const overhead = Buffer.byteLength(JSON.stringify(wrap(0)));
    await refused({ body: wrap(limits.bodyMaxBytes - overhead + 1) }, 'DOC_INVALID');
    const atLimit = await client.post('/admin/api/entries', { ...valid(), body: wrap(limits.bodyMaxBytes - overhead) });
    expect(atLimit.status).toBe(200);
  });

  it('counts the bytes, not the characters: Persian text is two bytes a letter', async () => {
    const wrap = (n: number) => ({ type: 'doc', content: [para(text('س'.repeat(n)))] });
    await refused({ body: wrap(limits.bodyMaxBytes / 2) }, 'DOC_INVALID');
  });

  it.each([
    ['whitespace only', { type: 'doc', content: [para(text('   \n\t '))] }],
    ['empty paragraphs only (S-4)', { type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph', content: [] }] }],
    ['empty paragraphs and whitespace', { type: 'doc', content: [{ type: 'paragraph' }, para(text('  '))] }],
    ['no paragraphs at all', { type: 'doc', content: [] }],
  ])('says BODY_REQUIRED for a body that is %s (AC-18)', async (_n, doc) => {
    await refused({ body: doc }, 'BODY_REQUIRED');
    await refused({ body: doc, publish: true }, 'BODY_REQUIRED');
  });

  it('drops empty paragraphs before it saves (S-4), keeping the others in order', async () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph' }, para(text('One.')), { type: 'paragraph', content: [] }, para(text('Two.')), { type: 'paragraph' }] };
    const entry = await save({ body: doc });
    expect(entry.body).toEqual(body('One.\n\nTwo.'));
    expect(JSON.parse(rowOf(entry.id).body as string)).toEqual(body('One.\n\nTwo.'));
    const put = await client.call('PUT', `/admin/api/entries/${entry.id}`, { body: { type: 'doc', content: [{ type: 'paragraph' }, para(text('Three.'))] } });
    expect((put.json.entry as { body: Doc }).body).toEqual(body('Three.'));
  });

  it('puts the title before the body: a bad title and a bad body is REQUEST_INVALID', async () => {
    await refused({ title: 3, body: { type: 'doc', content: [] } }, 'REQUEST_INVALID');
  });

  it('refuses the same things on an edit, and leaves the entry as it was', async () => {
    const entry = await save({ title: 'Keep', body: body('Keep.'), publish: true });
    const before = rowOf(entry.id);
    for (const [fields, code] of [
      [{ title: 5, body: body('x') }, 'REQUEST_INVALID'],
      [{ title: 'a\nb', body: body('x') }, 'REQUEST_INVALID'],
      [{ body: { type: 'doc', content: [para(text('a\u000Bb'))] } }, 'DOC_INVALID'],
      [{ body: 'junk' }, 'DOC_INVALID'],
      [{ body: { type: 'doc', content: [{ type: 'paragraph' }] } }, 'BODY_REQUIRED'],
      [{ title: 'x' }, 'DOC_INVALID'],
    ] as const) {
      const res = await client.call('PUT', `/admin/api/entries/${entry.id}`, fields);
      expect(res.status, JSON.stringify(fields)).toBe(400);
      expect(res.text).toBe(codeBody(code));
    }
    expect(rowOf(entry.id)).toEqual(before);
    expect((await client.call('PUT', `/admin/api/entries/${entry.id}`, [])).text).toBe(codeBody('REQUEST_INVALID'));
  });

  it('says NOT_FOUND, with the same body, for an unknown id and for a malformed one', async () => {
    const wanted = codeBody('NOT_FOUND');
    for (const id of [never, 'x', 'A000000099', 'a00000009', '..%2Fsession']) {
      for (const [method, path, payload] of [
        ['GET', `/admin/api/entries/${id}`, undefined],
        ['PUT', `/admin/api/entries/${id}`, { body: body('x') }],
        ['POST', `/admin/api/entries/${id}/publish`, {}],
        ['POST', `/admin/api/entries/${id}/unpublish`, {}],
      ] as const) {
        const res = await client.call(method, path, payload);
        expect(res.status, `${method} ${path}`).toBe(404);
        expect(res.text, `${method} ${path}`).toBe(wanted);
      }
    }
    expect(count()).toBe(0);
  });

  it('puts an unknown id before the body on an edit', async () => {
    const res = await client.call('PUT', `/admin/api/entries/${never}`, { body: 'junk', title: 4 });
    expect(res.text).toBe(codeBody('NOT_FOUND'));
  });
});

describe('the list', () => {
  const at = (days: number) => NOW - days * DAY;
  const fixture = (n: number, fields: Record<string, unknown> = {}) =>
    insertFixture(t.db, { id: `a${String(n).padStart(9, '0')}`, lang: 'en', body: body(`Entry ${n}.`), firstPublishedAt: at(n), ...fields });
  const list = async (query = '') => {
    const res = await client.get(`/admin/api/entries${query}`);
    expect(res.status, res.text).toBe(200);
    return res.json as { entries: { id: string; excerpt: string; title: string | null; lang: string; state: string; wasLive: boolean; firstPublishedAt: number | null }[]; olderBefore: string | null; now: number };
  };

  it('is empty with no entries, and says when it is: now() and no cursor', async () => {
    expect(await list()).toEqual({ entries: [], olderBefore: null, now: NOW });
  });

  it('orders by the date shown, newest first: first publish, or the day a draft was started', async () => {
    fixture(5);
    fixture(3);
    // Never published, started two days ago: sits between the two.
    insertFixture(t.db, { id: 'a000000099', lang: 'en', body: body('Half a thought.'), state: 'draft', createdAt: at(4) });
    // Was live, first published a day ago, started long before: sits by its first publish, not its start.
    insertFixture(t.db, { id: 'a000000098', lang: 'fa', body: body('سلام.'), state: 'draft', firstPublishedAt: at(1), createdAt: at(30) });
    const { entries } = await list();
    expect(entries.map((e) => e.id)).toEqual(['a000000098', 'a000000003', 'a000000099', 'a000000005']);
    expect(entries.map((e) => [e.state, e.wasLive, e.firstPublishedAt === null])).toEqual([
      ['draft', true, false],
      ['published', false, false],
      ['draft', false, true],
      ['published', false, false],
    ]);
  });

  it('pages by the cursor, across a tie and a mix of states, with no repeat and no gap', async () => {
    // 25 entries; every five share a date, so a page boundary can fall inside a tie.
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      ids.push(fixture(i + 1, { firstPublishedAt: at(Math.floor(i / 5) + 1) }));
    }
    insertFixture(t.db, { id: 'a000000050', lang: 'en', body: body('Draft.'), state: 'draft', createdAt: at(2) });
    const first = await list();
    expect(first.entries).toHaveLength(limits.pageSize);
    expect(first.olderBefore).toBe(first.entries[limits.pageSize - 1]?.id);
    const second = await list(`?before=${first.olderBefore}`);
    expect(second.entries).toHaveLength(26 - limits.pageSize);
    expect(second.olderBefore).toBeNull();
    const all = [...first.entries, ...second.entries].map((e) => e.id);
    expect(new Set(all).size).toBe(26);
    // The same order a single query gives: date descending, then id ascending.
    const expected = (t.db.prepare('SELECT id FROM entry ORDER BY COALESCE(first_published_at, created_at) DESC, id ASC').all() as { id: string }[]).map((r) => r.id);
    expect(all).toEqual(expected);
  });

  it('sends no count, total, page number or elapsed time: only the rows, the cursor and the clock', async () => {
    fixture(1);
    fixture(2, { lang: 'fa' });
    const res = await list();
    expect(Object.keys(res).sort()).toEqual(['entries', 'now', 'olderBefore']);
    for (const row of res.entries) {
      expect(Object.keys(row).sort()).toEqual(['excerpt', 'firstPublishedAt', 'id', 'lang', 'state', 'title', 'wasLive']);
    }
    expect(JSON.stringify(res)).not.toMatch(/count|total|page|ago/i);
  });

  it('lists both languages together, each row with its language', async () => {
    fixture(1);
    fixture(2, { lang: 'fa', body: body('سلام.') });
    expect((await list()).entries.map((e) => e.lang)).toEqual(['en', 'fa']);
  });

  it('gives each row its title and an excerpt of the body: plain text, about 120 characters, cut at a word', async () => {
    const long = `${'word '.repeat(40)}end`;
    insertFixture(t.db, { id: 'a000000001', lang: 'en', title: 'Titled', body: body('Short body.'), firstPublishedAt: at(1) });
    insertFixture(t.db, { id: 'a000000002', lang: 'en', body: body(`A [link](https://example.org) and ==marked== text.\n\n${long}`), firstPublishedAt: at(2) });
    const { entries } = await list();
    expect(entries[0]).toMatchObject({ title: 'Titled', excerpt: 'Short body.' });
    expect(entries[1]?.title).toBeNull();
    expect(entries[1]?.excerpt.startsWith('A link and marked text. word word')).toBe(true);
    expect(entries[1]?.excerpt.endsWith('word…')).toBe(true);
    expect(Array.from(entries[1]?.excerpt ?? '').length).toBeLessThanOrEqual(121);
  });

  it.each([['an unknown id', 'a000000077'], ['a malformed one', 'nope'], ['one in the wrong case', 'A000000001']])('says NOT_FOUND for a cursor that is %s', async (_n, cursor) => {
    fixture(1);
    const res = await client.get(`/admin/api/entries?before=${cursor}`);
    expect(res.status).toBe(404);
    expect(res.text).toBe(codeBody('NOT_FOUND'));
  });

  it('takes a draft, an unpublished entry and the other language as a cursor: the admin sees them all', async () => {
    fixture(1);
    const draft = insertFixture(t.db, { id: 'a000000020', lang: 'fa', body: body('x'), state: 'draft', createdAt: at(0) });
    const res = await list(`?before=${draft}`);
    expect(res.entries.map((e) => e.id)).toEqual(['a000000001']);
  });
});

describe('GET entries/<id>', () => {
  it('sends the whole entry: the language, the title, the body as a document, the state and the dates', async () => {
    const saved = await save({ lang: 'fa', title: 'عنوان', body: body('سلام ==دنیا==.'), publish: true });
    const res = await client.get(`/admin/api/entries/${saved.id}`);
    expect(res.json).toEqual({
      entry: { id: saved.id, lang: 'fa', title: 'عنوان', body: body('سلام ==دنیا==.'), state: 'published', wasLive: false, firstPublishedAt: NOW },
    });
  });
});

describe('S-11 and S-12: what is under /admin/api and nothing is a route', () => {
  const unknown = ['/admin/api/zzz', '/admin/api/entries/x/y/z', '/admin/api/episodes', '/admin/api/entries/extra/publish/more', '/admin/api'];

  it('answers an unknown path with the JSON NOT_FOUND when signed in', async () => {
    for (const path of unknown) {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
        const res = await client.call(method, path, method === 'GET' || method === 'DELETE' ? undefined : {});
        expect(res.status, `${method} ${path}`).toBe(404);
        expect(res.text, `${method} ${path}`).toBe(codeBody('NOT_FOUND'));
        expect(res.headers.get('Content-Type')).toContain('application/json');
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        expect(res.headers.getSetCookie()).toEqual([]);
      }
    }
  });

  it('answers a known path with a method it does not have as NOT_FOUND too', async () => {
    const res = await client.delete('/admin/api/entries');
    expect(res.status).toBe(404);
    expect(res.text).toBe(codeBody('NOT_FOUND'));
  });

  it('still answers 401 UNAUTHENTICATED for all of them when signed out', async () => {
    for (const path of [...unknown, '/admin/api/entries', `/admin/api/entries/${never}`]) {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
        const res = await new Client(app, env).call(method, path, method === 'GET' || method === 'DELETE' ? undefined : {});
        expect(res.status, `${method} ${path}`).toBe(401);
        expect(res.text, `${method} ${path}`).toBe(codeBody('UNAUTHENTICATED'));
      }
    }
  });

  it('leaves an unknown path under auth/ as it was: the public site\'s 404, signed in or out', async () => {
    const publicNotFound = await (await app.request('/no-such-page')).text();
    for (const c of [client, new Client(app, env)]) {
      for (const method of ['GET', 'POST']) {
        const res = await c.call(method, '/admin/api/auth/zzz', method === 'GET' ? undefined : {});
        expect(res.status, method).toBe(404);
        expect(res.text, method).toBe(publicNotFound);
      }
    }
  });

  it('puts every entry route behind the session, the Origin check and the CSRF token, before it writes anything', async () => {
    const entry = await save({ publish: true });
    const before = rowOf(entry.id);
    const writes: [string, string, unknown][] = [
      ['POST', '/admin/api/entries', { publishKey: randomUUID(), lang: 'en', body: body('x'), publish: true }],
      ['PUT', `/admin/api/entries/${entry.id}`, { body: body('changed') }],
      ['POST', `/admin/api/entries/${entry.id}/publish`, {}],
      ['POST', `/admin/api/entries/${entry.id}/unpublish`, {}],
    ];
    for (const [method, path, payload] of writes) {
      const noToken = await client.call(method, path, payload, { 'X-CSRF-Token': 'wrong' });
      expect(noToken.status, path).toBe(403);
      expect(noToken.text).toBe(codeBody('CSRF_INVALID'));
      const foreign = await client.call(method, path, payload, { Origin: 'https://evil.example' });
      expect(foreign.status, path).toBe(403);
      expect(foreign.text).toBe(codeBody('ORIGIN_REFUSED'));
    }
    expect(rowOf(entry.id)).toEqual(before);
    expect(count()).toBe(1);
  });

  it('sends the entry routes the admin API\'s own headers', async () => {
    const res = await client.get('/admin/api/entries');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
  });
});

describe('the feed follows an edit and an unpublish (AC-3, AC-13)', () => {
  it('shows an edit on the next request, drops an unpublished entry, and brings it back at its date', async () => {
    const entry = await save({ publish: true, body: body('First words.') });
    const feed = async () => (await app.request('/log/feed.xml')).text();
    expect(await feed()).toContain('First words.');
    await clockTo(NOW + DAY);
    await client.call('PUT', `/admin/api/entries/${entry.id}`, { body: body('Second words.') });
    const edited = await feed();
    expect(edited).toContain('Second words.');
    expect(edited).not.toContain('First words.');
    // The feed's own date is the edit's, the entry's <published> is not.
    expect(edited).toContain('<updated>2026-10-11T15:30:00+03:30</updated>');
    expect(edited).toContain('<published>2026-10-10T15:30:00+03:30</published>');
    await client.post(`/admin/api/entries/${entry.id}/unpublish`);
    const gone = await feed();
    expect(gone).not.toContain(entry.id);
    expect(gone).not.toContain('Second words.');
    await client.post(`/admin/api/entries/${entry.id}/publish`);
    const back = await feed();
    expect(back).toContain(`entry/${entry.id}`);
    expect(back).toContain('<published>2026-10-10T15:30:00+03:30</published>');
  });
});

describe('direct SQL: what B5 relies on (house rule 6)', () => {
  const insert = (sql: string, ...args: unknown[]) => () => t.db.prepare(sql).run(...args);
  const row = "INSERT INTO entry (id, lang, body, state, first_published_at, publish_key, created_at, updated_at) VALUES (?, 'en', '{}', ?, ?, ?, 1, 1)";

  it('refuses a published entry with no first-publish date, and accepts a draft with one (was live)', () => {
    expect(insert(row, 'c000000001', 'published', null, null)).toThrow(/CHECK/);
    expect(insert(row, 'c000000002', 'draft', null, null)).not.toThrow();
    expect(insert(row, 'c000000003', 'draft', 5, null)).not.toThrow();
    expect(insert(row, 'c000000004', 'published', 5, null)).not.toThrow();
  });

  it('refuses two rows with one publish key, and lets any number have none', () => {
    expect(insert(row, 'c000000005', 'draft', null, 'key-1')).not.toThrow();
    expect(insert(row, 'c000000006', 'draft', null, 'key-1')).toThrow(/UNIQUE/);
    expect(insert(row, 'c000000007', 'draft', null, null)).not.toThrow();
    expect(insert(row, 'c000000008', 'draft', null, null)).not.toThrow();
  });

  it('does nothing for a taken key under ON CONFLICT DO NOTHING, which is the whole of AC-25', () => {
    insert(row, 'c000000009', 'draft', null, 'key-2')();
    const result = t.db
      .prepare("INSERT INTO entry (id, lang, body, created_at, updated_at) VALUES ('c000000010', 'fa', '{}', 2, 2) ON CONFLICT (publish_key) DO NOTHING")
      .run();
    expect(result.changes).toBe(1); // no key given: a NULL never conflicts, so this is a new row
    const again = t.db
      .prepare("INSERT INTO entry (id, lang, body, publish_key, created_at, updated_at) VALUES ('c000000011', 'fa', '{}', 'key-2', 2, 2) ON CONFLICT (publish_key) DO NOTHING")
      .run();
    expect(again.changes).toBe(0);
    expect(t.db.prepare("SELECT count(*) AS n FROM entry WHERE publish_key = 'key-2'").get()).toEqual({ n: 1 });
  });
});

describe('what the API never says (house rules 1 and 9)', () => {
  it('has no id that counts: two entries saved in a row have unrelated ids', async () => {
    const a = await save();
    const b = await save();
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{10}$/);
  });

  it('logs nothing: a save, an edit and a refusal write no console line', async () => {
    const lines: unknown[][] = [];
    const originals = { log: console.log, error: console.error, warn: console.warn };
    console.log = (...args: unknown[]) => void lines.push(args);
    console.error = (...args: unknown[]) => void lines.push(args);
    console.warn = (...args: unknown[]) => void lines.push(args);
    try {
      const entry = await save({ title: 'Secret title', body: body('Secret text.'), publish: true });
      await client.call('PUT', `/admin/api/entries/${entry.id}`, { body: body('More secret text.') });
      await client.post('/admin/api/entries', { publishKey: 'bad', lang: 'en', body: body('Rejected secret.') });
    } finally {
      Object.assign(console, originals);
    }
    expect(lines).toEqual([]);
  });
});

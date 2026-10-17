// The entry insert the seed CLI and the tests share, the CLI itself, and the
// e2e-only routes (plan B3). The CHECKs the log relies on are proven by direct SQL.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seedEntry } from '../../scripts/seed-entry.ts';
import { resetClock, setNow } from '../../lib/clock.ts';
import { clearEntries, getPublished, insertFixture, insertPublished } from '../../lib/entries.ts';
import { isId } from '../../lib/ids.ts';
import { docFromText } from '../../shared/doc.ts';
import { NOW, tempDb, testApp } from '../helpers.ts';

const t = tempDb();
afterAll(() => {
  resetClock();
  t.cleanup();
});
beforeEach(() => {
  clearEntries(t.db);
  setNow(NOW);
});

const body = docFromText('Hello.');

describe('direct SQL: what the log relies on', () => {
  const insert = (sql: string, ...args: unknown[]) => () => t.db.prepare(sql).run(...args);

  it('refuses a published entry with no first-publish date', () => {
    expect(
      insert("INSERT INTO entry (id, lang, body, state, created_at, updated_at) VALUES ('x1', 'en', '{}', 'published', 1, 1)"),
    ).toThrow(/CHECK/);
  });

  it('refuses a language that is not en or fa', () => {
    expect(
      insert("INSERT INTO entry (id, lang, body, state, first_published_at, created_at, updated_at) VALUES ('x2', 'de', '{}', 'published', 1, 1, 1)"),
    ).toThrow(/CHECK/);
  });

  it('refuses a state that is not draft or published', () => {
    expect(
      insert("INSERT INTO entry (id, lang, body, state, created_at, updated_at) VALUES ('x3', 'en', '{}', 'live', 1, 1)"),
    ).toThrow(/CHECK/);
  });
});

describe('insertPublished', () => {
  it('inserts a published row with a random id, now() as its date, and no publish key', () => {
    const id = insertPublished(t.db, { lang: 'en', body });
    expect(isId(id)).toBe(true);
    const row = t.db.prepare('SELECT * FROM entry WHERE id = ?').get(id) as Record<string, unknown>;
    expect(row).toMatchObject({ lang: 'en', title: null, state: 'published', first_published_at: NOW, created_at: NOW, updated_at: NOW });
    expect(row.publish_key).toBeNull();
    expect(JSON.parse(row.body as string)).toEqual(body);
  });

  it('keeps a title, drops a blank one, and honours given dates and id', () => {
    insertPublished(t.db, { lang: 'fa', id: 'a000000001', title: '  عنوان ', body, firstPublishedAt: 5, updatedAt: 9 });
    insertPublished(t.db, { lang: 'fa', id: 'a000000002', title: '   ', body, firstPublishedAt: 6 });
    expect(getPublished(t.db, 'fa', 'a000000001')).toMatchObject({ title: 'عنوان', firstPublishedAt: 5, updatedAt: 9 });
    expect(getPublished(t.db, 'fa', 'a000000002')?.title).toBeNull();
  });

  it('refuses a body that is not a valid document', () => {
    expect(() => insertPublished(t.db, { lang: 'en', body: { type: 'doc', content: [] } })).toThrow('DOC_INVALID');
  });

  it('is read only in its own language', () => {
    insertPublished(t.db, { lang: 'en', id: 'a000000003', body });
    expect(getPublished(t.db, 'en', 'a000000003')).not.toBeNull();
    expect(getPublished(t.db, 'fa', 'a000000003')).toBeNull();
  });
});

describe('insertFixture: an entry in any state, for the tests and the e2e routes (B5)', () => {
  const rowOf = (id: string) => t.db.prepare('SELECT * FROM entry WHERE id = ?').get(id) as Record<string, unknown>;

  it('inserts a never-published draft with no date, placed by the day it was started', () => {
    const id = insertFixture(t.db, { lang: 'en', body, state: 'draft', createdAt: NOW - 1000 });
    expect(rowOf(id)).toMatchObject({ state: 'draft', first_published_at: null, created_at: NOW - 1000, updated_at: NOW - 1000 });
    expect(getPublished(t.db, 'en', id)).toBeNull();
  });

  it('inserts a draft that was live: a first-publish date and no public page', () => {
    const id = insertFixture(t.db, { lang: 'en', body, state: 'draft', firstPublishedAt: NOW - 5000 });
    expect(rowOf(id)).toMatchObject({ state: 'draft', first_published_at: NOW - 5000, created_at: NOW - 5000 });
    expect(getPublished(t.db, 'en', id)).toBeNull();
  });

  it('inserts a published entry at the clock by default, and keeps a publish key', () => {
    const id = insertFixture(t.db, { lang: 'fa', body, publishKey: 'k-1' });
    expect(rowOf(id)).toMatchObject({ state: 'published', first_published_at: NOW, publish_key: 'k-1' });
  });

  it('refuses a published entry with no date, and a body that is not a document', () => {
    expect(() => insertFixture(t.db, { lang: 'en', body, state: 'published', firstPublishedAt: null })).toThrow(/first-publish date/);
    expect(() => insertFixture(t.db, { lang: 'en', body: { type: 'doc', content: [] } })).toThrow('DOC_INVALID');
  });
});

describe('seed-entry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'imnstr-seed-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const file = (text: string) => {
    const path = join(dir, `${Math.random().toString(36).slice(2)}.txt`);
    writeFileSync(path, text);
    return path;
  };

  it('publishes a body file and prints the entry\'s path', () => {
    const path = seedEntry(['--lang', 'en', '--title', 'Seeded', '--body-file', file('One.\n\nTwo ==marked==.')], t.db);
    expect(path).toMatch(/^\/log\/[0-9a-hjkmnp-tv-z]{10}$/);
    const id = path.slice('/log/'.length);
    expect(getPublished(t.db, 'en', id)).toMatchObject({ title: 'Seeded' });
    expect(getPublished(t.db, 'en', id)?.doc.content).toHaveLength(2);
  });

  it('puts a Persian entry under /fa/log', () => {
    const path = seedEntry(['--lang', 'fa', '--body-file', file('سلام.')], t.db);
    expect(path).toMatch(/^\/fa\/log\//);
  });

  it('refuses a missing language, a bad language, a missing file and an empty body', () => {
    expect(() => seedEntry(['--body-file', file('x')], t.db)).toThrow(/Usage/);
    expect(() => seedEntry(['--lang', 'de', '--body-file', file('x')], t.db)).toThrow(/Usage/);
    expect(() => seedEntry(['--lang', 'en'], t.db)).toThrow(/Usage/);
    expect(() => seedEntry(['--lang', 'en', '--body-file', join(dir, 'missing.txt')], t.db)).toThrow();
    expect(() => seedEntry(['--lang', 'en', '--body-file', file('  \n\n ')], t.db)).toThrow(/no text/);
    expect(() => seedEntry(['--lang', 'en', '--nope', 'x'], t.db)).toThrow();
  });
});

describe('the e2e entry routes', () => {
  const post = (app: ReturnType<typeof testApp>, payload: unknown) =>
    app.request('/__test/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

  it('insert published entries through the same function, and clear them', async () => {
    const app = testApp(t.db, { E2E_CLOCK: '1' });
    const res = await post(app, {
      entries: [
        { lang: 'en', title: 'One', text: 'First.\n\nSecond.', firstPublishedAt: NOW - 1000 },
        { lang: 'fa', body, id: 'a000000009' },
      ],
    });
    expect(res.status).toBe(200);
    const { ids } = (await res.json()) as { ids: string[] };
    expect(ids).toHaveLength(2);
    expect(getPublished(t.db, 'en', ids[0] as string)).toMatchObject({ title: 'One', firstPublishedAt: NOW - 1000 });
    expect(ids[1]).toBe('a000000009');
    expect((await app.request('/log')).status).toBe(200);
    const cleared = await app.request('/__test/entries', { method: 'DELETE' });
    expect(cleared.status).toBe(200);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM entry').get()).toEqual({ n: 0 });
  });

  it('seed drafts and entries that were live, through state and the dates', async () => {
    const app = testApp(t.db, { E2E_CLOCK: '1' });
    const res = await post(app, {
      entries: [
        { lang: 'en', text: 'A draft.', state: 'draft', createdAt: NOW - 10, id: 'a000000021' },
        { lang: 'en', text: 'Was live.', state: 'draft', firstPublishedAt: NOW - 20, id: 'a000000022' },
        { lang: 'en', text: 'Live.', id: 'a000000023', publishKey: 'k-2' },
      ],
    });
    expect(res.status).toBe(200);
    const rows = t.db.prepare('SELECT id, state, first_published_at AS f, created_at AS c, publish_key AS k FROM entry ORDER BY id').all();
    expect(rows).toEqual([
      { id: 'a000000021', state: 'draft', f: null, c: NOW - 10, k: null },
      { id: 'a000000022', state: 'draft', f: NOW - 20, c: NOW - 20, k: null },
      { id: 'a000000023', state: 'published', f: NOW, c: NOW, k: 'k-2' },
    ]);
  });

  it.each([null, {}, { entries: 'x' }, { entries: [{ lang: 'en', text: 'x', state: 'live' }] }, { entries: [{ lang: 'en', text: 'x', createdAt: 'now' }] }, { entries: [{ lang: 'de', text: 'x' }] }, { entries: [{ lang: 'en' }] }, { entries: [{ lang: 'en', text: 'x', firstPublishedAt: 1.5 }] }])(
    'refuse %j with a code and insert nothing',
    async (payload) => {
      const app = testApp(t.db, { E2E_CLOCK: '1' });
      const res = await post(app, payload);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ code: 'ENTRY_INVALID' });
      expect(t.db.prepare('SELECT COUNT(*) AS n FROM entry').get()).toEqual({ n: 0 });
    },
  );

  it('do not exist without E2E_CLOCK', async () => {
    const app = testApp(t.db);
    expect((await post(app, { entries: [] })).status).toBe(404);
    expect((await app.request('/__test/entries', { method: 'DELETE' })).status).toBe(404);
  });
});

// lib/publish.ts as the one publish rule for any table with the shared columns (house
// rule 4, PD-11). Entries are covered through the API in admin-entries.test.ts; this file
// asks the same questions of the episode table too, because B7 reuses the file as it is.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetClock, setNow } from '../../lib/clock.ts';
import { createOrGet, lastLanguage, publish, rememberLanguage, unpublish, type PublishRow } from '../../lib/publish.ts';
import { DAY, NOW, tempDb } from '../helpers.ts';

const t = tempDb();
afterAll(() => {
  resetClock();
  t.cleanup();
});
beforeEach(() => {
  setNow(NOW);
  t.db.exec('DELETE FROM episode; DELETE FROM entry; DELETE FROM setting;');
});

const entryFields = { lang: 'en', title: null, body: '{}' };
const episodeFields = { lang: 'en', date: '2026-10-10' };
const key = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const addLink = (id: string) => t.db.prepare("INSERT INTO episode_link (episode_id, position, label, url) VALUES (?, 0, 'Listen', 'https://example.org/e')").run(id);

describe('createOrGet', () => {
  it('inserts a draft dated by the clock, under the key', () => {
    const { row, created } = createOrGet<PublishRow>(t.db, 'entry', key(1), entryFields, { publish: false });
    expect(created).toBe(true);
    expect(row).toMatchObject({ lang: 'en', state: 'draft', first_published_at: null, publish_key: key(1), created_at: NOW, updated_at: NOW });
  });

  it('inserts and publishes in one go, at the clock', () => {
    const { row } = createOrGet<PublishRow>(t.db, 'entry', key(2), entryFields, { publish: true });
    expect(row).toMatchObject({ state: 'published', first_published_at: NOW, updated_at: NOW });
  });

  it('returns the row that holds an existing key as it is, and writes nothing', () => {
    const first = createOrGet<PublishRow>(t.db, 'entry', key(3), entryFields, { publish: false });
    setNow(NOW + DAY);
    const second = createOrGet<PublishRow>(t.db, 'entry', key(3), { ...entryFields, lang: 'fa', title: 'Other' }, { publish: true });
    expect(second.created).toBe(false);
    expect(second.row).toEqual(first.row);
    expect(t.db.prepare('SELECT count(*) AS n FROM entry').get()).toEqual({ n: 1 });
  });

  it('refuses a field that is one of its own columns, or not a plain column name', () => {
    for (const name of ['id', 'state', 'first_published_at', 'publish_key', 'created_at', 'updated_at', 'lang; DROP TABLE entry', 'Lang']) {
      expect(() => createOrGet(t.db, 'entry', key(4), { ...entryFields, [name]: 'x' }, { publish: false })).toThrow(/Not a column/);
    }
    expect(t.db.prepare('SELECT count(*) AS n FROM entry').get()).toEqual({ n: 0 });
  });

  it('serves an episode too: a draft with its own columns, an existing key returning the same row', () => {
    const first = createOrGet<PublishRow>(t.db, 'episode', key(5), episodeFields, { publish: false });
    expect(first.row).toMatchObject({ lang: 'en', state: 'draft', first_published_at: null, date: '2026-10-10' });
    const again = createOrGet<PublishRow>(t.db, 'episode', key(5), episodeFields, { publish: false });
    expect(again.row).toEqual(first.row);
    expect(t.db.prepare('SELECT count(*) AS n FROM episode').get()).toEqual({ n: 1 });
  });

  it('rolls an episode back whole when it is asked to publish with no link: the trigger refuses, and no row is left', () => {
    expect(() => createOrGet(t.db, 'episode', key(6), episodeFields, { publish: true })).toThrow(/LINK_REQUIRED/);
    expect(t.db.prepare('SELECT count(*) AS n FROM episode').get()).toEqual({ n: 0 });
  });
});

describe('publish and unpublish', () => {
  const draft = (kind: 'entry' | 'episode' = 'entry') => createOrGet<PublishRow>(t.db, kind, key(Math.floor(Math.random() * 1e9)), kind === 'entry' ? entryFields : episodeFields, { publish: false }).row;

  it('publishes a draft at the clock, once', () => {
    const row = draft();
    setNow(NOW + DAY);
    const result = publish<PublishRow>(t.db, 'entry', row.id);
    expect(result?.changed).toBe(true);
    expect(result?.row).toMatchObject({ state: 'published', first_published_at: NOW + DAY, updated_at: NOW + DAY });
    setNow(NOW + 3 * DAY);
    const again = publish<PublishRow>(t.db, 'entry', row.id);
    expect(again?.changed).toBe(false);
    expect(again?.row).toEqual(result?.row);
  });

  it('keeps the first date through an unpublish and a republish, and moves updated_at each time', () => {
    const row = draft();
    setNow(NOW + DAY);
    publish(t.db, 'entry', row.id);
    setNow(NOW + 2 * DAY);
    const off = unpublish<PublishRow>(t.db, 'entry', row.id);
    expect(off?.row).toMatchObject({ state: 'draft', first_published_at: NOW + DAY, updated_at: NOW + 2 * DAY });
    setNow(NOW + 5 * DAY);
    const on = publish<PublishRow>(t.db, 'entry', row.id);
    expect(on?.row).toMatchObject({ state: 'published', first_published_at: NOW + DAY, updated_at: NOW + 5 * DAY });
  });

  it('leaves a draft as it is when it is unpublished', () => {
    const row = draft();
    setNow(NOW + DAY);
    const result = unpublish<PublishRow>(t.db, 'entry', row.id);
    expect(result?.changed).toBe(false);
    expect(result?.row).toEqual(row);
  });

  it('answers null for a row that is not there', () => {
    expect(publish(t.db, 'entry', 'zzzzzzzzzz')).toBeNull();
    expect(unpublish(t.db, 'entry', 'zzzzzzzzzz')).toBeNull();
  });

  it('publishes an episode only once it has a link (the trigger), and then keeps its date', () => {
    const row = draft('episode');
    expect(() => publish(t.db, 'episode', row.id)).toThrow(/LINK_REQUIRED/);
    addLink(row.id);
    expect(publish<PublishRow>(t.db, 'episode', row.id)?.row).toMatchObject({ state: 'published', first_published_at: NOW });
    setNow(NOW + DAY);
    unpublish(t.db, 'episode', row.id);
    setNow(NOW + 2 * DAY);
    expect(publish<PublishRow>(t.db, 'episode', row.id)?.row).toMatchObject({ state: 'published', first_published_at: NOW });
  });
});

describe('the last language (PD-10)', () => {
  it('is English until something is saved, and is whatever was last remembered', () => {
    expect(lastLanguage(t.db)).toBe('en');
    rememberLanguage(t.db, 'fa');
    expect(lastLanguage(t.db)).toBe('fa');
    rememberLanguage(t.db, 'en');
    expect(lastLanguage(t.db)).toBe('en');
    expect(t.db.prepare("SELECT count(*) AS n FROM setting WHERE key = 'last_language'").get()).toEqual({ n: 1 });
  });

  it('reads anything but "fa" as English, so a damaged value cannot start the editor in no language', () => {
    t.db.prepare("INSERT INTO setting (key, value) VALUES ('last_language', 'de')").run();
    expect(lastLanguage(t.db)).toBe('en');
  });
});

// Publishing, as one rule for entries and episodes (house rule 4, PD-11, AC-25).
// Both tables carry the same columns for it: `id`, `lang`, `state`,
// `first_published_at`, `publish_key`, `created_at` and `updated_at`. What an
// entry or an episode holds beyond those is the caller's, passed as `fields`.
//
// Nothing here checks first and then writes. A new composition's key is
// inserted with ON CONFLICT DO NOTHING and the row is read back by key, so a
// retry, a double tap and two requests in parallel all end on one row (AC-25).
import { now } from './clock.ts';
import type { Db } from './db.ts';
import type { Lang } from './i18n.ts';
import { newId } from './ids.ts';

export type Kind = 'entry' | 'episode';

// Table names are never taken from a request: a kind picks one from this list.
const TABLE: Record<Kind, string> = { entry: 'entry', episode: 'episode' };

/** The columns every publishable row has, and nothing else about it. */
export interface PublishRow {
  id: string;
  lang: Lang;
  state: 'draft' | 'published';
  first_published_at: number | null;
  publish_key: string | null;
  created_at: number;
  updated_at: number;
}

// Columns this file sets itself: a caller can't supply them through `fields`.
const OWN_COLUMNS = new Set(['id', 'state', 'first_published_at', 'publish_key', 'created_at', 'updated_at']);

export type Fields = Record<string, string | number | null>;

const select = (kind: Kind) => `SELECT * FROM ${TABLE[kind]}`;

/** One row by id, or null. */
export function getRow<R extends PublishRow>(db: Db, kind: Kind, id: string): R | null {
  return (db.prepare(`${select(kind)} WHERE id = ?`).get(id) as R | undefined) ?? null;
}

/**
 * Insert a new row under `publishKey`, or return the row that already holds
 * that key exactly as it is: an existing key changes nothing, whatever `fields`
 * or `publish` say now (once a draft is saved the client works by id).
 * `created` tells the caller whether this call made the row.
 *
 * With `publish`, the insert and the first publish are one transaction. The row
 * is inserted as a draft and then published, because an episode can't be born
 * published (its trigger needs a link first) and one path serves both.
 *
 * `afterInsert` is for what a row needs before it can be published: it runs
 * inside the same transaction, after the insert and before the publish, and
 * only when this call made the row. An episode inserts its links there, so new
 * text publishes in one request (S-3). Entries pass nothing.
 */
export function createOrGet<R extends PublishRow>(
  db: Db,
  kind: Kind,
  publishKey: string,
  fields: Fields,
  options: { publish: boolean; afterInsert?: (id: string) => void },
): { row: R; created: boolean } {
  const names = Object.keys(fields);
  for (const name of names) {
    if (OWN_COLUMNS.has(name) || !/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`Not a column a caller may set: ${name}`);
  }
  const table = TABLE[kind];
  return db.transaction(() => {
    const at = now();
    const id = newId();
    const columns = ['id', ...names, 'publish_key', 'created_at', 'updated_at'];
    const result = db
      .prepare(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})
         ON CONFLICT (publish_key) DO NOTHING`,
      )
      .run(id, ...names.map((name) => fields[name] as string | number | null), publishKey, at, at);
    const created = result.changes === 1;
    if (created) options.afterInsert?.(id);
    if (created && options.publish) publishAt(db, kind, id, at);
    const row = db.prepare(`${select(kind)} WHERE publish_key = ?`).get(publishKey) as R;
    return { row, created };
  })();
}

/** Draft to published at `at`. The first publish sets the date; a republish keeps it (AC-14). Returns whether anything changed. */
function publishAt(db: Db, kind: Kind, id: string, at: number): boolean {
  const result = db
    .prepare(
      `UPDATE ${TABLE[kind]} SET state = 'published', first_published_at = COALESCE(first_published_at, ?), updated_at = ?
       WHERE id = ? AND state = 'draft'`,
    )
    .run(at, at, id);
  return result.changes === 1;
}

/**
 * Publish a draft by id. Already published: nothing changes, and the row comes
 * back as it is (a double tap is not an error). A draft that was published
 * before returns at its original date, which `COALESCE` keeps: there is no
 * separate republish. Returns the row, whether it changed, or null for no such row.
 */
export function publish<R extends PublishRow>(db: Db, kind: Kind, id: string): { row: R; changed: boolean } | null {
  return db.transaction(() => {
    if (!getRow(db, kind, id)) return null;
    const changed = publishAt(db, kind, id, now());
    return { row: getRow<R>(db, kind, id) as R, changed };
  })();
}

/**
 * Take a published row off the site. It becomes a draft and keeps its first
 * publish date, which is what "was live" is (AC-14). A draft stays as it is.
 */
export function unpublish<R extends PublishRow>(db: Db, kind: Kind, id: string): { row: R; changed: boolean } | null {
  return db.transaction(() => {
    if (!getRow(db, kind, id)) return null;
    const result = db.prepare(`UPDATE ${TABLE[kind]} SET state = 'draft', updated_at = ? WHERE id = ? AND state = 'published'`).run(now(), id);
    return { row: getRow<R>(db, kind, id) as R, changed: result.changes === 1 };
  })();
}

const LAST_LANGUAGE = 'last_language';

/** The language the next new entry or episode starts in: the last one saved or published (PD-10, AC-42). */
export function lastLanguage(db: Db): Lang {
  const value = (db.prepare('SELECT value FROM setting WHERE key = ?').get(LAST_LANGUAGE) as { value: string } | undefined)?.value;
  return value === 'fa' ? 'fa' : 'en';
}

/** Remember it. Called inside the transaction of the save or publish it belongs to. */
export function rememberLanguage(db: Db, lang: Lang): void {
  db.prepare('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(LAST_LANGUAGE, lang);
}

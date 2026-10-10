// Entries: the public read side, and the one insert the seed CLI and the tests
// share (B3). Writing entries from the admin is B5's; this stage has no other
// write path.
import { validateDoc, type Doc } from '../shared/doc.ts';
import type { Db } from './db.ts';
import type { Lang } from './i18n.ts';
import { now } from './clock.ts';
import { limits } from './limits.ts';
import { newId } from './ids.ts';

export interface PublicEntry {
  id: string;
  lang: Lang;
  title: string | null;
  doc: Doc;
  firstPublishedAt: number;
  updatedAt: number;
}

interface Row {
  id: string;
  lang: Lang;
  title: string | null;
  body: string;
  first_published_at: number;
  updated_at: number;
}

const COLUMNS = 'id, lang, title, body, first_published_at, updated_at';

function toEntry(row: Row): PublicEntry {
  const parsed = validateDoc(JSON.parse(row.body));
  // Every writer validates, so this is a corrupt row. Name the id, never the text (house rule 9).
  if (!parsed.ok) throw new Error(`Entry ${row.id} holds a body that is not a valid document`);
  return {
    id: row.id,
    lang: row.lang,
    title: row.title,
    doc: parsed.doc,
    firstPublishedAt: row.first_published_at,
    updatedAt: row.updated_at,
  };
}

export interface NewPublished {
  lang: Lang;
  title?: string | null;
  body: Doc;
  /** Defaults to now(). Tests pass fixture dates relative to the fixed clock. */
  firstPublishedAt?: number;
  updatedAt?: number;
  /** Defaults to a random id. Tests pass one to make ties deterministic. */
  id?: string;
}

/**
 * Insert an entry already published. Used by `scripts/seed-entry.ts` and the
 * tests; the admin publishes through B5's idempotent path instead.
 */
export function insertPublished(db: Db, input: NewPublished): string {
  if (!validateDoc(input.body).ok) throw new Error('DOC_INVALID');
  const at = input.firstPublishedAt ?? now();
  const id = input.id ?? newId();
  db.prepare(
    `INSERT INTO entry (id, lang, title, body, state, first_published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'published', ?, ?, ?)`,
  ).run(id, input.lang, input.title?.trim() || null, JSON.stringify(input.body), at, at, input.updatedAt ?? at);
  return id;
}

export function clearEntries(db: Db): void {
  db.prepare('DELETE FROM entry').run();
}

export interface Page {
  entries: PublicEntry[];
  /** The cursor for "Older entries": the last entry shown, when there are more behind it. */
  olderBefore: string | null;
}

/** One published entry of this language, or null: a draft, an unknown id and the other language's id are all the same answer (AC-28). */
export function getPublished(db: Db, lang: Lang, id: string): PublicEntry | null {
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM entry WHERE id = ? AND lang = ? AND state = 'published'`)
    .get(id, lang) as Row | undefined;
  return row ? toEntry(row) : null;
}

/**
 * Published entries, newest first by first publish, then by id so two
 * entries in the same millisecond still page correctly (plan B3, traps). A
 * cursor is the id of the last entry on the previous page; `null` is the
 * first page. A page reads one row more than it shows, to know whether
 * "Older entries" has anywhere to go.
 */
export function listPublished(db: Db, lang: Lang, before: PublicEntry | null, limit: number = limits.pageSize): Page {
  const rows = (
    before
      ? db
          .prepare(
            `SELECT ${COLUMNS} FROM entry
             WHERE lang = ? AND state = 'published'
               AND (first_published_at < ? OR (first_published_at = ? AND id > ?))
             ORDER BY first_published_at DESC, id ASC LIMIT ?`,
          )
          .all(lang, before.firstPublishedAt, before.firstPublishedAt, before.id, limit + 1)
      : db
          .prepare(
            `SELECT ${COLUMNS} FROM entry WHERE lang = ? AND state = 'published'
             ORDER BY first_published_at DESC, id ASC LIMIT ?`,
          )
          .all(lang, limit + 1)
  ) as Row[];
  const shown = rows.slice(0, limit).map(toEntry);
  const last = shown[shown.length - 1];
  return { entries: shown, olderBefore: rows.length > limit && last ? last.id : null };
}

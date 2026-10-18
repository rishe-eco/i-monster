// Entries: the public read side and the one insert the seed CLI and the tests
// share (B3), and the admin's side: save, edit, list and publish (B5).
import {
  docHasText,
  docHasXmlForbidden,
  docText,
  isEmptyDoc,
  normalizeDoc,
  validateDoc,
  type Doc,
} from '../shared/doc.ts';
import type { Db } from './db.ts';
import type { Lang } from './i18n.ts';
import { now } from './clock.ts';
import { excerpt } from '../shared/excerpt.ts';
import { limits } from './limits.ts';
import { newId } from './ids.ts';
import { createOrGet, getRow, publish, rememberLanguage, unpublish, type PublishRow } from './publish.ts';

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
 * tests; the admin publishes through `lib/publish.ts` instead.
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

export interface NewFixture extends Omit<NewPublished, 'firstPublishedAt'> {
  state?: 'draft' | 'published';
  /** Null, or absent on a draft, is a never-published draft; a date on a draft is an entry that was live (AC-14). */
  firstPublishedAt?: number | null;
  /** When the row was started: it places a never-published draft in the admin's list. Defaults to the first publish, or now(). */
  createdAt?: number;
  publishKey?: string;
}

/** Insert an entry in any state, for the e2e routes and the tests: a draft, one that was live, or a published one. */
export function insertFixture(db: Db, input: NewFixture): string {
  if (!validateDoc(input.body).ok) throw new Error('DOC_INVALID');
  const state = input.state ?? 'published';
  const first = input.firstPublishedAt === undefined ? (state === 'published' ? now() : null) : input.firstPublishedAt;
  if (state === 'published' && first === null) throw new Error('A published entry needs its first-publish date');
  const created = input.createdAt ?? first ?? now();
  const id = input.id ?? newId();
  db.prepare(
    `INSERT INTO entry (id, lang, title, body, state, first_published_at, publish_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.lang, input.title?.trim() || null, JSON.stringify(input.body), state, first, input.publishKey ?? null, created, input.updatedAt ?? created);
  return id;
}

export function clearEntries(db: Db): void {
  db.prepare('DELETE FROM entry').run();
}

export interface Page {
  entries: PublicEntry[];
  /** The cursor for "Older entries": the last entry shown, when there are more behind it. */
  olderBefore: string | null;
  /**
   * Where "Newer entries" goes: `null` on the first page, `'first'` when the previous page is the first
   * (the bare path, no cursor), else the cursor of the previous page (PL-10).
   */
  newer: string | 'first' | null;
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
  return {
    entries: shown,
    olderBefore: rows.length > limit && last ? last.id : null,
    newer: before ? newerTarget(db, lang, before, limit) : null,
  };
}

/**
 * The previous page ends with the cursor entry itself. Read up to a page of entries newer than it, nearest
 * first: fewer than a page means the previous page is the first; otherwise its own cursor is the last one read.
 */
function newerTarget(db: Db, lang: Lang, before: PublicEntry, limit: number): string | 'first' {
  const ids = db
    .prepare(
      `SELECT id FROM entry
       WHERE lang = ? AND state = 'published'
         AND (first_published_at > ? OR (first_published_at = ? AND id < ?))
       ORDER BY first_published_at ASC, id DESC LIMIT ?`,
    )
    .all(lang, before.firstPublishedAt, before.firstPublishedAt, before.id, limit) as { id: string }[];
  const last = ids[limit - 1];
  return ids.length < limit || !last ? 'first' : last.id;
}

// ── The admin's side (B5) ──────────────────────────────────────────────────

/** An entry as the admin sees it, in any state. */
export interface AdminEntry {
  id: string;
  lang: Lang;
  title: string | null;
  body: Doc;
  state: 'draft' | 'published';
  /** A draft that has been published before: it keeps its first date, and returns to it (AC-14). */
  wasLive: boolean;
  firstPublishedAt: number | null;
}

/** One row of the admin's list. No count and no total travel with a page (house rule 1). */
export interface AdminRow {
  id: string;
  lang: Lang;
  title: string | null;
  excerpt: string;
  state: 'draft' | 'published';
  wasLive: boolean;
  firstPublishedAt: number | null;
}

export interface AdminPage {
  entries: AdminRow[];
  olderBefore: string | null;
}

interface FullRow extends PublishRow {
  title: string | null;
  body: string;
}

function parseBody(row: FullRow): Doc {
  const parsed = validateDoc(JSON.parse(row.body));
  // Every writer validates, so this is a corrupt row. Name the id, never the text (house rule 9).
  if (!parsed.ok) throw new Error(`Entry ${row.id} holds a body that is not a valid document`);
  return parsed.doc;
}

const wasLive = (row: FullRow) => row.state === 'draft' && row.first_published_at !== null;

function toAdminEntry(row: FullRow): AdminEntry {
  return {
    id: row.id,
    lang: row.lang,
    title: row.title,
    body: parseBody(row),
    state: row.state,
    wasLive: wasLive(row),
    firstPublishedAt: row.first_published_at,
  };
}

function toAdminRow(row: FullRow): AdminRow {
  return {
    id: row.id,
    lang: row.lang,
    title: row.title,
    excerpt: excerpt(docText(parseBody(row))),
    state: row.state,
    wasLive: wasLive(row),
    firstPublishedAt: row.first_published_at,
  };
}

export type BodyRefusal = 'DOC_INVALID' | 'BODY_REQUIRED';

/**
 * A body from a request, checked in the order the plan fixes: empty paragraphs
 * are dropped first (S-4); then the schema, the characters XML forbids (S-5)
 * and the size limit say DOC_INVALID; then a body with no text left says
 * BODY_REQUIRED (AC-18).
 */
export function readBody(raw: unknown): { doc: Doc } | { refusal: BodyRefusal } {
  const normalized = normalizeDoc(raw);
  if (isEmptyDoc(normalized)) return { refusal: 'BODY_REQUIRED' };
  const parsed = validateDoc(normalized);
  if (!parsed.ok || docHasXmlForbidden(parsed.doc)) return { refusal: 'DOC_INVALID' };
  if (Buffer.byteLength(JSON.stringify(parsed.doc)) > limits.bodyMaxBytes) return { refusal: 'DOC_INVALID' };
  if (!docHasText(parsed.doc)) return { refusal: 'BODY_REQUIRED' };
  return { doc: parsed.doc };
}

/** A title from a request: absent, null or blank is no title; anything but a one-line string is refused. */
export function readTitle(value: unknown): { title: string | null } | { refusal: 'REQUEST_INVALID' } {
  if (value === undefined || value === null) return { title: null };
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return { refusal: 'REQUEST_INVALID' };
  const title = value.trim();
  if (title.length > limits.titleMaxChars) return { refusal: 'REQUEST_INVALID' };
  return { title: title || null };
}

export function getEntry(db: Db, id: string): AdminEntry | null {
  const row = getRow<FullRow>(db, 'entry', id);
  return row ? toAdminEntry(row) : null;
}

export interface NewEntry {
  publishKey: string;
  lang: Lang;
  title: string | null;
  body: Doc;
  publish: boolean;
}

/**
 * Save a new entry, as a draft or published, under its publish key. A key that
 * already holds a row returns that row untouched (AC-25), and writes nothing,
 * the last language included. The language is remembered in the same
 * transaction as the row (PD-10).
 */
export function createEntry(db: Db, input: NewEntry): AdminEntry {
  return db.transaction(() => {
    const { row, created } = createOrGet<FullRow>(
      db,
      'entry',
      input.publishKey,
      { lang: input.lang, title: input.title, body: JSON.stringify(input.body) },
      { publish: input.publish },
    );
    if (created) rememberLanguage(db, input.lang);
    return toAdminEntry(row);
  })();
}

/**
 * Change an entry's title and body, and its language while it has never been published (PL-8). Nothing else:
 * not its state or any date but `updated_at` (AC-13). A published entry, and a draft that was live, keep their
 * language, since the page, the feed and the link have carried it: a different one is `LANG_FIXED`. With no
 * `lang` the language stays as it is. The language the save leaves is remembered as the last used (AC-42).
 * Returns null for no such entry.
 */
export function updateEntry(
  db: Db,
  id: string,
  input: { title: string | null; body: Doc; lang?: Lang },
): AdminEntry | { refusal: 'LANG_FIXED' } | null {
  return db.transaction(() => {
    const row = getRow<FullRow>(db, 'entry', id);
    if (!row) return null;
    const lang = input.lang ?? row.lang;
    if (lang !== row.lang && row.first_published_at !== null) return { refusal: 'LANG_FIXED' as const };
    db.prepare('UPDATE entry SET lang = ?, title = ?, body = ?, updated_at = ? WHERE id = ?').run(lang, input.title, JSON.stringify(input.body), now(), id);
    rememberLanguage(db, lang);
    return toAdminEntry(getRow<FullRow>(db, 'entry', id) as FullRow);
  })();
}

/** Publish by id: first publish, or a return to the original date. Null for no such entry. */
export function publishEntry(db: Db, id: string): AdminEntry | null {
  return db.transaction(() => {
    const result = publish<FullRow>(db, 'entry', id);
    if (!result) return null;
    if (result.changed) rememberLanguage(db, result.row.lang);
    return toAdminEntry(result.row);
  })();
}

/** Take an entry off the site. It stays in the admin as a draft with its original date. Null for no such entry. */
export function unpublishEntry(db: Db, id: string): AdminEntry | null {
  const result = unpublish<FullRow>(db, 'entry', id);
  return result ? toAdminEntry(result.row) : null;
}

/**
 * The admin's list: every entry, in both languages and every state, ordered by
 * the date shown on its row (the first publish, or for a never-published draft
 * the day it was started), then by id so a tie still pages (plan B3). `before`
 * is the id of the last row of the previous page; an unknown one gives null.
 */
export function listForAdmin(db: Db, before: string | null, limit: number = limits.pageSize): AdminPage | null {
  const sortAt = 'COALESCE(first_published_at, created_at)';
  let rows: FullRow[];
  if (before === null) {
    rows = db.prepare(`SELECT * FROM entry ORDER BY ${sortAt} DESC, id ASC LIMIT ?`).all(limit + 1) as FullRow[];
  } else {
    const cursor = getRow<FullRow>(db, 'entry', before);
    if (!cursor) return null;
    const at = cursor.first_published_at ?? cursor.created_at;
    rows = db
      .prepare(`SELECT * FROM entry WHERE ${sortAt} < ? OR (${sortAt} = ? AND id > ?) ORDER BY ${sortAt} DESC, id ASC LIMIT ?`)
      .all(at, at, cursor.id, limit + 1) as FullRow[];
  }
  const shown = rows.slice(0, limit);
  const last = shown[shown.length - 1];
  return { entries: shown.map(toAdminRow), olderBefore: rows.length > limit && last ? last.id : null };
}

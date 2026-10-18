// Episodes: the public read side (B7), and the admin's side: save, edit, list and publish. An episode
// is like an entry in id, language, state, dates and publish key, and `lib/publish.ts` does its
// publishing (house rule 4, PD-11), but its content is a name, a description, one or two tags, a date
// and a list of links (spec §4.4).
//
// The links travel whole. A save carries the full list, and `replaceLinks` makes the table match it in
// one transaction: the new rows go in before the old ones come out, so a published episode never has
// none (the `episode_last_link` trigger would refuse it). The triggers stay as the backstop, and their
// messages are mapped to the same codes the checks here give (house rule 6).
import { stripXmlForbidden } from '../shared/doc.ts';
import { isHttpsLink } from '../shared/link.ts';
import { now } from './clock.ts';
import { isCalendarDay, todayIn } from './dates.ts';
import type { Db } from './db.ts';
import type { Lang } from './i18n.ts';
import { newId } from './ids.ts';
import { limits } from './limits.ts';
import { createOrGet, getRow, publish, rememberLanguage, unpublish, type PublishRow } from './publish.ts';

export interface EpisodeLink {
  label: string;
  url: string;
}

/** An episode as a public page shows it: published, so its text is all there. */
export interface PublicEpisode {
  id: string;
  lang: Lang;
  name: string;
  description: string;
  /** One or two, in order. */
  tags: string[];
  /** A calendar day, `YYYY-MM-DD`: never an instant (plan B7, traps). */
  date: string;
  links: EpisodeLink[];
  firstPublishedAt: number;
}

/** An episode as the admin sees it, in any state. A draft may be missing anything but its language. */
export interface AdminEpisode {
  id: string;
  lang: Lang;
  name: string | null;
  description: string | null;
  tags: string[];
  date: string;
  links: EpisodeLink[];
  state: 'draft' | 'published';
  /** A draft that has been published before: it keeps its first date, and returns to it (AC-14). */
  wasLive: boolean;
  firstPublishedAt: number | null;
}

/** One row of the admin's list. No count and no total travels with a page (house rule 1). */
export interface AdminEpisodeRow {
  id: string;
  lang: Lang;
  name: string | null;
  date: string;
  state: 'draft' | 'published';
  wasLive: boolean;
  firstPublishedAt: number | null;
}

interface Row extends PublishRow {
  name: string | null;
  description: string | null;
  tag1: string | null;
  tag2: string | null;
  date: string;
}

const tagsOf = (row: Row): string[] => [row.tag1, row.tag2].filter((tag): tag is string => tag !== null);

function linksOf(db: Db, id: string): EpisodeLink[] {
  return db.prepare('SELECT label, url FROM episode_link WHERE episode_id = ? ORDER BY position').all(id) as EpisodeLink[];
}

const wasLive = (row: Row) => row.state === 'draft' && row.first_published_at !== null;

function toAdminEpisode(db: Db, row: Row): AdminEpisode {
  return {
    id: row.id,
    lang: row.lang,
    name: row.name,
    description: row.description,
    tags: tagsOf(row),
    date: row.date,
    links: linksOf(db, row.id),
    state: row.state,
    wasLive: wasLive(row),
    firstPublishedAt: row.first_published_at,
  };
}

function toPublicEpisode(db: Db, row: Row): PublicEpisode {
  return {
    id: row.id,
    lang: row.lang,
    // Every writer refuses to publish without these (PD-23); an empty string is what a corrupt row shows, not a crash.
    name: row.name ?? '',
    description: row.description ?? '',
    tags: tagsOf(row),
    date: row.date,
    links: linksOf(db, row.id),
    firstPublishedAt: row.first_published_at ?? 0,
  };
}

// ── Reading a request ──────────────────────────────────────────────────────

/** What a request says an episode holds, cleaned. A blank field is null; a blank tag or link row is gone. */
export interface EpisodeInput {
  name: string | null;
  description: string | null;
  tags: string[];
  /** Null when the request names no date: a new episode takes today's, an edit keeps its own. */
  date: string | null;
  links: EpisodeLink[];
}

export type InputRefusal = 'REQUEST_INVALID' | 'TAGS_ONE_OR_TWO' | 'LINK_NOT_HTTPS';
export type PublishRefusal = 'NAME_REQUIRED' | 'DESCRIPTION_REQUIRED' | 'TAGS_ONE_OR_TWO' | 'LINK_REQUIRED';
export type EpisodeRefusal = InputRefusal | PublishRefusal | 'LAST_LINK';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * One line of text: absent or null is blank; anything but a string is refused, and so is a control
 * character (a line break included). The characters XML forbids are dropped first, since a paste can
 * carry them and one in the feed or a page would be unreadable (S-5). Trimmed, then measured.
 */
function readLine(value: unknown, max: number): { text: string | null } | { refusal: 'REQUEST_INVALID' } {
  if (value === undefined || value === null) return { text: null };
  if (typeof value !== 'string') return { refusal: 'REQUEST_INVALID' };
  const text = stripXmlForbidden(value);
  if (/\p{Cc}/u.test(text)) return { refusal: 'REQUEST_INVALID' };
  const trimmed = text.trim();
  if (trimmed.length > max) return { refusal: 'REQUEST_INVALID' };
  return { text: trimmed === '' ? null : trimmed };
}

/** The description keeps its line breaks, as `\n`. */
function readText(value: unknown, max: number): { text: string | null } | { refusal: 'REQUEST_INVALID' } {
  if (value === undefined || value === null) return { text: null };
  if (typeof value !== 'string') return { refusal: 'REQUEST_INVALID' };
  const trimmed = stripXmlForbidden(value).replace(/\r\n?/g, '\n').trim();
  if (trimmed.length > max) return { refusal: 'REQUEST_INVALID' };
  return { text: trimmed === '' ? null : trimmed };
}

/**
 * The request's episode fields, checked for shape, in the field order of the form. Nothing here asks
 * for a name or a link: a draft needs only a language (PD-23), and `checkPublishable` asks for the rest
 * when it is time. A link that isn't https is refused on every save.
 */
export function readEpisodeInput(json: Record<string, unknown>): { input: EpisodeInput } | { refusal: InputRefusal } {
  const name = readLine(json.name, limits.episodeNameMaxChars);
  if ('refusal' in name) return name;
  const description = readText(json.description, limits.episodeDescriptionMaxChars);
  if ('refusal' in description) return description;

  const rawTags = json.tags ?? [];
  if (!Array.isArray(rawTags)) return { refusal: 'REQUEST_INVALID' };
  const tags: string[] = [];
  for (const raw of rawTags) {
    const tag = readLine(raw, limits.episodeTagMaxChars);
    if ('refusal' in tag) return tag;
    if (tag.text !== null) tags.push(tag.text);
  }
  // Two columns hold the tags: a third has nowhere to go, whatever state the episode is in.
  if (tags.length > 2) return { refusal: 'TAGS_ONE_OR_TWO' };

  let date: string | null = null;
  if (json.date !== undefined && json.date !== null && json.date !== '') {
    if (typeof json.date !== 'string' || !isCalendarDay(json.date)) return { refusal: 'REQUEST_INVALID' };
    date = json.date;
  }

  const rawLinks = json.links ?? [];
  if (!Array.isArray(rawLinks) || rawLinks.length > limits.episodeLinksMax) return { refusal: 'REQUEST_INVALID' };
  const links: EpisodeLink[] = [];
  for (const raw of rawLinks) {
    if (!isObject(raw)) return { refusal: 'REQUEST_INVALID' };
    const label = readLine(raw.label, limits.episodeLinkLabelMaxChars);
    if ('refusal' in label) return label;
    if (raw.url !== undefined && raw.url !== null && typeof raw.url !== 'string') return { refusal: 'REQUEST_INVALID' };
    const rawUrl = stripXmlForbidden(typeof raw.url === 'string' ? raw.url : '').trim();
    // A row with nothing in it is the form's empty "Another link": it is no link.
    if (label.text === null && rawUrl === '') continue;
    if (rawUrl.length > limits.episodeLinkUrlMaxChars) return { refusal: 'REQUEST_INVALID' };
    // A URL with no label is a link the page would print as nothing; the form never sends one.
    if (label.text === null) return { refusal: 'REQUEST_INVALID' };
    if (!isHttpsLink(rawUrl)) return { refusal: 'LINK_NOT_HTTPS' };
    links.push({ label: label.text, url: rawUrl });
  }
  return { input: { name: name.text, description: description.text, tags, date, links } };
}

/**
 * What an episode needs to be on the site (PD-23), asked in the plan's order: a name, a description,
 * one or two tags, and a link. Null when it has them all.
 */
export function checkPublishable(fields: { name: string | null; description: string | null; tags: string[]; linkCount: number }): PublishRefusal | null {
  if (fields.name === null) return 'NAME_REQUIRED';
  if (fields.description === null) return 'DESCRIPTION_REQUIRED';
  if (fields.tags.length < 1 || fields.tags.length > 2) return 'TAGS_ONE_OR_TWO';
  if (fields.linkCount < 1) return 'LINK_REQUIRED';
  return null;
}

/** The triggers' messages (`RAISE(ABORT, …)`) as the codes the checks above give, or null for any other error. */
function triggerRefusal(error: unknown): 'LAST_LINK' | 'LINK_REQUIRED' | null {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('LAST_LINK')) return 'LAST_LINK';
  if (message.includes('LINK_REQUIRED')) return 'LINK_REQUIRED';
  return null;
}

// ── Links ──────────────────────────────────────────────────────────────────

// A save writes the new list into the half of the position space the old one isn't using, then removes
// the old: the primary key is (episode, position), so the two lists can't share positions while both
// exist. 1,000 is far past `episodeLinksMax`, and the order of a list is only ever "by position".
const BAND = 1000;

/** Make the episode's links the list given: the new rows first, then the old ones out, so a published episode never has none. */
function replaceLinks(db: Db, id: string, links: EpisodeLink[]): void {
  const old = db.prepare('SELECT position, label, url FROM episode_link WHERE episode_id = ? ORDER BY position').all(id) as (EpisodeLink & { position: number })[];
  if (old.length === links.length && old.every((row, n) => row.label === links[n]?.label && row.url === links[n]?.url)) return;
  const low = old.length > 0 && (old[0]?.position ?? 0) < BAND ? BAND : 0;
  const insert = db.prepare('INSERT INTO episode_link (episode_id, position, label, url) VALUES (?, ?, ?, ?)');
  links.forEach((link, n) => insert.run(id, low + n, link.label, link.url));
  const remove = db.prepare('DELETE FROM episode_link WHERE episode_id = ? AND position = ?');
  for (const row of old) remove.run(id, row.position);
}

// ── The public read side ───────────────────────────────────────────────────

const PUBLISHED = "state = 'published'";

/** One published episode of this language, or null: a draft, an unknown id and the other language's are the same answer. */
export function getPublishedEpisode(db: Db, lang: Lang, id: string): PublicEpisode | null {
  const row = db.prepare(`SELECT * FROM episode WHERE id = ? AND lang = ? AND ${PUBLISHED}`).get(id, lang) as Row | undefined;
  return row ? toPublicEpisode(db, row) : null;
}

export interface EpisodePage {
  episodes: PublicEpisode[];
  /** The cursor for "Older episodes": the last one shown, when there are more behind it. */
  olderBefore: string | null;
  /** Where "Newer episodes" goes: `null` on the first page, `'first'` for the bare path, else a cursor (PL-10). */
  newer: string | 'first' | null;
}

/**
 * Published episodes, newest date first, then by id so two on one day still page (plan B7, traps: the
 * order is the date shown, not the first publish). A cursor is the last episode of the previous page.
 */
export function listPublishedEpisodes(db: Db, lang: Lang, before: PublicEpisode | null, limit: number = limits.pageSize): EpisodePage {
  const rows = (
    before
      ? db
          .prepare(
            `SELECT * FROM episode WHERE lang = ? AND ${PUBLISHED} AND (date < ? OR (date = ? AND id > ?))
             ORDER BY date DESC, id ASC LIMIT ?`,
          )
          .all(lang, before.date, before.date, before.id, limit + 1)
      : db.prepare(`SELECT * FROM episode WHERE lang = ? AND ${PUBLISHED} ORDER BY date DESC, id ASC LIMIT ?`).all(lang, limit + 1)
  ) as Row[];
  const shown = rows.slice(0, limit).map((row) => toPublicEpisode(db, row));
  const last = shown[shown.length - 1];
  return {
    episodes: shown,
    olderBefore: rows.length > limit && last ? last.id : null,
    newer: before ? newerTarget(db, lang, before, limit) : null,
  };
}

/**
 * The previous page ends with the cursor episode itself. Read up to a page of episodes newer than it, nearest
 * first: fewer than a page means the previous page is the first; otherwise its own cursor is the last one read.
 */
function newerTarget(db: Db, lang: Lang, before: PublicEpisode, limit: number): string | 'first' {
  const ids = db
    .prepare(
      `SELECT id FROM episode WHERE lang = ? AND ${PUBLISHED} AND (date > ? OR (date = ? AND id < ?))
       ORDER BY date ASC, id DESC LIMIT ?`,
    )
    .all(lang, before.date, before.date, before.id, limit) as { id: string }[];
  const last = ids[limit - 1];
  return ids.length < limit || !last ? 'first' : last.id;
}

// ── The admin's side ───────────────────────────────────────────────────────

export function getEpisode(db: Db, id: string): AdminEpisode | null {
  const row = getRow<Row>(db, 'episode', id);
  return row ? toAdminEpisode(db, row) : null;
}

export interface NewEpisode {
  publishKey: string;
  lang: Lang;
  input: EpisodeInput;
  publish: boolean;
  /** The day a request with no date gets: today in `SITE_TZ`, which only the caller knows. */
  today: string;
}

/**
 * Save a new episode, as a draft or published, under its publish key (AC-25). A key that already holds a
 * row returns that row untouched and writes nothing, the last language included. The links go in inside
 * the transaction of the insert, before the publish, so new text publishes in one request (S-3), and a
 * refusal rolls the whole of it back.
 */
export function createEpisode(db: Db, input: NewEpisode): AdminEpisode | { refusal: EpisodeRefusal } {
  const fields = input.input;
  if (input.publish) {
    const refusal = checkPublishable({ ...fields, linkCount: fields.links.length });
    if (refusal) return { refusal };
  }
  try {
    return db.transaction(() => {
      const { row, created } = createOrGet<Row>(
        db,
        'episode',
        input.publishKey,
        {
          lang: input.lang,
          name: fields.name,
          description: fields.description,
          tag1: fields.tags[0] ?? null,
          tag2: fields.tags[1] ?? null,
          date: fields.date ?? input.today,
        },
        { publish: input.publish, afterInsert: (id) => replaceLinks(db, id, fields.links) },
      );
      if (created) rememberLanguage(db, input.lang);
      return toAdminEpisode(db, row);
    })();
  } catch (error) {
    const refusal = triggerRefusal(error);
    if (refusal) return { refusal };
    throw error;
  }
}

/**
 * Change an episode's text, tags, date and links, and nothing else: not its state, its language or any
 * date but `updated_at` (AC-13's twin). The links in the request are the whole list. A published episode
 * must still hold what publishing asked for, and an empty list there is `LAST_LINK`, not `LINK_REQUIRED`:
 * the episode has a link now, and the save would take it away (AC-17). Null for no such episode.
 */
export function updateEpisode(db: Db, id: string, input: EpisodeInput): AdminEpisode | { refusal: EpisodeRefusal } | null {
  try {
    return db.transaction(() => {
      const row = getRow<Row>(db, 'episode', id);
      if (!row) return null;
      if (row.state === 'published') {
        const refusal = checkPublishable({ ...input, linkCount: input.links.length });
        if (refusal) return { refusal: refusal === 'LINK_REQUIRED' ? ('LAST_LINK' as const) : refusal };
      }
      db.prepare('UPDATE episode SET name = ?, description = ?, tag1 = ?, tag2 = ?, date = ?, updated_at = ? WHERE id = ?').run(
        input.name,
        input.description,
        input.tags[0] ?? null,
        input.tags[1] ?? null,
        input.date ?? row.date,
        now(),
        id,
      );
      replaceLinks(db, id, input.links);
      rememberLanguage(db, row.lang);
      return toAdminEpisode(db, getRow<Row>(db, 'episode', id) as Row);
    })();
  } catch (error) {
    const refusal = triggerRefusal(error);
    if (refusal) return { refusal };
    throw error;
  }
}

/** Publish by id: first publish, or a return to the original date. A published one is returned as it is. Null for no such episode. */
export function publishEpisode(db: Db, id: string): AdminEpisode | { refusal: EpisodeRefusal } | null {
  try {
    return db.transaction(() => {
      const row = getRow<Row>(db, 'episode', id);
      if (!row) return null;
      if (row.state === 'draft') {
        const refusal = checkPublishable({ name: row.name, description: row.description, tags: tagsOf(row), linkCount: linksOf(db, id).length });
        if (refusal) return { refusal };
      }
      const result = publish<Row>(db, 'episode', id);
      if (!result) return null;
      if (result.changed) rememberLanguage(db, result.row.lang);
      return toAdminEpisode(db, result.row);
    })();
  } catch (error) {
    const refusal = triggerRefusal(error);
    if (refusal) return { refusal };
    throw error;
  }
}

/** Take an episode off the site. It stays in the admin as a draft with its original date. Null for no such episode. */
export function unpublishEpisode(db: Db, id: string): AdminEpisode | null {
  const result = unpublish<Row>(db, 'episode', id);
  return result ? toAdminEpisode(db, result.row) : null;
}

function toAdminRow(row: Row): AdminEpisodeRow {
  return { id: row.id, lang: row.lang, name: row.name, date: row.date, state: row.state, wasLive: wasLive(row), firstPublishedAt: row.first_published_at };
}

export interface AdminEpisodePage {
  episodes: AdminEpisodeRow[];
  olderBefore: string | null;
}

/**
 * The admin's list: every episode, in both languages and every state, in the order the public page
 * uses (date, then id). `before` is the id of the last row of the previous page; an unknown one gives null.
 */
export function listEpisodesForAdmin(db: Db, before: string | null, limit: number = limits.pageSize): AdminEpisodePage | null {
  let rows: Row[];
  if (before === null) {
    rows = db.prepare('SELECT * FROM episode ORDER BY date DESC, id ASC LIMIT ?').all(limit + 1) as Row[];
  } else {
    const cursor = getRow<Row>(db, 'episode', before);
    if (!cursor) return null;
    rows = db
      .prepare('SELECT * FROM episode WHERE date < ? OR (date = ? AND id > ?) ORDER BY date DESC, id ASC LIMIT ?')
      .all(cursor.date, cursor.date, cursor.id, limit + 1) as Row[];
  }
  const shown = rows.slice(0, limit);
  const last = shown[shown.length - 1];
  return { episodes: shown.map(toAdminRow), olderBefore: rows.length > limit && last ? last.id : null };
}

// ── Fixtures, for the e2e routes and the tests ─────────────────────────────

export interface NewFixture {
  lang: Lang;
  name?: string | null;
  description?: string | null;
  tags?: string[];
  /** Defaults to today in `SITE_TZ`. */
  date?: string;
  links?: EpisodeLink[];
  state?: 'draft' | 'published';
  /** Absent on a published episode, it is now(); a date on a draft is an episode that was live (AC-14). */
  firstPublishedAt?: number | null;
  createdAt?: number;
  id?: string;
  publishKey?: string;
}

/**
 * Insert an episode in any state. The table refuses one born published (it needs a link first), so a
 * published fixture goes in as a draft, takes its links, and is published after: the order the app uses.
 */
export function insertEpisodeFixture(db: Db, input: NewFixture, siteTz?: string): string {
  const state = input.state ?? 'published';
  const first = input.firstPublishedAt === undefined ? (state === 'published' ? now() : null) : input.firstPublishedAt;
  if (state === 'published' && (first === null || !input.links?.length)) throw new Error('A published episode needs its first-publish date and a link');
  if (input.date !== undefined && !isCalendarDay(input.date)) throw new Error('An episode date is YYYY-MM-DD');
  const created = input.createdAt ?? first ?? now();
  const id = input.id ?? newId();
  const tags = input.tags ?? [];
  db.prepare(
    `INSERT INTO episode (id, lang, name, description, tag1, tag2, date, state, first_published_at, publish_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
  ).run(id, input.lang, input.name ?? null, input.description ?? null, tags[0] ?? null, tags[1] ?? null, input.date ?? (siteTz ? todayIn(now(), siteTz) : todayIn(now())), first, input.publishKey ?? null, created, created);
  replaceLinks(db, id, input.links ?? []);
  if (state === 'published') db.prepare("UPDATE episode SET state = 'published' WHERE id = ?").run(id);
  return id;
}

export function clearEpisodes(db: Db): void {
  db.prepare('DELETE FROM episode').run();
}

// The three local buffers that keep text from being lost (plan B6, PD-12, AC-16, AC-43).
//
// Pure: the storage is handed in, so a test gives it a Map and the page gives it the browser's.
// There are three buffers, keyed by kind (`entry` and, from B7, `episode`):
//   unsent  the new text being written: its publish key, the row it was saved as (if it was), language, and the text;
//   edit    the changes to an existing entry or episode: its id and the text;
//   kept    unsent text set aside while something else is edited (AC-43), or found when the page opened.
// A buffer is written on every change and cleared only when the server has confirmed what it was waiting for,
// or when the person chose Discard. Nothing here counts, times or describes the text (W7): it is only stored.
//
// One reducer serves every kind. What differs between kinds is only what the text is, so each kind brings
// its own reader (to check what storage gives back) and its own "has content" check (is there anything to keep?).
import type { Lang } from '../lib/i18n.ts';
import { validateDoc, type Doc } from '../shared/doc.ts';

export type Kind = 'entry' | 'episode';

/** The part of the browser's local storage the buffers use. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** What every kind's new text carries, whatever the text is. */
export interface UnsentBase {
  /** The publish key, made at the first keystroke: every retry of this composition sends it (PD-11, AC-25). */
  key: string;
  /** The row the server made of it, once Save draft or a publish answered with one: from then on the text is worked on by id. */
  id: string | null;
  lang: Lang;
}

/** What every kind's edit carries. */
export interface EditBase {
  id: string;
}

/** New entry text, from its first keystroke until the server confirms it. */
export interface Unsent extends UnsentBase {
  title: string;
  doc: Doc;
}

/** Changes to an entry that already exists. */
export interface EditBuffer extends EditBase {
  title: string;
  doc: Doc;
  /**
   * The language the edit had chosen (PL-8). A buffer stored before PL1 has none, and is read as "unchanged": the row's
   * own language, never English. Only a never-published entry may change it; for any other the row's language wins.
   */
  lang?: Lang;
}

/** What a person has typed into the episode form, as the form holds it: every field a string, tags and links in rows. */
export interface EpisodeText {
  name: string;
  description: string;
  /** The first and second tag. */
  tags: [string, string];
  /**
   * The day, `YYYY-MM-DD`, or '' while the person hasn't chosen one: the field then shows the server's today and a
   * save sends no date, so a text kept overnight is never pinned to yesterday.
   */
  date: string;
  /** At least one row, blank or not: the form always shows a link to fill. */
  links: { label: string; url: string }[];
}

export interface UnsentEpisode extends UnsentBase, EpisodeText {}

export interface EpisodeEdit extends EditBase, EpisodeText {
  /** As `EditBuffer.lang`: absent in a buffer stored before PL1, which is read as the row's own language. */
  lang?: Lang;
}

export interface Snapshot<U extends UnsentBase = Unsent, E extends EditBase = EditBuffer> {
  unsent: U | null;
  edit: E | null;
  /** A stack: set aside while editing, and set aside again if the person edits twice before choosing. The last is offered first. */
  kept: U[];
}

// Nothing in it depends on the kind, so one empty snapshot serves them all.
export const EMPTY: Snapshot = { unsent: null, edit: null, kept: [] };

/**
 * Where a composition is. It follows from what is stored, so it can't disagree with it:
 * `editing` while an edit buffer holds changes, `kept` while text is set aside, `new` otherwise.
 * `confirmed` and `discarded` are not places to stay: they are the events that empty a buffer.
 */
export type Phase = 'new' | 'editing' | 'kept';

export const phaseOf = <U extends UnsentBase, E extends EditBase>(snapshot: Snapshot<U, E>): Phase =>
  snapshot.edit ? 'editing' : snapshot.kept.length > 0 ? 'kept' : 'new';

export type Event<U extends UnsentBase = Unsent, E extends EditBase = EditBuffer> =
  /** The new text changed. `null` is a composition with nothing in it. */
  | { type: 'typed'; unsent: U | null }
  /** The page opened with unsent text in the buffer: it is set aside, so typing in the empty editor can't write over it. */
  | { type: 'opened' }
  /** An existing item was opened to edit: the unsent text, if it has any, is set aside. The edit buffer waits for the first change. */
  | { type: 'edit-started' }
  /** The edit changed (it is stored only while it differs from the item as the server has it). */
  | { type: 'edit-typed'; edit: E }
  /** The server confirmed the edit (saved or published). */
  | { type: 'edit-confirmed' }
  /** The person left the edit. */
  | { type: 'edit-cancelled' }
  /** The server confirmed the new text (published). */
  | { type: 'confirmed' }
  /** Put set-aside text back: if the editor already holds text, the two swap, so neither is lost. */
  | { type: 'restored' }
  /** The person chose Discard, and then chose it again. */
  | { type: 'discarded'; which: 'unsent' | 'kept' | 'edit' };

const entryHasContent = (unsent: Unsent): boolean => unsent.title.trim() !== '' || unsent.doc.content.length > 0;

/** An episode has content when any field the person fills has text: the date alone is not content, and a link row counts when either half is filled. */
export const episodeHasContent = (text: EpisodeText): boolean =>
  text.name.trim() !== '' ||
  text.description.trim() !== '' ||
  text.tags.some((tag) => tag.trim() !== '') ||
  text.links.some((link) => link.label.trim() !== '' || link.url.trim() !== '');

/**
 * The next snapshot. Never mutates the one it is given. `hasContent` says whether a composition holds
 * anything worth keeping, which is the one thing that differs between kinds; entries are the default.
 */
export function reduce(snapshot: Snapshot, event: Event): Snapshot;
export function reduce<U extends UnsentBase, E extends EditBase>(snapshot: Snapshot<U, E>, event: Event<U, E>, hasContent: (unsent: U) => boolean): Snapshot<U, E>;
export function reduce<U extends UnsentBase, E extends EditBase>(
  snapshot: Snapshot<U, E>,
  event: Event<U, E>,
  hasContent: (unsent: U) => boolean = entryHasContent as unknown as (unsent: U) => boolean, // the overloads above make this the entry's own type
): Snapshot<U, E> {
  const { unsent, kept } = snapshot;
  switch (event.type) {
    case 'typed':
      // A composition with nothing in it, and no row on the server, is no composition: its key goes with it.
      return { ...snapshot, unsent: event.unsent && (hasContent(event.unsent) || event.unsent.id !== null) ? event.unsent : null };
    case 'opened':
      return unsent && hasContent(unsent) ? { ...snapshot, unsent: null, kept: [...kept, unsent] } : { ...snapshot, unsent: null };
    case 'edit-started':
      return { ...snapshot, unsent: null, kept: unsent && hasContent(unsent) ? [...kept, unsent] : kept };
    case 'edit-typed':
      return { ...snapshot, edit: event.edit };
    case 'edit-confirmed':
    case 'edit-cancelled':
      // The edit is over. What was set aside comes back into the editor (AC-43), unless it already holds something.
      return unsent || kept.length === 0 ? { ...snapshot, edit: null } : { unsent: kept[kept.length - 1] ?? null, edit: null, kept: kept.slice(0, -1) };
    case 'confirmed':
      return { ...snapshot, unsent: null };
    case 'restored': {
      const top = kept[kept.length - 1];
      if (!top) return snapshot;
      const rest = kept.slice(0, -1);
      return { ...snapshot, unsent: top, kept: unsent && hasContent(unsent) ? [...rest, unsent] : rest };
    }
    case 'discarded':
      if (event.which === 'unsent') return { ...snapshot, unsent: null };
      if (event.which === 'edit') return { ...snapshot, edit: null };
      return { ...snapshot, kept: kept.slice(0, -1) };
  }
}

// ── Reading storage back ──

const isLang = (value: unknown): value is Lang => value === 'en' || value === 'fa';
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';

/** A stored body: valid, or the empty one. Anything else means the buffer is damaged. */
function readDoc(value: unknown): Doc | null {
  if (isObject(value) && value.type === 'doc' && Array.isArray(value.content) && value.content.length === 0) return { type: 'doc', content: [] };
  const checked = validateDoc(value);
  return checked.ok ? checked.doc : null;
}

/** The part every kind's unsent text shares, or null when it is damaged. */
function readBase(value: Record<string, unknown>): UnsentBase | null {
  if (!isString(value.key) || !isLang(value.lang)) return null;
  if (value.id !== null && !isString(value.id)) return null;
  return { key: value.key, id: value.id, lang: value.lang };
}

function readUnsent(value: unknown): Unsent | null {
  if (!isObject(value)) return null;
  const base = readBase(value);
  const doc = readDoc(value.doc);
  if (!base || !isString(value.title) || !doc) return null;
  return { ...base, title: value.title, doc };
}

function readEdit(value: unknown): EditBuffer | null {
  if (!isObject(value)) return null;
  const doc = readDoc(value.doc);
  if (!isString(value.id) || !isString(value.title) || !doc) return null;
  return { id: value.id, title: value.title, doc, ...(isLang(value.lang) ? { lang: value.lang } : {}) };
}

function readEpisodeText(value: Record<string, unknown>): EpisodeText | null {
  const { name, description, date, tags, links } = value;
  if (!isString(name) || !isString(description) || !isString(date)) return null;
  if (!Array.isArray(tags) || tags.length !== 2 || !isString(tags[0]) || !isString(tags[1])) return null;
  if (!Array.isArray(links) || links.length === 0) return null;
  const rows: { label: string; url: string }[] = [];
  for (const link of links) {
    if (!isObject(link) || !isString(link.label) || !isString(link.url)) return null;
    rows.push({ label: link.label, url: link.url });
  }
  return { name, description, date, tags: [tags[0], tags[1]], links: rows };
}

function readUnsentEpisode(value: unknown): UnsentEpisode | null {
  if (!isObject(value)) return null;
  const base = readBase(value);
  const text = readEpisodeText(value);
  return base && text ? { ...base, ...text } : null;
}

function readEpisodeEdit(value: unknown): EpisodeEdit | null {
  if (!isObject(value) || !isString(value.id)) return null;
  const text = readEpisodeText(value);
  return text ? { id: value.id, ...text, ...(isLang(value.lang) ? { lang: value.lang } : {}) } : null;
}

function parse(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export interface Buffers<U extends UnsentBase = Unsent, E extends EditBase = EditBuffer> {
  /** What is stored now. */
  read(): Snapshot<U, E>;
  /** Apply an event and store the result. Returns the new snapshot, and whether every write landed. */
  apply(event: Event<U, E>): { snapshot: Snapshot<U, E>; stored: boolean };
}

/** What a kind brings: how to read its two shapes back from storage, and when its new text is worth keeping. */
interface Shape<U extends UnsentBase, E extends EditBase> {
  readUnsent(value: unknown): U | null;
  readEdit(value: unknown): E | null;
  hasContent(unsent: U): boolean;
}

function buffersOf<U extends UnsentBase, E extends EditBase>(storage: StorageLike, kind: Kind, shape: Shape<U, E>): Buffers<U, E> {
  const keys = { unsent: `imnstr:${kind}:unsent`, edit: `imnstr:${kind}:edit`, kept: `imnstr:${kind}:kept` };

  const read = (): Snapshot<U, E> => {
    const kept = parse(safeGet(storage, keys.kept));
    return {
      unsent: shape.readUnsent(parse(safeGet(storage, keys.unsent))),
      edit: shape.readEdit(parse(safeGet(storage, keys.edit))),
      kept: Array.isArray(kept) ? kept.map(shape.readUnsent).filter((item): item is U => item !== null) : [],
    };
  };

  const put = (key: string, value: unknown): boolean => {
    try {
      if (value === null || (Array.isArray(value) && value.length === 0)) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  };

  return {
    read,
    apply(event) {
      const snapshot = reduce(read(), event, shape.hasContent);
      // Written in this order so a failure part-way leaves the text in at least one buffer: what is set aside
      // is stored before the buffer it came from is emptied.
      const stored = [put(keys.kept, snapshot.kept), put(keys.unsent, snapshot.unsent), put(keys.edit, snapshot.edit)].every(Boolean);
      return { snapshot, stored };
    },
  };
}

/** The buffers of one kind, in `storage`. */
export function createBuffers(storage: StorageLike, kind: 'entry'): Buffers;
export function createBuffers(storage: StorageLike, kind: 'episode'): Buffers<UnsentEpisode, EpisodeEdit>;
export function createBuffers(storage: StorageLike, kind: Kind): Buffers | Buffers<UnsentEpisode, EpisodeEdit> {
  return kind === 'entry'
    ? buffersOf<Unsent, EditBuffer>(storage, kind, { readUnsent, readEdit, hasContent: entryHasContent })
    : buffersOf<UnsentEpisode, EpisodeEdit>(storage, kind, { readUnsent: readUnsentEpisode, readEdit: readEpisodeEdit, hasContent: episodeHasContent });
}

function safeGet(storage: StorageLike, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

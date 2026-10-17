// The three local buffers that keep text from being lost (plan B6, PD-12, AC-16, AC-43).
//
// Pure: the storage is handed in, so a test gives it a Map and the page gives it the browser's.
// There are three buffers, keyed by kind (`entry` now; B7 adds `episode`):
//   unsent  the new text being written: its publish key, the row it was saved as (if it was), language, title, body;
//   edit    the changes to an existing entry: its id, title, body;
//   kept    unsent text set aside while something else is edited (AC-43), or found when the page opened.
// A buffer is written on every change and cleared only when the server has confirmed what it was waiting for,
// or when the person chose Discard. Nothing here counts, times or describes the text (W7): it is only stored.
import type { Lang } from '../lib/i18n.ts';
import { validateDoc, type Doc } from '../shared/doc.ts';

export type Kind = 'entry' | 'episode';

/** The part of the browser's local storage the buffers use. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** New text, from its first keystroke until the server confirms it. */
export interface Unsent {
  /** The publish key, made at the first keystroke: every retry of this composition sends it (PD-11, AC-25). */
  key: string;
  /** The row the server made of it, once Save draft or a publish answered with one: from then on the text is worked on by id. */
  id: string | null;
  lang: Lang;
  title: string;
  doc: Doc;
}

/** Changes to an entry that already exists. */
export interface EditBuffer {
  id: string;
  title: string;
  doc: Doc;
}

export interface Snapshot {
  unsent: Unsent | null;
  edit: EditBuffer | null;
  /** A stack: set aside while editing, and set aside again if the person edits twice before choosing. The last is offered first. */
  kept: Unsent[];
}

export const EMPTY: Snapshot = { unsent: null, edit: null, kept: [] };

/**
 * Where a composition is. It follows from what is stored, so it can't disagree with it:
 * `editing` while an edit buffer holds changes, `kept` while text is set aside, `new` otherwise.
 * `confirmed` and `discarded` are not places to stay: they are the events that empty a buffer.
 */
export type Phase = 'new' | 'editing' | 'kept';

export const phaseOf = (snapshot: Snapshot): Phase => (snapshot.edit ? 'editing' : snapshot.kept.length > 0 ? 'kept' : 'new');

export type Event =
  /** The new text changed. `null` is a composition with nothing in it. */
  | { type: 'typed'; unsent: Unsent | null }
  /** The page opened with unsent text in the buffer: it is set aside, so typing in the empty editor can't write over it. */
  | { type: 'opened' }
  /** An existing entry was opened to edit: the unsent text, if it has any, is set aside. The edit buffer waits for the first change. */
  | { type: 'edit-started' }
  /** The edit changed (it is stored only while it differs from the entry as the server has it). */
  | { type: 'edit-typed'; edit: EditBuffer }
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

const hasContent = (unsent: Unsent): boolean => unsent.title.trim() !== '' || unsent.doc.content.length > 0;

/** The next snapshot. Never mutates the one it is given. */
export function reduce(snapshot: Snapshot, event: Event): Snapshot {
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

// ── Storage ──

const isLang = (value: unknown): value is Lang => value === 'en' || value === 'fa';
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A stored body: valid, or the empty one. Anything else means the buffer is damaged. */
function readDoc(value: unknown): Doc | null {
  if (isObject(value) && value.type === 'doc' && Array.isArray(value.content) && value.content.length === 0) return { type: 'doc', content: [] };
  const checked = validateDoc(value);
  return checked.ok ? checked.doc : null;
}

function readUnsent(value: unknown): Unsent | null {
  if (!isObject(value)) return null;
  const doc = readDoc(value.doc);
  if (typeof value.key !== 'string' || !isLang(value.lang) || typeof value.title !== 'string' || !doc) return null;
  if (value.id !== null && typeof value.id !== 'string') return null;
  return { key: value.key, id: value.id, lang: value.lang, title: value.title, doc };
}

function readEdit(value: unknown): EditBuffer | null {
  if (!isObject(value)) return null;
  const doc = readDoc(value.doc);
  if (typeof value.id !== 'string' || typeof value.title !== 'string' || !doc) return null;
  return { id: value.id, title: value.title, doc };
}

function parse(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export interface Buffers {
  /** What is stored now. */
  read(): Snapshot;
  /** Apply an event and store the result. Returns the new snapshot, and whether every write landed. */
  apply(event: Event): { snapshot: Snapshot; stored: boolean };
}

/** The buffers of one kind, in `storage`. */
export function createBuffers(storage: StorageLike, kind: Kind): Buffers {
  const keys = { unsent: `imnstr:${kind}:unsent`, edit: `imnstr:${kind}:edit`, kept: `imnstr:${kind}:kept` };

  const read = (): Snapshot => {
    const kept = parse(safeGet(storage, keys.kept));
    return {
      unsent: readUnsent(parse(safeGet(storage, keys.unsent))),
      edit: readEdit(parse(safeGet(storage, keys.edit))),
      kept: Array.isArray(kept) ? kept.map(readUnsent).filter((item): item is Unsent => item !== null) : [],
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
      const snapshot = reduce(read(), event);
      // Written in this order so a failure part-way leaves the text in at least one buffer: what is set aside
      // is stored before the buffer it came from is emptied.
      const stored = [put(keys.kept, snapshot.kept), put(keys.unsent, snapshot.unsent), put(keys.edit, snapshot.edit)].every(Boolean);
      return { snapshot, stored };
    },
  };
}

function safeGet(storage: StorageLike, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

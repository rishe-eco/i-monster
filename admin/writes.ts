// The editor's requests (plan B6, PD-11), as the order they are made in. Each returns the entry the
// server answered with, or the code it refused with. None of them touches the screen or a buffer:
// what the page does with the answer is the caller's.
//
// New text is sent with its publish key, once. When the server answers with a row, the text is worked
// on by that row's id from then on: Save is a PUT, and publishing a draft is a PUT and then a publish.
// A key the server already knew answers with the row as it first was and writes nothing (AC-25), so
// a retry of text that has changed since is followed by a PUT, and the row is published if it isn't yet.
import type { Lang } from '../lib/i18n.ts';
import { docHasText, type Doc } from '../shared/doc.ts';
import { api, type EntryDetail, type Result } from './api.ts';

export type Write = Result<{ entry: EntryDetail }>;

// The editor's writes keep the editor on screen when the session has ended (W6).
const IN_PLACE = { keepOnSignedOut: true } as const;

/** What the person has written. */
export interface Text {
  title: string;
  doc: Doc;
}

/** A blank title is no title, as the server reads it (`readTitle`). */
const titleOf = (title: string): string | null => title.trim() || null;

const holds = (entry: EntryDetail, text: Text): boolean =>
  entry.title === titleOf(text.title) && JSON.stringify(entry.body) === JSON.stringify(text.doc);

const entryPath = (id: string) => `entries/${encodeURIComponent(id)}`;

const BODY_REQUIRED: Write = { ok: false, code: 'BODY_REQUIRED' };

async function publishRow(entry: EntryDetail): Promise<Write> {
  if (entry.state === 'published') return { ok: true, data: { entry } };
  return api<{ entry: EntryDetail }>('POST', `${entryPath(entry.id)}/publish`, {}, IN_PLACE);
}

/** `lang` goes with the PUT only for an entry that has never been published: the server refuses a change for any other (PL-8). */
async function putText(id: string, text: Text, lang?: Lang): Promise<Write> {
  return api<{ entry: EntryDetail }>('PUT', entryPath(id), { title: titleOf(text.title), body: text.doc, ...(lang ? { lang } : {}) }, IN_PLACE);
}

/** New text: saved as a draft, or published. `onRow` hears the row's id the moment the server has made it. */
export async function writeNew(
  composition: Text & { key: string; id: string | null; lang: Lang },
  publish: boolean,
  onRow: (id: string) => void,
): Promise<Write> {
  // The server would say so too; this spares the round trip.
  if (!docHasText(composition.doc)) return BODY_REQUIRED;
  let entry: EntryDetail;
  if (composition.id === null) {
    const made = await api<{ entry: EntryDetail }>(
      'POST',
      'entries',
      { publishKey: composition.key, lang: composition.lang, title: titleOf(composition.title), body: composition.doc, publish },
      IN_PLACE,
    );
    if (!made.ok) return made;
    entry = made.data.entry;
    onRow(entry.id);
    if (!holds(entry, composition)) {
      const updated = await putText(entry.id, composition, composition.lang);
      if (!updated.ok) return updated;
      entry = updated.data.entry;
    }
  } else {
    // The row exists and has never been published, so its language may have changed since it was made (PL-8).
    const updated = await putText(composition.id, composition, composition.lang);
    if (!updated.ok) return updated;
    entry = updated.data.entry;
  }
  return publish ? publishRow(entry) : { ok: true, data: { entry } };
}

/** An entry that exists: its title and body saved, and, for a draft, published after. `lang` is sent only when the entry may change it. */
export async function writeEdit(id: string, text: Text, publish: boolean, lang?: Lang): Promise<Write> {
  if (!docHasText(text.doc)) return BODY_REQUIRED;
  const updated = await putText(id, text, lang);
  if (!updated.ok) return updated;
  return publish ? publishRow(updated.data.entry) : updated;
}

export const unpublishEntry = (id: string): Promise<Write> => api<{ entry: EntryDetail }>('POST', `${entryPath(id)}/unpublish`, {}, IN_PLACE);

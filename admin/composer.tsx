// The slot at the top of the signed-in shell (plan B6, W1): the editor that writes a new entry,
// and the frame that opens an existing one in the same editor (plates 7, 8, 9, 12, 14).
//
// `NewEntry` is always what the shell shows when nothing is being edited, so the editor comes first
// and empty on day 1 and on day 23 alike (J2.2, AC-5). `EntryFrame` is B5's frame, with its header
// lines, and the editor where B5 drew the text read-only.
//
// Nothing is lost (AC-16, AC-43, PD-12). Every change is written to a local buffer as it is made
// (`buffers.ts`), and a buffer is cleared only when the server has confirmed what it was waiting for:
// the one `await` that sends is followed by the one place that clears. The writer, the failure notice and
// the notices both this editor and the episode form use are in `writer.tsx`.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { formatAdminDay } from '../lib/dates.ts';
import { dirOf, localePath, type Lang } from '../lib/i18n.ts';
import { limits } from '../lib/limits.ts';
import { docText, stripXmlForbidden, type Doc } from '../shared/doc.ts';
import { excerpt } from '../shared/excerpt.ts';
import { api, type Code, type EntryDetail, type SessionInfo, type Settings } from './api.ts';
import type { Buffers, EditBuffer, Snapshot, Unsent } from './buffers.ts';
import { copy, refusals } from './copy.ts';
import { Editor } from './editor.tsx';
import { EMPTY_DOC } from './editor-model.ts';
import { Modal, Notice, siteTimeZone } from './ui.tsx';
import { DiscardDialog, FailureNotice, LanguageControl, Offer, OfferName, PublishedNotice, Said, UNANSWERED, guessLang, newKey, useWriter, type Action } from './writer.tsx';
import { unpublishEntry, writeEdit, writeNew } from './writes.ts';

/** The title is one line: the characters the server refuses in one (control characters) and the ones XML forbids are dropped as they arrive, say from a paste. */
const cleanTitle = (title: string): string => stripXmlForbidden(title).replace(/\p{Cc}/gu, ' ');

/** What the editor holds, as one comparable string: an edit is unsaved while this differs from the entry as the server has it. The language is part of it, since a never-published entry may change it (PL-8). */
const signature = (title: string, doc: Doc, lang: Lang): string => JSON.stringify([title.trim(), doc, lang]);

/**
 * What an offer of kept text is called, so the person can tell which text Put it back restores (PL-7): the entry's title,
 * or else its opening words in its own language's quotes, cut as the entries list cuts them. In the text's own language
 * and direction. An entry with neither has no name to give.
 */
function EntryName({ title, doc, lang }: { title: string; doc: Doc; lang: Lang }) {
  const words = excerpt(docText(doc));
  const name = title.trim() !== '' ? title.trim() : words !== '' ? copy.entries.opening(words, lang) : '';
  return name === '' ? null : <OfferName text={name} lang={lang} />;
}

// ── The editor's fields ──

interface FieldsProps {
  /** Ids in the page are built from this, so the new entry's fields and the frame's never clash. */
  idBase: string;
  lang: Lang;
  title: string;
  onTitle: (title: string) => void;
  doc: Doc;
  onDoc: (doc: Doc) => void;
  readOnly: boolean;
  /** Whether a copy of the text is in the local buffer: "Kept on this phone", the only draft signal (W7). */
  kept: boolean;
  dock: ComponentChildren;
}

/** The title and the body, in the entry's language and direction (AC-42). */
function Fields({ idBase, lang, title, onTitle, doc, onDoc, readOnly, kept, dock }: FieldsProps) {
  const t = copy.editor;
  return (
    <>
      <div class="field">
        <label class="field__label" for={`${idBase}-title`}>
          {t.titleLabel}
        </label>
        <input
          class="field__input field__input--title"
          id={`${idBase}-title`}
          type="text"
          lang={lang}
          dir={dirOf(lang)}
          value={title}
          maxLength={limits.titleMaxChars}
          readOnly={readOnly}
          autocomplete="off"
          onInput={(event) => onTitle(cleanTitle((event.currentTarget as HTMLInputElement).value))}
        />
      </div>
      <Editor
        value={doc}
        onChange={onDoc}
        lang={lang}
        readOnly={readOnly}
        labelId={`${idBase}-body`}
        placeholder={t.placeholder}
        toolbarEnd={kept ? <span class="toolbar__kept">{t.kept}</span> : null}
        dock={dock}
      />
    </>
  );
}

/** "Published. It's out there.", with where the entry is: its own address in the log. */
function EntryPublished({ id, lang, head }: { id: string; lang: Lang; head: string }) {
  return <PublishedNotice path={localePath(lang, `/log/${id}`)} head={head} />;
}

// ── A new entry ──

/** What an edit that ended in the editor's slot leaves to say above the new entry. */
export type SaidNote = { kind: 'saved' } | { kind: 'draftSaved' } | { kind: 'published'; id: string; lang: Lang; head: string };

/** The edit is over and set-aside text came back (AC-43), and what the edit last did, if it should still be said. */
export interface Returned {
  restored: boolean;
  said: SaidNote | null;
}

interface NewProps {
  buffers: Buffers;
  returned: Returned | null;
  onChanged: () => void;
  onSession: (session: SessionInfo) => void;
}

/**
 * What the shell shows when nothing is being edited: the language, then the title, the body and
 * the actions, empty and ready (plate 7). It starts in the language last used, which the server
 * remembers (PD-10), so the language is known before anything is drawn; or in the language of text
 * that was put back.
 */
export function NewEntry(props: NewProps) {
  const [initial] = useState(() => props.buffers.read().unsent);
  const [lang, setLang] = useState<Lang | null>(initial?.lang ?? null);
  useEffect(() => {
    if (initial) return undefined;
    let live = true;
    void api<Settings>('GET', 'settings').then((result) => {
      // A failed read leaves the default: English is never wrong to start in, only to stay in.
      if (live) setLang(result.ok ? result.data.lastLanguage : 'en');
    });
    return () => {
      live = false;
    };
  }, []);
  return lang === null ? null : <NewForm {...props} initial={initial} initialLang={lang} />;
}

function NewForm({ buffers, returned, initial, initialLang, onChanged, onSession }: NewProps & { initial: Unsent | null; initialLang: Lang }) {
  const [lang, setLang] = useState<Lang>(initial?.lang ?? initialLang);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [doc, setDoc] = useState<Doc>(initial?.doc ?? EMPTY_DOC);
  // What is set aside or kept, as the buffers hold it now. Whether the last write to them landed.
  const [snap, setSnap] = useState<Snapshot>(() => buffers.read());
  const [stored, setStored] = useState(true);
  // What the last write made, said just above the actions (PL-11).
  const [published, setPublished] = useState<{ id: string; lang: Lang } | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  // "Back to your unsent entry" stays until the person does something else.
  const [back, setBack] = useState(returned?.restored ?? false);
  const [said, setSaid] = useState<SaidNote | null>(returned?.said ?? null);
  const [discarding, setDiscarding] = useState<'kept' | 'unsent' | null>(null);
  const writer = useWriter(onSession);
  // The key is made at the first keystroke and kept until the server confirms a publish; the id is the row once there is one (PD-11).
  const key = useRef<string | null>(initial?.key ?? null);
  const rowId = useRef<string | null>(initial?.id ?? null);
  // Whether a request with this key went out and no answer came back (a dropped connection, a server error). The server
  // may have made the row, in the language it was sent in, and a retry with the key would find it: so the language is
  // fixed until an answer comes. A new key for a new language would publish the same text twice if the first one landed.
  const unanswered = useRef(false);
  const live = useRef({ lang, title, doc });
  live.current = { lang, title, doc };

  const store = (event: Parameters<Buffers['apply']>[0]) => {
    const result = buffers.apply(event);
    setSnap(result.snapshot);
    setStored(result.stored);
    return result.snapshot;
  };

  /** Every change is written to the buffer as it is made, before anything else happens. */
  const change = (next: Partial<{ lang: Lang; title: string; doc: Doc }>) => {
    const merged = { ...live.current, ...next };
    live.current = merged;
    // A composition with nothing in it, and no row, is no composition: it has no key. The first keystroke makes one.
    const empty = merged.title.trim() === '' && merged.doc.content.length === 0;
    if (empty && rowId.current === null && !unanswered.current) key.current = null;
    else key.current ??= newKey();
    store({ type: 'typed', unsent: key.current === null ? null : { key: key.current, id: rowId.current, ...merged } });
    setPublished(null);
    setDraftSaved(false);
    setBack(false);
    setSaid(null);
    writer.edited();
    if (next.lang !== undefined) setLang(next.lang);
    if (next.title !== undefined) setTitle(next.title);
    if (next.doc !== undefined) setDoc(next.doc);
  };

  const onLang = (next: Lang) => change({ lang: next });

  const write = async (action: 'publish' | 'saveDraft') => {
    key.current ??= newKey();
    const current = live.current;
    const sent = key.current;
    const result = await writer.attempt(action, async () => {
      const answer = await writeNew({ ...current, key: sent, id: rowId.current }, action === 'publish', (id) => {
        // The server made a row: from here the text is worked on by its id, and the buffer says so,
        // so a closed tab and a reopened page carry on with the same row.
        rowId.current = id;
        unanswered.current = false;
        store({ type: 'typed', unsent: { key: sent, id, ...current } });
      });
      // Set before the failure is drawn, so the language control is fixed in the same render.
      if (!answer.ok && UNANSWERED.has(answer.code) && rowId.current === null) unanswered.current = true;
      return answer;
    });
    if (!result?.ok) return;
    const entry = result.data.entry;
    onChanged();
    if (entry.state === 'published') {
      // The server has it. Only now is the buffer cleared and the editor emptied; the next entry starts in the language just used.
      store({ type: 'confirmed' });
      key.current = null;
      rowId.current = null;
      unanswered.current = false;
      live.current = { lang: live.current.lang, title: '', doc: EMPTY_DOC };
      setTitle('');
      setDoc(EMPTY_DOC);
      setDraftSaved(false);
      setBack(false);
      setSaid(null);
      setPublished({ id: entry.id, lang: entry.lang });
    } else {
      setDraftSaved(true);
    }
  };

  const signInAndRetry = async () => {
    const action = writer.failure?.action;
    if (action !== 'publish' && action !== 'saveDraft') return;
    // Signed in, the same action runs once more, on the new session and its token. A second 401 says so again and stops.
    if (await writer.signInHere()) await write(action);
  };

  const putBack = () => {
    const next = store({ type: 'restored' }).unsent;
    if (!next) return;
    key.current = next.key;
    rowId.current = next.id;
    unanswered.current = false;
    live.current = { lang: next.lang, title: next.title, doc: next.doc };
    setLang(next.lang);
    setTitle(next.title);
    setDoc(next.doc);
    setBack(false);
    setDraftSaved(false);
    setPublished(null);
    writer.clear();
  };

  const discard = () => {
    const which = discarding;
    setDiscarding(null);
    if (which === null) return;
    store({ type: 'discarded', which });
    if (which === 'unsent') {
      key.current = null;
      rowId.current = null;
      unanswered.current = false;
      live.current = { lang: live.current.lang, title: '', doc: EMPTY_DOC };
      setTitle('');
      setDoc(EMPTY_DOC);
      setBack(false);
      setDraftSaved(false);
      writer.clear();
    }
  };

  const busy = writer.busy;
  const t = copy.editor;
  // What the last write did is said in the one place a failure is said, just above the actions (PL-11). A failure and a
  // success never show together, and nothing is said about a write that is still out.
  const quiet = busy === null && writer.failure === null && writer.signInProblem === null;
  const success = !quiet ? null : published ? (
    <EntryPublished id={published.id} lang={published.lang} head={t.published.head} />
  ) : draftSaved ? (
    <Said head={t.savedDraft.head} body={t.savedDraft.body} />
  ) : said?.kind === 'saved' ? (
    <Said head={t.savedLive.head} body={t.savedLive.body} />
  ) : said?.kind === 'draftSaved' ? (
    <Said head={t.savedDraft.head} body={t.savedDraft.body} />
  ) : said?.kind === 'published' ? (
    <EntryPublished id={said.id} lang={said.lang} head={said.head} />
  ) : null;
  const dock = (
    <>
      <FailureNotice writer={writer} words={copy.editor.failure} kept={stored} onRetry={() => void write(writer.failure?.action === 'saveDraft' ? 'saveDraft' : 'publish')} onSignIn={() => void signInAndRetry()} />
      {success}
      <div class="composer__actions">
        <button type="button" class="btn" disabled={busy !== null || draftSaved} onClick={() => void write('saveDraft')}>
          {draftSaved ? copy.editor.saved : copy.editor.saveDraft}
        </button>
        <button type="button" class="btn btn--primary" disabled={busy !== null} aria-busy={busy === 'publish'} onClick={() => void write('publish')}>
          {busy === 'publish' ? copy.editor.publishing : copy.editor.publish}
        </button>
      </div>
    </>
  );

  // The text Put it back restores is the last one set aside: the buffer's stack keeps the newest on top.
  const keptTop = snap.kept[snap.kept.length - 1];
  return (
    <div class="composer">
      {/* Text found again when the page opened, or set aside while another entry was edited and not yet put back. */}
      {snap.kept.length > 0 ? (
        <Offer head={t.left.head} body={t.left.body} name={keptTop ? <EntryName title={keptTop.title} doc={keptTop.doc} lang={keptTop.lang} /> : undefined}>
          <button type="button" class="btn" disabled={busy !== null} onClick={putBack}>
            {t.left.put}
          </button>
          <button type="button" class="btn" disabled={busy !== null} onClick={() => setDiscarding('kept')}>
            {t.left.discard}
          </button>
        </Offer>
      ) : null}
      {back && snap.unsent ? (
        <Offer head={t.back.head} body={t.back.body}>
          <button type="button" class="btn" disabled={busy !== null} onClick={() => setDiscarding('unsent')}>
            {t.back.discard}
          </button>
        </Offer>
      ) : null}
      {/* A draft saved here has never been published, so its language may still change: the next Save draft or Publish
          sends it (PL-8). The control is fixed while a send is out, and while one went unanswered with no row known, since the
          row may exist in the language it was sent in and a new key for another would publish the same text twice. */}
      <LanguageControl name="entry-language" lang={lang} locked={busy !== null || unanswered.current} onChange={onLang} />
      <Fields
        idBase="new"
        lang={lang}
        title={title}
        onTitle={(next) => change({ title: next })}
        doc={doc}
        onDoc={(next) => change({ doc: next })}
        readOnly={busy !== null}
        kept={stored && snap.unsent !== null}
        dock={dock}
      />
      {discarding ? <DiscardDialog onKeep={() => setDiscarding(null)} onDiscard={discard} /> : null}
    </div>
  );
}

// ── An existing entry, in B5's frame ──

/** What the last write did, said just above the actions. */
type Note = 'saved' | 'draftSaved' | 'unpublished' | 'published' | 'republished';

interface FrameProps {
  id: string;
  buffers: Buffers;
  /** Changes left in the edit buffer by an earlier visit, offered back and chosen: they are put over the entry. */
  resume: EditBuffer | null;
  /** Unsent text was set aside when this edit opened, and comes back when it ends (AC-43). */
  keptNote: boolean;
  /** The person asked to leave. The shell decides, because it can see whether there are unsaved changes. */
  onCancel: () => void;
  /** The edit is done (saved or published) and set-aside text came back: the shell closes the frame and says what was done above it. */
  onDone: (said: SaidNote) => void;
  onChanged: () => void;
  onSession: (session: SessionInfo) => void;
  /** Whether the editor holds changes the server doesn't have. */
  onDirty: (dirty: boolean) => void;
}

/**
 * The edit view's frame, in the editor's slot (plate 8). Its header says what is being edited: a published
 * entry, a draft that was live, or a plain draft. The title and body are the editor, in the entry's own
 * language (an edit never changes it, AC-13). A published entry can be saved or unpublished, after one
 * confirmation and no reason asked (F19, AC-14); a draft can be saved or published, and one that was live
 * says where it will return before it does, and again after (G9, AC-34).
 */
export function EntryFrame(props: FrameProps) {
  const { id, onCancel } = props;
  const [entry, setEntry] = useState<EntryDetail | null>(null);
  const [loadFailed, setLoadFailed] = useState<Code | null>(null);
  const status = useRef<HTMLParagraphElement>(null);

  const load = async () => {
    setLoadFailed(null);
    const result = await api<{ entry: EntryDetail }>('GET', `entries/${encodeURIComponent(id)}`);
    if (result.ok) setEntry(result.data.entry);
    else setLoadFailed(result.code);
  };
  useEffect(() => void load(), [id]);

  // The frame appears above the list the person was reading: put the keyboard and the screen reader at its top.
  useEffect(() => status.current?.focus(), [entry === null]);

  if (loadFailed) {
    return (
      <section class="frame" aria-label={copy.entry.loading}>
        <Notice kind="error">{loadFailed === 'NOT_FOUND' ? refusals.NOT_FOUND : copy.entry.loadFailed}</Notice>
        <div class="actions">
          <button type="button" class="btn" onClick={() => void load()}>
            {copy.entry.retry}
          </button>
          <button type="button" class="btn btn--quiet" onClick={onCancel}>
            {copy.entry.cancel}
          </button>
        </div>
      </section>
    );
  }

  if (!entry) {
    return (
      <section class="frame" aria-busy="true">
        <p class="frame__status" tabIndex={-1} ref={status}>
          {copy.entry.loading}
        </p>
      </section>
    );
  }

  return <EditForm {...props} loaded={entry} statusRef={status} />;
}

function EditForm({
  loaded,
  statusRef,
  buffers,
  resume,
  keptNote,
  onCancel,
  onDone,
  onChanged,
  onSession,
  onDirty,
}: FrameProps & { loaded: EntryDetail; statusRef: { current: HTMLParagraphElement | null } }) {
  // What the server says about the entry changes as it is published and unpublished; the text is the person's.
  const [entry, setEntry] = useState(loaded);
  const [title, setTitle] = useState(resume ? resume.title : (loaded.title ?? ''));
  const [doc, setDoc] = useState<Doc>(resume ? resume.doc : loaded.body);
  // A never-published entry may change its language (PL-8). A buffer from before PL1 has none: it reads as "unchanged", the row's own.
  const [lang, setLang] = useState<Lang>(loaded.firstPublishedAt === null ? (resume?.lang ?? loaded.lang) : loaded.lang);
  // The text as the server has it, so "unsaved" means a difference from it, and a change put back isn't one.
  const [base, setBase] = useState(() => signature(loaded.title ?? '', loaded.body, loaded.lang));
  const [stored, setStored] = useState(true);
  const [note, setNote] = useState<Note | null>(null);
  const [confirming, setConfirming] = useState(false);
  const writer = useWriter(onSession);
  const live = useRef({ title, doc, lang, entry, base });
  live.current = { title, doc, lang, entry, base };
  // Once published, an entry keeps its language: the page, the feed and the link have carried it (AC-14).
  const mayChangeLanguage = entry.firstPublishedAt === null;

  const dirty = signature(title, doc, lang) !== base;
  useEffect(() => onDirty(dirty), [dirty]);

  const zone = siteTimeZone();
  const day = (instant: number) => formatAdminDay(instant, zone);
  const first = entry.firstPublishedAt;
  const header =
    entry.state === 'published' && first !== null
      ? copy.entry.editingPublished(day(first))
      : entry.wasLive && first !== null
        ? copy.entry.draftWasLive(day(first))
        : copy.entry.draft;

  /** Every change is written to the edit buffer as it is made, for as long as it differs from the entry. */
  const change = (next: Partial<{ title: string; doc: Doc; lang: Lang }>) => {
    const merged = { ...live.current, ...next };
    live.current = merged;
    const differs = signature(merged.title, merged.doc, merged.lang) !== merged.base;
    const result = buffers.apply(
      differs ? { type: 'edit-typed', edit: { id: loaded.id, title: merged.title, doc: merged.doc, lang: merged.lang } } : { type: 'discarded', which: 'edit' },
    );
    setStored(result.stored);
    writer.edited();
    // Saying "Saved" or "Published" about text that has changed since would be wrong; what the server did to the entry's state stays true.
    setNote((current) => (current === 'unpublished' ? current : null));
    if (next.title !== undefined) setTitle(next.title);
    if (next.doc !== undefined) setDoc(next.doc);
    if (next.lang !== undefined) setLang(next.lang);
  };

  const run = async (action: Action) => {
    const before = live.current.entry;
    const sent = { title: live.current.title, doc: live.current.doc };
    // The language goes only for an entry that may still change it; the server refuses it for any other (LANG_FIXED).
    const sentLang = before.firstPublishedAt === null ? live.current.lang : undefined;
    const result = await writer.attempt(action, () => (action === 'unpublish' ? unpublishEntry(before.id) : writeEdit(before.id, sent, action === 'publish', sentLang)));
    if (!result?.ok) return;
    const next = result.data.entry;
    setEntry(next);
    onChanged();
    if (action === 'unpublish') return setNote('unpublished');
    // The server has the text: the edit buffer is cleared, and what is unsaved is measured from here.
    const savedBase = signature(sent.title, sent.doc, next.lang);
    setBase(savedBase);
    live.current = { ...live.current, lang: next.lang, base: savedBase };
    const keptBefore = buffers.read().kept.length > 0;
    const after = buffers.apply({ type: 'edit-confirmed' });
    setStored(after.stored);
    const done: Note = action === 'publish' ? (before.wasLive ? 'republished' : 'published') : next.state === 'published' ? 'saved' : 'draftSaved';
    setNote(done);
    // Set-aside text comes back when the edit is done (AC-43): the frame closes, and says what it did above the unsent entry.
    if (keptBefore) {
      const day0 = next.firstPublishedAt;
      onDone(
        done === 'saved'
          ? { kind: 'saved' }
          : done === 'draftSaved'
            ? { kind: 'draftSaved' }
            : { kind: 'published', id: next.id, lang: next.lang, head: done === 'republished' && day0 !== null ? copy.entry.published(day(day0)) : copy.editor.published.head },
      );
    }
  };

  const signInAndRetry = async () => {
    const action = writer.failure?.action;
    if (!action) return;
    if (await writer.signInHere()) await run(action);
  };

  const t = copy.editor;
  const busy = writer.busy;
  // What the last write did is said just above the actions, where a failure is said (PL-11). Never both, and nothing about a write still out.
  const quiet = busy === null && writer.failure === null && writer.signInProblem === null;
  const success = !quiet ? null : note === 'saved' ? (
    <Said head={t.savedLive.head} body={t.savedLive.body} />
  ) : note === 'draftSaved' ? (
    <Said head={t.savedDraft.head} body={t.savedDraft.body} />
  ) : note === 'unpublished' ? (
    <Notice kind="success">{copy.entry.unpublished}</Notice>
  ) : note === 'published' || note === 'republished' ? (
    // A draft that was live returns at its original date, which it names (AC-34); a first publish says where it is.
    <EntryPublished id={entry.id} lang={entry.lang} head={note === 'republished' && first !== null ? copy.entry.published(day(first)) : t.published.head} />
  ) : null;
  const dock = (
    <>
      {entry.wasLive && first !== null ? (
        <p class="frame__notice">
          {copy.entry.republish.before}
          <mark>{day(first)}</mark>
          {copy.entry.republish.after}
        </p>
      ) : null}
      <FailureNotice writer={writer} words={copy.editor.failure} kept={stored} onRetry={() => void (writer.failure && run(writer.failure.action))} onSignIn={() => void signInAndRetry()} />
      {success}
      <div class="composer__actions">
        {entry.state === 'published' ? (
          <>
            <button type="button" class="btn" disabled={busy !== null} onClick={() => setConfirming(true)}>
              {busy === 'unpublish' ? copy.entry.unpublishing : copy.entry.unpublish}
            </button>
            <button type="button" class="btn btn--primary" disabled={busy !== null} onClick={() => void run('save')}>
              {t.save}
            </button>
          </>
        ) : (
          <>
            <button type="button" class="btn" disabled={busy !== null || note === 'draftSaved'} onClick={() => void run('saveDraft')}>
              {note === 'draftSaved' ? t.saved : t.saveDraft}
            </button>
            <button type="button" class="btn btn--primary" disabled={busy !== null} aria-busy={busy === 'publish'} onClick={() => void run('publish')}>
              {busy === 'publish' ? t.publishing : t.publish}
            </button>
          </>
        )}
      </div>
    </>
  );

  return (
    <section class="frame" aria-label={header}>
      <div class="frame__bar">
        <p class="frame__status" tabIndex={-1} ref={statusRef}>
          {header}
        </p>
        <button type="button" class="text-btn" onClick={onCancel}>
          {copy.entry.cancel}
        </button>
      </div>
      {keptNote ? <Offer head={t.keptNote.head} body={t.keptNote.body} /> : null}
      {/* Shown while the entry has never been published (PL-8): a published or was-live entry keeps its language. */}
      {mayChangeLanguage ? <LanguageControl name="edit-language" lang={lang} locked={busy !== null} onChange={(next) => change({ lang: next })} /> : null}

      <Fields
        idBase="edit"
        lang={lang}
        title={title}
        onTitle={(next) => change({ title: next })}
        doc={doc}
        onDoc={(next) => change({ doc: next })}
        readOnly={busy !== null}
        kept={stored && dirty}
        dock={dock}
      />

      {confirming ? (
        <Modal titleId="unpublish-title" onCancel={() => setConfirming(false)}>
          <h2 class="modal__title" id="unpublish-title">
            {copy.entry.confirm.title}
          </h2>
          <p class="modal__body">{copy.entry.confirm.body}</p>
          <div class="modal__actions">
            <button type="button" class="btn" onClick={() => setConfirming(false)}>
              {copy.entry.confirm.keep}
            </button>
            <button
              type="button"
              class="btn"
              onClick={() => {
                setConfirming(false);
                void run('unpublish');
              }}
            >
              {copy.entry.confirm.unpublish}
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

/** The dialog the shell shows when a person would leave an edit that holds changes the server doesn't have. */
export function LeaveDialog({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  const t = copy.editor.leaveDialog;
  return (
    <Modal titleId="leave-title" onCancel={onStay}>
      <h2 class="modal__title" id="leave-title">
        {t.title}
      </h2>
      <p class="modal__body">{t.body}</p>
      <div class="modal__actions">
        <button type="button" class="btn" onClick={onStay}>
          {t.stay}
        </button>
        <button type="button" class="btn" onClick={onLeave}>
          {t.leave}
        </button>
      </div>
    </Modal>
  );
}

/**
 * The offer for changes left in the edit buffer when the page opened: put them back, or discard (asking once more).
 * It names the entry the changes are to (PL-7). A buffer from before PL1 has no language, and the entry isn't read
 * yet, so the language of its words stands in for it.
 */
export function EditOffer({ edit, onPut, onDiscard }: { edit: EditBuffer; onPut: () => void; onDiscard: () => void }) {
  const t = copy.editor.leftEdit;
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Offer head={t.head} body={t.body} name={<EntryName title={edit.title} doc={edit.doc} lang={edit.lang ?? guessLang(`${edit.title} ${docText(edit.doc)}`)} />}>
        <button type="button" class="btn" onClick={onPut}>
          {t.put}
        </button>
        <button type="button" class="btn" onClick={() => setAsking(true)}>
          {t.discard}
        </button>
      </Offer>
      {asking ? (
        <DiscardDialog
          onKeep={() => setAsking(false)}
          onDiscard={() => {
            setAsking(false);
            onDiscard();
          }}
        />
      ) : null}
    </>
  );
}

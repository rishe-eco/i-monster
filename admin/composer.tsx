// The slot at the top of the signed-in shell (plan B6, W1): the editor that writes a new entry,
// and the frame that opens an existing one in the same editor (plates 7, 8, 12, 14).
//
// `NewEntry` is always what the shell shows when nothing is being edited, so the editor comes first
// and empty on day 1 and on day 23 alike (J2.2, AC-5). `EntryFrame` is B5's frame, with its header
// lines, and the editor where B5 drew the text read-only.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { formatAdminDay } from '../lib/dates.ts';
import { dirOf, localePath, type Lang } from '../lib/i18n.ts';
import { limits } from '../lib/limits.ts';
import { stripXmlForbidden, type Doc } from '../shared/doc.ts';
import { api, type Code, type EntryDetail, type Settings } from './api.ts';
import { copy, refusals } from './copy.ts';
import { Editor } from './editor.tsx';
import { EMPTY_DOC } from './editor-model.ts';
import { Modal, Notice, siteTimeZone } from './ui.tsx';
import { unpublishEntry, writeEdit, writeNew, type Write } from './writes.ts';

/** What a person can ask the editor to do. It decides the label, the copy of a failure, and what is sent. */
type Action = 'publish' | 'save' | 'saveDraft' | 'unpublish';

/** A UUID for a new composition's publish key (PD-11). `randomUUID` needs a secure context; the fallback builds the same thing from random bytes. */
function newKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The title is one line: the characters the server refuses in one (control characters) and the ones XML forbids are dropped as they arrive, say from a paste. */
const cleanTitle = (title: string): string => stripXmlForbidden(title).replace(/\p{Cc}/gu, ' ');

// ── Pieces both forms share ──

function LanguageControl({ lang, onChange, locked }: { lang: Lang; onChange: (lang: Lang) => void; locked: boolean }) {
  const t = copy.editor;
  return (
    <fieldset class="segmented" disabled={locked}>
      <legend class="field__label">{t.language}</legend>
      <div class="segmented__options">
        {(['en', 'fa'] as const).map((option) => (
          <label class="segmented__option" key={option}>
            <input type="radio" name="entry-language" value={option} checked={lang === option} onChange={() => onChange(option)} />
            <span lang={option}>{option === 'en' ? t.english : t.persian}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface FieldsProps {
  /** Ids in the page are built from this, so the new entry's fields and the frame's never clash. */
  idBase: string;
  lang: Lang;
  title: string;
  onTitle: (title: string) => void;
  doc: Doc;
  onDoc: (doc: Doc) => void;
  readOnly: boolean;
  toolbarEnd?: ComponentChildren;
  dock: ComponentChildren;
}

/** The title and the body, in the entry's language and direction (AC-42). */
function Fields({ idBase, lang, title, onTitle, doc, onDoc, readOnly, toolbarEnd, dock }: FieldsProps) {
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
        toolbarEnd={toolbarEnd}
        dock={dock}
      />
    </>
  );
}

/** "Published. It's out there.", with where it is, and Open and Copy link (J1.9; F16: Copy link says "Copied" for a moment, then goes back). */
function PublishedNotice({ id, lang, head }: { id: string; lang: Lang; head: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const where = useRef<HTMLSpanElement>(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const path = localePath(lang, `/log/${id}`);
  const t = copy.editor.published;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}${path}`);
    } catch {
      // No clipboard here, or it was refused: select the address so the person can copy it by hand.
      if (where.current) window.getSelection()?.selectAllChildren(where.current);
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), limits.copiedMs);
  };

  return (
    <div class="notice notice--success published" role="status">
      <strong>{head}</strong>
      <span class="published__where" dir="ltr" ref={where}>
        {location.host}
        {path}
      </span>
      <span class="published__actions">
        <a class="btn" href={path}>
          {t.open}
        </a>
        <button type="button" class="btn" onClick={() => void copyLink()}>
          {copied ? t.copied : t.copy}
        </button>
      </span>
      {/* Said politely, so a screen reader hears "Copied" without it taking focus. */}
      <span class="visually-hidden" aria-live="polite">
        {copied ? t.copied : ''}
      </span>
    </div>
  );
}

/** A confirmation with its first words in bold: "Saved." and what it means. */
function Said({ head, body }: { head: string; body: string }) {
  return (
    <Notice kind="success">
      <strong>{head}</strong> {body}
    </Notice>
  );
}

// ── A new entry ──

/**
 * What the shell shows when nothing is being edited: the language, then the title, the body and
 * the actions, empty and ready (plate 7). It starts in the language last used, which the server
 * remembers (PD-10), so the language is known before anything is drawn.
 */
export function NewEntry({ onChanged }: { onChanged: () => void }) {
  const [lang, setLang] = useState<Lang | null>(null);
  useEffect(() => {
    let live = true;
    void api<Settings>('GET', 'settings').then((result) => {
      // A failed read leaves the default: English is never wrong to start in, only to stay in.
      if (live) setLang(result.ok ? result.data.lastLanguage : 'en');
    });
    return () => {
      live = false;
    };
  }, []);
  return lang === null ? null : <NewForm initialLang={lang} onChanged={onChanged} />;
}

function NewForm({ initialLang, onChanged }: { initialLang: Lang; onChanged: () => void }) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [title, setTitle] = useState('');
  const [doc, setDoc] = useState<Doc>(EMPTY_DOC);
  const [busy, setBusy] = useState<'publish' | 'saveDraft' | null>(null);
  const [failure, setFailure] = useState<Code | null>(null);
  // What the last write made, shown above the editor (published) or beside the actions (draft).
  const [published, setPublished] = useState<{ id: string; lang: Lang } | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  // The key is made at the first keystroke and kept until the server confirms a publish; the id is the row once there is one (PD-11).
  const key = useRef<string | null>(null);
  const rowId = useRef<string | null>(null);
  const writing = useRef(false);
  const live = useRef({ lang, title, doc });
  live.current = { lang, title, doc };

  const touched = () => {
    key.current ??= newKey();
    setPublished(null);
    setDraftSaved(false);
    setFailure(null);
  };

  const write = async (action: 'publish' | 'saveDraft') => {
    // Synchronous, so a second tap in the same frame finds this one still running: one tap, one write.
    if (writing.current) return;
    writing.current = true;
    setBusy(action);
    setFailure(null);
    key.current ??= newKey();
    const current = live.current;
    const result = await writeNew({ ...current, key: key.current, id: rowId.current }, action === 'publish', (id) => {
      rowId.current = id;
    });
    writing.current = false;
    setBusy(null);
    if (!result.ok) return setFailure(result.code);
    const entry = result.data.entry;
    onChanged();
    if (entry.state === 'published') {
      // The server has it. Only now does the editor empty, and the next entry starts in the language just used.
      key.current = null;
      rowId.current = null;
      setTitle('');
      setDoc(EMPTY_DOC);
      setDraftSaved(false);
      setPublished({ id: entry.id, lang: entry.lang });
    } else {
      setDraftSaved(true);
    }
  };

  const dock = (
    <>
      {failure ? <Notice kind="error">{refusals[failure]}</Notice> : null}
      <div class="composer__actions">
        <button type="button" class="btn" disabled={busy !== null || draftSaved} onClick={() => void write('saveDraft')}>
          {draftSaved ? copy.editor.saved : copy.editor.saveDraft}
        </button>
        <button type="button" class="btn btn--primary btn--solid" disabled={busy !== null} aria-busy={busy === 'publish'} onClick={() => void write('publish')}>
          {busy === 'publish' ? copy.editor.publishing : copy.editor.publish}
        </button>
      </div>
      {draftSaved ? <Said head={copy.editor.savedDraft.head} body={copy.editor.savedDraft.body} /> : null}
    </>
  );

  return (
    <div class="composer">
      {published ? <PublishedNotice id={published.id} lang={published.lang} head={copy.editor.published.head} /> : null}
      {/* Once a draft is saved the row has a language, and a PUT never changes it: the control is fixed from then on. */}
      <LanguageControl
        lang={lang}
        locked={busy !== null || rowId.current !== null}
        onChange={(next) => {
          touched();
          setLang(next);
        }}
      />
      <Fields
        idBase="new"
        lang={lang}
        title={title}
        onTitle={(next) => {
          touched();
          setTitle(next);
        }}
        doc={doc}
        onDoc={(next) => {
          touched();
          setDoc(next);
        }}
        readOnly={busy !== null}
        dock={dock}
      />
    </div>
  );
}

// ── An existing entry, in B5's frame ──

/**
 * The edit view's frame, in the editor's slot (plate 8). Its header says what is being edited: a published
 * entry, a draft that was live, or a plain draft. The title and body are the editor, in the entry's own
 * language (an edit never changes it, AC-13). A published entry can be saved or unpublished, after one
 * confirmation and no reason asked (F19, AC-14); a draft can be saved or published, and one that was live
 * says where it will return before it does, and again after (G9, AC-34).
 */
export function EntryFrame({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
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
          <button type="button" class="btn btn--quiet" onClick={onClose}>
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

  return <EditForm loaded={entry} statusRef={status} onClose={onClose} onChanged={onChanged} />;
}

/** What the last write did, said under the actions. */
type Note = 'saved' | 'draftSaved' | 'unpublished' | 'published' | 'republished';

function EditForm({
  loaded,
  statusRef,
  onClose,
  onChanged,
}: {
  loaded: EntryDetail;
  statusRef: { current: HTMLParagraphElement | null };
  onClose: () => void;
  onChanged: () => void;
}) {
  // What the server says about the entry changes as it is published and unpublished; the text is the person's.
  const [entry, setEntry] = useState(loaded);
  const [title, setTitle] = useState(loaded.title ?? '');
  const [doc, setDoc] = useState<Doc>(loaded.body);
  const [busy, setBusy] = useState<Action | null>(null);
  const [failure, setFailure] = useState<Code | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [confirming, setConfirming] = useState(false);
  const writing = useRef(false);
  const live = useRef({ title, doc, entry });
  live.current = { title, doc, entry };

  const zone = siteTimeZone();
  const day = (instant: number) => formatAdminDay(instant, zone);
  const first = entry.firstPublishedAt;
  const header =
    entry.state === 'published' && first !== null
      ? copy.entry.editingPublished(day(first))
      : entry.wasLive && first !== null
        ? copy.entry.draftWasLive(day(first))
        : copy.entry.draft;

  const touched = () => {
    setFailure(null);
    // Saying "Saved" or "Published" about text that has changed since would be wrong; what the server did stays true, so unpublish's answer stays.
    setNote((current) => (current === 'unpublished' ? current : null));
  };

  const run = async (action: Action) => {
    // Synchronous, so a second tap in the same frame finds this one still running.
    if (writing.current) return;
    writing.current = true;
    setConfirming(false);
    setBusy(action);
    setFailure(null);
    const before = live.current.entry;
    const result: Write = action === 'unpublish' ? await unpublishEntry(before.id) : await writeEdit(before.id, live.current, action === 'publish');
    writing.current = false;
    setBusy(null);
    if (!result.ok) return setFailure(result.code);
    const next = result.data.entry;
    setEntry(next);
    onChanged();
    if (action === 'unpublish') setNote('unpublished');
    else if (action === 'publish') setNote(before.wasLive ? 'republished' : 'published');
    else setNote(next.state === 'published' ? 'saved' : 'draftSaved');
  };

  const t = copy.editor;
  const dock = (
    <>
      {entry.wasLive && first !== null ? (
        <p class="frame__notice">
          {copy.entry.republish.before}
          <mark>{day(first)}</mark>
          {copy.entry.republish.after}
        </p>
      ) : null}
      {failure ? <Notice kind="error">{refusals[failure]}</Notice> : null}
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
            <button type="button" class="btn btn--primary btn--solid" disabled={busy !== null} aria-busy={busy === 'publish'} onClick={() => void run('publish')}>
              {busy === 'publish' ? t.publishing : t.publish}
            </button>
          </>
        )}
      </div>
      {note === 'saved' ? <Said head={t.savedLive.head} body={t.savedLive.body} /> : null}
      {note === 'draftSaved' ? <Said head={t.savedDraft.head} body={t.savedDraft.body} /> : null}
      {note === 'unpublished' ? <Notice kind="success">{copy.entry.unpublished}</Notice> : null}
      {/* A draft that was live returns at its original date, which it names (AC-34); a first publish says where it is. */}
      {note === 'published' || note === 'republished' ? (
        <PublishedNotice id={entry.id} lang={entry.lang} head={note === 'republished' && first !== null ? copy.entry.published(day(first)) : t.published.head} />
      ) : null}
    </>
  );

  return (
    <section class="frame" aria-label={header}>
      <div class="frame__bar">
        <p class="frame__status" tabIndex={-1} ref={statusRef}>
          {header}
        </p>
        <button type="button" class="text-btn" onClick={onClose}>
          {copy.entry.cancel}
        </button>
      </div>

      <Fields
        idBase="edit"
        lang={entry.lang}
        title={title}
        onTitle={(next) => {
          touched();
          setTitle(next);
        }}
        doc={doc}
        onDoc={(next) => {
          touched();
          setDoc(next);
        }}
        readOnly={busy !== null}
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
            <button type="button" class="btn" onClick={() => void run('unpublish')}>
              {copy.entry.confirm.unpublish}
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

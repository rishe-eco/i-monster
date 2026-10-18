// The episode form (plan B7, plates 11 and 12): one set of fields for a new episode and for an edit, in
// the Podcast section. `NewEpisode` writes new text under a publish key; `EpisodeFrame` opens an existing
// episode in the same fields. Both are built on `writer.tsx` and `buffers.ts`, the same machinery as the
// entry editor, so what is true there is true here: every change is written to a local buffer as it is
// made, a buffer is cleared only when the server has confirmed what it was waiting for, a failed write
// says it did not happen and waits for a tap, and a session that ended is signed back in over the form.
//
// The links are rows of a label and an address, kept whole: Remove is part of the edit, and Cancel
// undoes it (the server has no route to delete one link). An address that isn't https is refused at the
// field, before anything is sent, with the fix built from the person's own text (AC-17).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { formatDay } from '../lib/dates.ts';
import { dirOf, localePath, type Lang } from '../lib/i18n.ts';
import { limits } from '../lib/limits.ts';
import { stripXmlForbidden } from '../shared/doc.ts';
import { httpsSuggestion, isHttpsLink } from '../shared/link.ts';
import { api, type Code, type EpisodeDetail, type SessionInfo, type Settings } from './api.ts';
import { episodeHasContent, type Buffers, type EpisodeEdit, type EpisodeText, type Snapshot, type UnsentEpisode } from './buffers.ts';
import { copy, refusals } from './copy.ts';
import { Modal, Notice } from './ui.tsx';
import { DiscardDialog, FailureNotice, LanguageControl, Offer, OfferName, PublishedNotice, Said, UNANSWERED, guessLang, newKey, useWriter, type Action } from './writer.tsx';
import { unpublishEpisode, writeEditEpisode, writeNewEpisode } from './episode-writes.ts';

export type EpisodeBuffers = Buffers<UnsentEpisode, EpisodeEdit>;

/** What a form that is finished leaves to say in the section: the episode was saved, or went live. */
export type Done = { kind: 'saved' } | { kind: 'draftSaved' } | { kind: 'published'; lang: Lang } | { kind: 'republished'; date: string };

/** What a finished form says, in the place a failure would: just above the actions (PL-11). */
export function DoneNotice({ done }: { done: Done }) {
  const t = copy.episode;
  if (done.kind === 'saved') return <Said head={t.savedLive.head} body={t.savedLive.body} />;
  if (done.kind === 'draftSaved') return <Said head={t.savedDraft.head} body={t.savedDraft.body} />;
  if (done.kind === 'published') return <PublishedNotice path={localePath(done.lang, '/podcast')} head={t.published.head} />;
  const republished = t.republished(formatDay(done.date, 'en'));
  return <Said head={republished.head} body={republished.body} />;
}

const emptyText = (): EpisodeText => ({ name: '', description: '', tags: ['', ''], date: '', links: [{ label: '', url: '' }] });

/** The form's text for an episode as the server has it: the form always shows at least one link to fill. */
function textOf(episode: EpisodeDetail): EpisodeText {
  return {
    name: episode.name ?? '',
    description: episode.description ?? '',
    tags: [episode.tags[0] ?? '', episode.tags[1] ?? ''],
    date: episode.date,
    links: episode.links.length > 0 ? episode.links.map((link) => ({ ...link })) : [{ label: '', url: '' }],
  };
}

/** One line: the characters the server refuses in one (control characters) and the ones XML forbids are dropped as they arrive, say from a paste. */
const cleanLine = (text: string): string => stripXmlForbidden(text).replace(/\p{Cc}/gu, ' ');

/** What an offer of kept text is called, so the person can tell which text Put it back restores (PL-7): the episode's name, or "No name yet". In its own language and direction. */
function EpisodeName({ name, lang }: { name: string; lang: Lang }) {
  return name.trim() === '' ? <OfferName text={copy.podcast.noName} lang={lang} placeholder /> : <OfferName text={name.trim()} lang={lang} />;
}

const isFilled = (link: { label: string; url: string }): boolean => link.label.trim() !== '' || link.url.trim() !== '';

/**
 * The text as one comparable string, the way the server keeps it: an edit is unsaved while this differs from the episode as
 * the server has it. The language is part of it, since a never-published episode may change it (PL-8).
 */
const signature = (text: EpisodeText, lang: Lang): string =>
  JSON.stringify([
    lang,
    text.name.trim(),
    text.description.replace(/\r\n?/g, '\n').trim(),
    text.tags.map((tag) => tag.trim()),
    text.date,
    text.links.filter(isFilled).map((link) => [link.label.trim(), link.url.trim()]),
  ]);

type LinkProblem = 'notHttps' | 'needsLabel';

/** The rows the server would refuse, found before anything is sent: an address that isn't https, or an address with no label. */
function linkProblems(text: EpisodeText): Map<number, LinkProblem> {
  const found = new Map<number, LinkProblem>();
  text.links.forEach((link, index) => {
    if (!isFilled(link)) return;
    if (link.label.trim() === '') found.set(index, 'needsLabel');
    else if (!isHttpsLink(link.url.trim())) found.set(index, 'notHttps');
  });
  return found;
}

// ── The fields ──

interface FieldsProps {
  idBase: string;
  lang: Lang;
  text: EpisodeText;
  onText: (next: EpisodeText) => void;
  /** The server's day, which an unchosen date shows; null until the list has been read. */
  today: string | null;
  readOnly: boolean;
  /** A published episode keeps one link: its only one has no Remove. */
  published: boolean;
  problems: Map<number, LinkProblem>;
  /** The server refused the date: a day that hasn't come (PL-9). It is said here, at the field, and nothing typed is lost. */
  dateProblem: boolean;
  /** Whether a copy of the text is in the local buffer: "Kept on this phone", the only draft signal (W7). */
  kept: boolean;
  dock: ComponentChildren;
}

/** Name, description, tags, date and links, in the episode's language and direction (AC-42). */
function Fields({ idBase, lang, text, onText, today, readOnly, published, problems, dateProblem, kept, dock }: FieldsProps) {
  const t = copy.episode;
  const dir = dirOf(lang);
  const set = (next: Partial<EpisodeText>) => onText({ ...text, ...next });
  const setLink = (index: number, next: Partial<EpisodeText['links'][number]>) =>
    set({ links: text.links.map((link, at) => (at === index ? { ...link, ...next } : link)) });

  // Remove is on each link when there are two or more; a published episode's only link has none, and says why (AC-17).
  // Taking the last one away by removing the others is for the server to refuse: LAST_LINK says what is true.
  const canRemove = text.links.length >= 2;
  const onlyLink = published && text.links.length === 1;

  return (
    <>
      <div class="field">
        <label class="field__label" for={`${idBase}-name`}>
          {t.nameLabel}
        </label>
        <input
          class="field__input field__input--title"
          id={`${idBase}-name`}
          type="text"
          lang={lang}
          dir={dir}
          value={text.name}
          maxLength={limits.episodeNameMaxChars}
          readOnly={readOnly}
          autocomplete="off"
          onInput={(event) => set({ name: cleanLine((event.currentTarget as HTMLInputElement).value) })}
        />
      </div>
      <div class="field">
        <label class="field__label" for={`${idBase}-description`}>
          {t.descriptionLabel}
        </label>
        <textarea
          class="field__input field__textarea"
          id={`${idBase}-description`}
          rows={4}
          lang={lang}
          dir={dir}
          value={text.description}
          maxLength={limits.episodeDescriptionMaxChars}
          readOnly={readOnly}
          onInput={(event) => set({ description: stripXmlForbidden((event.currentTarget as HTMLTextAreaElement).value) })}
        />
      </div>
      <div class="field">
        <label class="field__label" for={`${idBase}-tag1`}>
          {t.tagLabel}
        </label>
        <input
          class="field__input"
          id={`${idBase}-tag1`}
          type="text"
          lang={lang}
          dir={dir}
          value={text.tags[0]}
          maxLength={limits.episodeTagMaxChars}
          readOnly={readOnly}
          autocomplete="off"
          onInput={(event) => set({ tags: [cleanLine((event.currentTarget as HTMLInputElement).value), text.tags[1]] })}
        />
      </div>
      <div class="field">
        <label class="field__label" for={`${idBase}-tag2`}>
          {t.secondTagLabel}
        </label>
        <input
          class="field__input"
          id={`${idBase}-tag2`}
          type="text"
          lang={lang}
          dir={dir}
          value={text.tags[1]}
          maxLength={limits.episodeTagMaxChars}
          readOnly={readOnly}
          autocomplete="off"
          onInput={(event) => set({ tags: [text.tags[0], cleanLine((event.currentTarget as HTMLInputElement).value)] })}
        />
      </div>
      <div class="field">
        <label class="field__label" for={`${idBase}-date`}>
          {t.dateLabel}
        </label>
        <input
          class="field__input field__input--date"
          id={`${idBase}-date`}
          type="date"
          value={text.date || today || ''}
          // The server's day is the latest an episode can have (PL-9); the server is what refuses, since a field's `max` only hints.
          max={today ?? undefined}
          readOnly={readOnly}
          aria-invalid={dateProblem ? true : undefined}
          aria-describedby={dateProblem ? `${idBase}-date-problem` : undefined}
          onInput={(event) => set({ date: (event.currentTarget as HTMLInputElement).value })}
        />
        {dateProblem ? (
          <p class="field__error" id={`${idBase}-date-problem`} role="alert">
            {refusals.DATE_FUTURE}
          </p>
        ) : null}
      </div>

      <fieldset class="links">
        <legend class="field__label">{t.links}</legend>
        {text.links.map((link, index) => {
          const problem = problems.get(index);
          const base = `${idBase}-link${index}`;
          const named = link.label.trim() || t.thisLink;
          return (
            <div class="linkrow" key={index}>
              {/* One link needs no caption over "Links" and has no Remove; with more, each is numbered (PL-5). */}
              {canRemove ? (
                <div class="linkrow__head">
                  <span class="field__label">{t.link(index + 1)}</span>
                  <button
                    type="button"
                    class="text-btn"
                    disabled={readOnly}
                    aria-label={t.removeNamed(named)}
                    onClick={() => set({ links: text.links.filter((_, at) => at !== index) })}
                  >
                    {t.remove}
                  </button>
                </div>
              ) : null}
              <div class="field">
                <label class="field__label" for={`${base}-label`}>
                  {t.labelLabel}
                </label>
                <input
                  class="field__input"
                  id={`${base}-label`}
                  type="text"
                  lang={lang}
                  dir={dir}
                  value={link.label}
                  maxLength={limits.episodeLinkLabelMaxChars}
                  readOnly={readOnly}
                  autocomplete="off"
                  aria-invalid={problem === 'needsLabel' ? true : undefined}
                  aria-describedby={problem === 'needsLabel' ? `${base}-problem` : undefined}
                  onInput={(event) => setLink(index, { label: cleanLine((event.currentTarget as HTMLInputElement).value) })}
                />
                {link.label.trim() === '' ? (
                  <span class="chips">
                    {t.chips.map((chip) => (
                      <button type="button" class="btn chip" key={chip} disabled={readOnly} onClick={() => setLink(index, { label: chip })}>
                        {chip}
                      </button>
                    ))}
                  </span>
                ) : null}
              </div>
              <div class="field">
                <label class="field__label" for={`${base}-url`}>
                  {t.addressLabel}
                </label>
                <input
                  class="field__input field__input--code"
                  id={`${base}-url`}
                  type="text"
                  inputMode="url"
                  dir="ltr"
                  value={link.url}
                  placeholder={t.addressPlaceholder}
                  maxLength={limits.episodeLinkUrlMaxChars}
                  readOnly={readOnly}
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck={false}
                  aria-invalid={problem === 'notHttps' ? true : undefined}
                  aria-describedby={problem === 'notHttps' ? `${base}-problem` : undefined}
                  onInput={(event) => setLink(index, { url: cleanLine((event.currentTarget as HTMLInputElement).value) })}
                />
              </div>
              {/* Refused at the field, with the fix built from the person's own text; nothing is added to what they typed. */}
              {problem ? (
                <p class="field__error" id={`${base}-problem`} role="alert">
                  {problem === 'notHttps' ? t.notHttps(httpsSuggestion(link.url)) : t.needsLabel}
                </p>
              ) : null}
            </div>
          );
        })}
        {onlyLink ? <p class="hint">{t.lastLink}</p> : null}
        <button
          type="button"
          class="btn btn--quiet"
          disabled={readOnly || text.links.length >= limits.episodeLinksMax}
          onClick={() => set({ links: [...text.links, { label: '', url: '' }] })}
        >
          {t.addLink}
        </button>
      </fieldset>

      {kept ? <p class="hint">{copy.editor.kept}</p> : null}
      {dock}
    </>
  );
}

/** Put the keyboard at the first row the form refused, so the person lands on the field to fix. */
function focusProblem(idBase: string, problems: Map<number, LinkProblem>): void {
  const [index, problem] = [...problems.entries()][0] ?? [];
  if (index === undefined) return;
  document.getElementById(`${idBase}-link${index}-${problem === 'needsLabel' ? 'label' : 'url'}`)?.focus();
}

// ── A new episode ──

interface NewProps {
  buffers: EpisodeBuffers;
  /** The unsent text the form opens with: set aside text put back, or an unsent episode an edit left behind. */
  initial: UnsentEpisode | null;
  /** Say so: "Back to your unsent episode". */
  restored: boolean;
  /** What an edit that closed into this form did: said above its actions (PL-11). */
  said: Done | null;
  today: string | null;
  /** The form is finished: the server has it, and the section says what happened. */
  onDone: (done: Done) => void;
  onChanged: () => void;
  onSession: (session: SessionInfo) => void;
}

/**
 * New text in the Podcast section. It starts in the language last used, which the server remembers
 * (PD-10), so the language is known before anything is drawn; or in the language of text that was put back.
 */
export function NewEpisode(props: NewProps) {
  const [lang, setLang] = useState<Lang | null>(props.initial?.lang ?? null);
  useEffect(() => {
    if (props.initial) return undefined;
    let live = true;
    void api<Settings>('GET', 'settings').then((result) => {
      // A failed read leaves the default: English is never wrong to start in, only to stay in.
      if (live) setLang(result.ok ? result.data.lastLanguage : 'en');
    });
    return () => {
      live = false;
    };
  }, []);
  return lang === null ? null : <NewForm {...props} initialLang={lang} />;
}

function NewForm({ buffers, initial, restored, said, today, onDone, onChanged, onSession, initialLang }: NewProps & { initialLang: Lang }) {
  const [lang, setLang] = useState<Lang>(initial?.lang ?? initialLang);
  const [text, setText] = useState<EpisodeText>(initial ? { name: initial.name, description: initial.description, tags: initial.tags, date: initial.date, links: initial.links } : emptyText());
  const [snap, setSnap] = useState<Snapshot<UnsentEpisode, EpisodeEdit>>(() => buffers.read());
  const [stored, setStored] = useState(true);
  const [back, setBack] = useState(restored);
  const [problems, setProblems] = useState<Map<number, LinkProblem>>(new Map());
  const [discarding, setDiscarding] = useState<'kept' | 'unsent' | null>(null);
  // What the edit that closed into this form did, said until the person types (PL-11).
  const [saidNote, setSaidNote] = useState<Done | null>(said);
  const writer = useWriter(onSession);
  // The key is made at the first keystroke and kept until the server confirms the episode; the id is the row once there is one (PD-11).
  const key = useRef<string | null>(initial?.key ?? null);
  const rowId = useRef<string | null>(initial?.id ?? null);
  // Whether a request with this key went out and no answer came back: the server may have made the row, in the language it
  // was sent in, so the language is fixed until an answer comes. A new key for a new language would add the episode twice.
  const unanswered = useRef(false);
  const live = useRef({ lang, text });
  live.current = { lang, text };

  const store = (event: Parameters<EpisodeBuffers['apply']>[0]) => {
    const result = buffers.apply(event);
    setSnap(result.snapshot);
    setStored(result.stored);
    return result.snapshot;
  };

  /** Every change is written to the buffer as it is made, before anything else happens. */
  const change = (next: Partial<{ lang: Lang; text: EpisodeText }>) => {
    const merged = { ...live.current, ...next };
    live.current = merged;
    // A composition with nothing in it, and no row, is no composition: it has no key. The first keystroke makes one.
    if (!episodeHasContent(merged.text) && rowId.current === null && !unanswered.current) key.current = null;
    else key.current ??= newKey();
    store({ type: 'typed', unsent: key.current === null ? null : { key: key.current, id: rowId.current, lang: merged.lang, ...merged.text } });
    setBack(false);
    setSaidNote(null);
    setProblems(new Map());
    writer.edited();
    if (next.lang !== undefined) setLang(next.lang);
    if (next.text !== undefined) setText(next.text);
  };

  const write = async (action: 'publish' | 'saveDraft') => {
    const found = linkProblems(live.current.text);
    if (found.size > 0) {
      // Refused at the field, before anything is sent (AC-17): the rest of what was typed stays where it is.
      setProblems(found);
      focusProblem('new-episode', found);
      return;
    }
    key.current ??= newKey();
    const current = live.current;
    const sent = key.current;
    const result = await writer.attempt(action, async () => {
      const answer = await writeNewEpisode({ ...current.text, key: sent, id: rowId.current, lang: current.lang }, action === 'publish', (id) => {
        // The server made a row: from here the text is worked on by its id, and the buffer says so,
        // so a closed tab and a reopened page carry on with the same row.
        rowId.current = id;
        unanswered.current = false;
        store({ type: 'typed', unsent: { key: sent, id, lang: current.lang, ...current.text } });
      });
      // Set before the failure is drawn, so the language control is fixed in the same render.
      if (!answer.ok && UNANSWERED.has(answer.code) && rowId.current === null) unanswered.current = true;
      return answer;
    });
    if (result && !result.ok && result.code === 'DATE_FUTURE') document.getElementById('new-episode-date')?.focus();
    if (!result?.ok) return;
    const episode = result.data.episode;
    onChanged();
    // The server has it, saved or published: only now is the buffer cleared, and the form is done. The next episode starts in the language just used.
    store({ type: 'confirmed' });
    onDone(episode.state === 'published' ? { kind: 'published', lang: episode.lang } : { kind: 'draftSaved' });
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
    const restoredText = { name: next.name, description: next.description, tags: next.tags, date: next.date, links: next.links };
    live.current = { lang: next.lang, text: restoredText };
    setLang(next.lang);
    setText(restoredText);
    setBack(false);
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
      live.current = { lang: live.current.lang, text: emptyText() };
      setText(emptyText());
      setBack(false);
      writer.clear();
    }
  };

  const t = copy.episode;
  const busy = writer.busy;
  const keptTop = snap.kept[snap.kept.length - 1];
  // An edit that closed on success says so here, just above the actions, where a failure is said (PL-11); never both.
  const quiet = busy === null && writer.failure === null && writer.signInProblem === null;
  const dock = (
    <div class="dock">
      <FailureNotice
        writer={writer}
        words={t.failure}
        kept={stored}
        atField="DATE_FUTURE"
        onRetry={() => void write(writer.failure?.action === 'saveDraft' ? 'saveDraft' : 'publish')}
        onSignIn={() => void signInAndRetry()}
      />
      {quiet && saidNote ? <DoneNotice done={saidNote} /> : null}
      <div class="composer__actions">
        <button type="button" class="btn" disabled={busy !== null} onClick={() => void write('saveDraft')}>
          {t.saveDraft}
        </button>
        <button type="button" class="btn btn--primary" disabled={busy !== null} aria-busy={busy === 'publish'} onClick={() => void write('publish')}>
          {busy === 'publish' ? t.publishing : t.publish}
        </button>
      </div>
    </div>
  );

  return (
    <div class="composer" id="new-episode">
      {/* Text found again when the page opened, or set aside while another episode was edited and not yet put back. */}
      {snap.kept.length > 0 ? (
        <Offer head={t.left.head} body={t.left.body} name={keptTop ? <EpisodeName name={keptTop.name} lang={keptTop.lang} /> : undefined}>
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
          row may exist in the language it was sent in and a new key for another would add the episode twice. */}
      <LanguageControl name="episode-language" lang={lang} locked={busy !== null || unanswered.current} onChange={(next) => change({ lang: next })} />
      <Fields
        idBase="new-episode"
        lang={lang}
        text={text}
        onText={(next) => change({ text: next })}
        today={today}
        readOnly={busy !== null}
        published={false}
        problems={problems}
        dateProblem={writer.failure?.code === 'DATE_FUTURE'}
        kept={stored && snap.unsent !== null}
        dock={dock}
      />
      {discarding ? <DiscardDialog onKeep={() => setDiscarding(null)} onDiscard={discard} /> : null}
    </div>
  );
}

// ── An existing episode ──

/** What the last write did, said just above the actions. */
type Note = 'saved' | 'draftSaved' | 'unpublished' | 'published' | 'republished';

interface FrameProps {
  id: string;
  buffers: EpisodeBuffers;
  /** Changes left in the edit buffer by an earlier visit, offered back and chosen: they are put over the episode. */
  resume: EpisodeEdit | null;
  /** Unsent text was set aside when this edit opened, and comes back when it ends (AC-43). */
  keptNote: boolean;
  today: string | null;
  /** The person asked to leave. The section decides, because it can see whether there are unsaved changes. */
  onCancel: () => void;
  /** The edit is done (saved or published) and set-aside text came back: the section closes the frame and says what was done. */
  onDone: (done: Done) => void;
  onChanged: () => void;
  onSession: (session: SessionInfo) => void;
  /** Whether the form holds changes the server doesn't have. */
  onDirty: (dirty: boolean) => void;
}

/**
 * The edit view's frame, in the section (plate 11). Its header says what is being edited: a published
 * episode, a draft that was live, or a plain draft. The fields are in the episode's own language (an edit
 * never changes it). A published episode can be saved or unpublished, after one confirmation and no
 * reason asked; a draft can be saved or published, and one that was live says where it will return
 * before it does, and again after.
 */
export function EpisodeFrame(props: FrameProps) {
  const { id, onCancel } = props;
  const [episode, setEpisode] = useState<EpisodeDetail | null>(null);
  const [loadFailed, setLoadFailed] = useState<Code | null>(null);
  const status = useRef<HTMLParagraphElement>(null);

  const load = async () => {
    setLoadFailed(null);
    const result = await api<{ episode: EpisodeDetail }>('GET', `episodes/${encodeURIComponent(id)}`);
    if (result.ok) setEpisode(result.data.episode);
    else setLoadFailed(result.code);
  };
  useEffect(() => void load(), [id]);

  // The frame appears above the list the person was reading: put the keyboard and the screen reader at its top.
  useEffect(() => status.current?.focus(), [episode === null]);

  if (loadFailed) {
    return (
      <section class="frame" aria-label={copy.episode.loading}>
        <Notice kind="error">{loadFailed === 'NOT_FOUND' ? refusals.NOT_FOUND : copy.episode.loadFailed}</Notice>
        <div class="actions">
          <button type="button" class="btn" onClick={() => void load()}>
            {copy.episode.retry}
          </button>
          <button type="button" class="btn btn--quiet" onClick={onCancel}>
            {copy.episode.cancel}
          </button>
        </div>
      </section>
    );
  }

  if (!episode) {
    return (
      <section class="frame" aria-busy="true">
        <p class="frame__status" tabIndex={-1} ref={status}>
          {copy.episode.loading}
        </p>
      </section>
    );
  }

  return <EditForm {...props} loaded={episode} statusRef={status} />;
}

function EditForm({
  loaded,
  statusRef,
  buffers,
  resume,
  keptNote,
  today,
  onCancel,
  onDone,
  onChanged,
  onSession,
  onDirty,
}: FrameProps & { loaded: EpisodeDetail; statusRef: { current: HTMLParagraphElement | null } }) {
  // What the server says about the episode changes as it is published and unpublished; the text is the person's.
  const [episode, setEpisode] = useState(loaded);
  const [text, setText] = useState<EpisodeText>(resume ? { name: resume.name, description: resume.description, tags: resume.tags, date: resume.date, links: resume.links } : textOf(loaded));
  // A never-published episode may change its language (PL-8). A buffer from before PL1 has none: it reads as "unchanged", the row's own.
  const [lang, setLang] = useState<Lang>(loaded.firstPublishedAt === null ? (resume?.lang ?? loaded.lang) : loaded.lang);
  // The text as the server has it, so "unsaved" means a difference from it, and a change put back isn't one.
  const [base, setBase] = useState(() => signature(textOf(loaded), loaded.lang));
  const [stored, setStored] = useState(true);
  const [note, setNote] = useState<Note | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [problems, setProblems] = useState<Map<number, LinkProblem>>(new Map());
  const writer = useWriter(onSession);
  const live = useRef({ text, lang, episode, base });
  live.current = { text, lang, episode, base };
  // Once published, an episode keeps its language: the page, the feed and the link have carried it (AC-14).
  const mayChangeLanguage = episode.firstPublishedAt === null;

  const dirty = signature(text, lang) !== base;
  useEffect(() => onDirty(dirty), [dirty]);

  const day = (date: string) => formatDay(date, 'en');
  const header =
    episode.state === 'published' ? copy.episode.editingPublished(day(episode.date)) : episode.wasLive ? copy.episode.draftWasLive(day(episode.date)) : copy.episode.draft;

  /** Every change is written to the edit buffer as it is made, for as long as it differs from the episode. */
  const change = (changed: EpisodeText, nextLang: Lang = live.current.lang) => {
    // A cleared date is sent as none, and the server keeps the episode's own (`updateEpisode`). The field shows
    // that date again, so what is on screen is what a save keeps, rather than falling back to today.
    const next = changed.date === '' ? { ...changed, date: live.current.episode.date } : changed;
    live.current = { ...live.current, text: next, lang: nextLang };
    const differs = signature(next, nextLang) !== live.current.base;
    const result = buffers.apply(differs ? { type: 'edit-typed', edit: { id: loaded.id, ...next, lang: nextLang } } : { type: 'discarded', which: 'edit' });
    setStored(result.stored);
    setProblems(new Map());
    writer.edited();
    // Saying "Saved" or "Published" about text that has changed since would be wrong; what the server did to the episode's state stays true.
    setNote((current) => (current === 'unpublished' ? current : null));
    setText(next);
    setLang(nextLang);
  };

  const run = async (action: Action) => {
    if (action !== 'unpublish') {
      const found = linkProblems(live.current.text);
      if (found.size > 0) {
        // Refused at the field, before anything is sent (AC-17).
        setProblems(found);
        focusProblem('edit-episode', found);
        return;
      }
    }
    const before = live.current.episode;
    const sent = live.current.text;
    // The language goes only for an episode that may still change it; the server refuses it for any other (LANG_FIXED).
    const sentLang = before.firstPublishedAt === null ? live.current.lang : undefined;
    const result = await writer.attempt(action, () => (action === 'unpublish' ? unpublishEpisode(before.id) : writeEditEpisode(before.id, sent, action === 'publish', sentLang)));
    if (result && !result.ok && result.code === 'DATE_FUTURE') document.getElementById('edit-episode-date')?.focus();
    if (!result?.ok) return;
    const next = result.data.episode;
    setEpisode(next);
    onChanged();
    if (action === 'unpublish') return setNote('unpublished');
    // The server has the text: the edit buffer is cleared, and what is unsaved is measured from here.
    const savedBase = signature(sent, next.lang);
    setBase(savedBase);
    live.current = { ...live.current, lang: next.lang, base: savedBase, episode: next };
    const keptBefore = buffers.read().kept.length > 0;
    const after = buffers.apply({ type: 'edit-confirmed' });
    setStored(after.stored);
    const done: Note = action === 'publish' ? (before.wasLive ? 'republished' : 'published') : next.state === 'published' ? 'saved' : 'draftSaved';
    setNote(done);
    // Set-aside text comes back when the edit is done (AC-43): the frame closes, and says what it did.
    if (keptBefore) {
      onDone(done === 'saved' ? { kind: 'saved' } : done === 'draftSaved' ? { kind: 'draftSaved' } : done === 'republished' ? { kind: 'republished', date: next.date } : { kind: 'published', lang: next.lang });
    }
  };

  const signInAndRetry = async () => {
    const action = writer.failure?.action;
    if (!action) return;
    if (await writer.signInHere()) await run(action);
  };

  const t = copy.episode;
  const busy = writer.busy;
  const republished = t.republished(day(episode.date));
  // What the last write did is said just above the actions, where a failure is said (PL-11). Never both, and nothing about a write still out.
  const quiet = busy === null && writer.failure === null && writer.signInProblem === null;
  const success = !quiet ? null : note === 'saved' ? (
    <Said head={t.savedLive.head} body={t.savedLive.body} />
  ) : note === 'draftSaved' ? (
    <Said head={t.savedDraft.head} body={t.savedDraft.body} />
  ) : note === 'unpublished' ? (
    <Notice kind="success">{t.unpublished}</Notice>
  ) : note === 'republished' ? (
    // A draft that was live returns at its date, which it names (plate 12); a first publish says where it is.
    <Said head={republished.head} body={republished.body} />
  ) : note === 'published' ? (
    <PublishedNotice path={localePath(episode.lang, '/podcast')} head={t.published.head} />
  ) : null;
  const dock = (
    <div class="dock">
      {episode.wasLive ? (
        <p class="frame__notice">
          {t.republish.before}
          <mark>{day(episode.date)}</mark>
          {t.republish.after}
        </p>
      ) : null}
      <FailureNotice
        writer={writer}
        words={t.failure}
        kept={stored}
        atField="DATE_FUTURE"
        onRetry={() => void (writer.failure && run(writer.failure.action))}
        onSignIn={() => void signInAndRetry()}
      />
      {success}
      <div class="composer__actions">
        {episode.state === 'published' ? (
          <>
            <button type="button" class="btn" disabled={busy !== null} onClick={() => setConfirming(true)}>
              {busy === 'unpublish' ? t.unpublishing : t.unpublish}
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
    </div>
  );

  return (
    <section class="frame" aria-label={header}>
      <div class="frame__bar">
        <p class="frame__status" tabIndex={-1} ref={statusRef}>
          {header}
        </p>
        <button type="button" class="text-btn" onClick={onCancel}>
          {t.cancel}
        </button>
      </div>
      {keptNote ? <Offer head={t.keptNote.head} body={t.keptNote.body} /> : null}
      {/* Shown while the episode has never been published (PL-8): a published or was-live episode keeps its language. */}
      {mayChangeLanguage ? <LanguageControl name="edit-episode-language" lang={lang} locked={busy !== null} onChange={(next) => change(live.current.text, next)} /> : null}
      <Fields
        idBase="edit-episode"
        lang={lang}
        text={text}
        onText={(next) => change(next)}
        today={today}
        readOnly={busy !== null}
        published={episode.state === 'published'}
        problems={problems}
        dateProblem={writer.failure?.code === 'DATE_FUTURE'}
        kept={stored && dirty}
        dock={dock}
      />
      {confirming ? (
        <Modal titleId="unpublish-episode-title" onCancel={() => setConfirming(false)}>
          <h2 class="modal__title" id="unpublish-episode-title">
            {t.confirm.title}
          </h2>
          <p class="modal__body">{t.confirm.body}</p>
          <div class="modal__actions">
            <button type="button" class="btn" onClick={() => setConfirming(false)}>
              {t.confirm.keep}
            </button>
            <button
              type="button"
              class="btn"
              onClick={() => {
                setConfirming(false);
                void run('unpublish');
              }}
            >
              {t.confirm.unpublish}
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

/** The dialog the section shows when a person would leave an edit that holds changes the server doesn't have. */
export function LeaveDialog({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  const t = copy.episode.leaveDialog;
  return (
    <Modal titleId="leave-episode-title" onCancel={onStay}>
      <h2 class="modal__title" id="leave-episode-title">
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
 * The offer for changes left in the edit buffer when the page opened: put them back, or discard (asking once more). It
 * names the episode the changes are to (PL-7). A buffer from before PL1 has no language, and the episode isn't read yet,
 * so the language of its words stands in for it.
 */
export function EditOffer({ edit, onPut, onDiscard }: { edit: EpisodeEdit; onPut: () => void; onDiscard: () => void }) {
  const t = copy.episode.leftEdit;
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Offer head={t.head} body={t.body} name={<EpisodeName name={edit.name} lang={edit.lang ?? guessLang(edit.name)} />}>
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

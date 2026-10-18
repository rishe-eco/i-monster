// The Podcast section (plan B7, plates 11 and 12): New episode, then the list of episodes, collapsed until
// it is opened like Entries. A row has a date, a name, its pills and Edit, and nothing else: no count, no
// total, no "n of m" (house rule 1, W2). The form opens in the section, in place of the New episode button
// (new) or above the list (edit): `episode-form.tsx`.
//
// This section owns the episode buffers (PD-12). The page has just opened, so unsent text found there is set
// aside and offered back, and so are changes left in an edit (AC-43, J3.3): the section opens itself when
// there is something to offer, so the offer is never hidden in a collapsed list.
import { useEffect, useRef, useState } from 'preact/hooks';
import { formatAdminListDay } from '../lib/dates.ts';
import { api, type Code, type EpisodeRow, type EpisodesPage, type SessionInfo } from './api.ts';
import { browserStorage } from './browser-storage.ts';
import { createBuffers, type EpisodeEdit, type UnsentEpisode } from './buffers.ts';
import { copy, refusals } from './copy.ts';
import { Runs } from './doc.tsx';
import { DoneNotice, EditOffer, EpisodeFrame, EpisodeName, LeaveDialog, NewEpisode, type Done } from './episode-form.tsx';
import { Notice } from './ui.tsx';
import { DiscardDialog, Offer } from './writer.tsx';

interface Page {
  rows: EpisodeRow[];
  olderBefore: string | null;
  today: string;
}

/** What a row is called: its name, or the words that say it has none yet. */
const nameOf = (row: EpisodeRow) => row.name ?? copy.podcast.noName;

function Row({ row, today, onEdit }: { row: EpisodeRow; today: string; onEdit: (id: string) => void }) {
  // A draft that was never published has no date; one that was live keeps the date it will return to (AC-14).
  const date = row.firstPublishedAt === null ? copy.podcast.noDate : formatAdminListDay(row.date, today);
  return (
    <li class="entry-row">
      <span class="entry-row__date">{date}</span>
      {/* The name is in the episode's own language and direction, whatever the admin's (AC-42). */}
      <span class={row.name === null ? 'entry-row__name entry-row__name--opening' : 'entry-row__name'} lang={row.lang} dir={row.lang === 'fa' ? 'rtl' : 'ltr'}>
        {row.name === null ? copy.podcast.noName : <Runs text={row.name} lang={row.lang} />}
      </span>
      <span class="entry-row__pills">
        {row.state === 'draft' && !row.wasLive ? <span class="pill pill--dashed">{copy.podcast.draft}</span> : null}
        {row.wasLive ? <span class="pill pill--dashed">{copy.podcast.wasLive}</span> : null}
        {row.lang === 'fa' ? <span class="pill">{copy.podcast.persian}</span> : null}
      </span>
      <button type="button" class="text-btn" aria-label={copy.podcast.editing(nameOf(row))} onClick={() => onEdit(row.id)}>
        {copy.podcast.edit}
      </button>
    </li>
  );
}

/** What is open in the form's place: nothing, a new episode, or an episode being edited. */
type Form =
  | null
  | { kind: 'new'; initial: UnsentEpisode | null; restored: boolean; said: Done | null }
  | { kind: 'edit'; id: string; resume: EpisodeEdit | null; keptNote: boolean };

export function PodcastSection({ onSession }: { onSession: (session: SessionInfo) => void }) {
  const [buffers] = useState(() => createBuffers(browserStorage(), 'episode'));
  // The page has just opened: unsent text in the buffer is set aside, and offered back (J3.3).
  const [opened] = useState(() => buffers.apply({ type: 'opened' }).snapshot);
  const [editOffer, setEditOffer] = useState<EpisodeEdit | null>(opened.edit);
  const [open, setOpen] = useState(opened.kept.length > 0 || opened.edit !== null);
  const [form, setForm] = useState<Form>(null);
  const [said, setSaid] = useState<Done | null>(null);
  const [discarding, setDiscarding] = useState(false);
  // Counts the times set-aside text was discarded, so the offer, which is drawn from the buffer, is drawn again.
  const [, setDiscardedKept] = useState(0);
  // An action that would leave an edit with unsaved changes waits here for the person's word.
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const unsaved = useRef(false);

  const [page, setPage] = useState<Page | null>(null);
  const [changed, setChanged] = useState(0);
  const [loadFailed, setLoadFailed] = useState<Code | null>(null);
  const [olderFailed, setOlderFailed] = useState<Code | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const load = async () => {
    const result = await api<EpisodesPage>('GET', 'episodes');
    if (result.ok) {
      setPage({ rows: result.data.episodes, olderBefore: result.data.olderBefore, today: result.data.today });
      setLoadFailed(null);
    } else {
      setLoadFailed(result.code);
    }
  };

  // The list is read when it is opened, and again when the form changed an episode. A collapsed list asks for nothing.
  useEffect(() => {
    if (open) void load();
  }, [open, changed]);

  const older = async () => {
    if (!page?.olderBefore) return;
    setLoadingOlder(true);
    setOlderFailed(null);
    const result = await api<EpisodesPage>('GET', `episodes?before=${encodeURIComponent(page.olderBefore)}`);
    setLoadingOlder(false);
    if (!result.ok) {
      setOlderFailed(result.code);
      return;
    }
    const next = result.data;
    setPage({ rows: [...page.rows, ...next.episodes], olderBefore: next.olderBefore, today: next.today });
  };

  /** Run `then` now, or after the person has said they mean to leave changes that are not saved. */
  const guard = (then: () => void) => {
    if (form?.kind === 'edit' && unsaved.current) setLeaving(() => then);
    else then();
  };

  const startNew = () => {
    setSaid(null);
    setForm({ kind: 'new', initial: buffers.read().unsent, restored: false, said: null });
  };

  const startEdit = (id: string, resume: EpisodeEdit | null = null) => {
    // Unsent text, if there is any, is set aside before the episode opens, and says so (AC-43).
    const snapshot = buffers.apply({ type: 'edit-started' }).snapshot;
    unsaved.current = false;
    setSaid(null);
    setForm({ kind: 'edit', id, resume, keptNote: snapshot.kept.length > 0 });
  };

  /** The edit is over. What was set aside comes back, in a new form that says so; otherwise the form just closes. */
  const closeFrame = () => {
    const snapshot = buffers.apply({ type: 'edit-cancelled' }).snapshot;
    unsaved.current = false;
    setForm(snapshot.unsent ? { kind: 'new', initial: snapshot.unsent, restored: true, said: null } : null);
  };

  const putBack = () => {
    const snapshot = buffers.apply({ type: 'restored' }).snapshot;
    if (snapshot.unsent) setForm({ kind: 'new', initial: snapshot.unsent, restored: true, said: null });
  };

  const discardKept = () => {
    setDiscarding(false);
    // The offer is drawn from what the buffer holds, so it goes when the last set-aside text does.
    buffers.apply({ type: 'discarded', which: 'kept' });
    setDiscardedKept((n) => n + 1);
  };

  const done = (note: Done) => {
    unsaved.current = false;
    // What the form was waiting for is confirmed; what an edit set aside comes back as a new form.
    const returned = buffers.read().unsent;
    setForm(returned ? { kind: 'new', initial: returned, restored: true, said: note } : null);
    setSaid(note);
  };

  // What a closed form said sits directly above New episode. With the form gone the page is shorter and may
  // have been scrolled past it, so the button, and the notice over it, are brought into view (PL-11).
  const newEpisodeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (said && form === null) newEpisodeButton.current?.scrollIntoView({ block: 'end' });
  }, [said, form === null]);

  const today = page?.today ?? null;
  // Drawn from the buffer, not from a copy of it: the form can discard or put back what is set aside too.
  const kept = buffers.read().kept;
  const hasKept = kept.length > 0;
  // Put it back restores the last one set aside, and the offer names it (PL-7).
  const keptTop = kept[kept.length - 1];

  return (
    <section class="section" aria-labelledby="podcast-heading">
      <h2 class="section__heading" id="podcast-heading">
        <button type="button" class="disclosure" aria-expanded={open} aria-controls="podcast-body" onClick={() => setOpen(!open)}>
          <span>{copy.podcast.title}</span>
          <span aria-hidden="true">{open ? '−' : '+'}</span>
        </button>
      </h2>
      <div id="podcast-body" hidden={!open}>
        {/* What was left here when the page opened: unsent text, and changes to an episode. Nothing is dropped without a word (AC-43). */}
        {hasKept && form === null ? (
          <Offer
            head={copy.episode.left.head}
            body={copy.episode.left.body}
            name={keptTop ? <EpisodeName name={keptTop.name} lang={keptTop.lang} /> : undefined}
          >
            <button type="button" class="btn" onClick={putBack}>
              {copy.episode.left.put}
            </button>
            <button type="button" class="btn" onClick={() => setDiscarding(true)}>
              {copy.episode.left.discard}
            </button>
          </Offer>
        ) : null}
        {editOffer && form?.kind !== 'edit' ? (
          <EditOffer
            edit={editOffer}
            onPut={() => {
              setEditOffer(null);
              startEdit(editOffer.id, editOffer);
            }}
            onDiscard={() => {
              buffers.apply({ type: 'discarded', which: 'edit' });
              setEditOffer(null);
            }}
          />
        ) : null}

        {form?.kind === 'new' ? (
          <NewEpisode
            key={form.initial?.key ?? 'blank'}
            buffers={buffers}
            initial={form.initial}
            restored={form.restored}
            said={form.said}
            today={today}
            onDone={done}
            onChanged={() => setChanged((n) => n + 1)}
            onSession={onSession}
          />
        ) : null}
        {form?.kind === 'edit' ? (
          <EpisodeFrame
            key={form.id}
            id={form.id}
            buffers={buffers}
            resume={form.resume}
            keptNote={form.keptNote}
            today={today}
            onCancel={() => guard(closeFrame)}
            onDone={done}
            onChanged={() => setChanged((n) => n + 1)}
            onSession={onSession}
            onDirty={(dirty) => {
              unsaved.current = dirty;
            }}
          />
        ) : null}
        {form === null ? (
          <>
            {/* What a form that closed did is said directly above New episode, where a failure would be (PL-11). */}
            {said ? <DoneNotice done={said} /> : null}
            <button type="button" class="btn btn--primary episode-new" ref={newEpisodeButton} onClick={startNew}>
              {copy.podcast.newEpisode}
            </button>
          </>
        ) : null}

        {loadFailed ? (
          <div>
            <Notice kind="error">{copy.podcast.loadFailed}</Notice>
            <button type="button" class="btn" onClick={() => void load()}>
              {copy.podcast.retry}
            </button>
          </div>
        ) : null}

        {page && page.rows.length === 0 ? <p class="hint">{copy.podcast.empty}</p> : null}

        {page && page.rows.length > 0 ? (
          <ul class="entry-list">
            {page.rows.map((row) => (
              <Row key={row.id} row={row} today={page.today} onEdit={(id) => guard(() => startEdit(id))} />
            ))}
          </ul>
        ) : null}

        {olderFailed ? <Notice kind="error">{refusals[olderFailed]}</Notice> : null}
        {page?.olderBefore ? (
          <div class="entry-older">
            <button type="button" class="btn" disabled={loadingOlder} onClick={() => void older()}>
              {copy.podcast.older}
            </button>
          </div>
        ) : null}
      </div>
      {discarding ? <DiscardDialog onKeep={() => setDiscarding(false)} onDiscard={discardKept} /> : null}
      {leaving ? (
        <LeaveDialog
          onStay={() => setLeaving(null)}
          onLeave={() => {
            const then = leaving;
            setLeaving(null);
            // The changes are dropped by the person's own word, the one way an edit's text is ever let go.
            buffers.apply({ type: 'discarded', which: 'edit' });
            unsaved.current = false;
            then();
          }}
        />
      ) : null}
    </section>
  );
}

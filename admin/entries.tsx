// The Entries section and the edit view's frame (plate 8, plan B5). The list is
// collapsed until it is opened; a row has a date, a name, its pills and Edit, and
// nothing else: no count, no total, no "n of m" (house rule 1, W2). Edit opens the
// frame in the editor's slot above. The frame shows the title and body read-only
// and carries Unpublish or Publish; B6 puts the editor into the same frame.
import { useEffect, useRef, useState } from 'preact/hooks';
import { formatAdminDay, formatAdminListDate } from '../lib/dates.ts';
import { localePath } from '../lib/i18n.ts';
import { api, type Code, type EntriesPage, type EntryDetail, type EntryRow } from './api.ts';
import { copy, refusals } from './copy.ts';
import { DocView, Runs } from './doc.tsx';
import { Modal, Notice, siteTimeZone } from './ui.tsx';

interface Page {
  rows: EntryRow[];
  olderBefore: string | null;
  now: number;
}

/** What a row is called: its title, or its opening words in quotes. */
const nameOf = (row: EntryRow) => row.title ?? copy.entries.opening(row.excerpt, row.lang);

function Row({ row, now, zone, onEdit }: { row: EntryRow; now: number; zone: string; onEdit: (id: string) => void }) {
  // A draft that was never published has no date; one that was live keeps the date it will return to (AC-14).
  const date = row.firstPublishedAt === null ? copy.entries.noDate : formatAdminListDate(row.firstPublishedAt, now, zone);
  return (
    <li class="entry-row">
      <span class="entry-row__date">{date}</span>
      {/* The name is in the entry's own language and direction, whatever the admin's (AC-42). */}
      <span class={row.title === null ? 'entry-row__name entry-row__name--opening' : 'entry-row__name'} lang={row.lang} dir={row.lang === 'fa' ? 'rtl' : 'ltr'}>
        {row.title === null ? <Runs text={copy.entries.opening(row.excerpt, row.lang)} lang={row.lang} /> : <Runs text={row.title} lang={row.lang} />}
      </span>
      <span class="entry-row__pills">
        {row.state === 'draft' && !row.wasLive ? <span class="pill pill--dashed">{copy.entries.draft}</span> : null}
        {row.wasLive ? <span class="pill pill--dashed">{copy.entries.wasLive}</span> : null}
        {row.lang === 'fa' ? <span class="pill">{copy.entries.persian}</span> : null}
      </span>
      <button type="button" class="text-btn" aria-label={copy.entries.editing(nameOf(row))} onClick={() => onEdit(row.id)}>
        {copy.entries.edit}
      </button>
    </li>
  );
}

export function EntriesSection({ onEdit, refreshKey }: { onEdit: (id: string) => void; refreshKey: number }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<Page | null>(null);
  const [loadFailed, setLoadFailed] = useState<Code | null>(null);
  const [olderFailed, setOlderFailed] = useState<Code | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const load = async () => {
    const result = await api<EntriesPage>('GET', 'entries');
    if (result.ok) {
      setPage({ rows: result.data.entries, olderBefore: result.data.olderBefore, now: result.data.now });
      setLoadFailed(null);
    } else {
      setLoadFailed(result.code);
    }
  };

  // The list is read when it is opened, and again when the frame changed an entry. A collapsed list asks for nothing.
  useEffect(() => {
    if (open) void load();
  }, [open, refreshKey]);

  const older = async () => {
    if (!page?.olderBefore) return;
    setLoadingOlder(true);
    setOlderFailed(null);
    const result = await api<EntriesPage>('GET', `entries?before=${encodeURIComponent(page.olderBefore)}`);
    setLoadingOlder(false);
    if (!result.ok) {
      setOlderFailed(result.code);
      return;
    }
    const next = result.data;
    setPage({ rows: [...page.rows, ...next.entries], olderBefore: next.olderBefore, now: next.now });
  };

  const zone = siteTimeZone();

  return (
    <section class="section" aria-labelledby="entries-heading">
      <h2 class="section__heading" id="entries-heading">
        <button type="button" class="disclosure" aria-expanded={open} aria-controls="entries-body" onClick={() => setOpen(!open)}>
          <span>{copy.entries.title}</span>
          <span aria-hidden="true">{open ? '−' : '+'}</span>
        </button>
      </h2>
      <div id="entries-body" hidden={!open}>
        {loadFailed ? (
          <div>
            <Notice kind="error">{copy.entries.loadFailed}</Notice>
            <button type="button" class="btn" onClick={() => void load()}>
              {copy.entries.retry}
            </button>
          </div>
        ) : null}

        {page && page.rows.length === 0 ? <p class="hint">{copy.entries.empty}</p> : null}

        {page && page.rows.length > 0 ? (
          <ul class="entry-list">
            {page.rows.map((row) => (
              <Row key={row.id} row={row} now={page.now} zone={zone} onEdit={onEdit} />
            ))}
          </ul>
        ) : null}

        {olderFailed ? <Notice kind="error">{refusals[olderFailed]}</Notice> : null}
        {page?.olderBefore ? (
          <div class="entry-older">
            <button type="button" class="btn" disabled={loadingOlder} onClick={() => void older()}>
              {copy.entries.older}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

type Message = { kind: 'success' | 'error'; text: string; open?: string };

/**
 * The edit view's frame, in the editor's slot (plate 8). Its header says what is
 * being edited: a published entry, a draft that was live, or a plain draft. The
 * text is read-only until B6. A published entry can be unpublished, after one
 * confirmation and no reason asked (F19, AC-14); a draft that was live says where
 * it will return before it is published, and again after (G9, AC-34).
 */
export function EntryFrame({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [entry, setEntry] = useState<EntryDetail | null>(null);
  const [loadFailed, setLoadFailed] = useState<Code | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState<'unpublish' | 'publish' | null>(null);
  const [confirming, setConfirming] = useState(false);
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

  const zone = siteTimeZone();
  const day = (instant: number) => formatAdminDay(instant, zone);

  const change = async (action: 'unpublish' | 'publish') => {
    setConfirming(false);
    setMessage(null);
    setBusy(action);
    const result = await api<{ entry: EntryDetail }>('POST', `entries/${encodeURIComponent(id)}/${action}`, {});
    setBusy(null);
    if (!result.ok) {
      setMessage({ kind: 'error', text: refusals[result.code] });
      return;
    }
    const next = result.data.entry;
    setEntry(next);
    if (action === 'unpublish') {
      setMessage({ kind: 'success', text: copy.entry.unpublished });
    } else {
      // The date it came back at: the original one, which the server kept (AC-34).
      setMessage({ kind: 'success', text: copy.entry.published(day(next.firstPublishedAt ?? 0)), open: localePath(next.lang, `/log/${next.id}`) });
    }
    onChanged();
  };

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

  const first = entry.firstPublishedAt;
  const header =
    entry.state === 'published' && first !== null
      ? copy.entry.editingPublished(day(first))
      : entry.wasLive && first !== null
        ? copy.entry.draftWasLive(day(first))
        : copy.entry.draft;

  return (
    <section class="frame" aria-label={header}>
      <div class="frame__bar">
        <p class="frame__status" tabIndex={-1} ref={status}>
          {header}
        </p>
        <button type="button" class="text-btn" onClick={onClose}>
          {copy.entry.cancel}
        </button>
      </div>

      {/* Read-only until B6: the editor takes this place, and Save arrives with it. */}
      {entry.title !== null ? (
        <p class="frame__title" lang={entry.lang} dir={entry.lang === 'fa' ? 'rtl' : 'ltr'} role="group" aria-label={copy.entry.titleLabel}>
          <Runs text={entry.title} lang={entry.lang} />
        </p>
      ) : null}
      <DocView doc={entry.body} lang={entry.lang} label={copy.entry.bodyLabel} />

      {entry.wasLive && first !== null ? (
        <p class="frame__notice">
          {copy.entry.republish.before}
          <mark>{day(first)}</mark>
          {copy.entry.republish.after}
        </p>
      ) : null}

      <div class="frame__actions">
        {entry.state === 'published' ? (
          <button type="button" class="btn" disabled={busy !== null} onClick={() => setConfirming(true)}>
            {busy === 'unpublish' ? copy.entry.unpublishing : copy.entry.unpublish}
          </button>
        ) : null}
        {/* A draft that was live can go back; a draft that never was is published from B6's editor. */}
        {entry.state === 'draft' && entry.wasLive ? (
          <button type="button" class="btn btn--primary btn--solid" disabled={busy !== null} onClick={() => void change('publish')}>
            {busy === 'publish' ? copy.entry.publishing : copy.entry.publish}
          </button>
        ) : null}
      </div>

      {message ? (
        <Notice kind={message.kind}>
          {message.open ? (
            <>
              <strong>{message.text}</strong> <a href={message.open}>{copy.entry.open}</a>
            </>
          ) : (
            message.text
          )}
        </Notice>
      ) : null}

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
            <button type="button" class="btn" onClick={() => void change('unpublish')}>
              {copy.entry.confirm.unpublish}
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

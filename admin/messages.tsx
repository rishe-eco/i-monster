// The Messages section (change note 08, CT-8): what visitors sent through the contact form, newest first. It is
// collapsed until opened, like Entries. A message shows its subject, how to reach the sender, the text, the
// language of the page it came from and its date, and Delete behind a confirmation. No count, no total, no
// "new" badge, no read state (house rule 1): the list is the messages and nothing about them.
import { useEffect, useRef, useState } from 'preact/hooks';
import { formatAdminDate } from '../lib/dates.ts';
import { api, type Code, type MessageRow, type MessagesPage } from './api.ts';
import { copy, refusals } from './copy.ts';
import { Runs } from './doc.tsx';
import { Modal, Notice, siteTimeZone } from './ui.tsx';

interface Page {
  rows: MessageRow[];
  olderBefore: string | null;
  now: number;
}

function Row({ row, now, zone, onDelete }: { row: MessageRow; now: number; zone: string; onDelete: (row: MessageRow) => void }) {
  const dir = row.lang === 'fa' ? 'rtl' : 'ltr';
  return (
    <li class="message">
      {/* The subject and the text are in the language of the page they were sent from, whatever the admin's (AC-42). */}
      <p class="message__subject" lang={row.lang} dir={dir}>
        <Runs text={row.subject} lang={row.lang} />
      </p>
      {/* The admin is English and Gregorian whatever the message's language (AC-31). `bdi` isolates what the sender typed. */}
      <p class="message__meta">
        {copy.messages.lang[row.lang]} · {formatAdminDate(row.receivedAt, now, zone)} · {copy.messages.reach} <bdi>{row.reach}</bdi>
      </p>
      <p class="message__text" lang={row.lang} dir={dir}>
        <Runs text={row.message} lang={row.lang} />
      </p>
      <button type="button" class="btn message__delete" aria-label={copy.messages.deleteNamed(row.subject)} onClick={() => onDelete(row)}>
        {copy.messages.delete}
      </button>
    </li>
  );
}

export function MessagesSection() {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<Page | null>(null);
  const [loadFailed, setLoadFailed] = useState<Code | null>(null);
  const [olderFailed, setOlderFailed] = useState<Code | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // The message the confirmation is about, and what the delete itself did.
  const [confirming, setConfirming] = useState<MessageRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState<Code | null>(null);
  const heading = useRef<HTMLButtonElement>(null);

  const load = async () => {
    const result = await api<MessagesPage>('GET', 'messages');
    if (result.ok) {
      setPage({ rows: result.data.messages, olderBefore: result.data.olderBefore, now: result.data.now });
      setLoadFailed(null);
    } else {
      setLoadFailed(result.code);
    }
  };

  // The list is read when it is opened. A collapsed list asks for nothing.
  useEffect(() => {
    if (open) void load();
  }, [open]);

  const older = async () => {
    if (!page?.olderBefore) return;
    setLoadingOlder(true);
    setOlderFailed(null);
    const result = await api<MessagesPage>('GET', `messages?before=${encodeURIComponent(page.olderBefore)}`);
    setLoadingOlder(false);
    if (!result.ok) {
      setOlderFailed(result.code);
      return;
    }
    const next = result.data;
    setPage({ rows: [...page.rows, ...next.messages], olderBefore: next.olderBefore, now: next.now });
  };

  const confirmDelete = async () => {
    if (!confirming) return;
    setDeleting(true);
    setDeleteFailed(null);
    const result = await api('DELETE', `messages/${encodeURIComponent(confirming.id)}`);
    setDeleting(false);
    // A message that is already gone is what Delete wanted: the list is read again and the dialog closes.
    if (!result.ok && result.code !== 'NOT_FOUND') {
      setDeleteFailed(result.code);
      setConfirming(null);
      return;
    }
    setConfirming(null);
    await load();
    // The Delete button that had focus is gone, so focus goes to the section's own button rather than to the page's top.
    heading.current?.focus();
  };

  const zone = siteTimeZone();

  return (
    <section class="section" aria-labelledby="messages-heading">
      <h2 class="section__heading" id="messages-heading">
        <button type="button" class="disclosure" aria-expanded={open} aria-controls="messages-body" ref={heading} onClick={() => setOpen(!open)}>
          <span>{copy.messages.title}</span>
          <span aria-hidden="true">{open ? '−' : '+'}</span>
        </button>
      </h2>
      <div id="messages-body" hidden={!open}>
        {loadFailed ? (
          <div>
            <Notice kind="error">{copy.messages.loadFailed}</Notice>
            <button type="button" class="btn" onClick={() => void load()}>
              {copy.messages.retry}
            </button>
          </div>
        ) : null}

        {deleteFailed ? <Notice kind="error">{refusals[deleteFailed]}</Notice> : null}

        {page && page.rows.length === 0 ? <p class="hint">{copy.messages.empty}</p> : null}

        {page && page.rows.length > 0 ? (
          <ul class="message-list">
            {page.rows.map((row) => (
              <Row key={row.id} row={row} now={page.now} zone={zone} onDelete={(r) => setConfirming(r)} />
            ))}
          </ul>
        ) : null}

        {olderFailed ? <Notice kind="error">{refusals[olderFailed]}</Notice> : null}
        {page?.olderBefore ? (
          <div class="entry-older">
            <button type="button" class="btn" disabled={loadingOlder} onClick={() => void older()}>
              {copy.messages.older}
            </button>
          </div>
        ) : null}
      </div>
      {confirming ? (
        <Modal titleId="delete-message-title" locked={deleting} onCancel={() => setConfirming(null)}>
          <h2 class="modal__title" id="delete-message-title">
            {copy.messages.confirm.title}
          </h2>
          <div class="modal__actions">
            <button type="button" class="btn" disabled={deleting} onClick={() => setConfirming(null)}>
              {copy.messages.confirm.keep}
            </button>
            <button type="button" class="btn" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting ? copy.messages.deleting : copy.messages.confirm.delete}
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

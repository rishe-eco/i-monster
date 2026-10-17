// The Entries section (plate 8, plan B5). The list is collapsed until it is opened;
// a row has a date, a name, its pills and Edit, and nothing else: no count, no total,
// no "n of m" (house rule 1, W2). Edit opens the entry in the editor's slot above
// (composer.tsx).
import { useEffect, useState } from 'preact/hooks';
import { formatAdminListDate } from '../lib/dates.ts';
import { api, type Code, type EntriesPage, type EntryRow } from './api.ts';
import { copy, refusals } from './copy.ts';
import { Runs } from './doc.tsx';
import { Notice, siteTimeZone } from './ui.tsx';

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

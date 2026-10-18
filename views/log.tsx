// The log: every published entry of one language, newest first. No count, no
// page number, no "latest" (AC-5, AC-30); the empty and short logs are designed
// states, not blanks (AC-4).
import { raw } from 'hono/html';
import type { FC } from 'hono/jsx';
import { isolate } from '../lib/bidi.ts';
import { feedDate, formatEntryDate } from '../lib/dates.ts';
import type { PublicEntry } from '../lib/entries.ts';
import type { AssetManifest } from '../lib/assets.ts';
import { localePath, strings, type Lang } from '../lib/i18n.ts';
import { renderParagraphs } from '../lib/render.ts';
import { ArrowIcon, BackArrowIcon, FeedIcon } from './icons.tsx';
import { Layout } from './layout.tsx';
import { fill } from './fill.tsx';
import { Eyes } from './wordmark.tsx';

export interface LogProps {
  lang: Lang;
  assets: AssetManifest;
  entries: PublicEntry[];
  /** The cursor for "Older entries", or null on the last page. */
  olderBefore: string | null;
  /** Where "Newer entries" goes: null on the first page, 'first' for the bare path, else a cursor. */
  newer: string | 'first' | null;
}

/** The ¶, the date as a link to the entry, the title inline if there is one, then the first paragraph. */
const EntryBlock: FC<{ lang: Lang; entry: PublicEntry }> = ({ lang, entry }) => {
  const [first = '', ...rest] = renderParagraphs(entry.doc, lang);
  const date = formatEntryDate(entry.firstPublishedAt, lang);
  return (
    <article class="entry">
      <p class="entry__first">
        <span class="entry__pilcrow" aria-hidden="true">
          ¶
        </span>{' '}
        <a class="entry__date" href={localePath(lang, `/log/${entry.id}`)}>
          <time datetime={feedDate(entry.firstPublishedAt)}>{date}</time>
        </a>{' '}
        {entry.title ? <strong class="entry__title">{raw(isolate(entry.title, lang))}</strong> : null}
        {entry.title ? ' ' : null}
        {raw(first)}
      </p>
      {rest.map((html) => (
        <p class="entry__more">{raw(html)}</p>
      ))}
    </article>
  );
};

export const Log: FC<LogProps> = ({ lang, assets, entries, olderBefore, newer }) => {
  const t = strings(lang);
  const feed = localePath(lang, '/log/feed.xml');
  return (
    <Layout lang={lang} kind="log" assets={assets} title={t.log.title} description={t.log.description} current="learnings">
      <h1 class="page-title">{t.log.title}</h1>
      <p class="page-lede">{t.log.lede}</p>
      <a class="feed-link" href={feed}>
        <FeedIcon />
        {t.nav.feed}
      </a>
      {entries.length === 0 ? (
        <div class="empty">
          <Eyes size="empty" />
          <p class="empty__line">{t.log.empty}</p>
          <p class="empty__more">
            {fill(t.log.emptyMeanwhile, {
              who: <a href={localePath(lang, '/')}>{t.log.whoLink}</a>,
              podcast: <a href={localePath(lang, '/podcast')}>{t.log.podcastLink}</a>,
            })}
          </p>
        </div>
      ) : (
        <div class="entries">
          {entries.map((entry) => (
            <EntryBlock lang={lang} entry={entry} />
          ))}
        </div>
      )}
      {olderBefore || newer ? (
        <div class="older">
          {newer ? (
            <a class="big-row" href={newer === 'first' ? localePath(lang, '/log') : `${localePath(lang, '/log')}?before=${newer}`} rel="prev">
              <span class="big-row__title">{t.log.newer}</span>
              <BackArrowIcon class="big-row__arrow" />
            </a>
          ) : null}
          {olderBefore ? (
            <a class="big-row" href={`${localePath(lang, '/log')}?before=${olderBefore}`} rel="next">
              <span class="big-row__title">{t.log.older}</span>
              <ArrowIcon class="big-row__arrow" />
            </a>
          ) : null}
        </div>
      ) : null}
    </Layout>
  );
};

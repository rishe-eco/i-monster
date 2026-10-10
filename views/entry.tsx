// One entry at its own address. No previous or next, which would show the
// neighbouring dates (W4), and never an "edited" mark (AC-13).
import { raw } from 'hono/html';
import type { FC } from 'hono/jsx';
import type { AssetManifest } from '../lib/assets.ts';
import { isolate } from '../lib/bidi.ts';
import { feedDate, formatEntryDate } from '../lib/dates.ts';
import type { PublicEntry } from '../lib/entries.ts';
import { feedTitle } from '../lib/feed.ts';
import { localePath, strings, type Lang } from '../lib/i18n.ts';
import { renderDoc } from '../lib/render.ts';
import { fill } from './fill.tsx';
import { ArrowIcon } from './icons.tsx';
import { Layout } from './layout.tsx';

export const EntryPage: FC<{ lang: Lang; assets: AssetManifest; entry: PublicEntry }> = ({ lang, assets, entry }) => {
  const t = strings(lang);
  const date = formatEntryDate(entry.firstPublishedAt, lang);
  const title = feedTitle(entry);
  return (
    <Layout lang={lang} kind="entry" assets={assets} title={title} current="learnings">
      <article class="entry-page">
        <a class="entry-page__date" href={localePath(lang, `/log/${entry.id}`)}>
          <time datetime={feedDate(entry.firstPublishedAt)}>{date}</time>
        </a>
        {/* An untitled entry still has a heading for assistive technology: its date. */}
        {entry.title ? (
          <h1 class="entry-page__title">{raw(isolate(entry.title, lang))}</h1>
        ) : (
          <h1 class="visually-hidden">{title}</h1>
        )}
        <div class="entry-page__body">{raw(renderDoc(entry.doc, lang))}</div>
      </article>
      <div class="older">
        <a class="big-row big-row--small" href={localePath(lang, '/log')}>
          <span class="big-row__title">{t.entry.more}</span>
          <ArrowIcon class="big-row__arrow" />
        </a>
      </div>
      <p class="entry-page__owner">
        {fill(t.entry.writtenBy, {
          owner: (
            <a href={localePath(lang, '/')}>
              <bdi lang="en">{t.owner}</bdi>
            </a>
          ),
          podcast: <a href={localePath(lang, '/podcast')}>{t.entry.podcastLink}</a>,
        })}
      </p>
    </Layout>
  );
};

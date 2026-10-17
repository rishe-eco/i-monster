// The podcast page: the show's name, intro and show-level links, then its episodes, newest date first.
// The show links sit under the intro whether or not episodes exist, so the page is never a dead end (G8,
// AC-29). Every platform link is the same pill: unknown labels get no mark, and no platform gets one
// until the founder supplies them (plan B7, traps). No count, no page number (AC-5, AC-30).
import { raw } from 'hono/html';
import type { FC } from 'hono/jsx';
import type { SiteContent } from '../content/site.ts';
import type { AssetManifest } from '../lib/assets.ts';
import { isolate } from '../lib/bidi.ts';
import { escapeHtml } from '../lib/escape.ts';
import { formatDay } from '../lib/dates.ts';
import type { PublicEpisode } from '../lib/episodes.ts';
import { localePath, strings, type Lang } from '../lib/i18n.ts';
import { renderLines } from '../lib/render.ts';
import { SITE_ORIGIN } from '../lib/switch.ts';
import { fill } from './fill.tsx';
import { ArrowIcon, ExternalIcon } from './icons.tsx';
import { Layout } from './layout.tsx';
import { Eyes } from './wordmark.tsx';

export interface PodcastProps {
  lang: Lang;
  assets: AssetManifest;
  show: SiteContent['show'];
  episodes: PublicEpisode[];
  /** The cursor for "Older episodes", or null on the last page. */
  olderBefore: string | null;
}

/**
 * One episode, with microdata (PD-19): a `PodcastEpisode` with its name, description, date, tags and
 * links, part of the show's `PodcastSeries`. There is no episode number: nothing counts (AC-5).
 */
const Episode: FC<{ lang: Lang; episode: PublicEpisode; showName: string }> = ({ lang, episode, showName }) => {
  const t = strings(lang);
  const separator = t.podcast.tagSeparator;
  return (
    <article class="episode" itemscope itemtype="https://schema.org/PodcastEpisode">
      <p class="episode__meta">
        <time datetime={episode.date} itemprop="datePublished">
          {formatDay(episode.date, lang)}
        </time>
        {' · '}
        {episode.tags.map((tag, n) => (
          <>
            {n > 0 ? separator : null}
            <span itemprop="keywords">{raw(isolate(tag, lang))}</span>
          </>
        ))}
      </p>
      <h2 class="episode__name" itemprop="name">
        {raw(isolate(episode.name, lang))}
      </h2>
      <div class="episode__description" itemprop="description">
        {raw(renderLines(episode.description, lang))}
      </div>
      {/* Written as markup, not JSX: Hono's JSX hoists every <meta> and <link> into the page's <head>, which would leave the series empty. */}
      {raw(
        `<meta itemprop="inLanguage" content="${lang}">` +
          `<span itemprop="partOfSeries" itemscope itemtype="https://schema.org/PodcastSeries">` +
          `<meta itemprop="name" content="${escapeHtml(showName)}">` +
          `<link itemprop="url" href="${escapeHtml(SITE_ORIGIN + localePath(lang, '/podcast'))}">` +
          '</span>',
      )}
      <p class="pills">
        {episode.links.map((link) => (
          <a class="pill-link" href={link.url} target="_blank" rel="noopener" itemprop="url">
            <span class="pill-link__label">{raw(isolate(link.label, lang))}</span>
            <ExternalIcon />
          </a>
        ))}
      </p>
    </article>
  );
};

export const Podcast: FC<PodcastProps> = ({ lang, assets, show, episodes, olderBefore }) => {
  const t = strings(lang);
  return (
    <Layout lang={lang} kind="podcast" assets={assets} title={show.name} description={t.podcast.description} current="podcast">
      <h1 class="page-title">{raw(isolate(show.name, lang))}</h1>
      {/* page-lede--intro: the highlighter draws in on a phrase of this line, once, when the founder's copy marks one (F-2). */}
      <p class="page-lede page-lede--intro">{t.podcast.lede}</p>
      {show.links.length > 0 ? (
        <div class="rows rows--show">
          {show.links.map((link) => (
            <a class="big-row" href={link.url} target="_blank" rel="noopener">
              <span class="big-row__title">{fill(t.podcast.showOn, { platform: raw(isolate(link.label, lang)) })}</span>
              <ExternalIcon class="big-row__arrow" />
            </a>
          ))}
        </div>
      ) : null}
      {episodes.length === 0 ? (
        <div class="empty">
          <Eyes size="empty" />
          <p class="empty__line">{t.podcast.empty}</p>
        </div>
      ) : (
        <div class="episodes">
          {episodes.map((episode) => (
            <Episode lang={lang} episode={episode} showName={show.name} />
          ))}
        </div>
      )}
      {olderBefore ? (
        <div class="older">
          <a class="big-row" href={`${localePath(lang, '/podcast')}?before=${olderBefore}`} rel="next">
            <span class="big-row__title">{t.podcast.older}</span>
            <ArrowIcon class="big-row__arrow" />
          </a>
        </div>
      ) : null}
    </Layout>
  );
};

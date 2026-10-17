// The podcast page, in both languages (plan B7, §6.1): the show and its episodes, 20 to a page, with
// the `?before=` cursor behind "Older episodes" (PD-25, AC-30).
import { Hono, type Context } from 'hono';
import type { SiteContent } from '../content/site.ts';
import type { AppEnv } from '../lib/context.ts';
import type { Db } from '../lib/db.ts';
import { getPublishedEpisode, listPublishedEpisodes } from '../lib/episodes.ts';
import { isId } from '../lib/ids.ts';
import type { Lang } from '../lib/i18n.ts';
import { Podcast } from '../views/podcast.tsx';
import { page } from '../views/render.ts';

export function podcastRoutes(db: Db, content: Record<Lang, SiteContent>): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  const showPodcast = (lang: Lang) => async (c: Context<AppEnv>) => {
    const cursor = c.req.query('before');
    let before = null;
    if (cursor !== undefined) {
      // A malformed, unknown, unpublished or other-language cursor is a 404 (PD-25).
      before = isId(cursor) ? getPublishedEpisode(db, lang, cursor) : null;
      if (!before) return c.notFound();
    }
    const { episodes, olderBefore } = listPublishedEpisodes(db, lang, before);
    return page(c, <Podcast lang={lang} assets={c.get('assets')} show={content[lang].show} episodes={episodes} olderBefore={olderBefore} />);
  };

  routes.get('/podcast', showPodcast('en'));
  routes.get('/fa/podcast', showPodcast('fa'));
  return routes;
}

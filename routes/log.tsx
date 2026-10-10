// The public log, an entry and the feed, in both languages (plan B3, §6.1).
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../lib/context.ts';
import type { Db } from '../lib/db.ts';
import { getPublished, listPublished } from '../lib/entries.ts';
import { buildFeed } from '../lib/feed.ts';
import { limits } from '../lib/limits.ts';
import { isId } from '../lib/ids.ts';
import type { Lang } from '../lib/i18n.ts';
import { EntryPage } from '../views/entry.tsx';
import { Log } from '../views/log.tsx';
import { page } from '../views/render.ts';

export function logRoutes(db: Db): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  const showLog = (lang: Lang) => async (c: Context<AppEnv>) => {
    const cursor = c.req.query('before');
    let before = null;
    if (cursor !== undefined) {
      // A malformed, unknown, unpublished or other-language cursor is a 404 (PD-25).
      before = isId(cursor) ? getPublished(db, lang, cursor) : null;
      if (!before) return c.notFound();
    }
    const { entries, olderBefore } = listPublished(db, lang, before);
    return page(c, <Log lang={lang} assets={c.get('assets')} entries={entries} olderBefore={olderBefore} />);
  };

  const showFeed = (lang: Lang) => (c: Context<AppEnv>) => {
    const { entries } = listPublished(db, lang, null, limits.feedSize);
    return c.body(buildFeed(lang, entries), 200, { 'Content-Type': 'application/atom+xml; charset=utf-8' });
  };

  const showEntry = (lang: Lang) => (c: Context<AppEnv>) => {
    const id = c.req.param('id') ?? '';
    const entry = isId(id) ? getPublished(db, lang, id) : null;
    if (!entry) return c.notFound();
    return page(c, <EntryPage lang={lang} assets={c.get('assets')} entry={entry} />);
  };

  for (const [lang, prefix] of [['en', ''], ['fa', '/fa']] as const) {
    routes.get(`${prefix}/log`, showLog(lang));
    routes.get(`${prefix}/log/feed.xml`, showFeed(lang));
    routes.get(`${prefix}/log/:id`, showEntry(lang));
  }
  return routes;
}

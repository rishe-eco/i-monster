// The public pages B1 owns: the two landing pages and the designed 404. Later
// stages add their own routes in their own files (`routes/log.ts` and so on).
import { Hono, type Context } from 'hono';
import type { SiteContent } from '../content/site.ts';
import type { AppEnv } from '../lib/context.ts';
import { Landing } from '../views/landing.tsx';
import { NotFound } from '../views/not-found.tsx';
import { page } from '../views/render.ts';

export function publicRoutes(content: Record<'en' | 'fa', SiteContent>): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get('/', (c) => page(c, <Landing lang="en" assets={c.get('assets')} content={content.en} />));
  routes.get('/fa/', (c) => page(c, <Landing lang="fa" assets={c.get('assets')} content={content.fa} />));
  // `/fa` is the same landing page without its slash: one address, not two pages.
  routes.get('/fa', (c) => c.redirect('/fa/', 308));

  return routes;
}

/** The 404 for any path nothing else answered, in the language of the path (AC-28). */
export function notFoundHandler(c: Context<AppEnv>): Promise<Response> {
  return page(c, <NotFound lang={c.get('lang')} assets={c.get('assets')} />, 404);
}

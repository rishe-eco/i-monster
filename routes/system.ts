// What the container, crawlers and browsers ask for that isn't a page.
import { Hono } from 'hono';
import type { AppEnv } from '../lib/context.ts';
import type { Db } from '../lib/db.ts';

const YEAR = 60 * 60 * 24 * 365;

export function systemRoutes(db: Db, options: { prelaunch: boolean }): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  // For the container's health check. It proves the process answers and the database opens.
  routes.get('/healthz', (c) => {
    try {
      db.prepare('SELECT 1').get();
    } catch {
      return c.text('DB_UNAVAILABLE', 503, { 'Cache-Control': 'no-store' });
    }
    return c.text('ok', 200, { 'Cache-Control': 'no-store' });
  });

  // Before launch the site asks not to be indexed (PD-22); after, it allows everything.
  routes.get('/robots.txt', (c) =>
    c.text(options.prelaunch ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\n'),
  );

  // Hashed names never change their content, so they cache for a year.
  routes.get('/assets/*', (c, next) => {
    const asset = c.get('assets').get(c.req.path);
    if (!asset) return next();
    return c.body(new Uint8Array(asset.body), 200, {
      'Content-Type': asset.type,
      'Cache-Control': `public, max-age=${YEAR}, immutable`,
    });
  });

  return routes;
}

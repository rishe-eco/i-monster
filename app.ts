// The Hono app, assembled from its parts. Every stage adds its routes with one
// line here and keeps the routes themselves in `routes/<area>.ts`.
import { Hono } from 'hono';
import { etag } from 'hono/etag';
import { siteEn } from './content/site.en.ts';
import { siteFa } from './content/site.fa.ts';
import { buildAssets, type AssetManifest } from './lib/assets.ts';
import type { AppEnv } from './lib/context.ts';
import type { Db } from './lib/db.ts';
import type { Env } from './lib/env.ts';
import { securityHeaders } from './lib/headers.ts';
import { langFromPath } from './lib/i18n.ts';
import { notFoundHandler, publicRoutes } from './routes/public.tsx';
import { systemRoutes } from './routes/system.ts';
import { testRoutes } from './routes/test.ts';

export interface AppOptions {
  env: Env;
  db: Db;
  assets?: AssetManifest;
}

export function createApp({ env, db, assets = buildAssets() }: AppOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Middleware order (D-8): headers, then language. Nothing on a public route
  // reads a cookie, so a signed-in request can't differ from a signed-out one.
  app.use('*', securityHeaders({ prelaunch: env.prelaunch }));
  app.use('*', async (c, next) => {
    c.set('lang', langFromPath(c.req.path).lang);
    c.set('assets', assets);
    c.set('env', env);
    await next();
  });
  // Pages carry an ETag so a reader's conditional request costs nothing (PD-4).
  // Hashed assets are immutable and need none.
  const withEtag = etag();
  app.use('*', (c, next) => (c.req.path.startsWith('/assets/') ? next() : withEtag(c, next)));
  // B8 adds the reader-record middleware here, after language.

  app.route('/', systemRoutes(db, { prelaunch: env.prelaunch }));
  app.route('/', publicRoutes({ en: siteEn, fa: siteFa }));
  if (env.e2eClock) app.route('/', testRoutes());

  app.notFound(notFoundHandler);
  app.onError((error, c) => {
    // Only the error is logged: never the request, its address, headers or body (house rule 9).
    console.error(error);
    return c.text('INTERNAL_ERROR', 500);
  });

  return app;
}

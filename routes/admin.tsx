// The admin's HTML shell (plan B4b, PD-21): one page for `/admin` and for the
// `/admin/setup/<code>` link the CLI and an enrolment code print. It is public,
// reads no cookie and sets none, and holds no script or style of its own, so the
// CSP (PD-18) needs no exception: the bundle is an external, hashed file. What
// the screen shows is decided in the browser, from the path and from
// `/admin/api/session`, so the same bytes go to everyone.
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../lib/context.ts';
import { PRELOAD } from '../views/layout.tsx';
import { page } from '../views/render.ts';

export function adminRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  const shell = (c: Context<AppEnv>) => {
    const assets = c.get('assets');
    const { siteTz } = c.get('env');
    return page(
      c,
      <html lang="en" dir="ltr">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="color-scheme" content="light dark" />
          <meta name="robots" content="noindex" />
          {/* The bundle formats "added" dates in the site's timezone; it can't read the server's environment. */}
          <meta name="site-timezone" content={siteTz} />
          <title>Admin · iMNSTR</title>
          <link rel="icon" href="data:," />
          {PRELOAD.en.map((name) => (
            <link rel="preload" as="font" type="font/woff2" href={assets.url(name)} crossorigin="anonymous" />
          ))}
          <link rel="stylesheet" href={assets.url('css/site.css')} />
          <link rel="stylesheet" href={assets.url('admin/admin.css')} />
          {/* The sign-in view's eyes follow the pointer: the same script the public pages load. */}
          <script defer src={assets.url('wordmark.js')}></script>
          <script type="module" src={assets.url('admin/admin.js')}></script>
        </head>
        <body>
          <div id="admin"></div>
          <noscript>The admin needs JavaScript.</noscript>
        </body>
      </html>,
    );
  };

  routes.get('/admin', shell);
  routes.get('/admin/', shell);
  routes.get('/admin/setup/:code', shell);

  return routes;
}

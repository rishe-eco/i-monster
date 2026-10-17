// The page shell every public page shares: head, header, nav, switch, footer.
// No inline script, no style attribute, nothing off-origin (CSP, PD-18).
import type { Child, FC } from 'hono/jsx';
import type { AssetManifest } from '../lib/assets.ts';
import { dirOf, localePath, strings, type Lang } from '../lib/i18n.ts';
import { alternates, switchTarget, type PageKind } from '../lib/switch.ts';
import { Eyes, Wordmark } from './wordmark.tsx';

export interface LayoutProps {
  lang: Lang;
  kind: PageKind;
  assets: AssetManifest;
  /** The text in the tab; the owner's name follows it. Omitted on the landing page. */
  title?: string;
  description?: string;
  /** Which nav link is the current page. */
  current?: 'learnings' | 'podcast';
  children?: Child;
}

// The two families each language reads first, preloaded so the first paint
// doesn't swap. Each language preloads only its own (PD-26).
export const PRELOAD: Record<Lang, string[]> = {
  en: [
    'fonts/bricolage-grotesque/bricolage-grotesque-latin-800-normal.woff2',
    'fonts/newsreader/newsreader-latin-400-normal.woff2',
  ],
  fa: [
    'fonts/estedad/estedad-arabic-800-normal.woff2',
    'fonts/vazirmatn/vazirmatn-arabic-400-normal.woff2',
  ],
};

export const Layout: FC<LayoutProps> = ({ lang, kind, assets, title, description, current, children }) => {
  const t = strings(lang);
  const landing = kind === 'landing';
  const target = switchTarget(kind, lang);
  const home = localePath(lang, '/');
  const log = localePath(lang, '/log');
  const podcast = localePath(lang, '/podcast');
  const feed = localePath(lang, '/log/feed.xml');

  return (
    <html lang={lang} dir={dirOf(lang)}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>{title ? `${title} · ${t.siteTitle}` : t.siteTitle}</title>
        {description ? <meta name="description" content={description} /> : null}
        {/* No icon yet. An empty data URL stops the browser asking for /favicon.ico on every page. */}
        <link rel="icon" href="data:," />
        {PRELOAD[lang].map((name) => (
          <link rel="preload" as="font" type="font/woff2" href={assets.url(name)} crossorigin="anonymous" />
        ))}
        <link rel="stylesheet" href={assets.url('css/site.css')} />
        {/* The one script on a public page: the eyes and the wordmark's reveal. It returns at once under reduced motion. */}
        <script defer src={assets.url('wordmark.js')}></script>
        <link rel="alternate" type="application/atom+xml" title={t.feedTitle} href={feed} />
        {alternates(kind).map((alt) => (
          <link rel="alternate" hreflang={alt.hreflang} href={alt.href} />
        ))}
      </head>
      <body>
        <div class="wrap">
          <header class={landing ? 'site-header site-header--landing' : 'site-header'}>
            {landing ? null : (
              // The wordmark is Latin and keeps its own direction, at the start (the right, in Persian), with its eyes.
              <div class="brand" dir="ltr">
                <Wordmark href={home} name={t.owner} />
                <Eyes size="header" />
              </div>
            )}
            <nav class="nav" aria-label={t.nav.label}>
              <a href={log} aria-current={current === 'learnings' ? 'page' : undefined}>
                {t.nav.learnings}
              </a>
              <a href={podcast} aria-current={current === 'podcast' ? 'page' : undefined}>
                {t.nav.podcast}
              </a>
              <a class="nav-feed" href={feed}>
                {t.nav.feed}
              </a>
              <a href={target.href} lang={target.lang} hreflang={target.lang}>
                {target.label}
              </a>
            </nav>
          </header>
          <main id="main">{children}</main>
          <footer class="site-footer">
            <nav class="footer-nav" aria-label={t.nav.footerLabel}>
              <a href={log}>{t.nav.learnings}</a>
              <a href={podcast}>{t.nav.podcast}</a>
              <a href={feed}>{t.nav.feed}</a>
            </nav>
            <p>{t.footer.noCookies}</p>
          </footer>
        </div>
      </body>
    </html>
  );
};

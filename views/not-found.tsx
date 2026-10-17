import { raw } from 'hono/html';
import type { FC } from 'hono/jsx';
import type { AssetManifest } from '../lib/assets.ts';
import { isolate } from '../lib/bidi.ts';
import { localePath, strings, type Lang } from '../lib/i18n.ts';
import { ArrowIcon } from './icons.tsx';
import { Layout } from './layout.tsx';
import { Eyes } from './wordmark.tsx';

// One page per language, whatever was asked for (AC-28): it never mentions the
// path, and an unpublished entry and a URL that never existed look the same.
export const NotFound: FC<{ lang: Lang; assets: AssetManifest }> = ({ lang, assets }) => {
  const t = strings(lang);
  // The owner's name is Latin; inside Persian text lib/bidi.ts keeps it in its own run.
  const [before = '', after = ''] = t.notFound.ownerLine.split('{owner}');
  return (
    <Layout lang={lang} kind="not-found" assets={assets} title={t.notFound.title}>
      <div class="notfound">
        <Eyes size="big" />
        <h1>{t.notFound.title}</h1>
        <p class="notfound__body">{t.notFound.body}</p>
        <div class="button-list">
          <a class="button button--primary" href={localePath(lang, '/log')}>
            {t.notFound.readLearnings}
            <ArrowIcon />
          </a>
          <a class="button" href={localePath(lang, '/podcast')}>
            {t.notFound.podcast}
            <ArrowIcon />
          </a>
          <a class="button" href={localePath(lang, '/')}>
            {t.notFound.goHome}
            <ArrowIcon />
          </a>
        </div>
        <p class="owner-line">
          {before}
          {raw(isolate(t.owner, lang))}
          {after}
        </p>
      </div>
    </Layout>
  );
};

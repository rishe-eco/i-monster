import { raw } from 'hono/html';
import type { FC } from 'hono/jsx';
import type { SiteContent } from '../content/site.ts';
import type { AssetManifest } from '../lib/assets.ts';
import { isolate } from '../lib/bidi.ts';
import { localePath, strings, type Lang } from '../lib/i18n.ts';
import { ArrowIcon, ExternalIcon } from './icons.tsx';
import { Layout } from './layout.tsx';
import { Eyes, Wordmark } from './wordmark.tsx';

// There is no "latest entry" and no date on this page (W4, AC-5): only who this
// is, the way into the log and the podcast, and what is being built.
export const Landing: FC<{ lang: Lang; assets: AssetManifest; content: SiteContent }> = ({
  lang,
  assets,
  content,
}) => {
  const t = strings(lang);
  return (
    <Layout lang={lang} kind="landing" assets={assets} description={t.landing.description}>
      {/* data-intro: the wordmark plays its reveal once, a moment after load (wordmark.js). */}
      <div class="hero" data-intro>
        <div class="brand brand--hero" dir="ltr">
          <h1>
            <Wordmark class="wordmark--hero" href={localePath(lang, '/')} name={t.owner} current />
          </h1>
          <Eyes size="hero" />
        </div>
      </div>
      <p class="intro">
        {content.who.map((segment) =>
          segment.mark ? <mark>{raw(isolate(segment.text, lang))}</mark> : raw(isolate(segment.text, lang)),
        )}
      </p>
      <div class="rows">
        <a class="big-row" href={localePath(lang, '/log')}>
          <span class="big-row__title">{t.landing.learningsTitle}</span>
          <span class="big-row__line">{t.landing.learningsLine}</span>
          <ArrowIcon class="big-row__arrow" />
        </a>
        <a class="big-row" href={localePath(lang, '/podcast')}>
          <span class="big-row__title">{t.landing.podcastTitle}</span>
          <span class="big-row__line">{t.landing.podcastLine}</span>
          <ArrowIcon class="big-row__arrow" />
        </a>
      </div>
      <section class="building" aria-labelledby="building-heading">
        <h2 class="building__heading" id="building-heading">
          {t.landing.buildingHeading}
        </h2>
        <ul class="projects">
          {content.projects.map((project) => {
            const name = raw(isolate(project.name, lang));
            const inner = (
              <>
                <span class="project__name">
                  {name}
                  {project.url ? <ExternalIcon /> : null}
                </span>
                <span class="project__line">{raw(isolate(project.line, lang))}</span>
              </>
            );
            return (
              <li>
                {project.url ? (
                  <a class="project" href={project.url} target="_blank" rel="noopener">
                    {inner}
                  </a>
                ) : (
                  <div class="project">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </Layout>
  );
};

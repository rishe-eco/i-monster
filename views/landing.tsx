import type { FC } from 'hono/jsx';
import type { SiteContent } from '../content/site.ts';
import type { AssetManifest } from '../lib/assets.ts';
import { localePath, strings, type Lang } from '../lib/i18n.ts';
import { ArrowIcon, ExternalIcon } from './icons.tsx';
import { Layout } from './layout.tsx';

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
      <div class="hero">
        <h1>
          <a href={localePath(lang, '/')} aria-current="page">
            {t.owner}
          </a>
        </h1>
      </div>
      <p class="intro">
        {content.who.map((segment) => (segment.mark ? <mark>{segment.text}</mark> : segment.text))}
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
            const name = project.latinName ? <bdi lang="en">{project.name}</bdi> : project.name;
            const inner = (
              <>
                <span class="project__name">
                  {name}
                  {project.url ? <ExternalIcon /> : null}
                </span>
                <span class="project__line">{project.line}</span>
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

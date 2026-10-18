// The public podcast page, in both languages and both colour schemes, at 360 px and at 200% zoom
// (180 px): zero episodes, one with one link, and 21, with the show links on every page, paging,
// mixed text, the pills (plan B7; AC-4, AC-5, AC-6, AC-7, AC-29, AC-30, AC-33, AC-39, AC-40, AC-48, J5).
import { expect, test } from '@playwright/test';
import {
  FAMILIES,
  expectColourScheme,
  expectLangAndDir,
  expectNoCookies,
  expectNoFallbackFont,
  expectNoSidewaysScroll,
  expectNoThirdParty,
  expectTapTargets,
  loadedFamilies,
  watchRequests,
  type Lang,
} from './support.ts';
import { resetPodcast, plainEpisodes, type SeedEpisode } from './podcast-support.ts';

const LANGS: Lang[] = ['en', 'fa'];
const podcastPath = (lang: Lang) => (lang === 'fa' ? '/fa/podcast' : '/podcast');

// The show links the content file gives each language (content/site.<lang>.ts): the Persian show's are its own (AC-29).
const SHOW: Record<Lang, { name: string; urls: string[] }> = {
  en: { name: 'Monster Podcast', urls: ['https://example.com/monster-podcast/youtube', 'https://example.com/monster-podcast/castbox'] },
  fa: { name: 'پادکست مانستر', urls: ['https://example.com/monster-podcast-fa/youtube', 'https://example.com/monster-podcast-fa/castbox'] },
};

for (const lang of LANGS) {
  test.describe(`the podcast page, ${lang}`, () => {
    for (const count of [0, 1, 21]) {
      test(`with ${count} episodes: the show links, fits 360 px and 200% zoom, in the colour scheme (AC-4, AC-29, AC-30, AC-32)`, async ({ page, request }, info) => {
        await resetPodcast(request, plainEpisodes(lang, count));
        await page.goto(podcastPath(lang));
        await expectLangAndDir(page, lang);
        await expectColourScheme(page, info);
        await expectTapTargets(page);
        await expect(page.locator('h1.page-title')).toHaveText(SHOW[lang].name);
        // The show links are there at every amount of data (G8), and open in a new tab (AC-33).
        const links = page.locator('main .rows--show a');
        await expect(links).toHaveCount(2);
        for (const [n, url] of SHOW[lang].urls.entries()) {
          await expect(links.nth(n)).toHaveAttribute('href', url);
          await expect(links.nth(n)).toHaveAttribute('target', '_blank');
          await expect(links.nth(n)).toHaveAttribute('rel', 'noopener');
        }
        await expect(page.locator('main article.episode')).toHaveCount(Math.min(count, 20));
        await expect(page.locator('.empty')).toHaveCount(count === 0 ? 1 : 0);
        await expect(page.locator('.older')).toHaveCount(count > 20 ? 1 : 0);
        await expect(page.getByRole('link', { name: lang === 'fa' ? 'پادکست' : 'Podcast', exact: true }).first()).toHaveAttribute('aria-current', 'page');
        await expectNoSidewaysScroll(page, 360);
        await expectNoSidewaysScroll(page, 180);
      });
    }

    test('says "Episodes will be listed here, with links to listen." with no episodes, and has no error, blank or count (W11, AC-4)', async ({ page, request }) => {
      await resetPodcast(request, []);
      await page.goto(podcastPath(lang));
      await expect(page.locator('.empty')).toHaveText(lang === 'fa' ? 'قسمت‌ها اینجا فهرست می‌شوند، با لینک برای شنیدن.' : 'Episodes will be listed here, with links to listen.');
      await expect(page.locator('article')).toHaveCount(0);
    });

    test('shows an episode with its date and tags, its name and description, and one pill for each link it has (AC-6, J5.6, J5.7)', async ({ page, request }, info) => {
      await resetPodcast(request, [
        {
          lang,
          name: lang === 'fa' ? 'چرا هیولا؟' : 'Why a monster?',
          description: lang === 'fa' ? 'قسمت اول.' : 'Episode one: where the name comes from.',
          tags: [lang === 'fa' ? 'ریشه' : 'origins'],
          date: '2026-10-10',
          links: [{ label: 'YouTube', url: 'https://youtu.be/abc123' }],
        },
      ]);
      await page.goto(podcastPath(lang));
      const episode = page.locator('article.episode');
      // The date is a day, written as the digits it is, in the page's calendar (AC-31).
      await expect(episode.locator('time')).toHaveText(lang === 'fa' ? '۱۸ مهر ۱۴۰۵' : '10 Oct 2026');
      await expect(episode.locator('time')).toHaveAttribute('datetime', '2026-10-10');
      await expect(episode.locator('.episode__meta')).toContainText(lang === 'fa' ? 'ریشه' : 'origins');
      await expect(episode.locator('h2')).toHaveText(lang === 'fa' ? 'چرا هیولا؟' : 'Why a monster?');
      // Only the links it has: one pill, with no greyed Castbox beside it.
      const pills = episode.locator('.pill-link');
      await expect(pills).toHaveCount(1);
      await expect(pills.first()).toHaveAttribute('href', 'https://youtu.be/abc123');
      await expect(pills.first()).toHaveAttribute('target', '_blank');
      await expect(pills.first()).toHaveAttribute('rel', 'noopener');
      expect((await pills.first().boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5);
      await expect(episode).not.toContainText('Castbox');
      await expectColourScheme(page, info);
      await expectNoSidewaysScroll(page, 360);
      await expectNoSidewaysScroll(page, 180);
    });

    test('draws an unknown label as the same pill as YouTube, and gives every pill the same look (plan B7, traps)', async ({ page, request }) => {
      await resetPodcast(request, [
        {
          lang,
          name: lang === 'fa' ? 'نام' : 'Building in public',
          description: lang === 'fa' ? 'توضیح.' : 'Words.',
          tags: ['a', 'b'],
          date: '2026-10-24',
          links: [
            { label: 'YouTube', url: 'https://youtu.be/a' },
            { label: 'Castbox', url: 'https://castbox.fm/a' },
            { label: 'Spotify', url: 'https://open.spotify.com/a' },
            { label: 'My own site', url: 'https://example.org/a' },
          ],
        },
      ]);
      await page.goto(podcastPath(lang));
      const pills = page.locator('.pill-link');
      await expect(pills).toHaveCount(4);
      const looks = await pills.evaluateAll((els) =>
        els.map((el) => {
          const style = getComputedStyle(el);
          return [style.borderTopWidth, style.borderTopStyle, style.borderRadius, style.minHeight, el.querySelectorAll('svg').length, el.querySelectorAll('img').length].join('|');
        }),
      );
      expect(new Set(looks).size).toBe(1);
      expect(looks[0]).toMatch(/\|1\|0$/);
    });

    test('pages back with "Older" and ends on the last page, with the show links on it too (AC-29, AC-30)', async ({ page, request }) => {
      await resetPodcast(request, plainEpisodes(lang, 21));
      await page.goto(podcastPath(lang));
      await page.locator('.older a').click();
      await expect(page).toHaveURL(/\?before=[0-9a-z]{10}$/);
      await expect(page.locator('main article.episode')).toHaveCount(1);
      await expect(page.locator('.older a[rel=next]')).toHaveCount(0);
      await expect(page.locator('.older a[rel=prev]')).toHaveCount(1);
      // The show's links are above the episodes on page two as on page one.
      const links = page.locator('main .rows--show a');
      await expect(links).toHaveCount(2);
      await expect(links.first()).toHaveAttribute('href', SHOW[lang].urls[0] as string);
      await expectNoSidewaysScroll(page, 360);
      await expectNoSidewaysScroll(page, 180);
    });

    test('shows no count, page number or "latest" in what a reader sees (AC-5, AC-30)', async ({ page, request }) => {
      await resetPodcast(request, plainEpisodes(lang, 21));
      await page.goto(podcastPath(lang));
      const text = await page.locator('main').innerText();
      expect(text).not.toMatch(/\bpage\s*\d|\bof\s+\d+\b|\b\d+\s+(episodes|links)\b|latest|total/i);
      expect(text).not.toMatch(/صفحهٔ\s*[\d۰-۹]|مجموع|آخرین/);
      expect(page.url()).not.toMatch(/[?&](page|p|offset)=/);
    });

    test('works with script off: Older is a plain link (AC-30)', async ({ browser, baseURL }, info) => {
      const context = await browser.newContext({ baseURL, javaScriptEnabled: false, colorScheme: info.project.name === 'dark' ? 'dark' : 'light' });
      const page = await context.newPage();
      const request = context.request;
      await resetPodcast(request, plainEpisodes(lang, 21));
      await page.goto(podcastPath(lang));
      await page.locator('.older a').click();
      await expect(page.locator('main article.episode')).toHaveCount(1);
      // And Newer returns to the first page (PL-10).
      await page.locator('.older a[rel=prev]').click();
      await expect(page).toHaveURL(new RegExp(`${podcastPath(lang)}$`));
      await expect(page.locator('main article.episode')).toHaveCount(20);
      await context.close();
    });

    test('answers a made-up cursor with that language\'s 404 (PD-25)', async ({ page, request }) => {
      await resetPodcast(request, plainEpisodes(lang, 3));
      const res = await page.goto(`${podcastPath(lang)}?before=abcdefghjk`);
      expect(res?.status()).toBe(404);
      await expectLangAndDir(page, lang);
    });

    test('draws every glyph in its own fonts, the Latin platform names inside Persian included (AC-40)', async ({ page, request }) => {
      await resetPodcast(request, plainEpisodes(lang, 3));
      await page.goto(podcastPath(lang));
      expect((await expectNoFallbackFont(page)).length).toBeGreaterThan(0);
      const loaded = await loadedFamilies(page);
      for (const family of FAMILIES[lang]) expect(loaded).toContain(family);
    });

    test('makes no request to another origin and sets no cookie (AC-7)', async ({ page, request }) => {
      await resetPodcast(request, plainEpisodes(lang, 3));
      const requests = watchRequests(page);
      await page.goto(podcastPath(lang));
      await page.waitForLoadState('networkidle');
      await expectNoThirdParty(page, requests);
      await expectNoCookies(page);
    });

    test('wraps a long name, a long description and a 100-character word, label and address without scrolling sideways (AC-36)', async ({ page, request }) => {
      const word = 'Supercalifragilistic'.repeat(5);
      await resetPodcast(request, [
        {
          lang,
          name: lang === 'fa' ? `${'نام بلند '.repeat(20)}${word}` : `${'A name that goes on and on '.repeat(6)}${word}`,
          description: lang === 'fa' ? `${'متن بلند. '.repeat(40)}${word}` : `${'Long words and long lines must wrap at every width. '.repeat(8)}${word}\n\nhttps://example.org/${'a-long-path/'.repeat(10)}`,
          tags: [word, word],
          date: '2026-10-09',
          links: [
            { label: word, url: `https://example.org/${word}${word}` },
            { label: 'YouTube', url: 'https://youtu.be/a' },
          ],
        },
        ...plainEpisodes(lang, 2),
      ]);
      await page.goto(podcastPath(lang));
      await expectNoSidewaysScroll(page, 360);
      await expectNoSidewaysScroll(page, 180);
      // Every pill is inside the column at 180 px.
      const column = await page.locator('main').evaluate((main) => {
        const rect = main.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      });
      for (const pill of await page.locator('.pill-link').all()) {
        const box = await pill.boundingBox();
        expect((box?.x ?? -1) >= column.left - 0.5 && (box?.x ?? 0) + (box?.width ?? 0) <= column.right + 0.5).toBe(true);
      }
    });

    test('has the switch to the other language\'s podcast page, and hreflang alternates (AC-41)', async ({ page, request }) => {
      await resetPodcast(request, plainEpisodes(lang, 1));
      await page.goto(podcastPath(lang));
      const other: Lang = lang === 'en' ? 'fa' : 'en';
      const target = page.locator(`header a[hreflang="${other}"]`);
      await expect(target).toHaveText(other === 'fa' ? 'فارسی' : 'English');
      await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute('href', 'https://imnstr.com/podcast');
      await expect(page.locator('link[rel="alternate"][hreflang="fa"]')).toHaveAttribute('href', 'https://imnstr.com/fa/podcast');
      await target.click();
      await expect(page).toHaveURL(podcastPath(other));
      await expectLangAndDir(page, other);
      // The other language's page shows none of this language's episodes (AC-39).
      await expect(page.locator('article.episode')).toHaveCount(0);
    });
  });
}

test.describe('the other language\'s episodes stay on their own page (AC-39)', () => {
  test('21 English episodes leave /fa/podcast with its designed empty state and none of their words', async ({ page, request }) => {
    await resetPodcast(request, plainEpisodes('en', 21));
    await page.goto('/fa/podcast');
    await expect(page.locator('.empty')).toHaveCount(1);
    await expect(page.locator('article')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Episode');
  });
});

test.describe('mixed-direction text (AC-48)', () => {
  test('a Persian episode that starts with an English word reads right to left, with the word and the address isolated', async ({ page, request }) => {
    const seed: SeedEpisode = {
      lang: 'fa',
      name: 'Root و Tracker: چرا ساختیم',
      description: 'درباره Root Studio و https://example.org/root/a-very-long-path-that-keeps-going-to-test-wrapping-at-small-widths.',
      tags: ['Root'],
      date: '2026-10-10',
      links: [{ label: 'YouTube', url: 'https://youtu.be/a' }],
    };
    await resetPodcast(request, [seed]);
    await page.goto('/fa/podcast');
    const name = page.locator('.episode__name');
    expect(await name.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
    const word = name.locator('bdi[lang="en"]').first();
    await expect(word).toHaveText('Root');
    expect(await word.evaluate((e) => getComputedStyle(e).unicodeBidi)).toBe('isolate');
    const url = page.locator('.episode__description bdi[dir="ltr"]');
    await expect(url).toContainText('https://example.org/root/');
    expect(await url.evaluate((e) => getComputedStyle(e).unicodeBidi)).toBe('isolate');
    await expectNoSidewaysScroll(page, 360);
    await expectNoSidewaysScroll(page, 180);
  });

  test('an English episode with Persian in it keeps the Persian run in its own direction', async ({ page, request }) => {
    await resetPodcast(request, [
      { lang: 'en', name: 'The word سلام', description: 'It means hello.', tags: ['سلام'], date: '2026-10-10', links: [{ label: 'YouTube', url: 'https://youtu.be/a' }] },
    ]);
    await page.goto('/podcast');
    const run = page.locator('.episode__name bdi[lang="fa"]');
    await expect(run).toHaveText('سلام');
    expect(await run.evaluate((e) => getComputedStyle(e).direction)).toBe('rtl');
  });
});

test('the landing page links to the podcast, and the way in works in both languages', async ({ page, request }) => {
  await resetPodcast(request, []);
  for (const lang of LANGS) {
    await page.goto(lang === 'fa' ? '/fa/' : '/');
    await page.locator(`main a[href="${podcastPath(lang)}"]`).first().click();
    await expect(page).toHaveURL(podcastPath(lang));
    await expect(page.locator('h1.page-title')).toHaveText(SHOW[lang].name);
  }
});

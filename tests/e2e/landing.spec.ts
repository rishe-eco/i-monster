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

const PAGES: [Lang, string][] = [
  ['en', '/'],
  ['fa', '/fa/'],
];

for (const [lang, path] of PAGES) {
  test.describe(`landing page, ${lang}`, () => {
    test('fits 360px in the colour scheme, with lang and dir set (AC-1, AC-32, AC-40)', async ({ page }, info) => {
      await page.goto(path);
      await expectLangAndDir(page, lang);
      await expectColourScheme(page, info);
      await expectNoSidewaysScroll(page);
      await expectTapTargets(page);
      await expect(page.locator('h1')).toHaveText('iMNSTR');
      await expect(page.locator('main mark')).toHaveCount(2);
      await expect(page.locator('.big-row')).toHaveCount(2);
      await expect(page.locator('.project')).toHaveCount(3);
    });

    test('makes no request to another origin and sets no cookie (AC-7)', async ({ page }) => {
      const requests = watchRequests(page);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expectNoThirdParty(page, requests);
      expect(requests.length).toBeGreaterThan(3); // the page, the stylesheet and its fonts
      await expectNoCookies(page);
    });

    test('draws every glyph in its own fonts, never a fallback (AC-40)', async ({ page }) => {
      await page.goto(path);
      const seen = await expectNoFallbackFont(page);
      expect(seen.length).toBeGreaterThan(0);
      const loaded = await loadedFamilies(page);
      for (const family of FAMILIES[lang]) expect(loaded).toContain(family);
    });

    test('has the switch to the other language, which goes to its landing page (AC-41)', async ({ page }) => {
      await page.goto(path);
      const other = lang === 'en' ? 'fa' : 'en';
      const target = page.locator(`header a[hreflang="${other}"]`);
      await expect(target).toHaveText(other === 'fa' ? 'فارسی' : 'English');
      await target.click();
      await expect(page).toHaveURL(other === 'fa' ? '/fa/' : '/');
      await expectLangAndDir(page, other);
    });

    test('carries hreflang alternates for both landing pages (AC-41)', async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute('href', 'https://imnstr.com/');
      await expect(page.locator('link[rel="alternate"][hreflang="fa"]')).toHaveAttribute('href', 'https://imnstr.com/fa/');
    });

    test('links to the log and the podcast in its own language, and names the owner (AC-26)', async ({ page }) => {
      await page.goto(path);
      const prefix = lang === 'fa' ? '/fa' : '';
      await expect(page.locator(`header a[href="${prefix}/log"]`)).toBeVisible();
      await expect(page.locator(`header a[href="${prefix}/podcast"]`)).toBeVisible();
      await expect(page.locator('h1 a')).toHaveAttribute('href', lang === 'fa' ? '/fa/' : '/');
    });

    test('is not redirected by the browser language (AC-41)', async ({ request }) => {
      for (const acceptLanguage of ['fa', 'en-US,en;q=0.9', 'fa-IR,fa;q=0.9']) {
        const res = await request.get(path, { headers: { 'Accept-Language': acceptLanguage }, maxRedirects: 0 });
        expect(res.status()).toBe(200);
        expect(res.headers()['location']).toBeUndefined();
        expect(await res.text()).toContain(`<html lang="${lang}"`);
      }
    });

    test('serves its own highlighter, drawn behind the text, with a forced-colours fallback (HIG #4)', async ({ page }) => {
      await page.goto(path);
      const mark = page.locator('main mark').first();
      const image = await mark.evaluate((el) => getComputedStyle(el).backgroundImage);
      expect(image).toContain('linear-gradient');
      await page.emulateMedia({ forcedColors: 'active' });
      const forced = await mark.evaluate((el) => getComputedStyle(el).backgroundImage);
      expect(forced).toBe('none');
    });
  });
}

test('the text in Persian runs the other way: the hero and the rows start on the right (mirroring)', async ({ page }) => {
  await page.goto('/fa/');
  const viewport = page.viewportSize();
  const hero = await page.locator('h1 a').boundingBox();
  const row = await page.locator('.big-row__title').first().boundingBox();
  const arrow = await page.locator('.big-row__arrow').first().boundingBox();
  expect(viewport).not.toBeNull();
  const width = viewport?.width ?? 360;
  // The wordmark is Latin but sits at the start, which in Persian is the right edge.
  expect((hero?.x ?? 0) + (hero?.width ?? 0)).toBeGreaterThan(width / 2);
  expect((row?.x ?? 0) + (row?.width ?? 0)).toBeGreaterThan(width / 2);
  // The arrow is at the end, the left edge.
  expect(arrow?.x ?? width).toBeLessThan(width / 2);
});

test('Persian digits, ZWNJ, the Persian comma and guillemets are all drawn in Estedad or Vazirmatn (AC-40)', async ({
  page,
}) => {
  await page.goto('/fa/');
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.className = 'intro';
    p.id = 'probe';
    // ZWNJ in می‌سازم, Persian digits ۰۱۲۳۴۵۶۷۸۹, the Persian comma ، and guillemets «».
    p.textContent = 'می‌سازم ۰۱۲۳۴۵۶۷۸۹ ۲۸ مهر ۱۴۰۵، «متن»: ؟';
    document.querySelector('main')?.append(p);
  });
  const seen = await expectNoFallbackFont(page);
  expect(seen.length).toBeGreaterThan(0);
});

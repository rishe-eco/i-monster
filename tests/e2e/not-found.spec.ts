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

const PAGES: [Lang, string, string][] = [
  ['en', '/no-such-page', 'Something ate this page.'],
  ['fa', '/fa/no-such-page', 'چیزی این صفحه را خورد.'],
];

for (const [lang, path, title] of PAGES) {
  test.describe(`404, ${lang}`, () => {
    test('is a 404 that fits 360px in the colour scheme (AC-28, AC-32, AC-40)', async ({ page }, info) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expectLangAndDir(page, lang);
      await expectColourScheme(page, info);
      await expectNoSidewaysScroll(page);
      await expectTapTargets(page);
      await expect(page.locator('h1')).toHaveText(title);
    });

    test('names the owner and links to the landing page, log and podcast of its language (AC-26)', async ({ page }) => {
      await page.goto(path);
      const prefix = lang === 'fa' ? '/fa' : '';
      await expect(page.locator('.wordmark')).toHaveText('iMNSTR');
      await expect(page.locator('.wordmark')).toHaveAttribute('href', lang === 'fa' ? '/fa/' : '/');
      await expect(page.locator(`main a[href="${prefix}/log"]`)).toBeVisible();
      await expect(page.locator(`main a[href="${prefix}/podcast"]`)).toBeVisible();
      await expect(page.locator(`main a[href="${lang === 'fa' ? '/fa/' : '/'}"]`)).toBeVisible();
    });

    test('still fits when the 360px phone is zoomed to 200% (HIG #8)', async ({ page }) => {
      await page.goto(path);
      await expectNoSidewaysScroll(page, 180);
    });

    test('makes no request to another origin and sets no cookie (AC-7)', async ({ page }) => {
      const requests = watchRequests(page);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expectNoThirdParty(page, requests);
      await expectNoCookies(page);
    });

    test('draws every glyph in its own fonts, never a fallback (AC-40)', async ({ page }) => {
      await page.goto(path);
      await expectNoFallbackFont(page);
      const loaded = await loadedFamilies(page);
      for (const family of FAMILIES[lang]) expect(loaded).toContain(family);
    });

    test('has a switch to the other language landing page (AC-41)', async ({ page }) => {
      await page.goto(path);
      const other = lang === 'en' ? 'fa' : 'en';
      const target = page.locator(`header a[hreflang="${other}"]`);
      await expect(target).toHaveText(other === 'fa' ? 'فارسی' : 'English');
      await target.click();
      await expect(page).toHaveURL(other === 'fa' ? '/fa/' : '/');
      await expectLangAndDir(page, other);
    });
  });
}

test('is one page, whatever was asked for, and never repeats the path (AC-28)', async ({ page }) => {
  await page.goto('/log/abcdefghjk');
  const first = await page.content();
  await page.goto('/some/other/place');
  expect(await page.content()).toBe(first);
  expect(first).not.toContain('abcdefghjk');
});

test('does not redirect an English id under /fa/log/ or a Persian id under /log/ (AC-28)', async ({ request }) => {
  for (const path of ['/log/abcdefghjk', '/fa/log/abcdefghjk']) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBe(404);
    expect(res.headers()['location']).toBeUndefined();
  }
});

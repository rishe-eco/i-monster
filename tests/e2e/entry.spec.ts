// An entry's own page, in both languages and both colour schemes, at 360 px and
// 200% zoom (plan B3; AC-2, AC-13, AC-14, AC-26, AC-28, AC-31, AC-37, AC-41, AC-48).
import { expect, test } from '@playwright/test';
import {
  LONG_TEXT,
  MIXED,
  expectColourScheme,
  expectLangAndDir,
  expectNoCookies,
  expectNoFallbackFont,
  expectNoSidewaysScroll,
  expectNoThirdParty,
  expectTapTargets,
  plainEntries,
  resetLog,
  watchRequests,
  type Lang,
} from './support.ts';

const LANGS: Lang[] = ['en', 'fa'];
const logPath = (lang: Lang) => (lang === 'fa' ? '/fa/log' : '/log');
const prefix = (lang: Lang) => (lang === 'fa' ? '/fa' : '');

for (const lang of LANGS) {
  test.describe(`an entry page, ${lang}`, () => {
    test('titled, several paragraphs: fits 360 px and 200% zoom, in the colour scheme', async ({ page, request }, info) => {
      const [id] = await resetLog(request, [
        {
          lang,
          title: lang === 'fa' ? 'عنوان نوشته' : 'A titled entry',
          text: lang === 'fa' ? 'بند نخست.\n\nبند ==دوم== اینجا.\n\nبند سوم.' : 'First paragraph.\n\nThe ==second== one.\n\nThird.',
        },
      ]);
      await page.goto(`${logPath(lang)}/${id}`);
      await expectLangAndDir(page, lang);
      await expectColourScheme(page, info);
      await expectTapTargets(page);
      await expect(page.locator('h1')).toHaveText(lang === 'fa' ? 'عنوان نوشته' : 'A titled entry');
      await expect(page.locator('.entry-page__body p')).toHaveCount(3);
      await expect(page.locator('.entry-page__body mark')).toHaveCount(1);
      await expectNoSidewaysScroll(page, 360);
      await expectNoSidewaysScroll(page, 180);
    });

    test('untitled, with a long paragraph and a 100-character word: wraps at every width', async ({ page, request }) => {
      const [id] = await resetLog(request, [
        { lang, text: lang === 'fa' ? `${'متن بلند. '.repeat(40)}${'x'.repeat(100)}` : LONG_TEXT },
      ]);
      await page.goto(`${logPath(lang)}/${id}`);
      // No visible title, but a heading for assistive technology: the date.
      await expect(page.locator('h1.visually-hidden')).toHaveCount(1);
      await expectNoSidewaysScroll(page, 360);
      await expectNoSidewaysScroll(page, 180);
    });

    test('has no previous or next, no count, and no sign of an edit (W4, AC-5, AC-13)', async ({ page, request }) => {
      const ids = await resetLog(request, plainEntries(lang, 3));
      await page.goto(`${logPath(lang)}/${ids[1]}`);
      const text = await page.locator('main').innerText();
      expect(text).not.toMatch(/previous|next|older|newer|edited|updated|latest/i);
      expect(await page.content()).not.toContain(ids[0] as string);
      expect(await page.content()).not.toContain(ids[2] as string);
    });

    test('links to itself by its date, back to the log, and names the owner (AC-26)', async ({ page, request }) => {
      const [id] = await resetLog(request, plainEntries(lang, 1));
      await page.goto(`${logPath(lang)}/${id}`);
      await expect(page.locator('.entry-page__date')).toHaveAttribute('href', `${logPath(lang)}/${id}`);
      await expect(page.locator('.entry-page__date')).toHaveText(lang === 'fa' ? '۱۷ مهر ۱۴۰۵، ۱۵:۳۰' : '9 Oct 2026, 15:30');
      await expect(page.locator('main a.big-row')).toHaveAttribute('href', logPath(lang));
      await expect(page.locator('.entry-page__owner a').first()).toHaveAttribute('href', lang === 'fa' ? '/fa/' : '/');
      await expect(page.locator('.entry-page__owner a').nth(1)).toHaveAttribute('href', `${prefix(lang)}/podcast`);
      await expect(page.locator('header a.wordmark')).toHaveText('iMNSTR');
    });

    test('has the switch to the other language\'s log, not to a counterpart (AC-41)', async ({ page, request }) => {
      const [id] = await resetLog(request, plainEntries(lang, 1));
      await page.goto(`${logPath(lang)}/${id}`);
      const other: Lang = lang === 'en' ? 'fa' : 'en';
      await page.locator(`header a[hreflang="${other}"]`).click();
      await expect(page).toHaveURL(logPath(other));
      await expectLangAndDir(page, other);
    });

    test('answers the other language\'s id and an unknown id with the same 404, with no redirect (AC-28)', async ({ page, request }) => {
      const other: Lang = lang === 'en' ? 'fa' : 'en';
      const [elsewhere] = await resetLog(request, plainEntries(other, 1));
      for (const path of [`${logPath(lang)}/${elsewhere}`, `${logPath(lang)}/abcdefghjk`]) {
        const res = await page.goto(path);
        expect(res?.status()).toBe(404);
        expect(page.url()).toContain(path);
        await expectLangAndDir(page, lang);
        await expect(page.locator('h1')).toHaveText(lang === 'fa' ? 'چیزی این صفحه را خورد.' : 'Something ate this page.');
      }
    });

    test('draws every glyph in its own fonts and makes no off-origin request or cookie (AC-7, AC-40)', async ({ page, request }) => {
      const [id] = await resetLog(request, plainEntries(lang, 1));
      const requests = watchRequests(page);
      await page.goto(`${logPath(lang)}/${id}`);
      expect((await expectNoFallbackFont(page)).length).toBeGreaterThan(0);
      await expectNoThirdParty(page, requests);
      await expectNoCookies(page);
    });
  });
}

test.describe('mixed-direction text on an entry page (AC-48)', () => {
  test('a Persian entry keeps the English word and the URL in their own order', async ({ page, request }) => {
    const [id] = await resetLog(request, [{ lang: 'fa', text: MIXED.fa.text }]);
    await page.goto(`/fa/log/${id}`);
    const p = page.locator('.entry-page__body p');
    expect(await p.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
    const url = p.locator('bdi[dir="ltr"]');
    await expect(url).toContainText('https://example.org/passkeys/');
    expect(await url.evaluate((e) => getComputedStyle(e).unicodeBidi)).toBe('isolate');
    // The English word starts the paragraph, so it is at the right edge of the first line.
    const box = await p.boundingBox();
    const word = await p.locator('bdi[lang="en"]').first().boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0) - ((word?.x ?? 0) + (word?.width ?? 0))).toBeLessThan(4);
    await expectNoSidewaysScroll(page, 180);
  });

  test('an English entry isolates its Persian runs right to left', async ({ page, request }) => {
    const [id] = await resetLog(request, [{ lang: 'en', text: MIXED.en.text }]);
    await page.goto(`/log/${id}`);
    const run = page.locator('.entry-page__body bdi[lang="fa"]').first();
    expect(await run.evaluate((e) => getComputedStyle(e).direction)).toBe('rtl');
    await expectNoSidewaysScroll(page, 180);
  });
});

test.describe('links in a body (PD-7, AC-33)', () => {
  test('an https link carries rel="noopener" and a mailto link opens no page', async ({ page, request }) => {
    const [id] = await resetLog(request, [{ lang: 'en', text: '[site](https://example.org/x) and [me](mailto:me@example.org)' }]);
    await page.goto(`/log/${id}`);
    await expect(page.locator('.entry-page__body a[href^="https"]')).toHaveAttribute('rel', 'noopener');
    expect(await page.locator('.entry-page__body a[href^="mailto"]').getAttribute('rel')).toBeNull();
  });
});

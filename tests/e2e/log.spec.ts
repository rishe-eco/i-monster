// The public log, in both languages and both colour schemes, at 360 px and at
// 200% zoom (180 px): zero, one, three and 21 entries, paging, mixed text, the
// feed link (plan B3; AC-2, AC-4, AC-5, AC-7, AC-27, AC-30, AC-37, AC-39, AC-40, AC-42, AC-48).
import { expect, test } from '@playwright/test';
import {
  FAMILIES,
  LONG_TEXT,
  MIXED,
  expectColourScheme,
  expectLangAndDir,
  expectNoCookies,
  expectNoFallbackFont,
  expectNoSidewaysScroll,
  expectNoThirdParty,
  expectTapTargets,
  loadedFamilies,
  plainEntries,
  resetLog,
  sampleText,
  watchRequests,
  type Lang,
} from './support.ts';

const LANGS: Lang[] = ['en', 'fa'];
const logPath = (lang: Lang) => (lang === 'fa' ? '/fa/log' : '/log');

for (const lang of LANGS) {
  test.describe(`the log, ${lang}`, () => {
    for (const count of [0, 1, 3, 21]) {
      test(`with ${count} entries: fits 360 px and 200% zoom, in the colour scheme (AC-4, AC-5, AC-30, AC-32)`, async ({ page, request }, info) => {
        await resetLog(request, plainEntries(lang, count));
        await page.goto(logPath(lang));
        await expectLangAndDir(page, lang);
        await expectColourScheme(page, info);
        await expectTapTargets(page);
        await expect(page.locator('h1.page-title')).toBeVisible();
        await expect(page.locator('main article')).toHaveCount(Math.min(count, 20));
        // The feed link stays, including with no entries (AC-27, F8).
        await expect(page.locator('main a.feed-link')).toHaveAttribute('href', `${logPath(lang)}/feed.xml`);
        await expect(page.locator('.empty')).toHaveCount(count === 0 ? 1 : 0);
        await expect(page.locator('.older')).toHaveCount(count > 20 ? 1 : 0);
        await expectNoSidewaysScroll(page, 360);
        await expectNoSidewaysScroll(page, 180);
      });
    }

    test('shows no count, page number or "latest" in what a reader sees (AC-5, AC-30)', async ({ page, request }) => {
      await resetLog(request, plainEntries(lang, 21));
      await page.goto(logPath(lang));
      const text = await page.locator('main').innerText();
      expect(text).not.toMatch(/\bpage\s*\d|\bof\s+\d+\b|\b\d+\s+(entries|learnings)\b|latest|total/i);
      expect(text).not.toMatch(/صفحهٔ\s*[\d۰-۹]|مجموع|آخرین/);
      expect(page.url()).not.toMatch(/[?&](page|p|offset)=/);
    });

    test('pages back with "Older entries" and ends on the last page (AC-30)', async ({ page, request }) => {
      await resetLog(request, plainEntries(lang, 21));
      await page.goto(logPath(lang));
      await page.locator('.older a').click();
      await expect(page).toHaveURL(/\?before=[0-9a-z]{10}$/);
      await expect(page.locator('main article')).toHaveCount(1);
      await expect(page.locator('main article')).toContainText(sampleText(lang, 21));
      await expect(page.locator('.older')).toHaveCount(0);
      await expectNoSidewaysScroll(page, 360);
      await expectNoSidewaysScroll(page, 180);
    });

    test('answers a made-up cursor with that language\'s 404 (PD-25)', async ({ page, request }) => {
      await resetLog(request, plainEntries(lang, 3));
      const res = await page.goto(`${logPath(lang)}?before=abcdefghjk`);
      expect(res?.status()).toBe(404);
      await expectLangAndDir(page, lang);
    });

    test('draws every glyph in its own fonts, the pilcrow and the dates included (AC-40)', async ({ page, request }) => {
      await resetLog(request, plainEntries(lang, 3));
      await page.goto(logPath(lang));
      expect((await expectNoFallbackFont(page)).length).toBeGreaterThan(0);
      const loaded = await loadedFamilies(page);
      for (const family of FAMILIES[lang]) expect(loaded).toContain(family);
    });

    test('makes no request to another origin and sets no cookie (AC-7)', async ({ page, request }) => {
      await resetLog(request, plainEntries(lang, 3));
      const requests = watchRequests(page);
      await page.goto(logPath(lang));
      await page.waitForLoadState('networkidle');
      await expectNoThirdParty(page, requests);
      await expectNoCookies(page);
    });

    test('shows a long paragraph and a 100-character word without scrolling sideways (AC-36)', async ({ page, request }) => {
      await resetLog(request, [
        { lang, title: lang === 'fa' ? 'عنوان' : 'A long one', text: lang === 'fa' ? `${'متن بلند. '.repeat(40)}${'x'.repeat(100)}` : LONG_TEXT },
        ...plainEntries(lang, 2),
      ]);
      await page.goto(logPath(lang));
      await expectNoSidewaysScroll(page, 360);
      await expectNoSidewaysScroll(page, 180);
    });

    test('keeps the first-published date and no mark of an edit, and links the date to the entry (AC-2, AC-31)', async ({ page, request }) => {
      const [id] = await resetLog(request, plainEntries(lang, 1));
      await page.goto(logPath(lang));
      const date = page.locator('.entry__date');
      await expect(date).toHaveAttribute('href', `${logPath(lang)}/${id}`);
      // A day before the fixed clock: 9 Oct 2026 in Tehran, 15:30.
      await expect(date).toHaveText(lang === 'fa' ? '۱۷ مهر ۱۴۰۵، ۱۵:۳۰' : '9 Oct 2026, 15:30');
      const box = await date.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
    });

    test('has the switch to the other language\'s log, and hreflang alternates (AC-41)', async ({ page, request }) => {
      await resetLog(request, plainEntries(lang, 1));
      await page.goto(logPath(lang));
      const other: Lang = lang === 'en' ? 'fa' : 'en';
      const target = page.locator(`header a[hreflang="${other}"]`);
      await expect(target).toHaveText(other === 'fa' ? 'فارسی' : 'English');
      await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute('href', 'https://imnstr.com/log');
      await expect(page.locator('link[rel="alternate"][hreflang="fa"]')).toHaveAttribute('href', 'https://imnstr.com/fa/log');
      await target.click();
      await expect(page).toHaveURL(logPath(other));
      await expectLangAndDir(page, other);
    });
  });
}

test.describe('mixed-direction text (AC-48)', () => {
  test('a Persian entry that starts with an English word reads right to left on /fa/log, with the word and URL isolated', async ({ page, request }) => {
    await resetLog(request, [{ lang: 'fa', title: MIXED.fa.title, text: MIXED.fa.text }]);
    await page.goto('/fa/log');
    const first = page.locator('.entry__first');
    expect(await first.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
    const word = first.locator('bdi[lang="en"]').first();
    const url = first.locator('bdi[dir="ltr"]');
    await expect(word).toHaveText('Passkey');
    await expect(url).toContainText('https://example.org/passkeys/');
    for (const el of [word, url]) {
      expect(await el.evaluate((e) => getComputedStyle(e).unicodeBidi)).toBe('isolate');
    }
    // The URL keeps its left-to-right order: its box is as wide as its text, not mirrored.
    expect(await url.evaluate((e) => getComputedStyle(e).direction)).toBe('ltr');
    await expectNoSidewaysScroll(page, 360);
    await expectNoSidewaysScroll(page, 180);
  });

  test('on its own page, the title starts at the right edge although it begins in English', async ({ page, request }) => {
    const [id] = await resetLog(request, [{ lang: 'fa', title: MIXED.fa.title, text: MIXED.fa.text }]);
    await page.goto(`/fa/log/${id}`);
    const h1 = await page.locator('h1').boundingBox();
    const word = await page.locator('h1 bdi[lang="en"]').boundingBox();
    expect(h1).not.toBeNull();
    // The English word is the first thing on the line, so it sits at the right (start) edge.
    expect((h1?.x ?? 0) + (h1?.width ?? 0) - ((word?.x ?? 0) + (word?.width ?? 0))).toBeLessThan(4);
    expect(await page.locator('h1').evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
    await expectNoSidewaysScroll(page, 360);
    await expectNoSidewaysScroll(page, 180);
  });

  test('an English entry holding Persian isolates it right to left, in the Persian face', async ({ page, request }) => {
    await resetLog(request, [{ lang: 'en', text: MIXED.en.text }]);
    await page.goto('/log');
    const run = page.locator('.entry__first bdi[lang="fa"]').first();
    await expect(run).toHaveText('سلام دنیا');
    expect(await run.evaluate((e) => getComputedStyle(e).direction)).toBe('rtl');
    expect(await page.locator('.entry__first').evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
    expect((await expectNoFallbackFont(page)).length).toBeGreaterThan(0);
    await expectNoSidewaysScroll(page, 180);
  });
});

test.describe('<mark> (AC-37)', () => {
  for (const lang of LANGS) {
    test(`is drawn as the highlighter and survives forced colours, ${lang}`, async ({ page, request }) => {
      await resetLog(request, [{ lang, text: lang === 'fa' ? 'یک ==نشانه== اینجا' : 'A ==mark== here' }]);
      await page.goto(logPath(lang));
      const mark = page.locator('main mark');
      await expect(mark).toHaveCount(1);
      expect(await mark.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('linear-gradient');
      await page.emulateMedia({ forcedColors: 'active' });
      const forced = await mark.evaluate((el) => {
        const style = getComputedStyle(el);
        return { image: style.backgroundImage, colour: style.backgroundColor };
      });
      expect(forced.image).toBe('none');
      expect(forced.colour).not.toBe('rgba(0, 0, 0, 0)');
    });
  }
});

test.describe('each language stands alone (AC-39, AC-42)', () => {
  test('40 English entries and no Persian: /fa/log is the empty state and mentions nothing of English', async ({ page, request }) => {
    await resetLog(request, plainEntries('en', 40));
    await page.goto('/fa/log');
    await expectLangAndDir(page, 'fa');
    await expect(page.locator('.empty')).toHaveCount(1);
    await expect(page.locator('main article')).toHaveCount(0);
    await expect(page.locator('.older')).toHaveCount(0);
    const html = await page.content();
    expect(html).not.toContain('Entry number');
    expect(html).not.toMatch(/\/log\/[0-9a-z]{10}/);
    // The English log still pages.
    await page.goto('/log');
    await expect(page.locator('main article')).toHaveCount(20);
  });

  test('English entries are not on the Persian log and the reverse', async ({ page, request }) => {
    await resetLog(request, [...plainEntries('en', 2), ...plainEntries('fa', 3).map((e) => ({ ...e, firstPublishedAt: (e.firstPublishedAt ?? 0) - 1000 }))]);
    await page.goto('/log');
    await expect(page.locator('main article')).toHaveCount(2);
    await page.goto('/fa/log');
    await expect(page.locator('main article')).toHaveCount(3);
  });
});

test.describe('the feed, reached from the page (AC-3, AC-27, AC-40)', () => {
  for (const lang of LANGS) {
    test(`is advertised on the page, parses as XML in the browser and holds the 20 newest, ${lang}`, async ({ page, request }) => {
      await resetLog(request, [...plainEntries(lang, 21), { lang, title: MIXED[lang].title, text: MIXED[lang].text, firstPublishedAt: Date.UTC(2026, 9, 11) }]);
      await page.goto(logPath(lang));
      const href = await page.locator('head link[rel="alternate"][type="application/atom+xml"]').getAttribute('href');
      expect(href).toBe(`${logPath(lang)}/feed.xml`);
      const result = await page.evaluate(async (url) => {
        const res = await fetch(url);
        const doc = new DOMParser().parseFromString(await res.text(), 'application/xml');
        return {
          type: res.headers.get('content-type'),
          error: doc.querySelector('parsererror')?.textContent ?? null,
          lang: doc.documentElement.getAttribute('xml:lang'),
          entries: doc.querySelectorAll('entry').length,
          first: doc.querySelector('entry > title')?.textContent ?? null,
          untitled: [...doc.querySelectorAll('entry > title')].at(-1)?.textContent ?? null,
          html: doc.querySelector('entry > content')?.textContent ?? '',
        };
      }, href as string);
      expect(result.error).toBeNull();
      expect(result.type).toBe('application/atom+xml; charset=utf-8');
      expect(result.lang).toBe(lang);
      expect(result.entries).toBe(20);
      expect(result.first).toBe(MIXED[lang].title);
      // The oldest of the 20 is untitled, so its title is its date (AC-40).
      expect(result.untitled).toMatch(lang === 'fa' ? /^[۰-۹]{1,2} \S+ [۱۴۰۵]{4}$/ : /^\d{1,2} [A-Z][a-z]+ 2026$/);
      // AC-48 in the feed's HTML.
      if (lang === 'fa') {
        expect(result.html).toContain('<div dir="rtl">');
        expect(result.html).toContain('<bdi lang="en">Passkey</bdi>');
        expect(result.html).toContain('<bdi dir="ltr">https://example.org/passkeys/');
      } else {
        expect(result.html).toContain('<bdi lang="fa" dir="rtl">سلام دنیا</bdi>');
      }
    });
  }

  test('is reachable from the nav and the footer, and the nav and 404 links to the log resolve', async ({ page, request }) => {
    await resetLog(request, plainEntries('en', 1));
    await page.goto('/');
    for (const href of ['/log', '/log/feed.xml']) {
      const res = await request.get(href);
      expect(res.status()).toBe(200);
    }
    await page.locator('header a[href="/log"]').click();
    await expect(page).toHaveURL('/log');
    await page.goto('/nope');
    await page.locator('a.button--primary').click();
    await expect(page).toHaveURL('/log');
  });
});

test.describe('JavaScript off', () => {
  test.use({ javaScriptEnabled: false });
  for (const lang of LANGS) {
    test(`"Older entries" still works, ${lang} (AC-30)`, async ({ page, request }) => {
      await resetLog(request, plainEntries(lang, 21));
      await page.goto(logPath(lang));
      await expect(page.locator('main article')).toHaveCount(20);
      await page.locator('.older a').click();
      await expect(page.locator('main article')).toHaveCount(1);
    });
  }
});

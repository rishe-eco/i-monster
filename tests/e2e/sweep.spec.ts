// The access sweep over the public pages (plan B9; AC-19, AC-32, AC-35 to AC-38), then the motion itself:
// the intro, the reveal, the eyes, the highlighter's draw-in and the rows' sweep, each in a real browser.
// One test per page or state runs every check in `sweep-support.ts`, in both languages and, as the two
// projects, both colour schemes.
import { expect, test, type Page } from '@playwright/test';
import { resetPodcast, plainEpisodes } from './podcast-support.ts';
import { DAY, MIXED, NOW, cspViolations, expectNoSidewaysScroll, fontsSettled, plainEntries, resetLog, scheme, watchCsp, type Lang } from './support.ts';
import { axeViolations, brokenWords, clippedText, expectNoMotion, forcedColourProblems, sweep, tapTargetFailures } from './sweep-support.ts';

const LANGS: Lang[] = ['en', 'fa'];
const logPath = (lang: Lang) => (lang === 'fa' ? '/fa/log' : '/log');
const podcastPath = (lang: Lang) => (lang === 'fa' ? '/fa/podcast' : '/podcast');
const homePath = (lang: Lang) => (lang === 'fa' ? '/fa/' : '/');

async function open(page: Page, path: string): Promise<void> {
  await watchCsp(page);
  await page.goto(path);
}

/** An entry with emphasis and a link in it, in its own language, and two plain ones. */
const richLog = (lang: Lang) => [
  { lang, title: MIXED[lang].title, text: `${MIXED[lang].text}\n\nSee [the paper](https://example.org/paper).`, firstPublishedAt: NOW - DAY },
  ...plainEntries(lang, 2).map((entry) => ({ ...entry, firstPublishedAt: (entry.firstPublishedAt ?? NOW) - DAY })),
];

for (const lang of LANGS) {
  test.describe(`the sweep, public pages, ${lang}`, () => {
    test(`the landing page`, async ({ page, browser, baseURL }, info) => {
      await open(page, homePath(lang));
      await sweep(page, info, { browser, baseURL, reducedAt: homePath(lang) });
    });

    test(`the log, empty`, async ({ page, request, browser, baseURL }, info) => {
      await resetLog(request, []);
      await open(page, logPath(lang));
      await sweep(page, info, { browser, baseURL, reducedAt: logPath(lang) });
    });

    test(`the log, with entries (emphasis, a link, a title)`, async ({ page, request, browser, baseURL }, info) => {
      await resetLog(request, richLog(lang));
      await open(page, logPath(lang));
      await sweep(page, info, { browser, baseURL, reducedAt: logPath(lang) });
    });

    test(`the log, the older page`, async ({ page, request, browser, baseURL }, info) => {
      await resetLog(request, plainEntries(lang, 23));
      await open(page, logPath(lang));
      await page.locator('.older a').click();
      await expect(page).toHaveURL(/\?before=/);
      const older = new URL(page.url());
      await sweep(page, info, { browser, baseURL, reducedAt: older.pathname + older.search });
    });

    test(`the log, a middle page (Newer and Older rows)`, async ({ page, request, browser, baseURL }, info) => {
      await resetLog(request, plainEntries(lang, 45));
      await open(page, logPath(lang));
      await page.locator('.older a[rel=next]').click();
      await expect(page.locator('.older a')).toHaveCount(2);
      const middle = new URL(page.url());
      await sweep(page, info, { browser, baseURL, reducedAt: middle.pathname + middle.search });
    });

    test(`the podcast, a middle page (Newer and Older rows)`, async ({ page, request, browser, baseURL }, info) => {
      await resetPodcast(request, plainEpisodes(lang, 45));
      await open(page, podcastPath(lang));
      await page.locator('.older a[rel=next]').click();
      await expect(page.locator('.older a')).toHaveCount(2);
      const middle = new URL(page.url());
      await sweep(page, info, { browser, baseURL, reducedAt: middle.pathname + middle.search });
    });

    test(`one entry`, async ({ page, request, browser, baseURL }, info) => {
      const [id] = await resetLog(request, richLog(lang));
      await open(page, `${logPath(lang)}/${id}`);
      await sweep(page, info, { browser, baseURL, reducedAt: `${logPath(lang)}/${id}` });
    });

    test(`the podcast, empty`, async ({ page, request, browser, baseURL }, info) => {
      await resetPodcast(request, []);
      await open(page, podcastPath(lang));
      await sweep(page, info, { browser, baseURL, reducedAt: podcastPath(lang) });
    });

    test(`the podcast, with episodes`, async ({ page, request, browser, baseURL }, info) => {
      await resetPodcast(request, plainEpisodes(lang, 3));
      await open(page, podcastPath(lang));
      await sweep(page, info, { browser, baseURL, reducedAt: podcastPath(lang) });
    });

    test(`the 404`, async ({ page, browser, baseURL }, info) => {
      const path = lang === 'fa' ? '/fa/no-such-page' : '/no-such-page';
      await open(page, path);
      await sweep(page, info, { browser, baseURL, reducedAt: path });
    });
  });
}

// ── The motion, when it is allowed (the sweep above proves it stops when it is not) ──

test.describe('the wordmark', () => {
  for (const lang of LANGS) {
    test(`reveals i-MoNSTeR on hover, and its name stays iMNSTR, ${lang}`, async ({ page, request }) => {
      await resetLog(request, []);
      await open(page, logPath(lang));
      const link = page.getByRole('link', { name: 'iMNSTR', exact: true });
      await expect(link).toHaveAttribute('href', homePath(lang));
      const hidden = link.locator('.wordmark__hid');
      expect(await hidden.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))).toEqual([0, 0, 0]);
      await link.hover();
      await page.waitForTimeout(600);
      const widths = await hidden.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
      for (const width of widths) expect(width).toBeGreaterThan(2);
      // The letters weigh 500 beside the 800 of the rest.
      expect(await hidden.first().evaluate((el) => getComputedStyle(el).fontWeight)).toBe('500');
      // The accessible name is still the word, because every revealed letter is aria-hidden.
      await expect(link).toHaveAccessibleName('iMNSTR');
    });

    test(`reveals on keyboard focus, ${lang}`, async ({ page, request }) => {
      await resetLog(request, []);
      await open(page, logPath(lang));
      // The skip link is first (PL-6); the wordmark is second.
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await expect(page.locator('.wordmark')).toBeFocused();
      await page.waitForTimeout(600);
      expect(await page.locator('.wordmark__hid').first().evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(2);
    });

    test(`stays inside 360 px in every state of the landing hero, the intro included, ${lang}`, async ({ page }) => {
      await page.clock.install();
      await open(page, homePath(lang));
      const hero = page.locator('.wordmark--hero');
      await expect(hero).not.toHaveClass(/is-revealed/);
      await expectNoSidewaysScroll(page, 360);
      await page.clock.runFor(1000);
      await expect(hero).toHaveClass(/is-revealed/);
      await page.waitForTimeout(500);
      await expectNoSidewaysScroll(page, 360);
      // And at 180 px, the 200% zoom.
      await expectNoSidewaysScroll(page, 180);
      await page.setViewportSize({ width: 360, height: 800 });
    });
  }

  test('the intro plays once, 0.9 s after load and ending at 2.9 s, on the landing pages only', async ({ page }) => {
    await page.clock.install();
    await open(page, '/');
    const hero = page.locator('.wordmark--hero');
    await expect(hero).not.toHaveClass(/is-revealed/);
    await page.clock.runFor(500);
    await expect(hero).not.toHaveClass(/is-revealed/);
    await page.clock.runFor(600);
    await expect(hero).toHaveClass(/is-revealed/);
    await page.clock.runFor(1200);
    await expect(hero).toHaveClass(/is-revealed/);
    await page.clock.runFor(1500);
    await expect(hero).not.toHaveClass(/is-revealed/);
    await page.clock.runFor(10_000);
    await expect(hero).not.toHaveClass(/is-revealed/);

    // No other page has an intro: its wordmark stays closed.
    const other = await page.context().newPage();
    await other.clock.install();
    await other.goto('/log');
    await other.clock.runFor(10_000);
    await expect(other.locator('.wordmark')).not.toHaveClass(/is-revealed/);
  });

  test('a tap on the hero reveals instead of reloading, and a second tap closes it (the landing page only)', async ({ browser, baseURL }, info) => {
    const context = await browser.newContext({ baseURL, hasTouch: true, colorScheme: scheme(info), viewport: { width: 360, height: 800 } });
    try {
      const page = await context.newPage();
      await page.goto('/');
      await page.evaluate(() => {
        (window as unknown as { __stay: number }).__stay = 1;
      });
      const hero = page.locator('.wordmark--hero');
      await hero.tap();
      await expect(hero).toHaveClass(/is-revealed/);
      await page.waitForTimeout(500);
      await expectNoSidewaysScroll(page, 360);
      await hero.tap();
      await expect(hero).not.toHaveClass(/is-revealed/);
      // Still the same document: nothing reloaded.
      expect(await page.evaluate(() => (window as unknown as { __stay?: number }).__stay)).toBe(1);

      // In a header, a tap on the wordmark is a plain link: it navigates.
      await page.goto('/log');
      await page.locator('.wordmark').tap();
      await expect(page).toHaveURL(/\/$/);
    } finally {
      await context.close();
    }
  });

  test('a tap during the intro takes over from it: the intro does not hide what the tap opened', async ({ browser, baseURL }, info) => {
    const context = await browser.newContext({ baseURL, hasTouch: true, colorScheme: scheme(info), viewport: { width: 360, height: 800 } });
    try {
      const page = await context.newPage();
      await page.clock.install();
      await page.goto('/');
      const hero = page.locator('.wordmark--hero');
      await page.clock.runFor(1000);
      await expect(hero).toHaveClass(/is-revealed/);
      await hero.tap();
      await expect(hero).not.toHaveClass(/is-revealed/);
      await hero.tap();
      await expect(hero).toHaveClass(/is-revealed/);
      await page.clock.runFor(5000);
      await expect(hero).toHaveClass(/is-revealed/);
    } finally {
      await context.close();
    }
  });

  test('a tap reveals even where the click calls itself a mouse or names no pointer (Safari on an iPhone)', async ({ page }) => {
    // The intro is played to its end first, so its timers can't open or close the wordmark: only the taps do.
    await page.clock.install();
    await page.goto('/');
    await page.clock.runFor(3000);
    const hero = page.locator('.wordmark--hero');
    // iOS Safari before 18.2 sends a plain MouseEvent click; from 18.2 a PointerEvent click typed "mouse" (WebKit bug 282988).
    await hero.evaluate((el) => {
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await expect(hero).toHaveClass(/is-revealed/);
    await hero.evaluate((el) => {
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
      el.dispatchEvent(new PointerEvent('click', { pointerType: 'mouse', bubbles: true, cancelable: true }));
    });
    await expect(hero).not.toHaveClass(/is-revealed/);
    // A keyboard's Enter has no pointerdown before it: never a tap, even after one.
    await hero.focus();
    await page.keyboard.press('Enter');
    await page.mouse.move(5, 700);
    await expect(hero).not.toHaveClass(/is-revealed/);
  });

  test('a mouse click on the hero neither reloads nor leaves it open', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      (window as unknown as { __stay: number }).__stay = 1;
    });
    await page.locator('.wordmark--hero').click();
    await page.mouse.move(5, 700);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as unknown as { __stay?: number }).__stay)).toBe(1);
    await expect(page.locator('.wordmark--hero')).not.toHaveClass(/is-revealed/);
  });
});

test.describe('the eyes', () => {
  test('follow the pointer, and update once per animation frame however many moves come', async ({ page }) => {
    await page.goto('/nope');
    const pupils = page.locator('.eyes--big .eye__pupil');
    await expect(pupils).toHaveCount(2);
    // A pointer far to the lower right pulls every pupil that way; far to the upper left, the other.
    await page.mouse.move(350, 790);
    await expect.poll(() => pupils.first().evaluate((el) => parseFloat(el.style.getPropertyValue('--eye-x')))).toBeGreaterThan(0);
    expect(await pupils.first().evaluate((el) => parseFloat(el.style.getPropertyValue('--eye-y')))).toBeGreaterThan(0);
    await page.mouse.move(1, 1);
    await expect.poll(() => pupils.first().evaluate((el) => parseFloat(el.style.getPropertyValue('--eye-x')))).toBeLessThan(0);
    // Never further than a fifth of the eye from its centre, in px: the eye is 64 px (4rem) on this page.
    const reach = await pupils.first().evaluate((el) => Math.hypot(parseFloat(el.style.getPropertyValue('--eye-x')), parseFloat(el.style.getPropertyValue('--eye-y'))));
    expect(reach).toBeLessThanOrEqual(64 * 0.2 + 0.01);

    // Fifty moves in one task are one update: each eye's two properties are written once, not fifty times.
    const writes = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let count = 0;
          const original = CSSStyleDeclaration.prototype.setProperty;
          CSSStyleDeclaration.prototype.setProperty = function (name: string, ...rest: [string, string?]) {
            if (name === '--eye-x' || name === '--eye-y') count++;
            return original.call(this, name, ...rest);
          };
          for (let i = 0; i < 50; i++) window.dispatchEvent(new PointerEvent('pointermove', { clientX: 10 + i, clientY: 20 + i }));
          requestAnimationFrame(() => requestAnimationFrame(() => {
            CSSStyleDeclaration.prototype.setProperty = original;
            resolve(count);
          }));
        }),
    );
    // Two eyes in the header and two big ones, two properties each.
    expect(writes).toBe(8);
  });

  test('blink every 5.5 s, the second eye 0.04 s behind, in CSS', async ({ page }) => {
    await page.goto('/nope');
    const eyes = page.locator('.eyes--big .eye');
    const timing = await eyes.evaluateAll((els) => els.map((el) => ({ name: getComputedStyle(el).animationName, duration: getComputedStyle(el).animationDuration, delay: getComputedStyle(el).animationDelay, count: getComputedStyle(el).animationIterationCount })));
    expect(timing).toEqual([
      { name: 'eye-blink', duration: '5.5s', delay: '0s', count: 'infinite' },
      { name: 'eye-blink', duration: '5.5s', delay: '0.04s', count: 'infinite' },
    ]);
  });

  test('are decoration: hidden from assistive technology, never in the accessibility tree', async ({ page }) => {
    await page.goto('/nope');
    await expect(page.getByRole('img')).toHaveCount(0);
    expect(await page.locator('[data-eye]').evaluateAll((els) => els.every((el) => el.closest('[aria-hidden="true"]') !== null))).toBe(true);
  });
});

test.describe('the highlighter and the rows', () => {
  for (const lang of LANGS) {
    test(`the landing page's two marks draw in once, 0.7 s after 1.2 s and 0.8 s after 1.8 s, from the text's start edge, ${lang}`, async ({ page }) => {
      await page.goto(homePath(lang));
      const marks = page.locator('main .intro mark');
      await expect(marks).toHaveCount(2);
      const timing = await marks.evaluateAll((els) => els.map((el) => {
        const style = getComputedStyle(el);
        return { name: style.animationName, duration: style.animationDuration, delay: style.animationDelay, fill: style.animationFillMode, count: style.animationIterationCount, from: style.backgroundPosition.split(' ')[0] };
      }));
      expect(timing.map(({ name, duration, delay, fill, count }) => ({ name, duration, delay, fill, count }))).toEqual([
        { name: 'mark-draw', duration: '0.7s', delay: '1.2s', fill: 'both', count: '1' },
        { name: 'mark-draw', duration: '0.8s', delay: '1.8s', fill: 'both', count: '1' },
      ]);
      // It starts at the left in English and at the right in Persian, so it draws right to left there.
      for (const { from } of timing) expect(from).toBe(lang === 'fa' ? '100%' : '0px');
    });

    test(`an entry's emphasis does not animate, ${lang}`, async ({ page, request }) => {
      await resetLog(request, richLog(lang));
      await page.goto(logPath(lang));
      const marks = page.locator('main mark');
      expect(await marks.count()).toBeGreaterThan(0);
      expect(await marks.evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName))).toEqual(Array(await marks.count()).fill('none'));
    });
  }

  test('the podcast intro line is ready for a mark: its rule draws in once, and the page has none until the founder writes one (F-2)', async ({ page, request }) => {
    await resetPodcast(request, []);
    await page.goto('/podcast');
    await expect(page.locator('.page-lede--intro')).toHaveCount(1);
    await expect(page.locator('.page-lede--intro mark')).toHaveCount(0);
    // The rule exists: a mark placed in the lede takes the draw-in.
    await page.evaluate(() => {
      const lede = document.querySelector('.page-lede--intro') as HTMLElement;
      lede.innerHTML = `<mark>probe</mark> ${lede.textContent}`;
    });
    expect(await page.locator('.page-lede--intro mark').evaluate((el) => getComputedStyle(el).animationName)).toBe('mark-draw');
  });

  test('a row title keeps its full size at 360 px: the fit only bites when zoomed (PL-4)', async ({ page }) => {
    await page.goto('/');
    const sizes = await page.locator('.big-row__title').evaluateAll((els) => els.map((el) => getComputedStyle(el).fontSize));
    expect(sizes.length).toBeGreaterThan(0);
    // --size-cta at 360 px is 2.125rem, 34 px.
    for (const size of sizes) expect(size).toBe('34px');
  });

  test('a big row sweeps its highlighter in over 0.35 s on hover, and back out', async ({ page }) => {
    await page.goto('/');
    const row = page.locator('.big-row').first();
    expect(await row.evaluate((el) => getComputedStyle(el).transitionDuration)).toContain('0.35s');
    expect(await row.evaluate((el) => getComputedStyle(el).backgroundSize)).toBe('0% 100%');
    await row.evaluate((el) => {
      const seen: string[] = [];
      (window as unknown as { __runs: string[] }).__runs = seen;
      el.addEventListener('transitionrun', (event) => seen.push((event as TransitionEvent).propertyName));
    });
    await row.hover();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __runs: string[] }).__runs)).toContain('background-size');
    expect(await row.evaluate((el) => getComputedStyle(el).backgroundSize)).toBe('100% 100%');
    await page.mouse.move(2, 790);
    await page.waitForTimeout(500);
    expect(await row.evaluate((el) => getComputedStyle(el).backgroundSize)).toBe('0% 100%');
  });

  test('the sweep and the draw-in are not there when motion is reduced, and the final state shows', async ({ browser, baseURL }, info) => {
    const context = await browser.newContext({ baseURL, reducedMotion: 'reduce', colorScheme: scheme(info), viewport: { width: 360, height: 800 } });
    try {
      const page = await context.newPage();
      await page.clock.install();
      await page.goto('/');
      await fontsSettled(page);
      // The marks are drawn in full from the first frame, with no animation behind them.
      expect(await page.locator('main .intro mark').evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName))).toEqual(['none', 'none']);
      expect(await page.locator('main .intro mark').first().evaluate((el) => getComputedStyle(el).backgroundSize)).toMatch(/^100% (52|100)%$/);
      await expectNoMotion(page);
      // The intro never runs, and the script bound nothing: a pointer far off moves no pupil.
      await page.clock.runFor(10_000);
      await expect(page.locator('.wordmark--hero')).not.toHaveClass(/is-revealed/);
    } finally {
      await context.close();
    }
  });
});

// ── The skip link (PL-6) ──

test.describe('the skip link', () => {
  for (const lang of LANGS) {
    const label = lang === 'fa' ? 'پرش به محتوا' : 'Skip to content';
    const pages: [string, () => string][] = [
      ['the landing page', () => homePath(lang)],
      ['the log', () => logPath(lang)],
      ['the podcast', () => podcastPath(lang)],
      ['the 404', () => (lang === 'fa' ? '/fa/no-such-page' : '/no-such-page')],
    ];
    for (const [name, path] of pages) {
      for (const width of [360, 180]) {
        test(`on ${name}, ${lang}, at ${width} px: out of view until the first Tab, then visible, and Enter moves focus to main`, async ({ page, request }) => {
          await resetLog(request, plainEntries(lang, 2));
          await open(page, path());
          await page.setViewportSize({ width, height: 800 });
          await fontsSettled(page);
          const link = page.locator('.skip-link');
          await expect(link).toHaveText(label);
          await expect(link).toHaveAttribute('href', '#main');
          // Before any Tab it is above the viewport, and the same size it will be on focus.
          const resting = await link.boundingBox();
          expect(resting && resting.y + resting.height).toBeLessThanOrEqual(0);
          await page.keyboard.press('Tab');
          await expect(link).toBeFocused();
          const box = await link.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.y).toBeGreaterThanOrEqual(0);
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width);
          expect(box!.height).toBeGreaterThanOrEqual(44);
          await page.keyboard.press('Enter');
          await expect(page.locator('main')).toBeFocused();
          // The target is not a control: no focus ring frames the whole page (found at PL1's review).
          expect(await page.locator('main').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
        });
      }
    }
    test(`on an entry page, ${lang}, the first Tab focuses it`, async ({ page, request }) => {
      const [id] = await resetLog(request, plainEntries(lang, 1));
      await open(page, `${logPath(lang)}/${id}`);
      await page.keyboard.press('Tab');
      await expect(page.locator('.skip-link')).toBeFocused();
    });
  }
});

// ── The checks themselves: each is shown to fail on a page made wrong on purpose ──

test.describe('the checks catch what they claim to', () => {
  test('axe, the tap sizes, the clipping check, forced colours and the CSP watch each fail on a page broken on purpose', async ({ page, request }) => {
    await resetLog(request, richLog('en'));
    await open(page, '/log');
    await fontsSettled(page);
    // The page as it is passes them all.
    expect(await axeViolations(page)).toEqual([]);
    expect(await tapTargetFailures(page)).toEqual([]);
    expect(await clippedText(page)).toEqual([]);
    expect(await forcedColourProblems(page)).toEqual([]);
    expect(await cspViolations(page)).toEqual([]);

    // Now break it five ways.
    await page.evaluate(() => {
      const main = document.querySelector('main') as HTMLElement;
      // axe: an image with no alternative text, and words faded to a third.
      const image = document.createElement('img');
      image.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
      main.append(image);
      const faint = document.createElement('p');
      faint.textContent = 'Nearly invisible words.';
      faint.style.opacity = '0.3';
      main.prepend(faint);
      // The tap sizes: a 20 px button, and a link in a sentence that is only as tall as its letters.
      const small = document.createElement('button');
      small.textContent = 'x';
      small.style.inlineSize = '20px';
      small.style.blockSize = '20px';
      main.append(small);
      const sentence = document.createElement('p');
      sentence.innerHTML = 'A sentence with a <a href="/log">bare link</a> in it.';
      main.append(sentence);
      // Clipping: a box that cuts its words off.
      const box = document.createElement('div');
      box.textContent = 'These words are far too long for the box that holds them, and the box hides the rest.';
      box.style.overflow = 'hidden';
      box.style.whiteSpace = 'nowrap';
      box.style.inlineSize = '5rem';
      main.append(box);
      // Forced colours: a field with no edge, and a mark that is only a gradient.
      const field = document.createElement('input');
      field.setAttribute('aria-label', 'A field');
      field.style.border = '0';
      main.append(field);
      // A mark drawn only as a gradient, which forced colours would erase if the stylesheet did not step in.
      const lost = document.createElement('mark');
      lost.textContent = 'a lost mark';
      lost.style.setProperty('background-image', 'linear-gradient(red, red)', 'important');
      lost.style.setProperty('background-color', 'transparent', 'important');
      main.append(lost);
      // The CSP: an inline <style>, which `default-src 'self'` refuses.
      const style = document.createElement('style');
      style.textContent = 'body { outline: 0; }';
      document.head.append(style);
    });
    expect((await axeViolations(page)).join('\n')).toMatch(/image-alt/);
    expect((await axeViolations(page)).join('\n')).toMatch(/color-contrast/);
    expect((await tapTargetFailures(page)).map((f) => f.needs)).toEqual(expect.arrayContaining(['44 x 44', '24 x 24 (inline)']));
    expect((await clippedText(page)).join('\n')).toMatch(/cuts off \d+px sideways/);
    expect((await forcedColourProblems(page)).join('\n')).toMatch(/has no edge/);
    expect((await forcedColourProblems(page)).join('\n')).toMatch(/mark "a lost mark"/);
    expect(await cspViolations(page)).not.toEqual([]);
  });

  test('the broken-word check fails on a row title forced narrow, and passes on the page as it is (PL-4)', async ({ page, request }) => {
    await resetLog(request, plainEntries('fa', 23));
    await open(page, '/fa/log');
    await fontsSettled(page);
    await page.setViewportSize({ width: 180, height: 800 });
    await page.waitForTimeout(100);
    expect(await brokenWords(page)).toEqual([]);
    // Force the title into a column too narrow for its longest word: the browser cuts the word, and the check says so.
    await page.evaluate(() => {
      const title = document.querySelector<HTMLElement>('.big-row__title');
      if (!title) throw new Error('no row title');
      title.style.setProperty('font-size', '3rem', 'important');
      title.style.setProperty('inline-size', '3rem', 'important');
      title.style.setProperty('display', 'block', 'important');
    });
    expect((await brokenWords(page)).length).toBeGreaterThan(0);
    await page.setViewportSize({ width: 360, height: 800 });
  });

  test('the motion check fails when something moves under reduced motion', async ({ browser, baseURL, request }, info) => {
    await resetLog(request, []);
    const context = await browser.newContext({ baseURL, reducedMotion: 'reduce', colorScheme: scheme(info), viewport: { width: 360, height: 800 } });
    try {
      const page = await context.newPage();
      await page.goto('/log');
      await fontsSettled(page);
      await expectNoMotion(page);
      // Break the kill-switch: an element with an animation the CSS did not stop.
      await page.evaluate(() => {
        const dot = document.createElement('i');
        dot.textContent = '.';
        dot.style.setProperty('animation', 'eye-blink 1s infinite', 'important');
        document.body.append(dot);
      });
      await expect(expectNoMotion(page)).rejects.toThrow();
    } finally {
      await context.close();
    }
  });
});

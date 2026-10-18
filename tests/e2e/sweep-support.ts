// The access sweep's checks (plan B9; spec §4.6; AC-19, AC-32, AC-35 to AC-38), shared by the public and
// the admin specs. `sweep` is one call per page or state, so a state costs one test: axe at WCAG 2.2 AA,
// no sideways scroll at 360 and 180 px with the wordmark forced open, the root font at 200%, forced
// colours, reduced motion, every tap target measured, and no CSP violation.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import { cspViolations, expectNoSidewaysScroll, expectWithinColumn, fontsSettled, scheme } from './support.ts';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// ── What each check measures ──

/** axe's violations at WCAG 2.2 AA, as lines a failing test can show. */
export async function axeViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return result.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

/** Text a box cuts off: an element that clips its overflow and has more inside than it shows. A name that ends in an ellipsis on purpose is the one exception. */
export async function clippedText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const clipped: string[] = [];
    for (const el of document.body.querySelectorAll<HTMLElement>('*')) {
      if (el.closest('[aria-hidden="true"], .visually-hidden')) continue;
      // A field holds more than it shows by design: it scrolls, and a person can read all of it.
      if (el.matches('input, textarea, select')) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none') continue;
      const clipsX = style.overflowX === 'hidden' || style.overflowX === 'clip';
      const clipsY = style.overflowY === 'hidden' || style.overflowY === 'clip';
      const label = `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}`;
      if (clipsX && style.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1) clipped.push(`${label} cuts off ${el.scrollWidth - el.clientWidth}px sideways`);
      if (clipsY && el.scrollHeight > el.clientHeight + 1) clipped.push(`${label} cuts off ${el.scrollHeight - el.clientHeight}px downwards`);
    }
    return clipped;
  });
}

/**
 * Words a row title breaks inside (PL-4). For each `.big-row__title` it walks the text's words and reads
 * `Range.getClientRects()`: a word whose boxes sit on more than one line was cut by `overflow-wrap`, which
 * is what a title too wide for its column does. A title is a fit, not a wrapping rule, so none should.
 */
export async function brokenWords(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const broken: string[] = [];
    for (const title of document.querySelectorAll<HTMLElement>('.big-row__title')) {
      if (title.getClientRects().length === 0) continue;
      const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? '';
        for (const match of text.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index ?? 0);
          range.setEnd(node, (match.index ?? 0) + match[0].length);
          const rects = [...range.getClientRects()].filter((r) => r.width > 0);
          if (rects.length < 2) continue;
          const tops = rects.map((r) => r.top);
          if (Math.max(...tops) - Math.min(...tops) > rects[0]!.height / 2) broken.push(`"${match[0]}" in "${(title.textContent ?? '').trim()}"`);
        }
      }
    }
    return broken;
  });
}

/**
 * In the admin the highlighter is the emphasis a text carries (PL-1): it fills a <mark>, a Highlight tool that is
 * on, and a row under the pointer. A button that is drawn in it, and is not that tool, is a primary action in the
 * old look. The token is resolved by the browser, so both schemes and every colour format agree.
 */
export async function highlightedButtons(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const probe = document.createElement('i');
    probe.style.backgroundColor = 'var(--highlight)';
    document.body.append(probe);
    const highlight = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const found: string[] = [];
    for (const button of document.querySelectorAll<HTMLElement>('button, a.btn, [role=button]')) {
      if (button.getClientRects().length === 0 || button.matches(".tool[aria-pressed='true']")) continue;
      if (getComputedStyle(button).backgroundColor === highlight) found.push(`${button.tagName.toLowerCase()}.${button.className} "${(button.textContent ?? '').trim().slice(0, 30)}"`);
    }
    return found;
  });
}

/** The wordmark in its widest state, which is the review's #2: every one forced open, and the 0.35 s growth finished. */
async function revealWordmarks(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelectorAll('.wordmark').forEach((el) => el.classList.add('is-revealed')));
  await page.waitForTimeout(500);
}

interface TargetFailure {
  what: string;
  width: number;
  height: number;
  needs: string;
}

/**
 * Every tap target on the page at the width it is in (AC-35): 44 x 44, 24 x 24 for a link inside running
 * text or a date link, and 52 tall for a primary button. A target may be larger than its box on purpose, by
 * padding or a pseudo-element, and then it is the box that is measured, since that is what a finger hits.
 */
export async function tapTargetFailures(page: Page): Promise<TargetFailure[]> {
  return page.evaluate(() => {
    const failures: { what: string; width: number; height: number; needs: string }[] = [];
    const targets = document.querySelectorAll<HTMLElement>(
      'a[href], button, input:not([type=hidden]), textarea, select, summary, [role=button], [contenteditable=true], [tabindex]:not([tabindex="-1"])',
    );
    const textOutside = (el: HTMLElement): boolean => {
      // Running text: the nearest block holds words that are not this link's own.
      let block: HTMLElement | null = el.parentElement;
      while (block && getComputedStyle(block).display.startsWith('inline')) block = block.parentElement;
      if (!block) return false;
      return [...block.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '');
    };
    for (const el of targets) {
      if (el.closest('[aria-hidden="true"]')) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rects = [...el.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      if (rects.length === 0) continue;
      const union = el.getBoundingClientRect();
      const label = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : ''} "${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`;
      const inline = el.tagName === 'A' && ((style.display === 'inline' && textOutside(el)) || el.querySelector('time') !== null || el.classList.contains('entry-page__date'));
      // A link split over two lines has one box per line: the tallest is what a finger can aim at.
      const height = inline ? Math.max(...rects.map((r) => r.height)) : union.height;
      const width = union.width;
      const primary = el.classList.contains('btn--primary') || el.classList.contains('button--primary');
      const [needsW, needsH, name] = inline ? [24, 24, '24 x 24 (inline)'] : [44, primary ? 52 : 44, primary ? '44 x 52 (primary)' : '44 x 44'];
      if (width < needsW - 0.5 || height < needsH - 0.5) failures.push({ what: label, width: Math.round(width * 10) / 10, height: Math.round(height * 10) / 10, needs: name });
    }
    return failures;
  });
}

/** In forced colours the highlighter and the field edges are drawn in system colours: still there, and still apart from the page (AC-37). */
export async function forcedColourProblems(page: Page): Promise<string[]> {
  await page.emulateMedia({ forcedColors: 'active' });
  try {
    return await page.evaluate(() => {
      const problems: string[] = [];
      const canvas = getComputedStyle(document.body).backgroundColor;
      for (const mark of document.querySelectorAll<HTMLElement>('mark')) {
        if (mark.closest('[aria-hidden="true"]') || mark.getClientRects().length === 0) continue;
        const style = getComputedStyle(mark);
        if (style.backgroundImage !== 'none') problems.push(`mark "${mark.textContent}" still has a gradient`);
        if (style.backgroundColor === 'rgba(0, 0, 0, 0)' || style.backgroundColor === canvas) problems.push(`mark "${mark.textContent}" is not drawn apart from the page`);
        if (style.color === style.backgroundColor) problems.push(`mark "${mark.textContent}" has its text in its own colour`);
      }
      const fields = document.querySelectorAll<HTMLElement>('input:not([type=hidden]):not([type=radio]), textarea, select, .editor__body');
      for (const field of fields) {
        if (field.getClientRects().length === 0) continue;
        const style = getComputedStyle(field);
        const name = `${field.tagName.toLowerCase()}${field.id ? '#' + field.id : ''}`;
        if (parseFloat(style.borderTopWidth) < 1 || style.borderTopStyle === 'none') problems.push(`${name} has no edge`);
        else if (style.borderTopColor === 'rgba(0, 0, 0, 0)' || style.borderTopColor === canvas) problems.push(`${name}'s edge is the page's own colour`);
      }
      return problems;
    });
  } finally {
    await page.emulateMedia({ forcedColors: 'none' });
  }
}

/**
 * Nothing moves under reduced motion (AC-38). The page was loaded with the preference already set, so the
 * script bound nothing: hover the wordmark and every row, sweep the pointer across the page, and count the
 * animations and transitions that start. The pupils must not have been touched either.
 */
export async function expectNoMotion(page: Page, options: { pupils?: boolean } = {}): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __motion: string[] }).__motion = seen;
    for (const type of ['animationstart', 'transitionrun']) document.addEventListener(type, (event) => seen.push(`${type} ${(event.target as HTMLElement).className}`), true);
  });
  // Light the way for the hover rules: the wordmark and the first few rows or buttons.
  for (const selector of ['.wordmark', '.big-row', '.pill-link', '.btn', '.nav a']) {
    // Move the pointer to each one's centre, with no waiting for it to be actionable: a modal dialog makes the page behind it unreachable, and the pointer is still moved over it.
    for (const target of (await page.locator(`${selector}:visible`).all()).slice(0, 3)) {
      const box = await target.boundingBox();
      if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
    }
  }
  const size = page.viewportSize() ?? { width: 360, height: 800 };
  for (const [x, y] of [[4, 4], [size.width / 2, size.height / 3], [size.width - 4, size.height - 4], [size.width / 3, size.height / 2]] as const) await page.mouse.move(x, y, { steps: 4 });
  await page.waitForTimeout(450);
  expect(await page.evaluate(() => (window as unknown as { __motion: string[] }).__motion)).toEqual([]);
  // A pupil that had moved would carry the script's custom property. Only a page loaded with the preference
  // already set can prove the script bound nothing: in place, the script ran before the preference changed.
  if (options.pupils !== false) {
    const moved = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.eye__pupil')].filter((el) => el.style.getPropertyValue('--eye-x') !== '').length);
    expect(moved, 'pupils the script moved').toBe(0);
  }
  // And the CSS kill-switch: nothing on the page declares a running animation or a transition.
  const live = await page.evaluate(() => [...document.querySelectorAll('*')].filter((el) => getComputedStyle(el).animationName !== 'none' || parseFloat(getComputedStyle(el).transitionDuration) > 0).length);
  expect(live, 'elements with an animation or a transition').toBe(0);
}

export interface SweepOptions {
  /** The admin: its controls must stay in the column, and its states are not reachable by one address. */
  column?: string;
  /** The address to load again with reduced motion set, in a fresh context. Without one, the preference is set in place (the pupils then have nothing to prove). */
  reducedAt?: string;
  /** Someone has to be signed in or out for the reload at that address: the context to copy its storage from. */
  browser?: Browser;
  baseURL?: string;
  /** Skip a check that does not apply to this state, with the reason, so the skip is read in the spec. */
  skip?: Partial<Record<'forced' | 'targets' | 'scroll180', string>>;
}

/** Every check, on the page as it stands. One test per page or state calls this once. */
export async function sweep(page: Page, info: TestInfo, options: SweepOptions = {}): Promise<void> {
  await fontsSettled(page);
  const name = info.title;

  // axe, at the width the page is first drawn in (360 px).
  expect(await axeViolations(page), `${name}: axe`).toEqual([]);

  // The admin's primary actions are solid ink, not the highlighter (PL-1). `column` says this is the admin.
  if (options.column) expect(await highlightedButtons(page), `${name}: buttons drawn in the highlighter`).toEqual([]);

  // Tap targets, at 360 px, in the resting state.
  if (!options.skip?.targets) expect(await tapTargetFailures(page), `${name}: tap targets at 360 px`).toEqual([]);

  // No sideways scroll at 360 and at 180 px, with every wordmark forced open.
  await revealWordmarks(page);
  await expectNoSidewaysScroll(page, 360);
  if (options.column) await expectWithinColumn(page, options.column);
  if (!options.skip?.scroll180) {
    await expectNoSidewaysScroll(page, 180);
    if (options.column) await expectWithinColumn(page, options.column);
    expect(await brokenWords(page), `${name}: words a row title breaks at 180 px`).toEqual([]);
  }
  await page.setViewportSize({ width: 360, height: 800 });

  // The root font at 200%: at 360 and at 1280, nothing sideways and no text cut off.
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(100);
    const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
    expect(widths.page, `${name}: scroll width at ${width} px with 200% text`).toBeLessThanOrEqual(widths.viewport);
    expect(await clippedText(page), `${name}: clipped text at ${width} px with 200% text`).toEqual([]);
    if (options.column && width === 360) await expectWithinColumn(page, options.column);
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  await page.setViewportSize({ width: 360, height: 800 });

  // Forced colours.
  if (!options.skip?.forced) expect(await forcedColourProblems(page), `${name}: forced colours`).toEqual([]);

  // No CSP violation on the page, through every state above.
  expect(await cspViolations(page), `${name}: CSP violations`).toEqual([]);

  // Reduced motion, last, because it loads the page again with the preference set.
  const dark = scheme(info) === 'dark';
  if (options.reducedAt && options.browser) {
    const context = await options.browser.newContext({ baseURL: options.baseURL, reducedMotion: 'reduce', colorScheme: dark ? 'dark' : 'light', viewport: { width: 360, height: 800 } });
    try {
      const quiet = await context.newPage();
      await quiet.goto(options.reducedAt);
      await fontsSettled(quiet);
      await expectNoMotion(quiet);
    } finally {
      await context.close();
    }
  } else {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    try {
      await expectNoMotion(page, { pupils: false });
    } finally {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    }
  }
}

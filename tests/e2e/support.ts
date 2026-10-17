// Checks every public page's e2e spec shares: the same promises, asked of each page kind.
import { expect, type APIRequestContext, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

export type Lang = 'en' | 'fa';

export const GROUND = {
  light: 'rgb(239, 240, 234)', // #eff0ea
  dark: 'rgb(17, 32, 25)', // #112019
} as const;

/** The families a language's page may be drawn in, as document.fonts names them. */
export const FAMILIES: Record<Lang, string[]> = {
  en: ['Bricolage Grotesque', 'Newsreader'],
  fa: ['Estedad', 'Vazirmatn'],
};

export function scheme(info: TestInfo): 'light' | 'dark' {
  return info.project.name === 'dark' ? 'dark' : 'light';
}

/** Record every request the page makes, so a test can say none left its own origin (AC-7). */
export function watchRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  return urls;
}

export async function expectNoThirdParty(page: Page, requests: string[]): Promise<void> {
  const origin = new URL(page.url()).origin;
  const foreign = requests.filter((url) => !url.startsWith(origin) && !url.startsWith('data:'));
  expect(foreign).toEqual([]);
}

/** No horizontal scroll at `width` CSS px: 360 is the phone, 180 is that phone zoomed to 200% (HIG #8). */
export async function expectNoSidewaysScroll(page: Page, width = 360): Promise<void> {
  if (width !== 360) await page.setViewportSize({ width, height: 800 });
  // Measure the final faces: the fallback fonts are narrower and hide an overflow.
  await fontsSettled(page);
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(widths.viewport).toBe(width);
  expect(widths.page).toBeLessThanOrEqual(widths.viewport);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
}

export async function expectColourScheme(page: Page, info: TestInfo): Promise<void> {
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe(GROUND[scheme(info)]);
}

export async function expectLangAndDir(page: Page, lang: Lang): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
  await expect(page.locator('html')).toHaveAttribute('dir', lang === 'fa' ? 'rtl' : 'ltr');
}

/**
 * Every control inside the column, not only inside the screen: a button that runs into the gutter
 * still leaves no sideways scroll, and still looks broken (found at B6's review: Highlight at 180 px).
 * Shared by the editor, the episode form and the access sweep.
 */
export async function expectWithinColumn(page: Page, where: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const column = await page.locator('main').evaluate((main) => {
    const style = getComputedStyle(main);
    const rect = main.getBoundingClientRect();
    return { left: rect.left + parseFloat(style.paddingInlineStart), right: rect.right - parseFloat(style.paddingInlineEnd) };
  });
  const controls = page.locator(`${where} button, ${where} input:not([type=radio]), ${where} textarea, ${where} .segmented__options, ${where} .field__error`);
  expect(await controls.count()).toBeGreaterThan(0);
  for (const control of await controls.all()) {
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    const name = (await control.innerText().catch(() => '')) || ((await control.getAttribute('id')) ?? '');
    expect((box?.x ?? -1) >= column.left - 0.5 && (box?.x ?? 0) + (box?.width ?? 0) <= column.right + 0.5, `${name} stays in the column`).toBe(true);
  }
}

/** Header and footer links meet the 44px tap target (spec §4.6, HIG #1). */
export async function expectTapTargets(page: Page): Promise<void> {
  const links = page.locator('header a, footer a');
  const count = await links.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    if (!(await link.isVisible())) continue;
    const box = await link.boundingBox();
    expect(box, await link.innerText()).not.toBeNull();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  }
}

/** No cookie is set for the page, and none can be read from script (AC-7). */
export async function expectNoCookies(page: Page): Promise<void> {
  expect(await page.context().cookies()).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).toBe('');
}

/** Wait until the page's fonts have loaded, so what is drawn is the final face. */
export async function fontsSettled(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
}

/**
 * AC-40: every glyph on the page is drawn in one of our own fonts, never a
 * system fallback. Asks the browser which platform font drew each element's
 * text, through the DevTools protocol, and checks the answer is a web font.
 * Returns the family names it saw.
 */
export async function expectNoFallbackFont(page: Page): Promise<string[]> {
  await fontsSettled(page);
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    const { root } = await client.send('DOM.getDocument', { depth: 0 });
    const { nodeIds } = await client.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'body, body *' });
    const seen = new Set<string>();
    const fallbacks: string[] = [];
    for (const nodeId of nodeIds) {
      const { fonts } = await client.send('CSS.getPlatformFontsForNode', { nodeId });
      for (const font of fonts) {
        seen.add(font.familyName);
        if (!font.isCustomFont) fallbacks.push(`${font.familyName} (${font.glyphCount} glyphs)`);
      }
    }
    expect(fallbacks).toEqual([]);
    return [...seen];
  } finally {
    await client.detach();
  }
}

/** The families whose faces the document has loaded. */
export async function loadedFamilies(page: Page): Promise<string[]> {
  await fontsSettled(page);
  return page.evaluate(() => {
    const loaded = new Set<string>();
    document.fonts.forEach((face) => {
      if (face.status === 'loaded') loaded.add(face.family.replace(/^["']|["']$/g, ''));
    });
    return [...loaded];
  });
}

// ── Seeding the log through the e2e-only routes ──

/** The fixed instant every e2e fixture date is relative to (2026-10-10 12:00 UTC). */
export const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);
export const DAY = 24 * 60 * 60 * 1000;

export interface SeedEntry {
  lang: Lang;
  title?: string;
  text: string;
  firstPublishedAt?: number;
  id?: string;
}

/** Text in the entry's own language, so nothing needs isolating unless a test says so. */
export const sampleText = (lang: Lang, n: number): string => (lang === 'fa' ? `نوشتهٔ شماره ${n}` : `Entry number ${n}`);

/** `count` plain entries of one language, newest first, a day apart. */
export function plainEntries(lang: Lang, count: number): SeedEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    lang,
    text: sampleText(lang, i + 1),
    firstPublishedAt: NOW - (i + 1) * DAY,
  }));
}

/** Fix the clock, empty the entry table, and insert `entries`. Returns their ids in order. */
export async function resetLog(request: APIRequestContext, entries: SeedEntry[] = []): Promise<string[]> {
  expect((await request.post('/__test/clock', { data: { now: NOW } })).ok()).toBe(true);
  expect((await request.delete('/__test/entries')).ok()).toBe(true);
  if (entries.length === 0) return [];
  const res = await request.post('/__test/entries', { data: { entries } });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { ids: string[] }).ids;
}

/** A Persian entry that starts with an English word and holds a URL, and the same idea in English (AC-48). */
export const MIXED = {
  fa: {
    title: 'Passkeyها اگر همگام شوند',
    text: 'Passkeyها اگر همگام شوند، یکی‌اند. Google Password Manager هم همین کار را می‌کند. ==«دو کلید» در واقع یک کلید است== ببینید https://example.org/passkeys/a-very-long-path-that-keeps-going-to-test-wrapping-at-small-widths.',
  },
  en: {
    title: 'The word سلام',
    text: 'The word «سلام دنیا» means hello, and ==می‌خواهم== means I want. See https://example.org/passkeys/a-very-long-path-that-keeps-going-to-test-wrapping-at-small-widths.',
  },
} as const;

/** A paragraph of ordinary text and one 90-character word, which must wrap rather than scroll. */
export const LONG_TEXT = `${'Long words and long lines must wrap at every width. '.repeat(8)}${'Supercalifragilistic'.repeat(5)}`;

// ── The CSP: no violation event, ever ──

/**
 * Collects `securitypolicyviolation` events from the first byte of every document. It is added to a page
 * (or a whole context) before the first navigation, because an init script only runs in documents that
 * start after it.
 */
const CSP_WATCH = () => {
  const seen: string[] = [];
  (window as unknown as { __csp: string[] }).__csp = seen;
  document.addEventListener('securitypolicyviolation', (event) => seen.push(`${event.violatedDirective} ${event.blockedURI}`), true);
};

export async function watchCsp(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(CSP_WATCH);
}

export const cspViolations = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? ['(the CSP watch was never installed)']);

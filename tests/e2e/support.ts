// Checks every public page's e2e spec shares: the same promises, asked of each page kind.
import { expect, type Page, type TestInfo } from '@playwright/test';

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

export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(widths.viewport).toBe(360);
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

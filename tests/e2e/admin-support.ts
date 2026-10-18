// A signed-in admin in a real browser, for the specs that are about what the admin does and not
// about signing in (plan B5 on). Edge's virtual authenticator answers the passkey sheet; the setup
// token comes from the e2e-only route, as a terminal would print it.
import { expect, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { watchCsp } from './support.ts';

export interface Admin {
  context: BrowserContext;
  page: Page;
  /** Anything the page threw or the console called an error: a CSP violation is one. */
  problems: string[];
  /** Every request the page made, so a test can say none left its own origin. */
  requests: string[];
}

/** Sign in on a fresh device: register a passkey with a setup token and land on the shell. */
export async function signedInAdmin(browser: Browser, baseURL: string, request: APIRequestContext): Promise<Admin> {
  const context = await browser.newContext({ baseURL });
  // Every document of this context reports a CSP violation to `window.__csp`, which the access sweep reads.
  await watchCsp(context);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  const problems: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('request', (r) => requests.push(r.url()));
  page.on('console', (message) => {
    // The probe that finds no session answers 401 on purpose, and the browser logs a failed load for it.
    if (message.type() === 'error' && !/^Failed to load resource: the server responded with a status of 4\d\d/.test(message.text())) problems.push(message.text());
  });
  const res = await request.post('/__test/auth/setup-token');
  expect(res.ok()).toBe(true);
  const { token } = (await res.json()) as { token: string };
  await page.goto(`/admin/setup/${token}`);
  await page.getByLabel('Name this passkey').fill('laptop');
  await page.getByRole('button', { name: /^Create a passkey/ }).click();
  // This device's own row: another device may already be signed in, with a passkey of the same name.
  await expect(page.locator('.passkey').filter({ hasText: 'this device' })).toBeVisible();
  return { context, page, problems, requests };
}

/** The fixed clock and a clean slate: no passkey, no session, no entry or episode, and no remembered language. */
export async function resetAdmin(request: APIRequestContext, now: number): Promise<void> {
  expect((await request.post('/__test/clock', { data: { now } })).ok()).toBe(true);
  expect((await request.delete('/__test/auth')).ok()).toBe(true);
  expect((await request.delete('/__test/entries')).ok()).toBe(true);
  expect((await request.delete('/__test/episodes')).ok()).toBe(true);
}

/**
 * A confirm dialog is a sheet on the bottom edge, at full width, on a phone, and a centred box of at most 26 rem
 * from 48 em up (PL-2). Measured at the width the page is in, then at 1280, and the viewport is put back.
 */
export async function expectDialogPlace(page: Page, dialog: Locator): Promise<void> {
  const size = page.viewportSize() ?? { width: 360, height: 800 };
  const measure = () =>
    dialog.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, width: box.width, viewportWidth: document.documentElement.clientWidth, viewportHeight: window.innerHeight };
    });
  await page.setViewportSize({ width: 360, height: Math.max(size.height, 500) });
  const phone = await measure();
  expect(Math.abs(phone.bottom - phone.viewportHeight), 'the dialog sits on the bottom edge').toBeLessThanOrEqual(1);
  expect(Math.abs(phone.width - phone.viewportWidth), 'the dialog is as wide as the screen').toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1280, height: 800 });
  const desktop = await measure();
  expect(Math.abs(desktop.top - (desktop.viewportHeight - desktop.bottom)), 'the dialog is centred').toBeLessThanOrEqual(2);
  expect(desktop.width).toBeLessThanOrEqual(26 * 16 + 1);
  await page.setViewportSize(size);
}

/** A button's computed background, and the one a token gives: both as the browser resolves them, so schemes and formats agree. */
export async function expectSolidInk(button: Locator): Promise<void> {
  const [fill, ink, token, tokenInk] = await button.evaluate((el) => {
    const resolve = (property: 'backgroundColor' | 'color', value: string) => {
      const probe = document.createElement('i');
      probe.style[property] = value;
      document.body.append(probe);
      const resolved = getComputedStyle(probe)[property];
      probe.remove();
      return resolved;
    };
    const style = getComputedStyle(el);
    return [style.backgroundColor, style.color, resolve('backgroundColor', 'var(--button-fill)'), resolve('color', 'var(--button-ink)')];
  });
  expect(fill, 'a primary button is solid ink').toBe(token);
  expect(ink, 'with the ink of its scheme on it').toBe(tokenInk);
}

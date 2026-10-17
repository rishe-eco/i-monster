// The auth screens in a real browser (plan B4b): setup, sign-in, the passkey
// list, enrolment by code, removal and re-authentication. Edge's virtual
// authenticator answers the passkey sheet, one browser context per device, each
// with its own authenticator, as a phone and a laptop would have. Every test
// runs in both colour schemes at 360 px (spec §4.6, AC-32).
import { expect, test, type Browser, type BrowserContext, type CDPSession, type Locator, type Page } from '@playwright/test';
import { NOW, expectColourScheme, expectNoCookies, expectNoSidewaysScroll, expectNoThirdParty, scheme, watchRequests } from './support.ts';

const MINUTE = 60_000;
const COOKIE = '__Host-imnstr_session';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// What the 4b design draws, word for word (plates 5, 6, 10, 12).
const REFUSED =
  "This code can't be used. It works once, and only for a while. Make a new code from a signed-in device, or issue a setup token on the server.";
const SIGNIN_FAILED = "Sign-in didn't work. Try again.";
const ALREADY = 'This device already has a passkey for this site.';

interface Device {
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
  authenticatorId: string;
  /** Anything the page threw or the console called an error: a CSP violation is one. */
  problems: string[];
  requests: string[];
}

async function newDevice(browser: Browser, baseURL: string, options: { userAgent?: string } = {}): Promise<Device> {
  const context = await browser.newContext({ baseURL, ...options });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
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
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    // A refusal the API gives on purpose (401 from a signed-out probe, 400 from a refused code) is logged by
    // the browser as a failed load; it is not a fault of the page. Everything else, a CSP violation included, is.
    if (message.type() === 'error' && !/^Failed to load resource: the server responded with a status of 4\d\d/.test(message.text())) problems.push(message.text());
  });
  return { context, page, cdp, authenticatorId, problems, requests: watchRequests(page) };
}

const setClock = (page: Page, now: number) => page.request.post('/__test/clock', { data: { now } });

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__test/clock', { data: { now: NOW } })).ok()).toBe(true);
  expect((await request.delete('/__test/auth')).ok()).toBe(true);
});

async function setupToken(page: Page): Promise<string> {
  const res = await page.request.post('/__test/auth/setup-token');
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { token: string }).token;
}

const cookie = async (device: Device) => (await device.context.cookies()).find((c) => c.name === COOKIE);

/** The row for a passkey, by its exact name. */
const row = (page: Page, name: string): Locator =>
  page.locator('.passkey').filter({ has: page.locator('.passkey__name', { hasText: new RegExp(`^${name}$`) }) });

/** The first device: register with a setup token, signed in at the shell. */
async function firstDevice(browser: Browser, baseURL: string, name = 'phone'): Promise<Device> {
  const device = await newDevice(browser, baseURL, { userAgent: IPHONE });
  await device.page.goto(`/admin/setup/${await setupToken(device.page)}`);
  await device.page.getByLabel('Name this passkey').fill(name);
  await device.page.getByRole('button', { name: /^Create a passkey/ }).click();
  await expect(row(device.page, name)).toBeVisible();
  return device;
}

/** On a signed-in device: make an enrolment code and answer its link. */
async function enrolmentLink(device: Device): Promise<string> {
  await device.page.getByRole('button', { name: 'Enrol another device' }).click();
  const link = await device.page.getByLabel('Link', { exact: true }).inputValue();
  expect(link).toMatch(/\/admin\/setup\/[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  return link;
}

/** A second device enrols with a link: name it, create the passkey, land signed in. */
async function enrol(device: Device, link: string, name: string): Promise<void> {
  await device.page.goto(link);
  await device.page.getByLabel('Name this passkey').fill(name);
  await device.page.getByRole('button', { name: /^Create a passkey/ }).click();
  await expect(row(device.page, name)).toBeVisible();
}

/**
 * What every screen must hold at 360 px, in the scheme under test: no sideways
 * scroll, the ground colour, 44 px targets, a label on every field, and, with
 * the keyboard up (a shorter viewport), the page still scrolls to its action.
 */
async function expectScreenFits(device: Device, info: Parameters<typeof scheme>[0], primary: Locator): Promise<void> {
  const { page } = device;
  await expectNoSidewaysScroll(page);
  await expectColourScheme(page, info);
  await expectNoThirdParty(page, device.requests);
  for (const control of await page.locator('button:visible, a.btn:visible, input:visible').all()) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0, await control.evaluate((el) => el.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(43.5);
  }
  for (const input of await page.locator('input:visible').all()) {
    expect(await input.evaluate((el) => (el as HTMLInputElement).labels?.length ?? 0), await input.evaluate((el) => el.id)).toBeGreaterThan(0);
  }
  await page.setViewportSize({ width: 360, height: 380 });
  await primary.scrollIntoViewIfNeeded();
  const box = await primary.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? -1) >= 0 && (box?.y ?? 0) + (box?.height ?? 0) <= 380).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 360, height: 800 });
}

test('the shell is the same page for everyone, and holds no cookie, script or style of its own (PD-21)', async ({ browser, baseURL, request }, info) => {
  const device = await newDevice(browser, baseURL as string);
  const res = await device.page.goto('/admin');
  expect(res?.status()).toBe(200);
  expect(await res?.headerValue('set-cookie')).toBeNull();
  expect(await res?.headerValue('cache-control')).toBe('no-store');
  expect(await res?.headerValue('content-security-policy')).toContain("default-src 'self'");
  await expect(device.page.getByRole('heading', { name: "It's you, right?" })).toBeVisible();
  await expectNoCookies(device.page);
  // A first visit is not an ended session: nothing is said above the button.
  await expect(device.page.getByRole('status')).toHaveCount(0);
  await expect(device.page.getByRole('alert')).toHaveCount(0);
  expect(device.problems).toEqual([]);
  // The shell has no inline script or style, so the CSP needs no exception for it.
  const html = await (await request.get('/admin')).text();
  expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/);
  expect(html).not.toMatch(/\sstyle=|<style/);
  await expectScreenFits(device, info, device.page.getByRole('button', { name: 'Sign in with a passkey' }));
  await device.context.close();
});

test('J1.2 to J1.5a: the first passkey from a setup token, the laptop by code, then the note (AC-9, AC-20, AC-22, AC-24)', async ({ browser, baseURL }, info) => {
  const phone = await newDevice(browser, baseURL as string, { userAgent: IPHONE });
  const token = await setupToken(phone.page);

  // Setup: the token comes from the link, the name defaults to the device type (F3).
  await phone.page.goto(`/admin/setup/${token}`);
  await expect(phone.page.getByRole('heading', { name: 'Register this device' })).toBeVisible();
  await expect(phone.page.getByLabel('Setup token or code')).toHaveValue(token);
  await expect(phone.page.getByText('Filled in from the link. Works once, within 30 minutes.')).toBeVisible();
  await expect(phone.page.getByLabel('Name this passkey')).toHaveValue('phone');
  await expect(phone.page.locator('#eyes')).toHaveCount(0);
  await expectScreenFits(phone, info, phone.page.getByRole('button', { name: 'Create a passkey on this phone' }));
  await phone.page.getByRole('button', { name: 'Create a passkey on this phone' }).click();

  // Signed in, on the shell. The code has left the address bar, and nothing was stored in the browser.
  await expect(phone.page.getByText("Passkey created. You're signed in on this phone.")).toBeVisible();
  await expect(phone.page).toHaveURL(/\/admin$/);
  await expect(row(phone.page, 'phone')).toContainText('this device');
  await expect(row(phone.page, 'phone')).toContainText('added 10 Oct 2026');
  // One passkey: no Remove (AC-23, W8), the pointer to the next step, and the note.
  await expect(phone.page.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  await expect(phone.page.getByText('The last one has no Remove: that would lock you out.')).toBeVisible();
  await expect(phone.page.getByText('Next: add your other device')).toBeVisible();
  await expect(phone.page.getByText('If both stop working, they were one synced passkey.')).toBeVisible();
  await expect(phone.page.locator('#eyes')).toHaveCount(0);
  expect(await phone.page.evaluate(() => JSON.stringify([document.cookie, Object.keys(localStorage), Object.keys(sessionStorage)]))).toBe('["",[],[]]');
  expect(await cookie(phone)).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });
  await expectScreenFits(phone, info, phone.page.getByRole('button', { name: 'Enrol another device' }));

  // The setup token works once.
  const again = await newDevice(browser, baseURL as string);
  await again.page.goto(`/admin/setup/${token}`);
  await again.page.getByRole('button', { name: /^Create a passkey/ }).click();
  await expect(again.page.getByRole('alert')).toHaveText(REFUSED);
  await again.context.close();

  // Enrol another device: the code, the QR, the link with Copy, and its life in words (plate 10).
  await phone.page.getByRole('button', { name: 'Enrol another device' }).click();
  await expect(phone.page.getByRole('heading', { name: 'Enrol a new device' })).toBeVisible();
  await expect(phone.page.getByText('It works once, for the next 10 minutes. No server needed.')).toBeVisible();
  await expect(phone.page.locator('.code')).toHaveText(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  const qr = phone.page.getByRole('img', { name: 'QR code that opens the enrolment link' });
  await expect(qr).toBeVisible();
  expect(await qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(await qr.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const link = await phone.page.getByLabel('Link', { exact: true }).inputValue();
  expect(await phone.page.locator('.code').innerText()).toBe(link.split('/').pop());
  // No countdown, and no elapsed time (house rule 1).
  await expect(phone.page.getByRole('main')).not.toContainText(/\b\d+\s*(s|sec|seconds?)\b/i);
  await phone.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(link).origin });
  await phone.page.getByRole('button', { name: 'Copy link' }).click();
  await expect(phone.page.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await phone.page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  await expect(phone.page.getByRole('button', { name: 'Copy link' })).toBeVisible(); // it goes back after 2 s
  await expectScreenFits(phone, info, phone.page.getByRole('button', { name: 'Done' }));

  // The laptop opens the link, names its passkey and is signed in on its own.
  const laptop = await newDevice(browser, baseURL as string);
  await laptop.page.goto(link);
  await expect(laptop.page.getByText('Another signed-in device made this code. No server needed.')).toBeVisible();
  await expect(laptop.page.getByLabel('Setup token or code')).toHaveValue(link.split('/').pop() as string);
  await expect(laptop.page.getByText('Filled in from the link. Works once, for 10 minutes.')).toBeVisible();
  await expect(laptop.page.getByLabel('Name this passkey')).toHaveValue('computer');
  await laptop.page.getByLabel('Name this passkey').fill('laptop');
  await laptop.page.getByRole('button', { name: /^Create a passkey/ }).click();
  await expect(row(laptop.page, 'laptop')).toContainText('this device');
  await expect(row(laptop.page, 'phone')).not.toContainText('this device');
  await expect(row(laptop.page, 'phone')).toContainText('added 10 Oct 2026');
  await expect(laptop.page.getByText('Next: add your other device')).toHaveCount(0);
  expect((await cookie(laptop))?.value).not.toBe((await cookie(phone))?.value);

  // The code is spent: a third device is refused with the one message.
  const third = await newDevice(browser, baseURL as string);
  await third.page.goto(link);
  await third.page.getByRole('button', { name: /^Create a passkey/ }).click();
  await expect(third.page.getByRole('alert')).toHaveText(REFUSED);
  await expect(third.page.getByRole('alert')).toHaveText(REFUSED);
  await expectScreenFits(third, info, third.page.getByRole('button', { name: /^Create a passkey/ }));
  await third.context.close();

  // The phone's list catches up when it closes the panel; both can now be removed.
  await phone.page.getByRole('button', { name: 'Done' }).click();
  await expect(row(phone.page, 'laptop')).toBeVisible();
  await expect(phone.page.getByRole('button', { name: /^Remove/ })).toHaveCount(2);

  // The note: dismissed once, then gone for good, on every device (AC-24).
  await expect(laptop.page.getByRole('complementary')).toBeVisible();
  await laptop.page.getByRole('button', { name: 'Dismiss this note' }).click();
  await expect(laptop.page.getByRole('complementary')).toHaveCount(0);
  await laptop.page.reload();
  await expect(row(laptop.page, 'laptop')).toBeVisible();
  await expect(laptop.page.getByRole('complementary')).toHaveCount(0);
  await phone.page.reload();
  await expect(row(phone.page, 'phone')).toBeVisible();
  await expect(phone.page.getByRole('complementary')).toHaveCount(0);

  // Either device signs in on its own, by passkey alone (AC-9): no password field exists to type into.
  await laptop.page.getByRole('button', { name: 'Sign out' }).click();
  await expect(laptop.page.getByRole('heading', { name: "It's you, right?" })).toBeVisible();
  await expect(laptop.page.locator('input')).toHaveCount(0);
  await laptop.page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(row(laptop.page, 'laptop')).toContainText('this device');

  expect(phone.problems).toEqual([]);
  expect(laptop.problems).toEqual([]);
  await phone.context.close();
  await laptop.context.close();
});

test('J3.6 to J3.9: lose the phone, remove its passkey after signing in again, enrol a new phone (AC-11, AC-22)', async ({ browser, baseURL }, info) => {
  const phone = await firstDevice(browser, baseURL as string);
  const laptop = await newDevice(browser, baseURL as string);
  await enrol(laptop, await enrolmentLink(phone), 'laptop');

  // Six minutes on, the laptop's sign-in no longer counts as fresh.
  await setClock(laptop.page, NOW + 6 * MINUTE);
  await row(laptop.page, 'phone').getByRole('button', { name: /^Remove/ }).click();
  const confirm = laptop.page.getByRole('dialog');
  await expect(confirm.getByRole('heading', { name: 'Remove "phone"?' })).toBeVisible();
  await expect(confirm).toContainText("It won't sign in any more, and anywhere it's signed in now is signed out at once.");
  await expectScreenFits(laptop, info, confirm.getByRole('button', { name: 'Remove', exact: true }));
  await confirm.getByRole('button', { name: 'Remove', exact: true }).click();

  // The server wants a fresh sign-in: the one dialog asks, and the removal then goes through.
  const reauth = laptop.page.getByRole('dialog');
  await expect(reauth.getByRole('heading', { name: "Show it's you" })).toBeVisible();
  await expect(reauth).toContainText('Sign in again before changing passkeys.');
  await expectScreenFits(laptop, info, reauth.getByRole('button', { name: 'Sign in again' }));
  await reauth.getByRole('button', { name: 'Sign in again' }).click();
  await expect(laptop.page.getByText('Passkey "phone" removed.')).toBeVisible();
  await expect(laptop.page.getByRole('dialog')).toHaveCount(0);
  await expect(row(laptop.page, 'phone')).toHaveCount(0);
  // What is left is the last passkey: no Remove, and the page says why (AC-23).
  await expect(laptop.page.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  await expect(laptop.page.getByText('The last one has no Remove: that would lock you out.')).toBeVisible();

  // The lost phone is signed out at once, not at the 24 h limit.
  await phone.page.reload();
  await expect(phone.page.getByRole('heading', { name: "It's you, right?" })).toBeVisible();
  expect(await cookie(phone)).toBeUndefined();

  // The new phone enrols with a code from the laptop; the sign-in the laptop just did counts as fresh.
  const replacement = await newDevice(browser, baseURL as string, { userAgent: IPHONE });
  await enrol(replacement, await enrolmentLink(laptop), 'new phone');
  await laptop.page.getByRole('button', { name: 'Done' }).click();
  await expect(row(laptop.page, 'new phone')).toBeVisible();
  await expect(row(laptop.page, 'new phone')).not.toContainText('this device');

  for (const device of [phone, laptop, replacement]) expect(device.problems).toEqual([]);
  for (const device of [phone, laptop, replacement]) await device.context.close();
});

test('J3.11: removing this device\'s own passkey signs it out, and it can\'t sign in again (AC-45)', async ({ browser, baseURL }, info) => {
  const phone = await firstDevice(browser, baseURL as string);
  const laptop = await newDevice(browser, baseURL as string);
  await enrol(laptop, await enrolmentLink(phone), 'laptop');
  await phone.page.getByRole('button', { name: 'Done' }).click();
  await expect(row(phone.page, 'laptop')).toBeVisible();

  await row(phone.page, 'phone').getByRole('button', { name: /^Remove/ }).click();
  const confirm = phone.page.getByRole('dialog');
  await expect(confirm).toContainText("It's this device. This device signs out at once and can't sign in again. Your other passkey still signs in.");
  await confirm.getByRole('button', { name: 'Remove', exact: true }).click();

  await expect(phone.page.getByRole('heading', { name: 'Signed out' })).toBeVisible();
  await expect(phone.page.getByText('Passkey "phone" removed. This device can\'t sign in any more.')).toBeVisible();
  expect(await cookie(phone)).toBeUndefined();
  await expectScreenFits(phone, info, phone.page.getByRole('link', { name: 'View site' }));

  // Its next request gets 401, and the laptop carries on.
  await phone.page.goto('/admin');
  await expect(phone.page.getByRole('heading', { name: "It's you, right?" })).toBeVisible();
  await laptop.page.reload();
  await expect(row(laptop.page, 'laptop')).toBeVisible();

  // The authenticator still holds the passkey, but the server no longer knows it: the one failure
  // message every time, and after repeated failures the button waits, then comes back (plate 6).
  const signIn = phone.page.getByRole('button', { name: 'Sign in with a passkey' });
  for (let attempt = 0; attempt < 2; attempt++) {
    await signIn.click();
    await expect(phone.page.getByRole('alert')).toHaveText(SIGNIN_FAILED);
  }
  await expectScreenFits(phone, info, signIn);
  await signIn.click();
  await expect(phone.page.getByRole('alert')).toHaveText(SIGNIN_FAILED);
  const waiting = phone.page.getByRole('button', { name: 'Try again in a moment' });
  await expect(waiting).toBeDisabled();
  await expect(phone.page.getByText('After repeated failures the button waits, then comes back.')).toBeVisible();
  await expect(phone.page.getByRole('button', { name: 'Sign in with a passkey' })).toBeEnabled({ timeout: 10_000 });

  for (const device of [phone, laptop]) expect(device.problems).toEqual([]);
  for (const device of [phone, laptop]) await device.context.close();
});

test('removing the passkey that opened this session, when this device has its own, signs out without saying it can\'t sign in (AC-22, review)', async ({ browser, baseURL }, info) => {
  // A session opened by one passkey, on a device that then adds its own: what a sign-in from another
  // device's passkey (hybrid) leaves behind. Here the device swaps its authenticator to stand for that.
  const device = await firstDevice(browser, baseURL as string, 'borrowed');
  await device.cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: device.authenticatorId });
  await device.cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  await device.page.getByRole('button', { name: 'Add a passkey on this device' }).click();
  await device.page.getByLabel('Name this passkey').fill('own');
  await device.page.getByRole('button', { name: 'Create the passkey' }).click();
  await expect(device.page.getByText('Passkey "own" added.')).toBeVisible();
  await expect(row(device.page, 'own')).toContainText('this device');

  await row(device.page, 'borrowed').getByRole('button', { name: /^Remove/ }).click();
  const confirm = device.page.getByRole('dialog');
  await expect(confirm).toContainText("It won't sign in any more, and anywhere it's signed in now is signed out at once.");
  await confirm.getByRole('button', { name: 'Remove', exact: true }).click();

  // The session it opened is over, but this device keeps its own passkey: the sign-in view, not "can't sign in any more".
  const signIn = device.page.getByRole('button', { name: 'Sign in with a passkey' });
  await expect(signIn).toBeVisible();
  await expect(device.page.getByText('You were signed out. Sign in to carry on.')).toBeVisible();
  await expect(device.page.getByText("This device can't sign in any more", { exact: false })).toHaveCount(0);
  expect(await cookie(device)).toBeUndefined();
  await expectScreenFits(device, info, signIn);

  await signIn.click();
  await expect(row(device.page, 'own')).toBeVisible();
  await expect(row(device.page, 'borrowed')).toHaveCount(0);

  expect(device.problems).toEqual([]);
  await device.context.close();
});

test('sign-in and sign-out: the eyes\' slot is on the sign-in view only, and sign-out ends the session (AC-9, AC-10)', async ({ browser, baseURL }, info) => {
  const phone = await firstDevice(browser, baseURL as string);
  await phone.page.getByRole('button', { name: 'Sign out' }).click();
  await expect(phone.page.getByRole('heading', { name: "It's you, right?" })).toBeVisible();
  expect(await cookie(phone)).toBeUndefined();
  // The eyes are decoration (B9): drawn, and hidden from assistive technology rather than labelled.
  await expect(phone.page.locator('#eyes .eyes[aria-hidden="true"] [data-eye]')).toHaveCount(2);
  await expect(phone.page.getByRole('img')).toHaveCount(0);
  await expect(phone.page.getByText("This admin has one user. There's nothing to sign up for.")).toBeVisible();
  // No password field anywhere, and no username.
  await expect(phone.page.locator('input')).toHaveCount(0);
  await expectScreenFits(phone, info, phone.page.getByRole('button', { name: 'Sign in with a passkey' }));

  // The same passkey signs back in, with a new session id (AC-10).
  await phone.page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(row(phone.page, 'phone')).toContainText('this device');
  expect(await cookie(phone)).toBeDefined();
  await expect(phone.page.locator('#eyes')).toHaveCount(0);

  // Reloading keeps the session; the screen is decided by the server, not by anything stored here.
  await phone.page.reload();
  await expect(row(phone.page, 'phone')).toBeVisible();
  expect(phone.problems).toEqual([]);
  await phone.context.close();
});

test('a sign-out the server never heard keeps the screen signed in and says so (AC-10, review)', async ({ browser, baseURL }) => {
  const device = await firstDevice(browser, baseURL as string);
  await device.page.route('**/admin/api/auth/signout', (route) => route.abort());
  const signOut = device.page.getByRole('button', { name: 'Sign out' });
  await signOut.click();
  await expect(device.page.getByRole('alert')).toHaveText("Couldn't reach the server. Check the connection and try again.");
  await expect(signOut).toBeEnabled();
  expect(await cookie(device)).toBeDefined();

  await device.page.unroute('**/admin/api/auth/signout');
  await signOut.click();
  await expect(device.page.getByRole('heading', { name: "It's you, right?" })).toBeVisible();
  expect(await cookie(device)).toBeUndefined();

  // The aborted request is the browser's own console error; nothing else may be.
  expect(device.problems.filter((p) => !/ERR_FAILED|net::/.test(p))).toEqual([]);
  await device.context.close();
});

test('a cancelled passkey sheet is neutral, not an error', async ({ browser, baseURL }) => {
  const phone = await firstDevice(browser, baseURL as string);
  await phone.page.getByRole('button', { name: 'Sign out' }).click();
  // The person doesn't verify: the browser refuses with NotAllowedError, and the screen says nothing went wrong.
  await phone.cdp.send('WebAuthn.setUserVerified', { authenticatorId: phone.authenticatorId, isUserVerified: false });
  await phone.page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(phone.page.getByRole('status').filter({ hasText: "Not signed in. Try again when you're ready." })).toBeVisible();
  await expect(phone.page.getByRole('alert')).toHaveCount(0);
  await phone.context.close();
});

test('refused codes get the one message: unknown, used and expired alike (AC-20, AC-21, F2)', async ({ browser, baseURL }, info) => {
  const messages: string[] = [];
  const attempt = async (path: string) => {
    const device = await newDevice(browser, baseURL as string);
    await device.page.goto(path);
    await device.page.getByRole('button', { name: /^Create a passkey/ }).click();
    const alert = device.page.getByRole('alert');
    await expect(alert).toBeVisible();
    messages.push((await alert.textContent()) ?? '');
    // The refusal leaves the code where it was, so the person can see it and mend it.
    await expectScreenFits(device, info, device.page.getByRole('button', { name: /^Create a passkey/ }));
    expect(await cookie(device)).toBeUndefined();
    await device.context.close();
  };

  await attempt('/admin/setup/NOPE-NOPE-NOPE');
  await attempt(`/admin/setup/${'x'.repeat(43)}`);

  const used = await setupToken((await newDevice(browser, baseURL as string)).page);
  const first = await newDevice(browser, baseURL as string);
  await first.page.goto(`/admin/setup/${used}`);
  await first.page.getByRole('button', { name: /^Create a passkey/ }).click();
  await expect(first.page.getByText('Passkey created.')).toBeVisible();
  await attempt(`/admin/setup/${used}`);

  const old = await setupToken(first.page);
  await setClock(first.page, NOW + 31 * MINUTE);
  await attempt(`/admin/setup/${old}`);

  expect(messages).toEqual([REFUSED, REFUSED, REFUSED, REFUSED]);
  await first.context.close();
});

test('an enrolment code shows "Expired. Make a new code." when its 10 minutes are up, and the server agrees (AC-20, F2)', async ({ browser, baseURL }) => {
  const phone = await newDevice(browser, baseURL as string, { userAgent: IPHONE });
  // The browser's clock is the page's to control: the 10 minutes pass at once, by the clock.
  await phone.page.clock.install();
  await phone.page.goto(`/admin/setup/${await setupToken(phone.page)}`);
  await phone.page.getByRole('button', { name: /^Create a passkey/ }).click();
  await expect(row(phone.page, 'phone')).toBeVisible();

  const link = await enrolmentLink(phone);
  await expect(phone.page.getByRole('img', { name: 'QR code that opens the enrolment link' })).toBeVisible();
  await phone.page.clock.fastForward(9 * MINUTE);
  await expect(phone.page.getByText('Expired. Make a new code.')).toHaveCount(0);
  await expect(phone.page.getByLabel('Link', { exact: true })).toBeVisible();
  await phone.page.clock.fastForward(MINUTE + 5000);
  await expect(phone.page.getByText('Expired. Make a new code.')).toBeVisible();
  // Nothing that no longer works is left on show.
  await expect(phone.page.getByRole('img', { name: 'QR code that opens the enrolment link' })).toHaveCount(0);
  await expect(phone.page.getByLabel('Link', { exact: true })).toHaveCount(0);

  // The server counts the same 10 minutes on its own clock, and refuses the dead code.
  await setClock(phone.page, NOW + 10 * MINUTE + 1000);
  const laptop = await newDevice(browser, baseURL as string);
  await laptop.page.goto(link);
  await laptop.page.getByRole('button', { name: /^Create a passkey/ }).click();
  await expect(laptop.page.getByRole('alert')).toHaveText(REFUSED);
  await laptop.context.close();

  // Make a new code: ten minutes on, the sign-in is stale, so the dialog asks first, then the code is live again.
  await phone.page.getByRole('button', { name: 'Make a new code' }).click();
  const dialog = phone.page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: "Show it's you" })).toBeVisible();
  await dialog.getByRole('button', { name: 'Sign in again' }).click();
  await expect(phone.page.getByRole('img', { name: 'QR code that opens the enrolment link' })).toBeVisible();
  expect(await phone.page.getByLabel('Link', { exact: true }).inputValue()).not.toBe(link);
  expect(phone.problems).toEqual([]);
  await phone.context.close();
});

test('the last passkey has no Remove, and the server refuses to remove it (AC-23)', async ({ browser, baseURL }) => {
  const phone = await firstDevice(browser, baseURL as string);
  await expect(phone.page.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  const outcome = await phone.page.evaluate(async () => {
    const session = (await (await fetch('/admin/api/session')).json()) as { csrf: string; deviceCredentialId: string };
    const res = await fetch(`/admin/api/passkeys/${encodeURIComponent(session.deviceCredentialId)}`, { method: 'DELETE', headers: { 'X-CSRF-Token': session.csrf } });
    return { status: res.status, body: await res.json() };
  });
  expect(outcome).toEqual({ status: 409, body: { code: 'LAST_PASSKEY' } });
  await expect(row(phone.page, 'phone')).toBeVisible();
  await phone.context.close();
});

test('a device that already holds a passkey for this site is refused a second, in plain English (PD-17, AC-24)', async ({ browser, baseURL }) => {
  const phone = await firstDevice(browser, baseURL as string);
  await phone.page.getByRole('button', { name: 'Add a passkey on this device' }).click();
  await phone.page.getByLabel('Name this passkey').fill('again');
  await phone.page.getByRole('button', { name: 'Create the passkey' }).click();
  // excludeCredentials makes the browser raise InvalidStateError; the screen says what it means.
  await expect(phone.page.getByRole('alert')).toHaveText(ALREADY);
  await expect(row(phone.page, 'again')).toHaveCount(0);

  // Naming it badly is refused in words, before any passkey is made.
  await phone.page.getByLabel('Name this passkey').fill('   ');
  await phone.page.getByRole('button', { name: 'Create the passkey' }).click();
  await expect(phone.page.getByRole('alert')).toHaveText('Give this passkey a name, so you can tell it apart later.');
  await phone.page.getByLabel('Name this passkey').fill('a\u0007b');
  await phone.page.getByRole('button', { name: 'Create the passkey' }).click();
  await expect(phone.page.getByRole('alert')).toHaveText("That name can't be used. Use up to 60 characters, on one line.");
  expect(await phone.page.getByLabel('Name this passkey').evaluate((el) => (el as HTMLInputElement).maxLength)).toBe(60);
  await phone.page.getByRole('button', { name: 'Cancel' }).click();
  await expect(phone.page.getByRole('button', { name: 'Add a passkey on this device' })).toBeVisible();
  await phone.context.close();
});

test('adding a passkey on this device asks to sign in again only when the server says so (AC-11)', async ({ browser, baseURL }) => {
  const laptop = await firstDevice(browser, baseURL as string, 'laptop');
  // Fresh: no dialog. A second authenticator on the same browser context can't be used, so the
  // authenticator that holds the first passkey refuses; what matters here is that no dialog came.
  await laptop.page.getByRole('button', { name: 'Add a passkey on this device' }).click();
  await laptop.page.getByRole('button', { name: 'Create the passkey' }).click();
  await expect(laptop.page.getByRole('alert')).toHaveText(ALREADY);
  await expect(laptop.page.getByRole('dialog')).toHaveCount(0);

  // Stale: the dialog asks, and after it the add runs once more.
  await setClock(laptop.page, NOW + 6 * MINUTE);
  await laptop.page.getByRole('button', { name: 'Create the passkey' }).click();
  await expect(laptop.page.getByRole('dialog').getByRole('heading', { name: "Show it's you" })).toBeVisible();
  // Cancelling the dialog gives up quietly: nothing was added, and nothing is called an error.
  await laptop.page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(laptop.page.getByRole('dialog')).toHaveCount(0);
  await expect(laptop.page.getByRole('status').filter({ hasText: 'Sign in again to do that.' })).toBeVisible();
  // Signing in again, the add runs once more (and meets the same authenticator, which refuses): the
  // refusal is the add's own, so the dialog did its job and the retry happened.
  await laptop.page.getByRole('button', { name: 'Create the passkey' }).click();
  await laptop.page.getByRole('dialog').getByRole('button', { name: 'Sign in again' }).click();
  await expect(laptop.page.getByRole('alert')).toHaveText(ALREADY);
  await expect(laptop.page.getByRole('dialog')).toHaveCount(0);
  await laptop.context.close();
});

test('the remove dialog and the sign-in dialog are keyboard-reachable, and Escape closes the first', async ({ browser, baseURL }) => {
  const phone = await firstDevice(browser, baseURL as string);
  const laptop = await newDevice(browser, baseURL as string);
  await enrol(laptop, await enrolmentLink(phone), 'laptop');
  await phone.page.getByRole('button', { name: 'Done' }).click();
  await expect(row(phone.page, 'laptop')).toBeVisible();

  const remove = row(phone.page, 'laptop').getByRole('button', { name: /^Remove/ });
  await remove.focus();
  await phone.page.keyboard.press('Enter');
  await expect(phone.page.getByRole('dialog')).toBeVisible();
  await phone.page.keyboard.press('Escape');
  await expect(phone.page.getByRole('dialog')).toHaveCount(0);
  await expect(row(phone.page, 'laptop')).toBeVisible();
  for (const device of [phone, laptop]) await device.context.close();
});

test('a session that has ended sends the screen to sign-in, and says so (AC-10)', async ({ browser, baseURL }) => {
  const phone = await firstDevice(browser, baseURL as string);
  // Two hours with no request: the server has ended the session, and the next action finds out.
  await setClock(phone.page, NOW + 2 * 60 * MINUTE);
  await phone.page.getByRole('button', { name: 'Enrol another device' }).click();
  await expect(phone.page.getByRole('heading', { name: "It's you, right?" })).toBeVisible();
  await expect(phone.page.getByRole('status').filter({ hasText: 'You were signed out. Sign in to carry on.' })).toBeVisible();
  // No sign-in dialog opens over it: there is no session left to show anything to.
  await expect(phone.page.getByRole('dialog')).toHaveCount(0);
  await phone.page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(row(phone.page, 'phone')).toBeVisible();
  expect(phone.problems).toEqual([]);
  await phone.context.close();
});

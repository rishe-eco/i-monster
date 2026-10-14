// The auth API in a real browser (plan B4a): Edge's virtual authenticator, driven
// through the DevTools protocol, on the bare /__test/auth page. One browser
// context per device, each with its own authenticator, as a phone and a laptop
// would have. The page and its helper routes exist only under E2E_CLOCK=1.
//
// This is also where the plan's §4 unknown is settled for good: Edge accepts a
// Secure, __Host- cookie on http://localhost, so development needs no exception.
import { expect, test, type Browser, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import { NOW } from './support.ts';

const MINUTE = 60_000;
const COOKIE = '__Host-imnstr_session';

interface Reply {
  status: number;
  json: Record<string, unknown> | null;
}

interface Device {
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
  authenticatorId: string;
  /** Run one of the page's authTest calls. */
  run(method: string, ...args: unknown[]): Promise<Reply>;
  api(method: string, path: string, body?: unknown): Promise<Reply>;
}

async function newDevice(browser: Browser, baseURL: string): Promise<Device> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  // A platform passkey: resident, user-verifying, and it says yes without being asked.
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
  await page.goto('/__test/auth');
  const call = <T>(fn: (args: unknown[]) => Promise<T>, args: unknown[]) => page.evaluate(fn, args);
  return {
    context,
    page,
    cdp,
    authenticatorId,
    run: (method, ...args) =>
      call(
        (a) => {
          const [name, ...rest] = a as [string, ...unknown[]];
          const test = (window as unknown as { authTest: Record<string, (...x: unknown[]) => Promise<Reply>> }).authTest;
          return (test[name] as (...x: unknown[]) => Promise<Reply>)(...rest);
        },
        [method, ...args],
      ),
    api: (method, path, body) => call((a) => (window as unknown as { authTest: { api: (...x: unknown[]) => Promise<Reply> } }).authTest.api(...a), [method, path, body]),
  };
}

const setClock = (request: Page['request'], now: number) => request.post('/__test/clock', { data: { now } });

test.beforeEach(async ({ request }, info) => {
  test.skip(info.project.name === 'dark', 'No screens yet: one colour scheme is enough for the API');
  expect((await setClock(request, NOW)).ok()).toBe(true);
  expect((await request.delete('/__test/auth')).ok()).toBe(true);
});

async function setupToken(request: Page['request']): Promise<string> {
  const res = await request.post('/__test/auth/setup-token');
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { token: string }).token;
}

test('a setup token enrols the first passkey and signs in, with the cookie the spec asks for (AC-9, AC-10)', async ({ browser, baseURL, request }) => {
  const laptop = await newDevice(browser, baseURL as string);
  const res = await laptop.run('register', 'Laptop', await setupToken(request));
  expect(res.status).toBe(200);
  expect(res.json).toMatchObject({ fresh: true, independenceNoteDismissed: false });

  const cookies = (await laptop.context.cookies()).filter((c) => c.name === COOKIE);
  expect(cookies).toHaveLength(1);
  expect(cookies[0]).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/', expires: -1 });
  expect(cookies[0]?.value).toMatch(/^[A-Za-z0-9_-]{22}$/);
  // HttpOnly: script can't read it, so nothing in the page can leak it.
  expect(await laptop.page.evaluate(() => document.cookie)).toBe('');
  expect(await laptop.page.evaluate(() => JSON.stringify([Object.keys(localStorage), Object.keys(sessionStorage)]))).toBe('[[],[]]');

  const session = await laptop.run('session');
  expect(session.status).toBe(200);
  await laptop.context.close();
});

test('a setup token works once (AC-9, AC-21)', async ({ browser, baseURL, request }) => {
  const token = await setupToken(request);
  const first = await newDevice(browser, baseURL as string);
  expect((await first.run('register', 'Laptop', token)).status).toBe(200);
  const second = await newDevice(browser, baseURL as string);
  const again = await second.run('register', 'Other', token);
  expect(again.status).toBe(400);
  expect(again.json).toEqual({ code: 'CODE_REFUSED' });
  await first.context.close();
  await second.context.close();
});

test('a signed-in browser makes no public page differ and gets no Set-Cookie from one (AC-7, D-8)', async ({ browser, baseURL, request }) => {
  const laptop = await newDevice(browser, baseURL as string);
  await laptop.run('register', 'Laptop', await setupToken(request));
  const before = (await laptop.context.cookies()).find((c) => c.name === COOKIE)?.value;

  for (const path of ['/', '/fa/', '/log', '/fa/log', '/nowhere']) {
    const res = await laptop.page.goto(path);
    expect(res?.headers()['set-cookie'], path).toBeUndefined();
    expect(await res?.headerValue('set-cookie'), path).toBeNull();
  }
  expect((await laptop.context.cookies()).find((c) => c.name === COOKIE)?.value).toBe(before);

  // The page is the same for a browser with no session.
  const stranger = await browser.newContext({ baseURL });
  const strangerPage = await stranger.newPage();
  await strangerPage.goto('/');
  await laptop.page.goto('/');
  expect(await laptop.page.content()).toBe(await strangerPage.content());
  expect(await stranger.cookies()).toEqual([]);
  await stranger.close();
  await laptop.context.close();
});

test('a second device enrols with a code from the first, and each signs in on its own (AC-9, AC-20)', async ({ browser, baseURL, request }) => {
  const laptop = await newDevice(browser, baseURL as string);
  await laptop.run('register', 'Laptop', await setupToken(request));
  const issued = await laptop.api('POST', '/enrolment-codes', {});
  expect(issued.status).toBe(200);
  const code = issued.json?.code as string;
  expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  expect(issued.json?.qr).toMatch(/^data:image\/svg\+xml;base64,/);

  const phone = await newDevice(browser, baseURL as string);
  expect((await phone.run('register', 'Phone', code)).status).toBe(200);
  // The code is spent.
  const third = await newDevice(browser, baseURL as string);
  expect((await third.run('register', 'Tablet', code)).json).toEqual({ code: 'CODE_REFUSED' });
  await third.context.close();

  // Sign the phone out, then in again with its own discoverable passkey: a new cookie.
  const before = (await phone.context.cookies()).find((c) => c.name === COOKIE)?.value;
  expect((await phone.run('signOut')).status).toBe(200);
  expect((await phone.run('session')).status).toBe(401);
  expect((await phone.run('signIn')).status).toBe(200);
  const after = (await phone.context.cookies()).find((c) => c.name === COOKIE)?.value;
  expect(after).toBeTruthy();
  expect(after).not.toBe(before);

  const list = await laptop.api('GET', '/passkeys');
  expect((list.json?.passkeys as { name: string; thisDevice: boolean }[]).map((p) => [p.name, p.thisDevice])).toEqual([
    ['Laptop', true],
    ['Phone', false],
  ]);
  await laptop.context.close();
  await phone.context.close();
});

test('adding a passkey from a session needs a fresh sign-in, and the authenticator that holds one refuses a second (AC-11, PD-17)', async ({ browser, baseURL, request }) => {
  const laptop = await newDevice(browser, baseURL as string);
  await laptop.run('register', 'Laptop', await setupToken(request));

  // The same authenticator already holds this site's passkey: the browser refuses to make another.
  await expect(laptop.run('register', 'Again')).rejects.toThrow();

  // After 5 minutes the sign-in no longer counts.
  await setClock(request, NOW + 5 * MINUTE + 1000);
  const stale = await laptop.run('register', 'Again');
  expect(stale.json).toEqual({ code: 'REAUTH_REQUIRED' });
  const refused = await laptop.api('POST', '/enrolment-codes', {});
  expect(refused.json).toEqual({ code: 'REAUTH_REQUIRED' });
  await laptop.context.close();
});

test('removing a passkey: fresh sign-in first, the last one refused, and the sessions it opened end (AC-11, AC-22, AC-23, AC-45)', async ({ browser, baseURL, request }) => {
  const laptop = await newDevice(browser, baseURL as string);
  await laptop.run('register', 'Laptop', await setupToken(request));
  const phone = await newDevice(browser, baseURL as string);
  expect((await phone.run('register', 'Phone', (await laptop.api('POST', '/enrolment-codes', {})).json?.code)).status).toBe(200);
  const ids = ((await laptop.api('GET', '/passkeys')).json?.passkeys as { id: string; name: string }[]).reduce<Record<string, string>>(
    (all, p) => ({ ...all, [p.name]: p.id }),
    {},
  );

  // Six minutes on, the laptop's sign-in is stale.
  await setClock(request, NOW + 6 * MINUTE);
  const stale = await laptop.api('DELETE', `/passkeys/${encodeURIComponent(ids.Phone as string)}`);
  expect(stale.json).toEqual({ code: 'REAUTH_REQUIRED' });
  expect((await laptop.run('reauth')).status).toBe(200);

  // The phone's passkey goes: the phone's next request gets 401, the laptop carries on.
  const removed = await laptop.api('DELETE', `/passkeys/${encodeURIComponent(ids.Phone as string)}`);
  expect(removed.json).toEqual({ signedOut: false });
  expect((await phone.run('session')).status).toBe(401);
  expect((await laptop.run('session')).status).toBe(200);

  // What is left is the last passkey.
  const last = await laptop.api('DELETE', `/passkeys/${encodeURIComponent(ids.Laptop as string)}`);
  expect(last.status).toBe(409);
  expect(last.json).toEqual({ code: 'LAST_PASSKEY' });
  await laptop.context.close();
  await phone.context.close();
});

test('removing this device\'s own passkey signs it out and clears its cookie (AC-45)', async ({ browser, baseURL, request }) => {
  const laptop = await newDevice(browser, baseURL as string);
  await laptop.run('register', 'Laptop', await setupToken(request));
  const phone = await newDevice(browser, baseURL as string);
  await phone.run('register', 'Phone', (await laptop.api('POST', '/enrolment-codes', {})).json?.code);
  const own = ((await phone.api('GET', '/passkeys')).json?.passkeys as { id: string; thisDevice: boolean }[]).find((p) => p.thisDevice);
  expect(own).toBeTruthy();

  const res = await phone.api('DELETE', `/passkeys/${encodeURIComponent(own?.id as string)}`);
  expect(res.json).toEqual({ signedOut: true });
  expect((await phone.context.cookies()).filter((c) => c.name === COOKIE)).toEqual([]);
  expect((await phone.run('session')).status).toBe(401);
  expect((await laptop.run('session')).status).toBe(200);
  await laptop.context.close();
  await phone.context.close();
});

test('an authenticator that does not verify the user cannot sign in (AC-11)', async ({ browser, baseURL, request }) => {
  const laptop = await newDevice(browser, baseURL as string);
  await laptop.run('register', 'Laptop', await setupToken(request));
  expect((await laptop.run('signOut')).status).toBe(200);
  // The browser itself refuses to answer a userVerification: required request without a verified user.
  await laptop.cdp.send('WebAuthn.setUserVerified', { authenticatorId: laptop.authenticatorId, isUserVerified: false });
  await expect(laptop.run('signIn')).rejects.toThrow();
  await laptop.cdp.send('WebAuthn.setUserVerified', { authenticatorId: laptop.authenticatorId, isUserVerified: true });
  expect((await laptop.run('signIn')).status).toBe(200);
  await laptop.context.close();
});

test('a write with a foreign Origin is refused, and so is one with no session (AC-8, AC-11, PD-14)', async ({ request }) => {
  const foreign = await request.post('/admin/api/auth/signin/options', { headers: { Origin: 'https://evil.example' }, data: {} });
  expect(foreign.status()).toBe(403);
  expect(await foreign.json()).toEqual({ code: 'ORIGIN_REFUSED' });
  const noSession = await request.get('/admin/api/session');
  expect(noSession.status()).toBe(401);
  expect(await noSession.json()).toEqual({ code: 'UNAUTHENTICATED' });
});

// Sign-in, registration and re-authentication against the software
// authenticator (plan B4a; AC-9, AC-10, AC-11). Every ceremony here runs the
// server's real verifier on real attestation and assertion bytes.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetClock, setNow } from '../../lib/clock.ts';
import { limits } from '../../lib/limits.ts';
import { Client, COOKIE_NAME, newAuthenticator, resetAuth, setupToken, signedIn } from '../authHelpers.ts';
import { MINUTE, NOW, tempDb, testApp, testEnv } from '../helpers.ts';

const t = tempDb();
const env = testEnv();
const app = testApp(t.db);
afterAll(() => t.cleanup());
beforeEach(() => {
  setNow(NOW);
  resetAuth(t.db);
});
afterEach(resetClock);

const SIGNIN_FAILED = JSON.stringify({ code: 'SIGNIN_FAILED' });
const row = <T>(sql: string, ...args: unknown[]) => t.db.prepare(sql).get(...args) as T;

describe('registering the first passkey with a setup token', () => {
  it('stores the credential, opens a session and sets the cookie (AC-9, AC-10)', async () => {
    const client = new Client(app, env);
    const auth = newAuthenticator(env);
    const res = await client.registerWithCode(auth, setupToken(t.db), '  My   laptop ');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      csrf: expect.any(String),
      fresh: true,
      deviceCredentialId: auth.credentialId,
      independenceNoteDismissed: false,
    });
    const stored = row<{ id: string; name: string; sign_count: number; backup_eligible: number; backed_up: number; transports: string }>(
      'SELECT * FROM credential',
    );
    expect(stored.id).toBe(auth.credentialId);
    expect(stored.name).toBe('My laptop');
    expect(stored.backup_eligible).toBe(1);
    expect(stored.backed_up).toBe(0);
    expect(JSON.parse(stored.transports)).toEqual(['internal']);
    expect(client.cookie).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('sets a cookie with the __Host- prefix, Secure, HttpOnly, SameSite=Strict, Path=/ and no Domain (AC-10)', async () => {
    const client = new Client(app, env);
    const res = await client.registerWithCode(newAuthenticator(env), setupToken(t.db));
    const [setCookie = ''] = res.headers.getSetCookie();
    const parts = setCookie.split(';').map((p) => p.trim());
    expect(parts[0]).toMatch(new RegExp(`^${COOKIE_NAME}=[A-Za-z0-9_-]{22}$`));
    expect(parts).toContain('Secure');
    expect(parts).toContain('HttpOnly');
    expect(parts).toContain('SameSite=Strict');
    expect(parts).toContain('Path=/');
    expect(parts.some((p) => /^Domain=/i.test(p))).toBe(false);
    // A session cookie with no lifetime of its own: the server alone decides when it ends.
    expect(parts.some((p) => /^(Max-Age|Expires)=/i.test(p))).toBe(false);
  });

  it('keeps only the hash of the session id (PD-13)', async () => {
    const { client } = await signedIn(app, t.db, env);
    const stored = row<{ id_hash: string }>('SELECT id_hash FROM session');
    expect(stored.id_hash).not.toContain(client.cookie as string);
    expect(stored.id_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sends options that ask for a resident key and user verification, attestation none, and name no user data', async () => {
    const client = new Client(app, env);
    const res = await client.post('/admin/api/auth/register/options', { code: setupToken(t.db) });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      rp: { id: 'localhost' },
      attestation: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    expect(res.json.excludeCredentials).toEqual([]);
  });

  it('sends excludeCredentials for every passkey already stored (PD-17)', async () => {
    const { client, auth } = await signedIn(app, t.db, env);
    const options = await client.post('/admin/api/auth/register/options');
    expect(options.status).toBe(200);
    expect(options.json.excludeCredentials).toEqual([expect.objectContaining({ id: auth.credentialId })]);
    // And an authenticator that already holds that credential refuses to make another.
    expect(() => auth.register(options.json as never)).toThrow(/excluded/);
  });

  it('refuses a name that is empty, and one that is too long', async () => {
    const client = new Client(app, env);
    const token = setupToken(t.db);
    const options = await client.post('/admin/api/auth/register/options', { code: token });
    const response = newAuthenticator(env).register(options.json as never);
    const empty = await client.post('/admin/api/auth/register/verify', { code: token, name: '   ', response });
    expect(empty.status).toBe(400);
    expect(empty.json).toEqual({ code: 'NAME_REQUIRED' });
    const long = await client.post('/admin/api/auth/register/verify', { code: token, name: 'x'.repeat(61), response });
    expect(long.json).toEqual({ code: 'REQUEST_INVALID' });
    // Neither spent the code.
    expect(row<{ n: number }>('SELECT count(*) AS n FROM auth_code WHERE used_at IS NOT NULL').n).toBe(0);
  });

  it('refuses a registration that was not user-verified, and keeps the code live', async () => {
    const client = new Client(app, env);
    const token = setupToken(t.db);
    const res = await client.registerWithCode(newAuthenticator(env, { uv: false }), token);
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ code: 'REGISTRATION_FAILED' });
    expect(row<{ n: number }>('SELECT count(*) AS n FROM credential').n).toBe(0);
    expect((await client.registerWithCode(newAuthenticator(env), token)).status).toBe(200);
  });

  it('refuses a registration with no user presence', async () => {
    const res = await new Client(app, env).registerWithCode(newAuthenticator(env, { up: false }), setupToken(t.db));
    expect(res.json).toEqual({ code: 'REGISTRATION_FAILED' });
  });

  it('refuses a registration signed for another origin', async () => {
    const client = new Client(app, env);
    const token = setupToken(t.db);
    const options = await client.post('/admin/api/auth/register/options', { code: token });
    const response = newAuthenticator(env).register(options.json as never, { origin: 'https://evil.example' });
    const res = await client.post('/admin/api/auth/register/verify', { code: token, name: 'x', response });
    expect(res.json).toEqual({ code: 'REGISTRATION_FAILED' });
  });

  it('refuses a registration for another relying party', async () => {
    const res = await new Client(app, env).registerWithCode(newAuthenticator(env, { rpId: 'evil.example' }), setupToken(t.db));
    expect(res.json).toEqual({ code: 'REGISTRATION_FAILED' });
  });

  it('refuses a registration whose challenge the server did not issue, or issued for another code', async () => {
    const client = new Client(app, env);
    const token = setupToken(t.db);
    const options = await client.post('/admin/api/auth/register/options', { code: token });
    const forged = newAuthenticator(env).register(options.json as never, { challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
    expect((await client.post('/admin/api/auth/register/verify', { code: token, name: 'x', response: forged })).json).toEqual({
      code: 'REGISTRATION_FAILED',
    });
    // A challenge issued for one code can't complete another's ceremony.
    const other = setupToken(t.db);
    const fresh = await client.post('/admin/api/auth/register/options', { code: token });
    const response = newAuthenticator(env).register(fresh.json as never);
    expect((await client.post('/admin/api/auth/register/verify', { code: other, name: 'x', response })).json).toEqual({
      code: 'REGISTRATION_FAILED',
    });
  });

  it('refuses a backup state that cannot exist: backed up but not eligible', async () => {
    const res = await new Client(app, env).registerWithCode(newAuthenticator(env, { be: false, bs: true }), setupToken(t.db));
    expect(res.json).toEqual({ code: 'REGISTRATION_FAILED' });
  });

  it('stores BE and BS as the authenticator reported them (a device-bound key and a synced one)', async () => {
    await signedIn(app, t.db, env, { be: false, bs: false });
    expect(row<{ backup_eligible: number; backed_up: number }>('SELECT backup_eligible, backed_up FROM credential')).toEqual({
      backup_eligible: 0,
      backed_up: 0,
    });
    resetAuth(t.db);
    await signedIn(app, t.db, env, { be: true, bs: true });
    expect(row<{ backup_eligible: number; backed_up: number }>('SELECT backup_eligible, backed_up FROM credential')).toEqual({
      backup_eligible: 1,
      backed_up: 1,
    });
  });

  it('answers 401 to a registration with neither a code nor a session', async () => {
    const res = await new Client(app, env).post('/admin/api/auth/register/options');
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ code: 'UNAUTHENTICATED' });
  });
});

describe('signing in', () => {
  it('sends discoverable options: no allowCredentials, user verification required, this rp id', async () => {
    const res = await new Client(app, env).post('/admin/api/auth/signin/options');
    expect(res.status).toBe(200);
    expect(res.json.rpId).toBe('localhost');
    expect(res.json.userVerification).toBe('required');
    expect(res.json.allowCredentials ?? []).toEqual([]);
  });

  it('signs in with the registered passkey, and the session id changes at sign-in (AC-9, AC-10)', async () => {
    const { client: first, auth } = await signedIn(app, t.db, env);
    const second = new Client(app, env);
    const res = await second.signIn(auth);
    expect(res.status).toBe(200);
    expect(second.cookie).not.toBe(first.cookie);
    expect(res.json.csrf).not.toBe(first.csrf);
    // Both sessions exist: a second device signing in doesn't end the first.
    expect(row<{ n: number }>('SELECT count(*) AS n FROM session').n).toBe(2);
  });

  it('ends the session a request arrived with, when signing in again from the same browser', async () => {
    const { client, auth } = await signedIn(app, t.db, env);
    const before = client.cookie;
    await client.signIn(auth);
    expect(client.cookie).not.toBe(before);
    expect(row<{ n: number }>('SELECT count(*) AS n FROM session').n).toBe(1);
  });

  it('works from either of two registered devices (AC-9)', async () => {
    const { client, auth: laptop } = await signedIn(app, t.db, env);
    const phone = newAuthenticator(env);
    expect((await client.reauth(laptop)).status).toBe(200);
    expect((await client.registerFromSession(phone)).status).toBe(200);
    expect((await new Client(app, env).signIn(laptop)).status).toBe(200);
    expect((await new Client(app, env).signIn(phone)).status).toBe(200);
  });

  it('stores the sign count at each sign-in', async () => {
    const { auth } = await signedIn(app, t.db, env);
    await new Client(app, env).signIn(auth);
    await new Client(app, env).signIn(auth);
    expect(row<{ sign_count: number }>('SELECT sign_count FROM credential').sign_count).toBe(2);
  });

  it('refuses a replayed assertion with a lower sign count', async () => {
    const { auth } = await signedIn(app, t.db, env);
    const client = new Client(app, env);
    await client.signIn(auth);
    await client.signIn(auth);
    auth.signCount = 0; // a cloned authenticator that has fallen behind
    expect((await client.signIn(auth)).json).toEqual({ code: 'SIGNIN_FAILED' });
  });

  it('refuses an authenticator that did not verify the user, and says nothing different (AC-11)', async () => {
    const { auth } = await signedIn(app, t.db, env);
    auth.uv = false;
    const res = await new Client(app, env).signIn(auth);
    expect(res.status).toBe(400);
    expect(res.text).toBe(SIGNIN_FAILED);
    auth.uv = true;
    expect((await new Client(app, env).signIn(auth)).status).toBe(200);
  });

  it('works once per challenge: a replay of the same response is refused', async () => {
    const { auth } = await signedIn(app, t.db, env);
    const client = new Client(app, env);
    const options = await client.post('/admin/api/auth/signin/options');
    const response = auth.assert(options.json as never);
    expect((await client.post('/admin/api/auth/signin/verify', { response })).status).toBe(200);
    expect((await client.post('/admin/api/auth/signin/verify', { response })).text).toBe(SIGNIN_FAILED);
  });

  it('refuses a challenge after 5 minutes, and accepts it just before (PD-17)', async () => {
    const { auth } = await signedIn(app, t.db, env);
    const client = new Client(app, env);
    const late = await client.post('/admin/api/auth/signin/options');
    const lateResponse = auth.assert(late.json as never);
    setNow(NOW + limits.webauthnChallengeMs + 1);
    expect((await client.post('/admin/api/auth/signin/verify', { response: lateResponse })).text).toBe(SIGNIN_FAILED);

    const inTime = await client.post('/admin/api/auth/signin/options');
    const inTimeResponse = auth.assert(inTime.json as never);
    setNow(NOW + limits.webauthnChallengeMs + 1 + limits.webauthnChallengeMs - 1000);
    // Failures so far are below the back-off threshold, so this is checked.
    expect((await client.post('/admin/api/auth/signin/verify', { response: inTimeResponse })).status).toBe(200);
  });

  it('refuses a registration challenge used as a sign-in challenge', async () => {
    const { client, auth } = await signedIn(app, t.db, env);
    const reg = await client.post('/admin/api/auth/register/options');
    const response = auth.assert(reg.json as never);
    expect((await new Client(app, env).post('/admin/api/auth/signin/verify', { response })).text).toBe(SIGNIN_FAILED);
  });

  it('refuses an assertion signed for another origin', async () => {
    const { auth } = await signedIn(app, t.db, env);
    const client = new Client(app, env);
    const options = await client.post('/admin/api/auth/signin/options');
    const response = auth.assert(options.json as never, { origin: 'https://evil.example' });
    expect((await client.post('/admin/api/auth/signin/verify', { response })).text).toBe(SIGNIN_FAILED);
  });

  it('refuses a credential the server does not know', async () => {
    await signedIn(app, t.db, env);
    expect((await new Client(app, env).signIn(newAuthenticator(env))).text).toBe(SIGNIN_FAILED);
  });

  it('gives one body for every way a sign-in can fail (AC-11)', async () => {
    const { auth } = await signedIn(app, t.db, env);
    const stranger = newAuthenticator(env);
    const client = new Client(app, env);
    const bodies: { status: number; text: string; type: string | null }[] = [];
    const record = (res: { status: number; text: string; headers: Headers }) =>
      bodies.push({ status: res.status, text: res.text, type: res.headers.get('Content-Type') });
    // The throttle is reset between branches: each one must fail for its own reason.
    const again = () => resetThrottle();
    const verify = (body: unknown) => client.post('/admin/api/auth/signin/verify', body);
    const options = async () => (await client.post('/admin/api/auth/signin/options')).json as never;

    record(await verify({}));
    again();
    record(await verify({ response: 'nope' }));
    again();
    record(await verify({ response: { id: 1, response: {} } }));
    again();
    record(await verify({ response: auth.assert(await options(), { challenge: 'not-issued' }) }));
    again();
    record(await verify({ response: stranger.assert(await options()) }));
    again();
    record(await verify({ response: auth.assert(await options(), { origin: 'https://evil.example' }) }));
    auth.uv = false;
    again();
    record(await verify({ response: auth.assert(await options()) }));
    auth.uv = true;
    // And a request made inside a back-off wait.
    t.db.prepare('UPDATE auth_throttle SET failures = 6, last_failure_at = ?').run(NOW);
    record(await verify({ response: auth.assert(await options()) }));

    expect(bodies).toHaveLength(8);
    for (const b of bodies) {
      expect(b.text).toBe(SIGNIN_FAILED);
      expect(b.status).toBe(400);
      expect(b.type).toBe(bodies[0]?.type);
    }
  });

  it('does not set or clear a cookie when it refuses', async () => {
    const res = await new Client(app, env).post('/admin/api/auth/signin/verify', { response: 'nope' });
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});

function resetThrottle(): void {
  t.db.prepare('UPDATE auth_throttle SET failures = 0, last_failure_at = NULL').run();
}

describe('back-off (PD-15)', () => {
  const failSignIn = (client: Client) => client.post('/admin/api/auth/signin/verify', { response: 'nope' });
  const throttle = () => row<{ failures: number; last_failure_at: number | null }>('SELECT failures, last_failure_at FROM auth_throttle');

  it('does not slow the first four failures, and waits from the 4th', async () => {
    const { auth } = await signedIn(app, t.db, env);
    const client = new Client(app, env);
    for (let i = 0; i < 4; i++) await failSignIn(client);
    expect(throttle().failures).toBe(4);
    // Inside the 2 s wait the right passkey is refused, unchecked.
    expect((await client.signIn(auth)).text).toBe(SIGNIN_FAILED);
    expect(throttle().failures).toBe(4);
    setNow(NOW + 1999);
    expect((await client.signIn(auth)).text).toBe(SIGNIN_FAILED);
    setNow(NOW + 2000);
    expect((await client.signIn(auth)).status).toBe(200);
  });

  it('leaves the count and the timer alone while it refuses inside the wait, so hammering cannot stretch it', async () => {
    const client = new Client(app, env);
    for (let i = 0; i < 4; i++) await failSignIn(client);
    const before = throttle();
    setNow(NOW + 500);
    await failSignIn(client);
    await failSignIn(client);
    expect(throttle()).toEqual(before);
  });

  it('doubles the wait with each failure and caps it at 30 s', async () => {
    const { auth } = await signedIn(app, t.db, env);
    const client = new Client(app, env);
    const waitFor = [[4, 2], [5, 4], [6, 8], [7, 16], [8, 30], [20, 30]] as const;
    for (const [failures, seconds] of waitFor) {
      t.db.prepare('UPDATE auth_throttle SET failures = ?, last_failure_at = ?').run(failures, NOW);
      setNow(NOW + seconds * 1000 - 1);
      expect((await client.signIn(auth)).status, `${failures} failures, just inside ${seconds} s`).toBe(400);
      setNow(NOW + seconds * 1000);
      expect((await client.signIn(auth)).status, `${failures} failures, at ${seconds} s`).toBe(200);
      setNow(NOW);
    }
  });

  it('resets on a success', async () => {
    const { auth } = await signedIn(app, t.db, env);
    const client = new Client(app, env);
    for (let i = 0; i < 4; i++) await failSignIn(client);
    setNow(NOW + 2000);
    expect((await client.signIn(auth)).status).toBe(200);
    expect(throttle()).toEqual({ failures: 0, last_failure_at: null });
  });

  it('counts failed code redemptions with failed sign-ins, and a refused code inside the wait is refused unchecked', async () => {
    const client = new Client(app, env);
    const token = setupToken(t.db);
    for (let i = 0; i < 2; i++) await failSignIn(client);
    for (const bad of ['nope', 'ABCD-EFGH-JKMN']) await client.post('/admin/api/auth/register/options', { code: bad });
    expect(throttle().failures).toBe(4);
    // The code is real, but it is inside the wait.
    expect((await client.post('/admin/api/auth/register/options', { code: token })).json).toEqual({ code: 'CODE_REFUSED' });
    setNow(NOW + 2000);
    expect((await client.post('/admin/api/auth/register/options', { code: token })).status).toBe(200);
  });

  it('is reset by a code that is redeemed', async () => {
    t.db.prepare('UPDATE auth_throttle SET failures = 3').run();
    const res = await new Client(app, env).registerWithCode(newAuthenticator(env), setupToken(t.db));
    expect(res.status).toBe(200);
    expect(throttle().failures).toBe(0);
  });

  it('is one account-wide row, so a stranger slows the founder by no more than the cap', async () => {
    const { auth } = await signedIn(app, t.db, env);
    t.db.prepare('UPDATE auth_throttle SET failures = 1000, last_failure_at = ?').run(NOW);
    setNow(NOW + 30_000);
    expect((await new Client(app, env).signIn(auth)).status).toBe(200);
  });
});

describe('sessions on the server (AC-10)', () => {
  it('answers 401 once a session has been idle for 1 h, and not before', async () => {
    const { client } = await signedIn(app, t.db, env);
    setNow(NOW + 59 * MINUTE);
    expect((await client.get('/admin/api/session')).status).toBe(200);
    // That request counted as activity, so idle is measured from it.
    setNow(NOW + 59 * MINUTE + 61 * MINUTE);
    const res = await client.get('/admin/api/session');
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ code: 'UNAUTHENTICATED' });
    expect(row<{ n: number }>('SELECT count(*) AS n FROM session').n).toBe(0);
  });

  it('answers 401 24 h after sign-in however busy it has been', async () => {
    const { client } = await signedIn(app, t.db, env);
    for (let minutes = 50; minutes <= 24 * 60; minutes += 50) {
      setNow(NOW + minutes * MINUTE);
      expect((await client.get('/admin/api/session')).status, `at ${minutes} min`).toBe(200);
    }
    setNow(NOW + 24 * 60 * MINUTE + MINUTE);
    expect((await client.get('/admin/api/session')).status).toBe(401);
  });

  it('is moved only by /admin/api requests: a page request leaves last_seen_at alone (D-8)', async () => {
    const { client } = await signedIn(app, t.db, env);
    setNow(NOW + 10 * MINUTE);
    const res = await client.get('/log');
    expect(res.status).toBe(200);
    expect(row<{ last_seen_at: number }>('SELECT last_seen_at FROM session').last_seen_at).toBe(NOW);
    await client.get('/admin/api/session');
    expect(row<{ last_seen_at: number }>('SELECT last_seen_at FROM session').last_seen_at).toBe(NOW + 10 * MINUTE);
  });

  it('is not moved by a request that fails its CSRF check', async () => {
    const { client } = await signedIn(app, t.db, env);
    setNow(NOW + 10 * MINUTE);
    expect((await client.post('/admin/api/settings/independence-note/dismiss', {}, { 'X-CSRF-Token': 'wrong' })).status).toBe(403);
    expect(row<{ last_seen_at: number }>('SELECT last_seen_at FROM session').last_seen_at).toBe(NOW);
  });

  it('sign-out ends the session on the server: the old cookie gets 401 (AC-10)', async () => {
    const { client } = await signedIn(app, t.db, env);
    const cookie = client.cookie as string;
    const out = await client.post('/admin/api/auth/signout');
    expect(out.status).toBe(200);
    expect(out.headers.getSetCookie()[0]).toMatch(/Max-Age=0/i);
    expect(row<{ n: number }>('SELECT count(*) AS n FROM session').n).toBe(0);
    const stale = new Client(app, env);
    stale.cookie = cookie;
    expect((await stale.get('/admin/api/session')).status).toBe(401);
  });

  it('refuses a sign-out without the CSRF token when a session exists, and signs out nothing when there is none', async () => {
    const { client } = await signedIn(app, t.db, env);
    expect((await client.post('/admin/api/auth/signout', {}, { 'X-CSRF-Token': null })).json).toEqual({ code: 'CSRF_INVALID' });
    expect(row<{ n: number }>('SELECT count(*) AS n FROM session').n).toBe(1);
    expect((await new Client(app, env).post('/admin/api/auth/signout')).status).toBe(200);
  });

  it('refuses a cookie that is not a session, and clears it', async () => {
    const client = new Client(app, env);
    client.cookie = 'AAAAAAAAAAAAAAAAAAAAAA';
    const res = await client.get('/admin/api/session');
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie()[0]).toMatch(/Max-Age=0/i);
  });

  it('returns the session body, and no counts or times (house rule 1)', async () => {
    const { client, auth } = await signedIn(app, t.db, env);
    const res = await client.get('/admin/api/session');
    expect(res.json).toEqual({
      csrf: client.csrf,
      fresh: true,
      deviceCredentialId: auth.credentialId,
      independenceNoteDismissed: false,
    });
  });
});

describe('freshness and re-authentication (AC-11)', () => {
  it('counts a sign-in at 4:59 as fresh and one at 5:01 as not', async () => {
    const { client, auth } = await signedIn(app, t.db, env);
    setNow(NOW + 5 * MINUTE - 1000);
    expect((await client.get('/admin/api/session')).json.fresh).toBe(true);
    setNow(NOW + 5 * MINUTE + 1000);
    expect((await client.get('/admin/api/session')).json.fresh).toBe(false);
    // The window is the passkey assertion's, not the last request's.
    expect(row<{ auth_at: number }>('SELECT auth_at FROM session').auth_at).toBe(NOW);
    expect(auth.signCount).toBe(0);
  });

  it('makes a session fresh again with a passkey assertion, rotating the session id and the CSRF token', async () => {
    const { client, auth } = await signedIn(app, t.db, env);
    setNow(NOW + 20 * MINUTE);
    const before = { cookie: client.cookie, csrf: client.csrf };
    const res = await client.reauth(auth);
    expect(res.status).toBe(200);
    expect(res.json.fresh).toBe(true);
    expect(client.cookie).not.toBe(before.cookie);
    expect(client.csrf).not.toBe(before.csrf);
    expect(row<{ n: number }>('SELECT count(*) AS n FROM session').n).toBe(1);
    // The old id is gone; the 24 h limit is still counted from the first sign-in.
    const old = new Client(app, env);
    old.cookie = before.cookie;
    expect((await old.get('/admin/api/session')).status).toBe(401);
    expect(row<{ created_at: number }>('SELECT created_at FROM session').created_at).toBe(NOW);
  });

  it('refuses a re-authentication that fails, with the sign-in refusal, and counts it', async () => {
    const { client, auth } = await signedIn(app, t.db, env);
    auth.uv = false;
    const res = await client.reauth(auth);
    expect(res.status).toBe(400);
    expect(res.text).toBe(SIGNIN_FAILED);
    expect(row<{ failures: number }>('SELECT failures FROM auth_throttle').failures).toBe(1);
  });

  it('refuses a sign-in challenge as a re-authentication challenge, and one session\'s challenge for another', async () => {
    const { client, auth } = await signedIn(app, t.db, env);
    const other = await signedIn(app, t.db, env);
    const options = await new Client(app, env).post('/admin/api/auth/signin/options');
    const viaSignIn = await client.post('/admin/api/auth/reauth/verify', { response: auth.assert(options.json as never) });
    expect(viaSignIn.text).toBe(SIGNIN_FAILED);
    resetThrottle();
    const mine = await client.post('/admin/api/auth/reauth/options');
    const response = auth.assert(mine.json as never);
    expect((await other.client.post('/admin/api/auth/reauth/verify', { response })).text).toBe(SIGNIN_FAILED);
  });

  it('needs a session, and the CSRF token', async () => {
    const { client, auth } = await signedIn(app, t.db, env);
    expect((await new Client(app, env).post('/admin/api/auth/reauth/options')).json).toEqual({ code: 'UNAUTHENTICATED' });
    expect((await client.post('/admin/api/auth/reauth/options', {}, { 'X-CSRF-Token': null })).json).toEqual({ code: 'CSRF_INVALID' });
    expect((await client.reauth(auth)).status).toBe(200);
  });
});

describe('adding a passkey from a session (PD-17)', () => {
  it('needs a fresh session: at 5:01 it is REAUTH_REQUIRED, and after a re-authentication it works', async () => {
    const { client, auth } = await signedIn(app, t.db, env);
    setNow(NOW + 5 * MINUTE + 1000);
    const refused = await client.post('/admin/api/auth/register/options');
    expect(refused.status).toBe(403);
    expect(refused.json).toEqual({ code: 'REAUTH_REQUIRED' });
    expect((await client.reauth(auth)).status).toBe(200);
    expect((await client.registerFromSession(newAuthenticator(env))).status).toBe(200);
  });

  it('checks freshness again at verify, so options fetched in time do not outlive the window', async () => {
    const { client } = await signedIn(app, t.db, env);
    const options = await client.post('/admin/api/auth/register/options');
    const response = newAuthenticator(env).register(options.json as never);
    setNow(NOW + 5 * MINUTE + 1000);
    const res = await client.post('/admin/api/auth/register/verify', { name: 'Phone', response });
    expect(res.json).toEqual({ code: 'REAUTH_REQUIRED' });
  });

  it('marks the new passkey as this device, and the session stays opened by the first', async () => {
    const { client, auth: laptop } = await signedIn(app, t.db, env);
    const phone = newAuthenticator(env);
    const res = await client.registerFromSession(phone);
    expect(res.json.deviceCredentialId).toBe(phone.credentialId);
    expect(row<{ opened_by: string; device_credential: string }>('SELECT opened_by, device_credential FROM session')).toEqual({
      opened_by: laptop.credentialId,
      device_credential: phone.credentialId,
    });
  });

  it('needs the CSRF token', async () => {
    const { client } = await signedIn(app, t.db, env);
    const res = await client.post('/admin/api/auth/register/options', {}, { 'X-CSRF-Token': 'wrong' });
    expect(res.json).toEqual({ code: 'CSRF_INVALID' });
  });
});

describe('what is never logged', () => {
  it('writes nothing to the console through a whole run of failing and passing ceremonies', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method));
    try {
      const { client, auth } = await signedIn(app, t.db, env);
      auth.uv = false;
      await new Client(app, env).signIn(auth);
      await client.reauth(auth);
      await new Client(app, env).registerWithCode(newAuthenticator(env), 'not-a-code');
      await new Client(app, env).post('/admin/api/auth/signin/verify', { response: 'garbage' });
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

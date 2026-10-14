// The /admin/api guard: no session means 401 on every route (AC-8, house rule 7),
// every write carries the site's Origin and the CSRF token (AC-11, PD-14), and
// no public route reads, refreshes or sets the session (D-8).
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetClock, setNow } from '../../lib/clock.ts';
import { Client, COOKIE_NAME, resetAuth, signedIn } from '../authHelpers.ts';
import { NOW, tempDb, testApp, testEnv } from '../helpers.ts';

const t = tempDb();
const env = testEnv();
const app = testApp(t.db);
afterAll(() => t.cleanup());
beforeEach(() => {
  setNow(NOW);
  resetAuth(t.db);
});
afterEach(resetClock);

const UNAUTHENTICATED = JSON.stringify({ code: 'UNAUTHENTICATED' });

/** A concrete path for a route pattern: every `:param` becomes a value. */
const concrete = (path: string) => path.replace(/:[A-Za-z]+/g, 'x');

/** Every /admin/api route the app has registered that isn't a pre-session ceremony. */
function guardedRoutes(): { method: string; path: string }[] {
  const seen = new Set<string>();
  const found: { method: string; path: string }[] = [];
  for (const route of app.routes) {
    if (route.method === 'ALL') continue; // middleware, not a route
    if (!route.path.startsWith('/admin/api')) continue;
    if (route.path.startsWith('/admin/api/auth/')) continue;
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ method: route.method, path: route.path });
  }
  return found;
}

describe('AC-8: every admin API route answers 401 without a session', () => {
  it('finds the routes by enumerating the router, and finds some', () => {
    // An empty enumeration must not pass: the routes that matter are named here, so renaming one is noticed.
    const found = guardedRoutes().map((r) => `${r.method} ${r.path}`);
    expect(found.length).toBeGreaterThan(0);
    expect(found).toEqual(
      expect.arrayContaining([
        'GET /admin/api/session',
        'GET /admin/api/passkeys',
        'DELETE /admin/api/passkeys/:id',
        'POST /admin/api/enrolment-codes',
        'POST /admin/api/settings/independence-note/dismiss',
      ]),
    );
  });

  it('returns 401 UNAUTHENTICATED, one body, with no cookie at all', async () => {
    for (const { method, path } of guardedRoutes()) {
      const client = new Client(app, env);
      const res = await client.call(method, concrete(path), method === 'GET' ? undefined : {});
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(res.text, `${method} ${path}`).toBe(UNAUTHENTICATED);
      expect(res.headers.getSetCookie(), `${method} ${path}`).toEqual([]);
    }
  });

  it('returns 401 with an expired or unknown session too, and with the Origin and a CSRF token sent', async () => {
    const { client } = await signedIn(app, t.db, env);
    const cookie = client.cookie;
    const csrf = client.csrf;
    setNow(NOW + 2 * 60 * 60 * 1000);
    for (const { method, path } of guardedRoutes()) {
      const stale = new Client(app, env);
      stale.cookie = cookie;
      stale.csrf = csrf;
      const res = await stale.call(method, concrete(path), method === 'GET' ? undefined : {});
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(res.text, `${method} ${path}`).toBe(UNAUTHENTICATED);
    }
  });

  // The guard skips the whole auth/ prefix, so a route added there would escape it
  // and the enumeration above. The prefix holds exactly these, and a new one fails
  // here until a review places it.
  it('leaves only the ceremonies outside the guard', () => {
    const unguarded = [...new Set(app.routes.filter((r) => r.method !== 'ALL' && r.path.startsWith('/admin/api/auth/')).map((r) => `${r.method} ${r.path}`))];
    expect(unguarded.sort()).toEqual(
      [
        'POST /admin/api/auth/register/options',
        'POST /admin/api/auth/register/verify',
        'POST /admin/api/auth/reauth/options',
        'POST /admin/api/auth/reauth/verify',
        'POST /admin/api/auth/signin/options',
        'POST /admin/api/auth/signin/verify',
        'POST /admin/api/auth/signout',
      ].sort(),
    );
  });

  it('returns 401 from the ceremonies that check a session themselves, when there is none', async () => {
    // Registration without a code is from a session; re-authentication always is.
    for (const path of ['/admin/api/auth/register/options', '/admin/api/auth/register/verify', '/admin/api/auth/reauth/options', '/admin/api/auth/reauth/verify']) {
      const res = await new Client(app, env).post(path, {});
      expect(res.status, path).toBe(401);
      expect(res.text, path).toBe(UNAUTHENTICATED);
    }
  });

  it('returns 401 for a path that is no route at all, so the guard covers what a later stage adds', async () => {
    for (const path of ['/admin/api/entries', '/admin/api/episodes', '/admin/api/zzz', '/admin/api']) {
      const res = await new Client(app, env).get(path);
      expect(res.status, path).toBe(401);
      expect(res.text, path).toBe(UNAUTHENTICATED);
    }
  });

  it('is not defeated by a trailing slash, a different case of the method path, or a path-parameter trick', async () => {
    for (const path of ['/admin/api/session/', '/admin/api//session', '/admin/api/passkeys/../session', '/admin/api/%73ession']) {
      const res = await new Client(app, env).get(path);
      expect([401, 404], path).toContain(res.status);
      expect(res.text, path).not.toContain('csrf');
    }
  });

  it('lets a valid session through to every one of them', async () => {
    const { client } = await signedIn(app, t.db, env);
    expect((await client.get('/admin/api/session')).status).toBe(200);
    expect((await client.get('/admin/api/passkeys')).status).toBe(200);
  });

  it('serves the admin API with Cache-Control: no-store and the security headers (PD-18)', async () => {
    const res = await new Client(app, env).get('/admin/api/session');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

describe('the Origin check (PD-14)', () => {
  it('refuses a foreign Origin on every ceremony and every write, before anything else (403 ORIGIN_REFUSED)', async () => {
    const posts = [
      '/admin/api/auth/signin/options',
      '/admin/api/auth/signin/verify',
      '/admin/api/auth/signout',
      '/admin/api/auth/register/options',
      '/admin/api/auth/register/verify',
      '/admin/api/auth/reauth/options',
      '/admin/api/auth/reauth/verify',
      '/admin/api/enrolment-codes',
      '/admin/api/settings/independence-note/dismiss',
    ];
    const body = JSON.stringify({ code: 'ORIGIN_REFUSED' });
    for (const origin of ['https://evil.example', 'http://localhost:4101', 'null', `${env.origin}.evil.example`, `${env.origin}/`]) {
      for (const path of posts) {
        const res = await new Client(app, env).post(path, {}, { Origin: origin });
        expect(res.status, `${path} from ${origin}`).toBe(403);
        expect(res.text).toBe(body);
      }
    }
    const del = await new Client(app, env).delete('/admin/api/passkeys/x', { Origin: 'https://evil.example' });
    expect(del.status).toBe(403);
    expect(del.text).toBe(body);
  });

  it('refuses a write with no Origin at all, and a session cookie does not help', async () => {
    const { client } = await signedIn(app, t.db, env);
    const res = await client.post('/admin/api/settings/independence-note/dismiss', {}, { Origin: null });
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ code: 'ORIGIN_REFUSED' });
    expect(row('SELECT count(*) AS n FROM setting WHERE key = ?', 'independence_note_dismissed').n).toBe(0);
  });

  it('does not ask a GET for an Origin', async () => {
    const res = await new Client(app, env).get('/admin/api/session', { Origin: null });
    expect(res.status).toBe(401);
  });

  it('takes the Origin from ORIGIN, so a production site refuses its development origin', async () => {
    const prod = testApp(t.db, { NODE_ENV: 'production', ORIGIN: 'https://imnstr.com' });
    const prodEnv = testEnv({ NODE_ENV: 'production' });
    const ok = await new Client(prod, prodEnv).post('/admin/api/auth/signin/options');
    expect(ok.status).toBe(200);
    expect(ok.json.rpId).toBe('imnstr.com');
    const dev = await new Client(prod, prodEnv).post('/admin/api/auth/signin/options', {}, { Origin: 'http://localhost:4100' });
    expect(dev.status).toBe(403);
  });
});

function row(sql: string, ...args: unknown[]) {
  return t.db.prepare(sql).get(...args) as { n: number };
}

describe('the CSRF token (AC-11)', () => {
  const writes = [
    { method: 'POST', path: '/admin/api/enrolment-codes' },
    { method: 'POST', path: '/admin/api/settings/independence-note/dismiss' },
    { method: 'DELETE', path: '/admin/api/passkeys/x' },
  ];

  it('refuses a write with no token, a wrong token or the token of another session: 403 CSRF_INVALID, one body', async () => {
    const { client } = await signedIn(app, t.db, env);
    const other = await signedIn(app, t.db, env);
    const body = JSON.stringify({ code: 'CSRF_INVALID' });
    for (const { method, path } of writes) {
      for (const token of [null, '', 'wrong', other.client.csrf]) {
        const res = await client.call(method, path, method === 'POST' ? {} : undefined, { 'X-CSRF-Token': token });
        expect(res.status, `${method} ${path} with ${String(token)}`).toBe(403);
        expect(res.text).toBe(body);
      }
    }
  });

  it('refuses it before the write happens', async () => {
    const { client } = await signedIn(app, t.db, env);
    await client.post('/admin/api/settings/independence-note/dismiss', {}, { 'X-CSRF-Token': 'wrong' });
    expect(row('SELECT count(*) AS n FROM setting WHERE key = ?', 'independence_note_dismissed').n).toBe(0);
    expect((await client.post('/admin/api/settings/independence-note/dismiss')).status).toBe(200);
    expect(row('SELECT count(*) AS n FROM setting WHERE key = ?', 'independence_note_dismissed').n).toBe(1);
  });

  it('does not ask a read for the token', async () => {
    const { client } = await signedIn(app, t.db, env);
    expect((await client.get('/admin/api/session', { 'X-CSRF-Token': null })).status).toBe(200);
    expect((await client.get('/admin/api/passkeys', { 'X-CSRF-Token': null })).status).toBe(200);
  });

  it('does not take the token from the query string or the body', async () => {
    const { client } = await signedIn(app, t.db, env);
    const token = client.csrf as string;
    expect((await client.call('POST', `/admin/api/enrolment-codes?csrf=${token}`, { csrf: token }, { 'X-CSRF-Token': null })).status).toBe(403);
  });
});

describe('D-8: no session on a public route', () => {
  const publicPaths = ['/', '/fa/', '/log', '/fa/log', '/healthz', '/robots.txt', '/no-such-page', '/admin'];

  it('answers a request that carries a session cookie with no Set-Cookie, as it does without one (AC-7)', async () => {
    const { client } = await signedIn(app, t.db, env);
    for (const path of publicPaths) {
      const withCookie = await client.get(path);
      const without = await new Client(app, env).get(path);
      expect(withCookie.headers.getSetCookie(), path).toEqual([]);
      expect(without.headers.getSetCookie(), path).toEqual([]);
      expect(withCookie.status, path).toBe(without.status);
      expect(withCookie.text, path).toBe(without.text);
    }
  });

  it('does not refresh the session, and does not end an expired one', async () => {
    const { client } = await signedIn(app, t.db, env);
    setNow(NOW + 90 * 60 * 1000); // past the idle limit
    for (const path of publicPaths) await client.get(path);
    // Untouched: the stale row is still there, and still last seen at sign-in.
    expect(t.db.prepare('SELECT last_seen_at FROM session').get()).toEqual({ last_seen_at: NOW });
  });

  it('does not set a cookie on a failed admin request either, except to clear a dead one', async () => {
    const res = await new Client(app, env).get('/admin/api/session');
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(COOKIE_NAME).toBe('__Host-imnstr_session');
  });
});

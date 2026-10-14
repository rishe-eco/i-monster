// The e2e-only auth page and its helper routes exist only with E2E_CLOCK=1
// (plan B4a). In production they are the 404 page, which the verify checks by
// curl: `/__test/auth` → 404.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetClock, setNow } from '../../lib/clock.ts';
import { Client, newAuthenticator, resetAuth } from '../authHelpers.ts';
import { NOW, tempDb, testApp, testEnv } from '../helpers.ts';

const t = tempDb();
afterAll(() => t.cleanup());
beforeEach(() => {
  setNow(NOW);
  resetAuth(t.db);
});
afterEach(resetClock);

describe('with E2E_CLOCK=1', () => {
  const env = testEnv({ E2E_CLOCK: '1' });
  const app = testApp(t.db, { E2E_CLOCK: '1' });

  it('serves a bare page whose only script is a file of its own, under the same CSP as every page', async () => {
    const res = await app.request('/__test/auth');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/^text\/html/);
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(res.headers.getSetCookie()).toEqual([]);
    const html = await res.text();
    expect(html).toContain('<script src="/__test/auth.js"></script>');
    expect(html.replace('<script src="/__test/auth.js"></script>', '')).not.toMatch(/<script|\son[a-z]+=|\sstyle=/);
  });

  it('serves the script as JavaScript', async () => {
    const res = await app.request('/__test/auth.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/^text\/javascript/);
    expect(await res.text()).toContain('window.authTest');
  });

  it('issues a setup token that registers a passkey, and clears everything on DELETE', async () => {
    const issued = await app.request('/__test/auth/setup-token', { method: 'POST' });
    expect(issued.status).toBe(200);
    const { token } = (await issued.json()) as { token: string };
    const client = new Client(app, env);
    expect((await client.registerWithCode(newAuthenticator(env), token)).status).toBe(200);

    expect((await app.request('/__test/auth', { method: 'DELETE' })).status).toBe(200);
    for (const table of ['credential', 'session', 'auth_code']) {
      expect(t.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
    expect((await client.get('/admin/api/session')).status).toBe(401);
  });
});

describe('without E2E_CLOCK', () => {
  const app = testApp(t.db);

  it('has none of it: every path is the 404 page', async () => {
    for (const [method, path] of [
      ['GET', '/__test/auth'],
      ['GET', '/__test/auth.js'],
      ['POST', '/__test/auth/setup-token'],
      ['DELETE', '/__test/auth'],
    ] as const) {
      const res = await app.request(path, { method });
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(await res.text()).toContain('Something ate this page.');
    }
  });
});

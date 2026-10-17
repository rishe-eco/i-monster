// What every response carries, as the browser will see it (PD-18, PD-22, house
// rule 2). The app sets these itself, so the suite can check them.
import { afterAll, describe, expect, it } from 'vitest';
import { tempDb, testApp } from '../helpers.ts';

const t = tempDb();
afterAll(() => t.cleanup());
const app = testApp(t.db);

// The exact policy, written out again here on purpose: a change to it should be a visible edit to this test.
const CSP = "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const PAGES = ['/', '/fa/', '/no-such-page', '/fa/no-such-page', '/log/abcdefghjk', '/fa/log/abcdefghjk'];

describe.each(PAGES)('headers on %s', (path) => {
  it('carries the exact CSP and the other security headers', async () => {
    const res = await app.request(path);
    expect(res.headers.get('Content-Security-Policy')).toBe(CSP);
    expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=63072000');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Permissions-Policy')).toContain('camera=()');
    expect(res.headers.get('Permissions-Policy')).toContain('microphone=()');
    expect(res.headers.get('Permissions-Policy')).toContain('geolocation=()');
  });

  it('sets no cookie', async () => {
    const res = await app.request(path);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('revalidates on every request (PD-4)', async () => {
    const res = await app.request(path);
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
  });

  it('has no noindex when the site is not pre-launch', async () => {
    const res = await app.request(path);
    expect(res.headers.get('X-Robots-Tag')).toBeNull();
  });
});

describe('the landing pages carry an ETag, so a feed reader or browser can revalidate cheaply (PD-4)', () => {
  it.each(['/', '/fa/'])('%s', async (path) => {
    const res = await app.request(path);
    expect(res.headers.get('ETag')).toMatch(/^(W\/)?"[0-9a-f]+"$/);
  });
});

describe('the markup under that CSP (house rule 2)', () => {
  it.each(['/', '/fa/', '/nope', '/fa/nope'])('%s has no inline script and no style attribute', async (path) => {
    const html = await (await app.request(path)).text();
    // No inline script: the one script is the external, hashed wordmark.js (B9), which binds nothing under reduced motion.
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/i);
    expect([...html.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/gi)].map((m) => m[1])).toEqual([
      expect.stringMatching(/^\/assets\/wordmark\.[0-9a-f]{10}\.js$/),
    ]);
    expect(html).not.toMatch(/\sstyle\s*=/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/<style/i);
  });

  it.each(['/', '/fa/', '/nope', '/fa/nope'])('%s names no host but its own', async (path) => {
    const html = await (await app.request(path)).text();
    // The only absolute URLs are the hreflang alternates, which are links, not requests, and the
    // placeholder outbound project links, which a visitor must click.
    const requested = [...html.matchAll(/<(?:link|script|img|iframe|source|video|audio)\b[^>]*?\s(?:href|src)="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((url) => !/^(\/(?!\/)|data:)/.test(url ?? ''))
      // rel="alternate" links are hints for crawlers; the browser fetches nothing for them.
      .filter((url) => !/^https:\/\/imnstr\.com\//.test(url ?? ''));
    expect(requested).toEqual([]);
  });
});

describe('PRELAUNCH=1 (PD-22)', () => {
  const prelaunch = testApp(t.db, { PRELAUNCH: '1' });

  it.each([...PAGES, '/robots.txt', '/healthz'])('adds X-Robots-Tag: noindex on %s', async (path) => {
    const res = await prelaunch.request(path);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
  });

  it('adds it to an asset too', async () => {
    const html = await (await prelaunch.request('/')).text();
    const css = /href="(\/assets\/css\/site\.[0-9a-f]+\.css)"/.exec(html)?.[1];
    expect(css).toBeTruthy();
    const res = await prelaunch.request(css as string);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
  });
});

describe('robots.txt', () => {
  it('allows everything when the site is not pre-launch', async () => {
    const res = await app.request('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/^text\/plain/);
    expect(await res.text()).toBe('User-agent: *\nAllow: /\n');
  });

  it('disallows everything pre-launch', async () => {
    const res = await testApp(t.db, { PRELAUNCH: '1' }).request('/robots.txt');
    expect(await res.text()).toBe('User-agent: *\nDisallow: /\n');
  });
});

// The admin's shell is a public page: the same bytes for everyone, no cookie read or set, and the same
// policy as the rest. Its script is an external hashed file, so the CSP needs no exception (PD-21).
const ADMIN_PAGES = ['/admin', '/admin/', '/admin/setup/x', '/admin/setup/K7FQ-2MXP-R9TD'];

describe.each(ADMIN_PAGES)('headers on the admin shell %s', (path) => {
  it('carries the exact CSP and the other security headers', async () => {
    const res = await app.request(path);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Security-Policy')).toBe(CSP);
    expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=63072000');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Permissions-Policy')).toContain('camera=()');
  });

  it('never caches', async () => {
    expect((await app.request(path)).headers.get('Cache-Control')).toBe('no-store');
  });

  it('sets no cookie, and is identical with and without a session cookie (D-8)', async () => {
    const plain = await app.request(path);
    const cookie = await app.request(path, { headers: { Cookie: '__Host-imnstr_session=0123456789abcdef; other=1' } });
    expect(plain.headers.get('Set-Cookie')).toBeNull();
    expect(plain.headers.getSetCookie()).toEqual([]);
    expect(cookie.headers.get('Set-Cookie')).toBeNull();
    expect(await cookie.text()).toBe(await plain.text());
  });

  it('has no inline script and no style attribute, and asks for nothing off its own origin', async () => {
    const html = await (await app.request(path)).text();
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/i);
    expect(html).not.toMatch(/\sstyle\s*=|<style/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    const requested = [...html.matchAll(/<(?:link|script|img|iframe|source)\b[^>]*?\s(?:href|src)="([^"]+)"/g)].map((m) => m[1] as string);
    expect(requested.length).toBeGreaterThan(0);
    for (const url of requested) expect(url, url).toMatch(/^(\/(?!\/)|data:)/);
  });

  it('asks not to be indexed with PRELAUNCH=1, like every other response', async () => {
    expect((await testApp(t.db, { PRELAUNCH: '1' }).request(path)).headers.get('X-Robots-Tag')).toBe('noindex');
  });
});

describe('the admin never caches (PD-18)', () => {
  it('sets no-store on /admin paths, found or not', async () => {
    for (const path of ['/admin', '/admin/api/anything']) {
      const res = await app.request(path);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
  });
});

describe('D-8: nothing on a public route reads a cookie', () => {
  it.each(['/', '/fa/', '/nope', '/fa/nope'])('%s is identical with and without a session cookie', async (path) => {
    const plain = await app.request(path);
    const cookie = await app.request(path, {
      headers: { Cookie: '__Host-imnstr_session=0123456789abcdef; other=1' },
    });
    expect(cookie.status).toBe(plain.status);
    expect(await cookie.text()).toBe(await plain.text());
    expect(cookie.headers.get('Set-Cookie')).toBeNull();
    expect(cookie.headers.get('ETag')).toBe(plain.headers.get('ETag'));
  });
});

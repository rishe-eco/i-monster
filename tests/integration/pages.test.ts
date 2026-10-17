// The landing pages and the 404, in both languages: markup, language, switch,
// hreflang, no redirect by Accept-Language (AC-1, AC-26, AC-28, AC-40, AC-41).
import { afterAll, describe, expect, it } from 'vitest';
import { tempDb, testApp } from '../helpers.ts';

const t = tempDb();
afterAll(() => t.cleanup());
const app = testApp(t.db);

const html = async (path: string, init?: RequestInit) => (await app.request(path, init)).text();

describe('the landing pages', () => {
  it('serve English at / as lang=en dir=ltr', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/^text\/html; charset=utf-8/i);
    const body = await res.text();
    expect(body.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(body).toContain('<html lang="en" dir="ltr">');
  });

  it('serve Persian at /fa/ as lang=fa dir=rtl (AC-40)', async () => {
    const res = await app.request('/fa/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<html lang="fa" dir="rtl">');
  });

  it('show who this is, the projects, and the way into the log and the podcast (AC-1)', async () => {
    const en = await html('/');
    expect(en).toContain('<mark>understand them</mark>');
    expect(en).toContain('Root Studio');
    expect(en).toContain('href="/log"');
    expect(en).toContain('href="/podcast"');
    const fa = await html('/fa/');
    expect(fa).toContain('<mark>بفهمم‌شان</mark>');
    expect(fa).toContain('href="/fa/log"');
    expect(fa).toContain('href="/fa/podcast"');
  });

  it('name the owner as iMNSTR and link to /, /log and /podcast in their own language (AC-26)', async () => {
    for (const [path, home, log, podcast] of [
      ['/', '/', '/log', '/podcast'],
      ['/fa/', '/fa/', '/fa/log', '/fa/podcast'],
    ] as const) {
      const body = await html(path);
      expect(body).toContain('>iMNSTR<');
      expect(body).toContain(`href="${home}"`);
      expect(body).toContain(`href="${log}"`);
      expect(body).toContain(`href="${podcast}"`);
    }
  });

  it('show no date, count or latest-entry teaser (AC-5, W4)', async () => {
    for (const path of ['/', '/fa/']) {
      const body = await html(path);
      expect(body).not.toMatch(/<time\b/);
      expect(body).not.toMatch(/\b(19|20)\d\d\b/);
      expect(body).not.toMatch(/[۰-۹]{4}/);
    }
  });

  it('carry the footer line (AC-7)', async () => {
    expect(await html('/')).toContain('No cookies here. The monster ate them.');
    expect(await html('/fa/')).toContain('اینجا کوکی نداریم. هیولا خوردشان.');
  });

  it('isolate a Latin project name inside Persian text', async () => {
    expect(await html('/fa/')).toContain('<bdi lang="en">Root</bdi>');
  });

  it('send /fa to /fa/ rather than serve two addresses', async () => {
    const res = await app.request('/fa');
    expect(res.status).toBe(308);
    expect(res.headers.get('Location')).toBe('/fa/');
  });
});

describe('the language switch (AC-41)', () => {
  it('names Persian in Persian on English pages, and links to the Persian landing', async () => {
    const body = await html('/');
    expect(body).toContain('<a href="/fa/" lang="fa" hreflang="fa">فارسی</a>');
  });

  it('names English in English on Persian pages, and links to the English landing', async () => {
    const body = await html('/fa/');
    expect(body).toContain('<a href="/" lang="en" hreflang="en">English</a>');
  });

  it('goes from a 404 to the other language landing page', async () => {
    expect(await html('/nope')).toContain('<a href="/fa/" lang="fa" hreflang="fa">فارسی</a>');
    expect(await html('/fa/nope')).toContain('<a href="/" lang="en" hreflang="en">English</a>');
  });
});

describe('hreflang (AC-41)', () => {
  it('lists each landing page as the alternate of the other', async () => {
    for (const path of ['/', '/fa/']) {
      const body = await html(path);
      expect(body).toContain('<link rel="alternate" hreflang="en" href="https://imnstr.com/"/>');
      expect(body).toContain('<link rel="alternate" hreflang="fa" href="https://imnstr.com/fa/"/>');
    }
  });

  it('is not on a 404', async () => {
    expect(await html('/nope')).not.toContain('hreflang="en" href="https');
  });

  it('points each page at its own language feed (G6)', async () => {
    expect(await html('/')).toContain('rel="alternate" type="application/atom+xml" title="iMNSTR — Learnings" href="/log/feed.xml"');
    expect(await html('/fa/')).toContain('type="application/atom+xml"');
    expect(await html('/fa/')).toContain('href="/fa/log/feed.xml"');
  });
});

describe('no redirect by browser language (AC-41)', () => {
  it.each(['fa', 'fa-IR,fa;q=0.9,en;q=0.5', 'en-US', '*', 'de'])('serves / unchanged for Accept-Language: %s', async (lang) => {
    const res = await app.request('/', { headers: { 'Accept-Language': lang } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Location')).toBeNull();
    expect(await res.text()).toContain('<html lang="en" dir="ltr">');
  });

  it.each(['en', 'en-US,en;q=0.9'])('serves /fa/ unchanged for Accept-Language: %s', async (lang) => {
    const res = await app.request('/fa/', { headers: { 'Accept-Language': lang } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<html lang="fa" dir="rtl">');
  });
});

describe('the 404 (AC-26, AC-28)', () => {
  it.each([
    ['/nope', 'en', 'Something ate this page.'],
    ['/fa/nope', 'fa', 'چیزی این صفحه را خورد.'],
  ])('is a designed page in the language of the path: %s', async (path, lang, title) => {
    const res = await app.request(path);
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain(`<html lang="${lang}" dir="${lang === 'fa' ? 'rtl' : 'ltr'}">`);
    expect(body).toContain(title);
  });

  it('names the owner and links to /, /log and /podcast, per language', async () => {
    const en = await html('/nope');
    for (const href of ['/', '/log', '/podcast']) expect(en).toContain(`href="${href}"`);
    expect(en).toContain('iMNSTR');
    const fa = await html('/fa/nope');
    for (const href of ['/fa/', '/fa/log', '/fa/podcast']) expect(fa).toContain(`href="${href}"`);
    expect(fa).toContain('iMNSTR');
  });

  it('does not depend on what was asked for: every unknown path gives one page', async () => {
    const pages = await Promise.all(
      ['/nope', '/log/abcdefghjk', '/log/0000000000', '/a/b/c', '/podcast/x', '/log/feed.xml.bak'].map((path) => html(path)),
    );
    expect(new Set(pages).size).toBe(1);
    const fa = await Promise.all(['/fa/nope', '/fa/log/abcdefghjk', '/fa/a/b/c'].map((path) => html(path)));
    expect(new Set(fa).size).toBe(1);
  });

  it('never repeats the path in the page', async () => {
    const body = await html('/secret-unpublished-entry');
    expect(body).not.toContain('secret-unpublished-entry');
  });

  it('gives a Persian id under /log/ and an English one under /fa/log/ that language 404, with no redirect (AC-28)', async () => {
    const en = await app.request('/log/abcdefghjk');
    expect(en.status).toBe(404);
    expect(en.headers.get('Location')).toBeNull();
    const fa = await app.request('/fa/log/abcdefghjk');
    expect(fa.status).toBe(404);
    expect(await fa.text()).toContain('lang="fa"');
  });

  it('also answers other methods and HEAD with the 404', async () => {
    expect((await app.request('/nope', { method: 'POST' })).status).toBe(404);
    expect((await app.request('/nope', { method: 'HEAD' })).status).toBe(404);
  });

  it('is not a language the path does not name: /fax is English', async () => {
    expect(await html('/fax')).toContain('<html lang="en" dir="ltr">');
  });
});

describe('a conditional request (PD-4)', () => {
  it('gets 304 when the ETag still matches', async () => {
    const first = await app.request('/');
    const etag = first.headers.get('ETag') as string;
    const again = await app.request('/', { headers: { 'If-None-Match': etag } });
    expect(again.status).toBe(304);
    expect(again.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
  });
});

describe('/healthz', () => {
  it('answers ok, uncached', async () => {
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('says so when the database is gone', async () => {
    const own = tempDb();
    const broken = testApp(own.db);
    own.db.close();
    const res = await broken.request('/healthz');
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('DB_UNAVAILABLE');
    own.cleanup();
  });
});

describe('the admin shell (PD-21)', () => {
  it('is one English page for /admin and for every /admin/setup/<code>', async () => {
    const shell = await html('/admin');
    expect(shell.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(shell).toContain('<html lang="en" dir="ltr">');
    expect(shell).toContain('<div id="admin"></div>');
    expect(shell).toContain('<meta name="robots" content="noindex"/>');
    // The code is read from the path by the bundle; the server renders the same bytes whatever it is.
    expect(await html('/admin/setup/x')).toBe(shell);
    expect(await html('/admin/setup/K7FQ-2MXP-R9TD')).toBe(shell);
    expect(await html('/admin/')).toBe(shell);
  });

  it('never repeats the code in the page', async () => {
    expect(await html('/admin/setup/K7FQ-2MXP-R9TD')).not.toContain('K7FQ');
  });

  it('names the site stylesheet, the admin stylesheet and the one admin script, all hashed and served', async () => {
    const shell = await html('/admin');
    const css = /<link rel="stylesheet" href="(\/assets\/admin\/admin\.[0-9a-f]{10}\.css)"/.exec(shell)?.[1];
    const js = /<script type="module" src="(\/assets\/admin\/admin\.[0-9a-f]{10}\.js)"/.exec(shell)?.[1];
    expect(shell).toMatch(/<link rel="stylesheet" href="\/assets\/css\/site\.[0-9a-f]{10}\.css"/);
    expect(css).toBeTruthy();
    expect(js).toBeTruthy();
    for (const url of [css, js] as string[]) {
      const res = await app.request(url);
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
      expect(res.headers.get('Set-Cookie')).toBeNull();
    }
    expect((await app.request(js as string)).headers.get('Content-Type')).toBe('text/javascript; charset=utf-8');
  });

  it('loads the same wordmark.js as the public pages, deferred and external, for the sign-in view\'s eyes (B9)', async () => {
    const shell = await html('/admin');
    const wordmark = /<script defer="" src="(\/assets\/wordmark\.[0-9a-f]{10}\.js)"/.exec(shell)?.[1] as string;
    expect(wordmark).toBeTruthy();
    expect(await html('/')).toContain('src="' + wordmark + '"');
    expect(shell).not.toMatch(/<script(?![^>]*\ssrc=)/);
    expect((await app.request(wordmark)).status).toBe(200);
  });

  it('holds the shell\'s timezone for the bundle, and no other path under /admin is a page', async () => {
    expect(await html('/admin')).toContain('<meta name="site-timezone" content="Asia/Tehran"/>');
    // /admin/api is the API; anything else under /admin is the designed 404, as everywhere.
    for (const path of ['/admin/nope', '/admin/setup', '/admin/setup/a/b']) {
      expect((await app.request(path)).status, path).toBe(404);
    }
  });

  it('answers HEAD like GET, with no body', async () => {
    const res = await app.request('/admin', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });
});

describe('the wordmark and the eyes in the markup (B9)', () => {
  const PAGES: [string, string][] = [
    ['/', 'hero'],
    ['/fa/', 'hero'],
    ['/log', 'header'],
    ['/fa/log', 'header'],
    ['/podcast', 'header'],
    ['/fa/podcast', 'header'],
    ['/nope', 'header'],
    ['/fa/nope', 'header'],
  ];

  it.each(PAGES)('%s: the revealed letters are hidden from assistive technology, so the link is still named iMNSTR', async (path) => {
    const body = await html(path);
    const link = /<a class="wordmark[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(body)?.[1] as string;
    expect(link).toBeTruthy();
    const hidden = [...link.matchAll(/<span class="wordmark__hid" aria-hidden="true">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(hidden).toEqual(['-', 'o', 'e']);
    // What is left once the hidden letters are taken out is the name.
    expect(link.replace(/<span class="wordmark__hid"[^>]*>[^<]*<\/span>/g, '').replace(/<[^>]+>/g, '')).toBe('iMNSTR');
  });

  it.each(PAGES)('%s: every eye sits in a group that assistive technology skips, and the page carries no inline style', async (path) => {
    const body = await html(path);
    const groups = [...body.matchAll(/<span class="eyes eyes--(\w+)" aria-hidden="true">/g)].map((m) => m[1]);
    expect(groups.length).toBeGreaterThan(0);
    expect(body.match(/data-eye=/g)?.length).toBe(groups.length * 2);
    expect(body).not.toMatch(/\sstyle=/);
  });

  it('puts the eyes where the design does: beside the wordmark in every header, the hero, above the empty states, big on the 404 (plates 1 to 4, 13)', async () => {
    const size = async (path: string) => [...(await html(path)).matchAll(/class="eyes eyes--(\w+)"/g)].map((m) => m[1]);
    expect(await size('/')).toEqual(['hero']);
    expect(await size('/fa/')).toEqual(['hero']);
    // The landing header holds only the nav: the hero is the wordmark.
    expect(await size('/nope')).toEqual(['header', 'big']);
    expect(await size('/fa/nope')).toEqual(['header', 'big']);
    // An empty log and an empty podcast (no entries are seeded in this file) show the small eyes above their line.
    expect(await size('/log')).toEqual(['header', 'empty']);
    expect(await size('/fa/log')).toEqual(['header', 'empty']);
    expect(await size('/podcast')).toEqual(['header', 'empty']);
    expect(await size('/fa/podcast')).toEqual(['header', 'empty']);
  });

  it('plays the intro only where the hero says so: / and /fa/', async () => {
    for (const path of ['/', '/fa/']) expect(await html(path)).toContain('class="hero" data-intro');
    for (const path of ['/log', '/podcast', '/nope', '/fa/log']) expect(await html(path)).not.toContain('data-intro');
  });
});

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

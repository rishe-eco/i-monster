// Hashed asset names, long caching, and the self-hosted fonts (PD-26, D-1, D-6).
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildAssets } from '../../lib/assets.ts';
import { tempDb, testApp } from '../helpers.ts';

const t = tempDb();
afterAll(() => t.cleanup());
const app = testApp(t.db);

const stylesheetPath = async () => {
  const html = await (await app.request('/')).text();
  return /href="(\/assets\/css\/site\.[0-9a-f]{10}\.css)"/.exec(html)?.[1] as string;
};

describe('the stylesheet', () => {
  it('is served at a hashed name, immutable for a year', async () => {
    const path = await stylesheetPath();
    expect(path).toMatch(/^\/assets\/css\/site\.[0-9a-f]{10}\.css$/);
    const res = await app.request(path);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/css; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
  });

  it('has a hash that is the hash of its own bytes', async () => {
    const path = await stylesheetPath();
    const body = Buffer.from(await (await app.request(path)).arrayBuffer());
    const hash = createHash('sha256').update(body).digest('hex').slice(0, 10);
    expect(path).toContain(`.${hash}.`);
  });

  it('points every font at a hashed name that is served', async () => {
    const css = await (await app.request(await stylesheetPath())).text();
    const urls = [...css.matchAll(/url\((\/assets\/[^)]+)\)/g)].map((m) => m[1] as string);
    expect(urls.length).toBeGreaterThanOrEqual(13);
    for (const url of urls) {
      expect(url).toMatch(/^\/assets\/fonts\/[a-z-]+\/[a-z-]+-(latin|arabic)-\d{3}-normal\.[0-9a-f]{10}\.woff2$/);
      const res = await app.request(url);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('font/woff2');
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    }
  });

  it('asks for no host but its own, and no @import', async () => {
    const css = await (await app.request(await stylesheetPath())).text();
    expect(css).not.toMatch(/https?:\/\//);
    expect(css).not.toContain('@import');
    expect(css).not.toContain('fonts.googleapis.com');
  });

  it('declares every family with font-display: swap (PD-26)', async () => {
    const css = await (await app.request(await stylesheetPath())).text();
    const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    expect(faces.length).toBeGreaterThanOrEqual(13);
    for (const face of faces) expect(face).toContain('font-display: swap');
    for (const family of ['Bricolage Grotesque', 'Newsreader', 'Estedad', 'Vazirmatn']) {
      expect(css).toContain(`font-family: '${family}'`);
    }
  });
});

describe('what is not an asset', () => {
  it('404s an unhashed or wrong name with the designed page, and caches nothing for a year', async () => {
    for (const path of ['/assets/css/site.css', '/assets/css/site.0000000000.css', '/assets/nope.js', '/assets/']) {
      const res = await app.request(path);
      expect(res.status).toBe(404);
      expect(res.headers.get('Cache-Control')).toBe('no-cache');
      expect(await res.text()).toContain('Something ate this page.');
    }
  });

  it('does not serve a file outside assets by path tricks', async () => {
    for (const path of ['/assets/../package.json', '/assets/%2e%2e/package.json', '/assets/fonts/../../server.ts']) {
      const res = await app.request(path);
      expect(res.status).toBe(404);
    }
  });

  it('does not serve the licence text or the stylesheet parts as assets', async () => {
    for (const path of ['/assets/fonts/estedad/OFL.txt', '/assets/css/tokens.css', '/assets/css/fonts.css']) {
      expect((await app.request(path)).status).toBe(404);
    }
  });
});

describe('the pages preload only their own language fonts (PD-26)', () => {
  const preloads = async (path: string) =>
    [...(await (await app.request(path)).text()).matchAll(/<link rel="preload" as="font"[^>]*href="([^"]+)"/g)].map(
      (m) => m[1] as string,
    );

  it('English preloads Bricolage and Newsreader, and no Persian face', async () => {
    const urls = await preloads('/');
    expect(urls).toHaveLength(2);
    expect(urls.join(' ')).toMatch(/bricolage-grotesque/);
    expect(urls.join(' ')).toMatch(/newsreader/);
    expect(urls.join(' ')).not.toMatch(/estedad|vazirmatn/);
  });

  it('Persian preloads Estedad and Vazirmatn, and no Latin family', async () => {
    const urls = await preloads('/fa/');
    expect(urls).toHaveLength(2);
    expect(urls.join(' ')).toMatch(/estedad/);
    expect(urls.join(' ')).toMatch(/vazirmatn/);
    expect(urls.join(' ')).not.toMatch(/bricolage|newsreader/);
  });

  it('are served, with the crossorigin attribute fonts need', async () => {
    for (const path of ['/', '/fa/']) {
      const html = await (await app.request(path)).text();
      expect(html).toMatch(/<link rel="preload" as="font" type="font\/woff2" href="[^"]+" crossorigin="anonymous"\/>/);
      for (const url of await preloads(path)) expect((await app.request(url)).status).toBe(200);
    }
  });
});

describe('buildAssets', () => {
  it('gives a changed file a new address, so a stale one is never served', () => {
    const dir = mkdtempSync(join(tmpdir(), 'imnstr-assets-'));
    try {
      cpSync(join(import.meta.dirname, '..', '..', 'assets'), dir, { recursive: true });
      const before = buildAssets(dir).url('css/site.css');
      writeFileSync(join(dir, 'css', 'base.css'), `${readFileSync(join(dir, 'css', 'base.css'), 'utf8')}\n/* changed */\n`);
      const after = buildAssets(dir).url('css/site.css');
      expect(after).not.toBe(before);
      // The font addresses inside it did not change: their bytes did not.
      expect(buildAssets(dir).url('fonts/estedad/estedad-arabic-500-normal.woff2')).toBe(
        buildAssets().url('fonts/estedad/estedad-arabic-500-normal.woff2'),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to start when the stylesheet names a font that is not there', () => {
    const dir = mkdtempSync(join(tmpdir(), 'imnstr-assets-'));
    try {
      cpSync(join(import.meta.dirname, '..', '..', 'assets'), dir, { recursive: true });
      writeFileSync(join(dir, 'css', 'fonts.css'), "@font-face { src: url(../fonts/missing/none.woff2); }\n");
      expect(() => buildAssets(dir)).toThrow(/does not exist/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('knows its own names', () => {
    const assets = buildAssets();
    expect(() => assets.url('nope.css')).toThrow(/Unknown asset/);
    expect(assets.get('/assets/nope.css')).toBeUndefined();
  });
});

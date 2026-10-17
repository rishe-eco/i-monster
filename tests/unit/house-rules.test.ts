// Source-level checks of house rules that are easy to break by accident.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
const SKIP = new Set(['node_modules', '.tmp', '.claude', 'dist', 'test-results', 'playwright-report', '.git']);

function files(dir: string, extensions: string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...files(full, extensions));
    else if (extensions.some((ext) => entry.endsWith(ext))) found.push(full);
  }
  return found;
}

const rel = (path: string) => relative(ROOT, path).split(sep).join('/');

describe('house rule 5: time comes from clock.now()', () => {
  it('has no new Date() or Date.now() outside lib/clock.ts', () => {
    const offenders = files(ROOT, ['.ts', '.tsx'])
      .filter((path) => rel(path) !== 'lib/clock.ts' && rel(path) !== 'tests/unit/house-rules.test.ts')
      .filter((path) => /new Date\(\s*\)|Date\.now\(/.test(readFileSync(path, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('house rule 2: nothing inline in public markup (CSP)', () => {
  // An external script ("<script src>") is allowed: the CSP's default-src 'self' covers it. An inline one is not.
  const inline = /\sstyle=|<script(?![^>]*\ssrc=)|\son[a-z]+=/;

  it('has no style attribute and no inline script in the views', () => {
    const offenders = files(join(ROOT, 'views'), ['.tsx'])
      .filter((path) => inline.test(readFileSync(path, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('names two scripts across the views and the admin shell: assets/wordmark.js and the admin bundle (B9)', () => {
    const named = [...files(join(ROOT, 'views'), ['.tsx']), join(ROOT, 'routes', 'admin.tsx')].flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(/<script\b[^>]*\ssrc=\{assets\.url\('([^']+)'\)\}/g)].map((m) => m[1]),
    );
    // The public pages and the admin's shell both load wordmark.js; the shell alone loads the bundle.
    expect([...new Set(named)].sort()).toEqual(['admin/admin.js', 'wordmark.js']);
  });
});

describe('the stylesheets', () => {
  // Comments may say "left" or quote a colour; only the rules count.
  const code = (path: string) => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // The admin's stylesheet keeps the same rules as the site's: it is built by Vite, but written like the others.
  const sheets = [...files(join(ROOT, 'assets', 'css'), ['.css']), ...files(join(ROOT, 'admin'), ['.css'])].filter((path) => !rel(path).endsWith('tokens.css'));

  it('use logical properties only (no left, right, margin-left and the like)', () => {
    const physical =
      /(^|[\s;{])(left|right|margin-left|margin-right|padding-left|padding-right|border-left|border-right|text-align:\s*(left|right))\b/;
    const offenders = sheets.filter((path) => physical.test(code(path))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('take colours from tokens, never literals, outside tokens.css', () => {
    const literal = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;
    const offenders = sheets.filter((path) => literal.test(code(path))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('size in rem and em, not px', () => {
    const px = /[0-9.]\s?px\b/;
    const offenders = sheets
      .filter((path) => !rel(path).endsWith('fonts.css'))
      .filter((path) => px.test(code(path)))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('the admin bundle sources (plan B4b)', () => {
  const sources = files(join(ROOT, 'admin'), ['.ts', '.tsx']);
  const text = (path: string) => readFileSync(path, 'utf8');

  it('has sources to check', () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  it('keep nothing in the browser: no cookie, no sessionStorage, no IndexedDB, and localStorage only in browser-storage.ts, for the text buffers (AC-10, PD-12)', () => {
    const offenders = sources.filter((path) => /document\.cookie|sessionStorage|indexedDB/.test(text(path))).map(rel);
    expect(offenders).toEqual([]);
    // B6 keeps the person's unsent text on the device (plan B6, PD-12): the one place the browser's storage is reached.
    const storage = sources.filter((path) => /localStorage/.test(text(path))).map(rel);
    expect(storage).toEqual(['admin/browser-storage.ts']);
  });

  it('keep only the three text buffers in that storage: nothing about a session, a token or a setting (AC-10)', () => {
    const buffers = text(join(ROOT, 'admin', 'buffers.ts'));
    // Every key the buffers write is `imnstr:<kind>:<unsent|edit|kept>`.
    expect([...buffers.matchAll(/`imnstr:\$\{kind\}:(\w+)`/g)].map((m) => m[1]).sort()).toEqual(['edit', 'kept', 'unsent']);
    for (const path of ['admin/buffers.ts', 'admin/browser-storage.ts']) {
      const code = text(join(ROOT, path)).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(code, path).not.toMatch(/csrf|session|token|cookie/i);
    }
  });

  it('have no inline style and no raw HTML', () => {
    const offenders = sources.filter((path) => /\sstyle=|dangerouslySetInnerHTML|innerHTML/.test(text(path))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('write no prose of their own: every word is in copy.ts (house rule 3)', () => {
    // JSX text between tags would be prose written in place; copy.ts is the one place the words live.
    const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const offenders = sources
      .filter((path) => path.endsWith('.tsx'))
      .filter((path) => /(?<!=)>\s*[A-Z][a-z]+[^<>{}]*[a-z.]\s*</.test(withoutComments(text(path))))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('house rule 10: no secrets', () => {
  it('ships .env.example and no .env', () => {
    const names = readdirSync(ROOT);
    expect(names).toContain('.env.example');
    expect(names).not.toContain('.env');
  });
});

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
  it('has no style attribute and no inline script in the views', () => {
    const offenders = files(join(ROOT, 'views'), ['.tsx'])
      .filter((path) => /\sstyle=|<script[\s>]|\son[a-z]+=/.test(readFileSync(path, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
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

  it('keep nothing in the browser: no cookie, no localStorage, no sessionStorage, no IndexedDB (AC-10)', () => {
    const offenders = sources.filter((path) => /document\.cookie|localStorage|sessionStorage|indexedDB/.test(text(path))).map(rel);
    expect(offenders).toEqual([]);
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

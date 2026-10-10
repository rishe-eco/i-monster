// Shared setup for unit and integration tests.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.ts';
import { openDb, type Db } from '../lib/db.ts';
import { loadEnv, type Env } from '../lib/env.ts';

/** A fixed instant every fixture date is relative to: 2026-10-10 12:00 UTC. */
export const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export interface TempDb {
  db: Db;
  path: string;
  cleanup(): void;
}

/** A fresh, migrated SQLite file in the OS temp directory: one per test file. */
export function tempDb(): TempDb {
  const dir = mkdtempSync(join(tmpdir(), 'imnstr-test-'));
  const path = join(dir, 'test.db');
  const db = openDb(path);
  return {
    db,
    path,
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** An Env as the server would load it, with overrides. */
export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({ NODE_ENV: 'test', ...overrides });
}

export function testApp(db: Db, overrides: Record<string, string> = {}) {
  return createApp({ env: testEnv(overrides), db });
}

/**
 * A well-formedness check for the feed, with no XML dependency: tags nest and
 * close, attributes are quoted, and no bare `&` or `<` sits in text. Returns
 * the problem, or null. (The W3C Feed Validator is the reviewer's, plan §8.)
 */
export function xmlProblem(xml: string): string | null {
  const stack: string[] = [];
  const token = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|([^<]+)|(<)/g;
  for (const m of xml.matchAll(token)) {
    if (m[6]) return `a stray "<" at ${m.index}`;
    if (m[5] !== undefined) {
      if (/&(?!(?:amp|lt|gt|quot|#39|#\d+);)/.test(m[5])) return `a bare "&" in text near "${m[5].slice(0, 30)}"`;
      if (stack.length === 0 && m[5].trim() !== '') return 'text outside the root element';
    } else if (m[2]) {
      if (m[1]) {
        if (stack.pop() !== m[2]) return `unmatched </${m[2]}>`;
      } else if (!m[4]) {
        stack.push(m[2]);
      }
    }
  }
  return stack.length ? `unclosed <${stack[stack.length - 1]}>` : null;
}

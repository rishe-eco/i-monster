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

// scripts/setup-token.ts: prints the link and its expiry, and writes nothing else
// (plan B4a, house rule 10).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetClock, setNow } from '../../lib/clock.ts';
import { redeemCode } from '../../lib/codes.ts';
import { openDb } from '../../lib/db.ts';
import { setupTokenLines } from '../../scripts/setup-token.ts';
import { NOW, tempDb, testEnv } from '../helpers.ts';

const t = tempDb();
afterAll(() => t.cleanup());
beforeEach(() => setNow(NOW));
afterEach(resetClock);

const ROOT = join(import.meta.dirname, '..', '..');

describe('setupTokenLines', () => {
  it('prints the link and when it expires, 30 minutes on', () => {
    const lines = setupTokenLines(t.db, testEnv());
    expect(lines).toEqual([
      'Setup link (works once, for 30 minutes):',
      expect.stringMatching(/^http:\/\/localhost:4100\/admin\/setup\/[A-Za-z0-9_-]{22}$/),
      'Expires 2026-10-10T12:30:00.000Z',
    ]);
  });

  it('issues a token that redeems once, and keeps only its hash', () => {
    const link = setupTokenLines(t.db, testEnv())[1] as string;
    const token = link.split('/').pop() as string;
    expect(JSON.stringify(t.db.prepare('SELECT * FROM auth_code').all())).not.toContain(token);
    expect(redeemCode(t.db, token)).toMatchObject({ kind: 'setup' });
    expect(redeemCode(t.db, token)).toBe('CODE_REFUSED');
  });
});

describe('npm run setup-token, as a process', () => {
  const dir = mkdtempSync(join(tmpdir(), 'imnstr-cli-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('prints the production link, leaves only the database behind, and the token works', () => {
    const dbPath = join(dir, 'cli.db');
    const out = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/setup-token.ts'], {
      cwd: ROOT,
      env: { ...process.env, DB_PATH: dbPath, NODE_ENV: 'production', ORIGIN: '', E2E_CLOCK: '' },
      encoding: 'utf8',
    });
    const [heading, link, expires, ...rest] = out.trimEnd().split('\n');
    expect(heading).toBe('Setup link (works once, for 30 minutes):');
    expect(link).toMatch(/^https:\/\/imnstr\.com\/admin\/setup\/[A-Za-z0-9_-]{22}$/);
    expect(expires).toMatch(/^Expires \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(rest).toEqual([]);
    // Nothing but the database (and SQLite's own journal files) was written.
    expect(readdirSync(dir).filter((name) => !name.startsWith('cli.db'))).toEqual([]);

    const db = openDb(dbPath);
    try {
      expect(redeemCode(db, (link as string).split('/').pop())).toMatchObject({ kind: 'setup' });
    } finally {
      db.close();
    }
  }, 30_000);
});

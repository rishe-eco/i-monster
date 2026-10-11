// scripts/backup.ts: the copy has the same rows and passes integrity_check (plan B2).
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { backupDb } from '../../scripts/backup.ts';
import { NOW, tempDb } from '../helpers.ts';

const t = tempDb();
const out = mkdtempSync(join(tmpdir(), 'imnstr-backup-'));
afterAll(() => {
  t.cleanup();
  rmSync(out, { recursive: true, force: true });
});

describe('backupDb', () => {
  it('copies a seeded database: same rows, integrity_check ok', async () => {
    const insert = t.db.prepare('INSERT INTO credential (id, public_key, name, created_at) VALUES (?, ?, ?, ?)');
    insert.run('c1', Buffer.from([0]), 'phone', NOW);
    insert.run('c2', Buffer.from([1]), 'laptop', NOW);
    const destination = join(out, 'copy.db');

    await backupDb(t.path, destination);

    const copy = new Database(destination, { readonly: true });
    expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(copy.prepare('SELECT id, name FROM credential ORDER BY id').all()).toEqual([
      { id: 'c1', name: 'phone' },
      { id: 'c2', name: 'laptop' },
    ]);
    const migrations = 'SELECT name FROM schema_migration ORDER BY name';
    expect(copy.prepare(migrations).all()).toEqual(t.db.prepare(migrations).all());
    copy.close();
  });

  it('refuses to overwrite an existing file', async () => {
    await expect(backupDb(t.path, join(out, 'copy.db'))).rejects.toThrow(/already exists/);
  });

  it('writes nothing when the destination directory is missing', async () => {
    const destination = join(out, 'missing', 'copy.db');
    await expect(backupDb(t.path, destination)).rejects.toThrow();
    expect(existsSync(destination)).toBe(false);
  });
});

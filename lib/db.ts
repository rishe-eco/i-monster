// One SQLite file, opened the same way everywhere (PD-1, PD-5). Plain numbered
// SQL migrations in `migrations/`, run at boot, each in its own transaction.
import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Db = Database.Database;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * Open the database at `path`, with foreign keys on and WAL mode, and bring its
 * schema up to date. Both pragmas are per connection, so every opener goes
 * through here.
 */
export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // A second connection (the CLI, a backup) waits for the lock instead of failing.
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

/** Apply every migration file not yet recorded, in filename order. */
export function migrate(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migration (name TEXT PRIMARY KEY)');
  const applied = new Set(
    db
      .prepare('SELECT name FROM schema_migration')
      .all()
      .map((row) => (row as { name: string }).name),
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  for (const name of files) {
    if (applied.has(name)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migration (name) VALUES (?)').run(name);
    })();
  }
}

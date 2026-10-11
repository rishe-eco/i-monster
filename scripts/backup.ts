// Copy the live database to a file, safely, with SQLite's online backup API
// (plan B2), then check the copy. Usage:
//   node --import tsx scripts/backup.ts <destination.db>
// The database is DB_PATH. deploy/backup.sh runs this inside the container.
// Exits 1 if the copy cannot be made or fails PRAGMA integrity_check.
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { openDb } from '../lib/db.ts';
import { env } from '../lib/env.ts';

const USAGE = 'Usage: backup <destination.db>';

/** Back up the database at `sourcePath` to `destination`, and throw unless the copy passes integrity_check. */
export async function backupDb(sourcePath: string, destination: string): Promise<void> {
  // An existing file would be overwritten half way if the copy failed; the caller picks a fresh name.
  if (existsSync(destination)) throw new Error(`${destination} already exists`);
  const source = openDb(sourcePath);
  try {
    await source.backup(destination);
  } finally {
    source.close();
  }
  const copy = new Database(destination, { readonly: true });
  try {
    const result = copy.pragma('integrity_check', { simple: true });
    if (result !== 'ok') throw new Error(`integrity_check on the copy: ${String(result)}`);
  } finally {
    copy.close();
  }
}

if (import.meta.main) {
  const destination = process.argv[2];
  if (!destination || process.argv.length > 3) {
    console.error(USAGE);
    process.exit(1);
  }
  try {
    await backupDb(env.dbPath, destination);
    console.log(`Backed up to ${destination}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

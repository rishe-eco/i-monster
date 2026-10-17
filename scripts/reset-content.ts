// Clear what the demonstrations left, before launch (PD-20, eval plan §3.A):
// entries, episodes (their links go with them) and the reader record. Kept:
// passkeys, sessions, codes, the throttle and settings. Usage:
//   npm run reset-content            prints what it would delete and changes nothing
//   npm run reset-content -- --yes   deletes it, in one transaction
// On the server, take a backup first (deploy/README.md).
import { parseArgs } from 'node:util';
import { openDb, type Db } from '../lib/db.ts';
import { env } from '../lib/env.ts';
import { clearRecord } from '../lib/record.ts';

const USAGE = 'Usage: reset-content [--yes]';
const TABLES = ['entry', 'episode', 'episode_link', 'record_view', 'record_feed', 'record_referrer'] as const;

function counts(db: Db): string[] {
  return TABLES.map((table) => {
    const { n } = db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
    return `  ${table}: ${n} rows`;
  });
}

/** Run the CLI against `db`. Returns the text to print; throws with the usage on bad arguments. */
export function resetContent(argv: string[], db: Db): string {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: { yes: { type: 'boolean' } }, strict: true }));
  } catch {
    throw new Error(USAGE);
  }
  if (!values.yes) {
    return ['This would delete (nothing was changed; add --yes to do it):', ...counts(db), 'Kept: credential, session, auth_code, auth_throttle, setting.', ''].join('\n');
  }
  const before = counts(db);
  db.transaction(() => {
    // Deleting an episode cascades to its links past the last-link trigger, which only guards deleting a link by itself.
    db.prepare('DELETE FROM entry').run();
    db.prepare('DELETE FROM episode').run();
    clearRecord(db);
  })();
  return ['Deleted:', ...before, 'Kept: credential, session, auth_code, auth_throttle, setting.', ''].join('\n');
}

if (import.meta.main) {
  try {
    const db = openDb(env.dbPath);
    process.stdout.write(resetContent(process.argv.slice(2), db));
    db.close();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

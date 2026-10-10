// Insert a published entry straight into the table, for checks by hand and for
// MS2's demonstration (plan B3). Usage:
//   npm run seed-entry -- --lang en [--title "A title"] --body-file entry.txt
// The body file is plain text: a blank line between paragraphs, `[text](url)`
// for a link and `==text==` for the highlight. The database is DB_PATH.
// Rows made on production are cleared by B8's reset-content before launch.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { openDb, type Db } from '../lib/db.ts';
import { env } from '../lib/env.ts';
import { insertPublished } from '../lib/entries.ts';
import { localePath } from '../lib/i18n.ts';
import { docFromText } from '../shared/doc.ts';

const USAGE = 'Usage: seed-entry --lang en|fa [--title <text>] --body-file <path>';

/** Run the CLI against `db`. Returns the new entry's path; throws with a usage message on bad arguments. */
export function seedEntry(argv: string[], db: Db): string {
  const { values } = parseArgs({
    args: argv,
    options: { lang: { type: 'string' }, title: { type: 'string' }, 'body-file': { type: 'string' } },
    strict: true,
  });
  const lang = values.lang;
  if ((lang !== 'en' && lang !== 'fa') || !values['body-file']) throw new Error(USAGE);
  const body = docFromText(readFileSync(values['body-file'], 'utf8'));
  if (body.content.length === 0) throw new Error('The body file holds no text');
  const id = insertPublished(db, { lang, title: values.title, body });
  return localePath(lang, `/log/${id}`);
}

if (import.meta.main) {
  try {
    const db = openDb(env.dbPath);
    console.log(`Published ${seedEntry(process.argv.slice(2), db)}`);
    db.close();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

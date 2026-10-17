// Print the reader record for a run of months (plan B8, AC-47). Usage:
//   npm run report -- --from 2026-11 [--to 2027-01]
// Both months are inclusive; `--to` defaults to this month in SITE_TZ. The
// record is shown here and nowhere else: no page, no admin view (spec §3.1).
import { parseArgs } from 'node:util';
import { now } from '../lib/clock.ts';
import { recordMonth } from '../lib/dates.ts';
import { openDb, type Db } from '../lib/db.ts';
import { env } from '../lib/env.ts';
import { LANGS, localePath } from '../lib/i18n.ts';
import { report, type Report } from '../lib/record.ts';

const USAGE = 'Usage: report --from YYYY-MM [--to YYYY-MM]';
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Render a report as the text the CLI prints. */
export function formatReport(r: Report): string {
  const lines: string[] = [`The reader record, ${r.from} to ${r.to} (months in ${env.siteTz}).`];
  for (const lang of LANGS) {
    const part = r.langs[lang];
    lines.push('', lang === 'en' ? 'English' : 'Persian (/fa/)', '');
    lines.push('  Views per page');
    if (part.pages.length === 0) lines.push('    none');
    for (const p of part.pages) lines.push(`    ${p.page.padEnd(10)} ${p.views}`);
    lines.push('', '  Views per entry');
    if (part.entries.length === 0) lines.push('    none');
    for (const e of part.entries) {
      const name = e.label === null ? '(no longer an entry)' : e.label;
      lines.push(`    ${localePath(lang, `/log/${e.id}`)}  ${e.views}  ${name}`.trimEnd());
    }
    lines.push('', '  Feed readers: the highest subscribers reported');
    if (part.aggregators.length === 0) lines.push('    No feed reader reported subscribers in this period.');
    for (const a of part.aggregators) lines.push(`    ${a.aggregator}  ${a.subscribers}`);
    lines.push('', '  Referring domains');
    if (part.referrers.length === 0) lines.push('    none');
    for (const x of part.referrers) lines.push(`    ${x.domain}  ${x.count}`);
  }
  for (const c of r.capped) {
    lines.push('', `Note: ${c.month} (${c.lang}) reached the limit of keys for ${c.table === 'feed' ? 'feed readers' : 'referring domains'}, so later new ones were dropped.`);
  }
  return `${lines.join('\n')}\n`;
}

/** Run the CLI against `db`. Returns the text to print; throws with the usage on bad arguments. */
export function runReport(argv: string[], db: Db, instant: number = now()): string {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: { from: { type: 'string' }, to: { type: 'string' } }, strict: true }));
  } catch {
    throw new Error(USAGE);
  }
  const from = values.from;
  const to = values.to ?? recordMonth(instant, env.siteTz);
  if (from === undefined || !MONTH.test(from) || !MONTH.test(to) || from > to) throw new Error(USAGE);
  return formatReport(report(db, from, to));
}

if (import.meta.main) {
  try {
    const db = openDb(env.dbPath);
    process.stdout.write(runReport(process.argv.slice(2), db));
    db.close();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

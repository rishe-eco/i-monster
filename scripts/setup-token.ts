// Issue a one-time setup token and print its link (plan B4a, PD-16). Usage:
//   npm run setup-token
// The token is the only way in before the first passkey exists, and the way
// back in after both are lost, so it needs server access to make. It works once
// and dies after 30 minutes. It is printed and written nowhere else: the
// database keeps only its hash (house rule 10).
import { issueSetupToken } from '../lib/codes.ts';
import { openDb, type Db } from '../lib/db.ts';
import { env as processEnv, type Env } from '../lib/env.ts';
import { limits } from '../lib/limits.ts';

/** The lines the CLI prints for a token it has just issued in `db`. */
export function setupTokenLines(db: Db, env: Env): string[] {
  const { link, expiresAt } = issueSetupToken(db, env);
  const minutes = limits.setupTokenMs / 60_000;
  return [`Setup link (works once, for ${minutes} minutes):`, link, `Expires ${new Date(expiresAt).toISOString()}`];
}

if (import.meta.main) {
  try {
    const db = openDb(processEnv.dbPath);
    for (const line of setupTokenLines(db, processEnv)) console.log(line);
    db.close();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

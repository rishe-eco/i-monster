// Process entry: read the environment, open the database, serve.
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { openDb } from './lib/db.ts';
import { env } from './lib/env.ts';

const db = openDb(env.dbPath);
const app = createApp({ env, db });

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`imnstr listening on port ${info.port}${env.prelaunch ? ' (prelaunch: noindex)' : ''}`);
});

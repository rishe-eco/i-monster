// The admin's entry routes (plan B5, §6.1): list, read, save, edit, publish and
// unpublish. Mounted inside `adminApiRoutes`, after its guard, so none of them
// can be reached without a session (AC-8, S-12). Nothing here reads a cookie or
// checks a token: the guard has done both before a handler runs.
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../lib/context.ts';
import type { Db } from '../lib/db.ts';
import { now } from '../lib/clock.ts';
import {
  createEntry,
  getEntry,
  listForAdmin,
  publishEntry,
  readBody,
  readTitle,
  unpublishEntry,
  updateEntry,
  type AdminEntry,
} from '../lib/entries.ts';
import { isId } from '../lib/ids.ts';
import type { Lang } from '../lib/i18n.ts';
import type { Refusal } from './admin-api.ts';

/** What the admin router lends its sub-routers, so the table of refusals stays in one file. */
export interface ApiKit {
  refuse: (c: Context<AppEnv>, code: Refusal) => Response;
  readJson: (c: Context<AppEnv>) => Promise<Record<string, unknown> | null>;
}

// A client-made publish key (PD-11): any UUID, which `crypto.randomUUID()` makes.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The entry as the API sends it: the document is `body`, and the dates are instants, never elapsed times. */
const entryJson = (entry: AdminEntry) => ({
  id: entry.id,
  lang: entry.lang,
  title: entry.title,
  body: entry.body,
  state: entry.state,
  wasLive: entry.wasLive,
  firstPublishedAt: entry.firstPublishedAt,
});

const isLang = (value: unknown): value is Lang => value === 'en' || value === 'fa';

export function entryRoutes(db: Db, { refuse, readJson }: ApiKit): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get('/entries', (c) => {
    const cursor = c.req.query('before') ?? null;
    // A malformed or unknown cursor is the one refusal a read has: NOT_FOUND.
    if (cursor !== null && !isId(cursor)) return refuse(c, 'NOT_FOUND');
    const page = listForAdmin(db, cursor);
    if (!page) return refuse(c, 'NOT_FOUND');
    // `now` is the server's clock, for the year rule in the list's dates (AC-31): the bundle never reads the time.
    return c.json({ entries: page.entries, olderBefore: page.olderBefore, now: now() });
  });

  routes.get('/entries/:id', (c) => {
    const id = c.req.param('id');
    const entry = isId(id) ? getEntry(db, id) : null;
    return entry ? c.json({ entry: entryJson(entry) }) : refuse(c, 'NOT_FOUND');
  });

  routes.post('/entries', async (c) => {
    const json = await readJson(c);
    if (!json) return refuse(c, 'REQUEST_INVALID');
    // The order is fixed: language, then the shape of the request, then the body.
    if (!isLang(json.lang)) return refuse(c, 'LANG_INVALID');
    if (typeof json.publishKey !== 'string' || !UUID.test(json.publishKey)) return refuse(c, 'REQUEST_INVALID');
    const title = readTitle(json.title);
    if ('refusal' in title) return refuse(c, title.refusal);
    if (json.publish !== undefined && typeof json.publish !== 'boolean') return refuse(c, 'REQUEST_INVALID');
    const body = readBody(json.body);
    if ('refusal' in body) return refuse(c, body.refusal);
    // Any other field the client sends, a date included, is ignored: the server dates an entry (AC-12).
    const entry = createEntry(db, {
      publishKey: json.publishKey.toLowerCase(),
      lang: json.lang,
      title: title.title,
      body: body.doc,
      publish: json.publish === true,
    });
    // New or existing, the same answer: a retry can't tell, and needn't (AC-25).
    return c.json({ entry: entryJson(entry) });
  });

  routes.put('/entries/:id', async (c) => {
    const id = c.req.param('id');
    if (!isId(id) || !getEntry(db, id)) return refuse(c, 'NOT_FOUND');
    const json = await readJson(c);
    if (!json) return refuse(c, 'REQUEST_INVALID');
    // `lang`, `state` and the dates are not read: an edit changes the title and the body (AC-13).
    const title = readTitle(json.title);
    if ('refusal' in title) return refuse(c, title.refusal);
    const body = readBody(json.body);
    if ('refusal' in body) return refuse(c, body.refusal);
    const entry = updateEntry(db, id, { title: title.title, body: body.doc });
    return entry ? c.json({ entry: entryJson(entry) }) : refuse(c, 'NOT_FOUND');
  });

  routes.post('/entries/:id/publish', (c) => {
    const id = c.req.param('id');
    const entry = isId(id) ? publishEntry(db, id) : null;
    return entry ? c.json({ entry: entryJson(entry) }) : refuse(c, 'NOT_FOUND');
  });

  routes.post('/entries/:id/unpublish', (c) => {
    const id = c.req.param('id');
    const entry = isId(id) ? unpublishEntry(db, id) : null;
    return entry ? c.json({ entry: entryJson(entry) }) : refuse(c, 'NOT_FOUND');
  });

  return routes;
}

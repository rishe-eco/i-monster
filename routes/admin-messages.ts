// The admin's messages routes (change note 08, CT-8): the contact form's messages, newest first, and delete.
// Mounted inside `adminApiRoutes`, after its guard, so neither can be reached without a session (CT-9). There is
// no count or total in the answer (house rule 1), and every refusal is a code (house rule 3).
import { Hono } from 'hono';
import { now } from '../lib/clock.ts';
import { deleteMessage, listMessages } from '../lib/contact.ts';
import type { AppEnv } from '../lib/context.ts';
import type { Db } from '../lib/db.ts';
import { isId } from '../lib/ids.ts';
import type { ApiKit } from './admin-entries.ts';

export function messageRoutes(db: Db, { refuse }: Pick<ApiKit, 'refuse'>): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get('/messages', (c) => {
    const cursor = c.req.query('before') ?? null;
    // A malformed or unknown cursor is the one refusal a read has: NOT_FOUND.
    if (cursor !== null && !isId(cursor)) return refuse(c, 'NOT_FOUND');
    const page = listMessages(db, cursor);
    if (!page) return refuse(c, 'NOT_FOUND');
    // `now` is the server's, so the list's year rule (AC-31) never reads the browser's clock.
    return c.json({ messages: page.messages, olderBefore: page.olderBefore, now: now() });
  });

  routes.delete('/messages/:id', (c) => {
    const id = c.req.param('id');
    // Deleting is final (the table keeps nothing else), so the admin asks first; the route only does it.
    return isId(id) && deleteMessage(db, id) ? c.json({ ok: true }) : refuse(c, 'NOT_FOUND');
  });

  return routes;
}

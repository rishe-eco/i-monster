// The admin's messages API (change note 08, CT-8, CT-9): the contact form's messages newest first, delete, and
// the guard. Every refusal is a code and nothing else (house rule 3); nothing in an answer counts (house rule 1).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetClock, setNow } from '../../lib/clock.ts';
import { clearMessages, storeMessage } from '../../lib/contact.ts';
import { limits } from '../../lib/limits.ts';
import { Client, resetAuth, signedIn } from '../authHelpers.ts';
import { DAY, HOUR, MINUTE, NOW, tempDb, testApp, testEnv } from '../helpers.ts';

const t = tempDb();
const env = testEnv();
const app = testApp(t.db);
afterAll(() => {
  resetClock();
  t.cleanup();
});

let client: Client;
beforeEach(async () => {
  setNow(NOW);
  resetAuth(t.db);
  clearMessages(t.db);
  client = (await signedIn(app, t.db, env)).client;
});

interface Message {
  id: string;
  lang: string;
  subject: string;
  message: string;
  reach: string;
  receivedAt: number;
}

const input = (n: number) => ({ subject: `Subject ${n}`, message: `Message ${n}`, reach: `reach${n}@example.com` });
/** Store a message at `at`: the list is what is under test, so the cap's window is moved with it. */
const add = (n: number, at: number, lang: 'en' | 'fa' = 'en') => {
  const stored = storeMessage(t.db, lang, input(n), at);
  if (!stored.stored) throw new Error('capped');
  return stored.id;
};
const count = () => (t.db.prepare('SELECT count(*) AS n FROM contact_message').get() as { n: number }).n;
const never = 'a000000099';

describe('CT-8: the list', () => {
  it('is empty with nothing stored, and says nothing else', async () => {
    const res = await client.get('/admin/api/messages');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ messages: [], olderBefore: null, now: NOW });
  });

  it('lists each message with its subject, how to reach the sender, the text, the language and the time, newest first', async () => {
    const oldest = add(1, NOW - 3 * DAY, 'fa');
    const newest = add(3, NOW - HOUR);
    const middle = add(2, NOW - DAY);
    const res = await client.get('/admin/api/messages');
    const messages = res.json.messages as Message[];
    expect(messages.map((m) => m.id)).toEqual([newest, middle, oldest]);
    expect(messages[2]).toEqual({ id: oldest, lang: 'fa', ...input(1), receivedAt: NOW - 3 * DAY });
    expect(Object.keys(messages[0] as Message).sort()).toEqual(['id', 'lang', 'message', 'reach', 'receivedAt', 'subject']);
  });

  it('breaks a tie in time by id, so two messages in one millisecond keep a stable order', async () => {
    const a = add(1, NOW);
    const b = add(2, NOW);
    const ids = ((await client.get('/admin/api/messages')).json.messages as Message[]).map((m) => m.id);
    expect(ids).toEqual([a, b].sort());
  });

  it('carries no count, total, page number, elapsed time or unread state (house rule 1)', async () => {
    for (let n = 0; n < limits.pageSize + 2; n++) add(n, NOW - n * MINUTE);
    const res = await client.get('/admin/api/messages');
    expect(Object.keys(res.json).sort()).toEqual(['messages', 'now', 'olderBefore']);
    expect(res.text).not.toMatch(/"(count|total|page|pages|unread|read|new|size|elapsed|ago)"/i);
  });

  it('pages by a cursor: a page of twenty, then the rest, with no overlap', async () => {
    // The cap is 30 a day and this makes 23, so every one is stored.
    const ids = Array.from({ length: limits.pageSize + 3 }, (_, n) => add(n, NOW - n * MINUTE));
    const first = await client.get('/admin/api/messages');
    const firstPage = first.json.messages as Message[];
    expect(firstPage).toHaveLength(limits.pageSize);
    expect(first.json.olderBefore).toBe(ids[limits.pageSize - 1]);
    const second = await client.get(`/admin/api/messages?before=${first.json.olderBefore as string}`);
    expect((second.json.messages as Message[]).map((m) => m.id)).toEqual(ids.slice(limits.pageSize));
    expect(second.json.olderBefore).toBeNull();
  });

  it('refuses a cursor that is malformed or names no message with NOT_FOUND', async () => {
    for (const before of ['nope', never, '']) {
      const res = await client.get(`/admin/api/messages?before=${before}`);
      expect(res.status, before).toBe(404);
      expect(res.text, before).toBe(JSON.stringify({ code: 'NOT_FOUND' }));
    }
  });

  it('keeps the sender’s text exactly as stored: line breaks and markup are data, never markup', async () => {
    storeMessage(t.db, 'en', { subject: '<b>x</b>', message: 'a\nb <script>alert(1)</script>', reach: '@x' }, NOW);
    const [row] = (await client.get('/admin/api/messages')).json.messages as Message[];
    expect(row).toMatchObject({ subject: '<b>x</b>', message: 'a\nb <script>alert(1)</script>' });
  });
});

describe('CT-8: Delete', () => {
  it('deletes one message and no other, and answers ok', async () => {
    const keep = add(1, NOW - DAY);
    const gone = add(2, NOW);
    const res = await client.delete(`/admin/api/messages/${gone}`);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(((await client.get('/admin/api/messages')).json.messages as Message[]).map((m) => m.id)).toEqual([keep]);
  });

  it('refuses a message that is not there, or an id that is not an id, with NOT_FOUND', async () => {
    add(1, NOW);
    for (const id of [never, 'x', 'A000000099', '..']) {
      const res = await client.delete(`/admin/api/messages/${id}`);
      expect(res.status, id).toBe(404);
      expect(res.text, id).toBe(JSON.stringify({ code: 'NOT_FOUND' }));
    }
    expect(count()).toBe(1);
  });

  it('answers NOT_FOUND to a second delete of the same message', async () => {
    const id = add(1, NOW);
    expect((await client.delete(`/admin/api/messages/${id}`)).status).toBe(200);
    expect((await client.delete(`/admin/api/messages/${id}`)).status).toBe(404);
  });

  it('needs the site’s Origin and the CSRF token, like every admin write', async () => {
    const id = add(1, NOW);
    const noOrigin = await client.delete(`/admin/api/messages/${id}`, { Origin: null });
    expect(noOrigin.status).toBe(403);
    expect(noOrigin.text).toBe(JSON.stringify({ code: 'ORIGIN_REFUSED' }));
    const noToken = await client.delete(`/admin/api/messages/${id}`, { 'X-CSRF-Token': null });
    expect(noToken.status).toBe(403);
    expect(noToken.text).toBe(JSON.stringify({ code: 'CSRF_INVALID' }));
    expect(count()).toBe(1);
  });

  it('frees the 24-hour cap by the one message it removes, since the cap counts what is stored', async () => {
    for (let n = 0; n < limits.contactCap; n++) add(n, NOW - HOUR);
    expect(storeMessage(t.db, 'en', input(99), NOW).stored).toBe(false);
    const [first] = (await client.get('/admin/api/messages')).json.messages as Message[];
    await client.delete(`/admin/api/messages/${(first as Message).id}`);
    expect(storeMessage(t.db, 'en', input(99), NOW).stored).toBe(true);
  });
});

describe('CT-9: the guard', () => {
  const routes = () => {
    const found = new Set<string>();
    for (const route of app.routes) if (route.method !== 'ALL' && route.path.startsWith('/admin/api/messages')) found.add(`${route.method} ${route.path}`);
    return [...found].sort();
  };

  it('has the two routes, which the router-enumerating 401 test in auth-guard.test.ts therefore covers', () => {
    expect(routes()).toEqual(['DELETE /admin/api/messages/:id', 'GET /admin/api/messages']);
  });

  it('answers 401 UNAUTHENTICATED, one body and no cookie, signed out', async () => {
    const id = add(1, NOW);
    for (const [method, path] of [
      ['GET', '/admin/api/messages'],
      ['GET', `/admin/api/messages?before=${id}`],
      ['DELETE', `/admin/api/messages/${id}`],
      ['DELETE', '/admin/api/messages/x'],
    ] as const) {
      const res = await new Client(app, env).call(method, path);
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(res.text, `${method} ${path}`).toBe(JSON.stringify({ code: 'UNAUTHENTICATED' }));
      expect(res.headers.getSetCookie(), `${method} ${path}`).toEqual([]);
    }
    expect(count()).toBe(1);
  });

  it('answers 401 to a session that has expired', async () => {
    const id = add(1, NOW);
    const stale = new Client(app, env);
    stale.cookie = client.cookie;
    stale.csrf = client.csrf;
    setNow(NOW + limits.sessionIdleMs + HOUR);
    expect((await stale.get('/admin/api/messages')).status).toBe(401);
    expect((await stale.delete(`/admin/api/messages/${id}`)).status).toBe(401);
    expect(count()).toBe(1);
  });

  it('is never cached', async () => {
    expect((await client.get('/admin/api/messages')).headers.get('Cache-Control')).toBe('no-store');
  });
});

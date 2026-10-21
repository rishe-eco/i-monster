// Test-only routes. They are mounted only when E2E_CLOCK=1, and the server
// refuses to boot in production with it set (lib/env.ts).
import { Hono } from 'hono';
import { now, setNow } from '../lib/clock.ts';
import { issueSetupToken } from '../lib/codes.ts';
import { clearMessages } from '../lib/contact.ts';
import type { AppEnv } from '../lib/context.ts';
import type { Db } from '../lib/db.ts';
import { clearEntries, insertFixture, type NewFixture } from '../lib/entries.ts';
import { clearEpisodes, insertEpisodeFixture, type NewFixture as NewEpisodeFixture } from '../lib/episodes.ts';
import type { Env } from '../lib/env.ts';
import { clearChallenges } from '../lib/webauthn.ts';
import { validateDoc, docFromText } from '../shared/doc.ts';
import { AUTH_PAGE_HTML, AUTH_PAGE_JS } from './test-auth.ts';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

export function testRoutes(db: Db, env: Env): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  // POST /__test/clock {"now": <UTC milliseconds>} fixes the clock; {"now": null} lets it run again.
  routes.post('/__test/clock', async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const requested = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).now : undefined;
    if (requested !== null && !(typeof requested === 'number' && Number.isSafeInteger(requested))) {
      return c.json({ code: 'CLOCK_INVALID' }, 400);
    }
    setNow(requested);
    return c.json({ now: now() });
  });

  // POST /__test/entries {"entries": [{lang, title?, text | body, state?, firstPublishedAt?, createdAt?, updatedAt?, id?, publishKey?}]}
  // inserts entries and answers their ids. `text` is docFromText's markup; `body` is a document.
  // `state` is "published" unless it says "draft"; a draft with a `firstPublishedAt` is one that was live (AC-14),
  // and a draft without one is a never-published draft, placed in the admin's list by `createdAt`.
  routes.post('/__test/entries', async (c) => {
    const json: unknown = await c.req.json().catch(() => null);
    const list = isRecord(json) && Array.isArray(json.entries) ? json.entries : null;
    if (!list) return c.json({ code: 'ENTRY_INVALID' }, 400);
    const inputs: NewFixture[] = [];
    for (const item of list) {
      if (!isRecord(item) || (item.lang !== 'en' && item.lang !== 'fa')) return c.json({ code: 'ENTRY_INVALID' }, 400);
      const body = typeof item.text === 'string' ? docFromText(item.text) : validateDoc(item.body);
      const doc = 'ok' in body ? (body.ok ? body.doc : null) : body;
      if (!doc) return c.json({ code: 'ENTRY_INVALID' }, 400);
      for (const key of ['firstPublishedAt', 'createdAt', 'updatedAt'] as const) {
        if (item[key] !== undefined && !isWhole(item[key])) return c.json({ code: 'ENTRY_INVALID' }, 400);
      }
      if (item.state !== undefined && item.state !== 'draft' && item.state !== 'published') return c.json({ code: 'ENTRY_INVALID' }, 400);
      // A published entry needs its date, which a fixture that names none gets from the clock.
      inputs.push({
        lang: item.lang,
        title: typeof item.title === 'string' ? item.title : null,
        body: doc,
        state: item.state,
        firstPublishedAt: item.firstPublishedAt as number | undefined,
        createdAt: item.createdAt as number | undefined,
        updatedAt: item.updatedAt as number | undefined,
        id: typeof item.id === 'string' ? item.id : undefined,
        publishKey: typeof item.publishKey === 'string' ? item.publishKey : undefined,
      });
    }
    const ids = db.transaction(() => inputs.map((input) => insertFixture(db, input)))();
    return c.json({ ids });
  });

  // DELETE /__test/entries empties the table between tests.
  routes.delete('/__test/entries', (c) => {
    clearEntries(db);
    return c.json({ ok: true });
  });

  // POST /__test/episodes {"episodes": [{lang, name?, description?, tags?, date?, links?, state?, firstPublishedAt?, createdAt?, id?, publishKey?}]}
  // inserts episodes and answers their ids. `date` is YYYY-MM-DD and defaults to today in SITE_TZ. `state` is "published"
  // unless it says "draft"; a published episode needs a link, and a draft with a `firstPublishedAt` is one that was live (AC-14).
  routes.post('/__test/episodes', async (c) => {
    const json: unknown = await c.req.json().catch(() => null);
    const list = isRecord(json) && Array.isArray(json.episodes) ? json.episodes : null;
    if (!list) return c.json({ code: 'EPISODE_INVALID' }, 400);
    const inputs: NewEpisodeFixture[] = [];
    for (const item of list) {
      if (!isRecord(item) || (item.lang !== 'en' && item.lang !== 'fa')) return c.json({ code: 'EPISODE_INVALID' }, 400);
      for (const key of ['firstPublishedAt', 'createdAt'] as const) {
        if (item[key] !== undefined && item[key] !== null && !isWhole(item[key])) return c.json({ code: 'EPISODE_INVALID' }, 400);
      }
      if (item.state !== undefined && item.state !== 'draft' && item.state !== 'published') return c.json({ code: 'EPISODE_INVALID' }, 400);
      const tags = item.tags === undefined ? [] : item.tags;
      if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string')) return c.json({ code: 'EPISODE_INVALID' }, 400);
      const links = item.links === undefined ? [] : item.links;
      if (!Array.isArray(links) || !links.every((link) => isRecord(link) && typeof link.label === 'string' && typeof link.url === 'string')) {
        return c.json({ code: 'EPISODE_INVALID' }, 400);
      }
      inputs.push({
        lang: item.lang,
        name: typeof item.name === 'string' ? item.name : null,
        description: typeof item.description === 'string' ? item.description : null,
        tags: tags as string[],
        date: typeof item.date === 'string' ? item.date : undefined,
        links: links.map((link) => ({ label: (link as Record<string, string>).label, url: (link as Record<string, string>).url })),
        state: item.state,
        firstPublishedAt: item.firstPublishedAt === undefined ? undefined : (item.firstPublishedAt as number | null),
        createdAt: item.createdAt as number | undefined,
        id: typeof item.id === 'string' ? item.id : undefined,
        publishKey: typeof item.publishKey === 'string' ? item.publishKey : undefined,
      });
    }
    try {
      const ids = db.transaction(() => inputs.map((input) => insertEpisodeFixture(db, input, env.siteTz)))();
      return c.json({ ids });
    } catch {
      // A fixture the table refuses (a published episode with no link, a date that isn't a day).
      return c.json({ code: 'EPISODE_INVALID' }, 400);
    }
  });

  // DELETE /__test/episodes empties the table between tests.
  routes.delete('/__test/episodes', (c) => {
    clearEpisodes(db);
    return c.json({ ok: true });
  });

  // DELETE /__test/messages empties the contact messages between tests, so the 24-hour cap never carries over.
  routes.delete('/__test/messages', (c) => {
    clearMessages(db);
    return c.json({ ok: true });
  });

  // GET /__test/auth is the bare page the e2e suite drives Edge's virtual
  // authenticator through, and /__test/auth.js its script (CSP: no inline script).
  routes.get('/__test/auth', (c) => c.html(AUTH_PAGE_HTML));
  routes.get('/__test/auth.js', (c) => c.body(AUTH_PAGE_JS, 200, { 'Content-Type': 'text/javascript; charset=utf-8' }));

  // POST /__test/auth/setup-token issues a setup token through the CLI's own function and answers it,
  // since a test has no terminal to run the CLI in.
  routes.post('/__test/auth/setup-token', (c) => c.json({ token: issueSetupToken(db, env).token }));

  // DELETE /__test/auth signs everyone out, removes every passkey and code, and clears the back-off
  // and the pending challenges, so each test starts from a site with no passkey.
  routes.delete('/__test/auth', (c) => {
    db.exec(`
      DELETE FROM session;
      DELETE FROM credential;
      DELETE FROM auth_code;
      DELETE FROM setting;
      UPDATE auth_throttle SET failures = 0, last_failure_at = NULL;
    `);
    clearChallenges();
    return c.json({ ok: true });
  });

  return routes;
}

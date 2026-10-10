// Test-only routes. They are mounted only when E2E_CLOCK=1, and the server
// refuses to boot in production with it set (lib/env.ts).
import { Hono } from 'hono';
import { now, setNow } from '../lib/clock.ts';
import type { AppEnv } from '../lib/context.ts';
import type { Db } from '../lib/db.ts';
import { clearEntries, insertPublished, type NewPublished } from '../lib/entries.ts';
import { validateDoc, docFromText } from '../shared/doc.ts';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

export function testRoutes(db: Db): Hono<AppEnv> {
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

  // POST /__test/entries {"entries": [{lang, title?, text | body, firstPublishedAt?, updatedAt?, id?}]}
  // inserts published entries through the same function the seed CLI uses, and
  // answers their ids. `text` is docFromText's markup; `body` is a document.
  routes.post('/__test/entries', async (c) => {
    const json: unknown = await c.req.json().catch(() => null);
    const list = isRecord(json) && Array.isArray(json.entries) ? json.entries : null;
    if (!list) return c.json({ code: 'ENTRY_INVALID' }, 400);
    const inputs: NewPublished[] = [];
    for (const item of list) {
      if (!isRecord(item) || (item.lang !== 'en' && item.lang !== 'fa')) return c.json({ code: 'ENTRY_INVALID' }, 400);
      const body = typeof item.text === 'string' ? docFromText(item.text) : validateDoc(item.body);
      const doc = 'ok' in body ? (body.ok ? body.doc : null) : body;
      if (!doc) return c.json({ code: 'ENTRY_INVALID' }, 400);
      for (const key of ['firstPublishedAt', 'updatedAt'] as const) {
        if (item[key] !== undefined && !isWhole(item[key])) return c.json({ code: 'ENTRY_INVALID' }, 400);
      }
      inputs.push({
        lang: item.lang,
        title: typeof item.title === 'string' ? item.title : null,
        body: doc,
        firstPublishedAt: item.firstPublishedAt as number | undefined,
        updatedAt: item.updatedAt as number | undefined,
        id: typeof item.id === 'string' ? item.id : undefined,
      });
    }
    const ids = db.transaction(() => inputs.map((input) => insertPublished(db, input)))();
    return c.json({ ids });
  });

  // DELETE /__test/entries empties the table between tests.
  routes.delete('/__test/entries', (c) => {
    clearEntries(db);
    return c.json({ ok: true });
  });

  return routes;
}

// Test-only routes. They are mounted only when E2E_CLOCK=1, and the server
// refuses to boot in production with it set (lib/env.ts).
import { Hono } from 'hono';
import { now, setNow } from '../lib/clock.ts';
import type { AppEnv } from '../lib/context.ts';

export function testRoutes(): Hono<AppEnv> {
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

  return routes;
}

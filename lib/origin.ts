// The Origin check (PD-14). Every POST, PUT, PATCH and DELETE under /admin/api,
// including the sign-in and enrolment ceremonies that have no session yet, must
// carry the site's own origin. A browser always sends Origin on these, so a
// missing one is refused too.
import type { MiddlewareHandler } from 'hono';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function originGuard(origin: string): MiddlewareHandler {
  return async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method) && c.req.header('Origin') !== origin) {
      return c.json({ code: 'ORIGIN_REFUSED' }, 403);
    }
    await next();
  };
}

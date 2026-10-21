// The Origin check (PD-14). Every POST, PUT, PATCH and DELETE under /admin/api,
// including the sign-in and enrolment ceremonies that have no session yet, must
// carry the site's own origin. A browser always sends Origin on these, so a
// missing one is refused too.
import type { MiddlewareHandler } from 'hono';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The Origin check for a public form post (CT-5). Looser than the admin's on purpose: a browser sends Origin on a
 * form post, but an old client may send neither header, and the honeypot and the daily cap still apply to it.
 * What it refuses is a post that says it came from somewhere else: an `Origin` that isn't the site's, or a
 * `Sec-Fetch-Site` of `cross-site`.
 */
export function formOriginAllowed(origin: string, headers: { origin?: string; secFetchSite?: string }): boolean {
  if (headers.origin !== undefined && headers.origin !== origin) return false;
  return headers.secFetchSite !== 'cross-site';
}

export function originGuard(origin: string): MiddlewareHandler {
  return async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method) && c.req.header('Origin') !== origin) {
      return c.json({ code: 'ORIGIN_REFUSED' }, 403);
    }
    await next();
  };
}

// Security headers, set by the app and not by Nginx (PD-18), so the integration
// suite sees exactly what the browser will. First in the middleware order
// (D-8): headers, then language. It reads no cookie and sets none.
import type { MiddlewareHandler } from 'hono';

/** The content security policy for every page. No inline script, no inline style, nothing off-origin. */
export const CSP =
  "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const FIXED_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  // Two years is the usual HSTS value; no includeSubDomains or preload until the founder asks.
  'Strict-Transport-Security': 'max-age=63072000',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  // Public pages need none of these. Passkeys (publickey-credentials-*) stay allowed for the admin.
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()',
};

export interface HeaderOptions {
  /** PRELAUNCH=1: ask search engines not to index anything (PD-22). */
  prelaunch: boolean;
}

export function securityHeaders(options: HeaderOptions): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const headers = c.res.headers;
    for (const [name, value] of Object.entries(FIXED_HEADERS)) headers.set(name, value);
    if (options.prelaunch) headers.set('X-Robots-Tag', 'noindex');
    // The admin never caches (PD-18). Public pages revalidate on every request,
    // so an edit shows at once and feed readers poll cheaply with the ETag (PD-4).
    // A public route that set its own Cache-Control (assets, healthz) keeps it.
    const path = c.req.path;
    if (path === '/admin' || path.startsWith('/admin/')) {
      headers.set('Cache-Control', 'no-store');
    } else if (!headers.has('Cache-Control')) {
      headers.set('Cache-Control', 'no-cache');
    }
  };
}

// The admin API: sign-in, registration, sessions, passkeys and enrolment codes
// (plan B4a, spec §4.3). Later stages add their routers inside `adminApiRoutes`,
// after the guard, so a new route can't be reached without a session (AC-8).
//
// Nothing here is mounted on a public path, and nothing public reads the cookie
// (D-8). Every refusal is a code and nothing else (§6.2); a refusal with one
// meaning has one body, so no branch can tell an attacker which check failed.
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import QRCode from 'qrcode';
import { issueEnrolmentCode, peekCode, redeemCode } from '../lib/codes.ts';
import type { AppEnv } from '../lib/context.ts';
import { CSRF_HEADER, csrfMatches } from '../lib/csrf.ts';
import type { Db } from '../lib/db.ts';
import type { Env } from '../lib/env.ts';
import { limits } from '../lib/limits.ts';
import { originGuard } from '../lib/origin.ts';
import { cleanPasskeyName } from '../lib/passkey-name.ts';
import { lastLanguage } from '../lib/publish.ts';
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  hashSessionId,
  isFresh,
  reauthSession,
  setDeviceCredential,
  touchSession,
  validateSession,
  type Session,
} from '../lib/sessions.ts';
import { recordFailure, recordSuccess, waitRemainingMs } from '../lib/throttle.ts';
import {
  authenticationOptions,
  insertCredential,
  registrationOptions,
  verifyAssertion,
  verifyRegistration,
} from '../lib/webauthn.ts';
import { entryRoutes } from './admin-entries.ts';
import { episodeRoutes } from './admin-episodes.ts';

const STATUS = {
  UNAUTHENTICATED: 401,
  CSRF_INVALID: 403,
  ORIGIN_REFUSED: 403,
  REAUTH_REQUIRED: 403,
  SIGNIN_FAILED: 400,
  CODE_REFUSED: 400,
  REGISTRATION_FAILED: 400,
  REQUEST_INVALID: 400,
  NAME_REQUIRED: 400,
  LAST_PASSKEY: 409,
  BODY_REQUIRED: 400,
  DOC_INVALID: 400,
  LANG_INVALID: 400,
  LANG_FIXED: 409,
  DATE_FUTURE: 400,
  DESCRIPTION_REQUIRED: 400,
  TAGS_ONE_OR_TWO: 400,
  LINK_REQUIRED: 400,
  LINK_NOT_HTTPS: 400,
  LAST_LINK: 409,
  NOT_FOUND: 404,
} as const satisfies Record<string, ContentfulStatusCode>;

export type Refusal = keyof typeof STATUS;

/** The one way a refusal leaves the server: its code, with the status it always has. */
const refuse = (c: Context<AppEnv>, code: Refusal) => c.json({ code }, STATUS[code]);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const readJson = async (c: Context<AppEnv>): Promise<Record<string, unknown> | null> => {
  const body: unknown = await c.req.json().catch(() => null);
  return isRecord(body) ? body : null;
};

const INDEPENDENCE_KEY = 'independence_note_dismissed';
export function adminApiRoutes(db: Db, env: Env): Hono<AppEnv> {
  const api = new Hono<AppEnv>().basePath('/admin/api');

  // The cookie is `__Host-imnstr_session` in every environment: Edge accepts a
  // Secure `__Host-` cookie on http://localhost, so development needs no
  // exception and the production attributes are the ones always exercised.
  const cookieOptions = { prefix: 'host', secure: true, httpOnly: true, sameSite: 'Strict', path: '/' } as const;
  // The cookie lives as long as a session can (change note 06), so closing the browser doesn't sign the admin out.
  // The server still decides: `lib/sessions.ts` refuses an idle or old session whatever the browser keeps.
  const setSessionCookie = (c: Context<AppEnv>, value: string) =>
    setCookie(c, SESSION_COOKIE, value, { ...cookieOptions, maxAge: limits.sessionAbsoluteMs / 1000 });
  const clearSessionCookie = (c: Context<AppEnv>) => deleteCookie(c, SESSION_COOKIE, cookieOptions);
  const cookieValue = (c: Context<AppEnv>) => getCookie(c, SESSION_COOKIE, 'host');

  const sessionBody = (session: Session) => ({
    csrf: session.csrf,
    fresh: isFresh(session),
    deviceCredentialId: session.deviceCredential,
    independenceNoteDismissed:
      (db.prepare('SELECT value FROM setting WHERE key = ?').get(INDEPENDENCE_KEY) as { value: string } | undefined)?.value === '1',
  });

  /**
   * The session behind a request, with its CSRF token checked on a state-changing
   * method. Returns the session, or the refusal to send. Does not touch: only the
   * guard below moves the idle clock.
   */
  const sessionOf = (c: Context<AppEnv>): Session | Response => {
    const had = cookieValue(c);
    const session = validateSession(db, had);
    if (!session) {
      if (had) clearSessionCookie(c);
      return refuse(c, 'UNAUTHENTICATED');
    }
    if (!SAFE_METHODS.has(c.req.method) && !csrfMatches(session.csrf, c.req.header(CSRF_HEADER))) return refuse(c, 'CSRF_INVALID');
    return session;
  };

  // ── The guard: Origin on every write, then a session on everything that isn't a ceremony ──
  api.use('*', originGuard(env.origin));
  api.use('*', async (c, next) => {
    // The ceremonies run before a session exists. The ones that need one
    // (re-authentication, adding a passkey from a session) check it themselves.
    if (c.req.path.startsWith('/admin/api/auth/')) return next();
    const session = sessionOf(c);
    if (session instanceof Response) return session;
    // The only place a session's idle clock moves: an /admin/api request that got this far.
    touchSession(db, session.idHash);
    c.set('session', session);
    return next();
  });

  // ── The session ──

  api.get('/session', (c) => c.json(sessionBody(c.get('session'))));

  // ── Sign-in ──

  api.post('/auth/signin/options', async (c) => c.json(await authenticationOptions(env, 'signin')));

  api.post('/auth/signin/verify', async (c) => {
    // Inside a back-off wait the attempt is refused without looking at the
    // credential, and changes nothing (PD-15).
    if (waitRemainingMs(db) > 0) return refuse(c, 'SIGNIN_FAILED');
    const body = await readJson(c);
    const credentialId = body ? await verifyAssertion(db, env, body.response, 'signin') : null;
    if (!credentialId) {
      recordFailure(db);
      return refuse(c, 'SIGNIN_FAILED');
    }
    recordSuccess(db);
    // The id changes at sign-in (AC-10): a session cookie that came with this
    // request is ended, never reused.
    const old = cookieValue(c);
    if (old) destroySession(db, hashSessionId(old));
    const created = createSession(db, credentialId);
    setSessionCookie(c, created.cookieValue);
    return c.json(sessionBody(created.session));
  });

  api.post('/auth/signout', (c) => {
    // No session, or a dead one: nothing to end, and the answer is the same.
    const had = cookieValue(c);
    const session = validateSession(db, had);
    if (session) {
      if (!csrfMatches(session.csrf, c.req.header(CSRF_HEADER))) return refuse(c, 'CSRF_INVALID');
      destroySession(db, session.idHash);
    }
    if (had) clearSessionCookie(c);
    return c.json({ ok: true });
  });

  // ── Registration: by setup token or enrolment code, or from a fresh session ──

  api.post('/auth/register/options', async (c) => {
    const body = await readJson(c);
    if (body && 'code' in body) {
      const code = peekCode(db, body.code);
      if (code === 'CODE_REFUSED') return refuse(c, 'CODE_REFUSED');
      return c.json(await registrationOptions(db, env, code.hash));
    }
    const session = sessionOf(c);
    if (session instanceof Response) return session;
    if (!isFresh(session)) return refuse(c, 'REAUTH_REQUIRED');
    return c.json(await registrationOptions(db, env, session.idHash));
  });

  api.post('/auth/register/verify', async (c) => {
    const body = await readJson(c);

    if (body && 'code' in body) {
      // A code refused here is the same refusal as at the options step, and
      // counts the same, so a dead code can't be told apart by where it fails.
      const code = peekCode(db, body.code);
      if (code === 'CODE_REFUSED') return refuse(c, 'CODE_REFUSED');
      const name = cleanPasskeyName(body.name);
      if ('refusal' in name) return refuse(c, name.refusal);
      const verified = await verifyRegistration(env, body.response, code.hash);
      if (!verified) return refuse(c, 'REGISTRATION_FAILED');
      try {
        // One transaction: the code is spent, the passkey stored and the session
        // opened together, or none of it is. A passkey that fails to store leaves the code live.
        const outcome = db.transaction(() => {
          if (redeemCode(db, body.code) === 'CODE_REFUSED') return null;
          insertCredential(db, name.name, verified);
          // Enrolling signs this device in, so, as at sign-in, a session the
          // request arrived with is ended rather than left behind (AC-10).
          const old = cookieValue(c);
          if (old) destroySession(db, hashSessionId(old));
          return createSession(db, verified.id);
        })();
        if (!outcome) return refuse(c, 'CODE_REFUSED');
        setSessionCookie(c, outcome.cookieValue);
        return c.json(sessionBody(outcome.session));
      } catch {
        return refuse(c, 'REGISTRATION_FAILED');
      }
    }

    const session = sessionOf(c);
    if (session instanceof Response) return session;
    if (!isFresh(session)) return refuse(c, 'REAUTH_REQUIRED');
    const name = cleanPasskeyName(body?.name);
    if ('refusal' in name) return refuse(c, name.refusal);
    const verified = await verifyRegistration(env, body?.response, session.idHash);
    if (!verified) return refuse(c, 'REGISTRATION_FAILED');
    try {
      db.transaction(() => {
        insertCredential(db, name.name, verified);
        // This device now has its own passkey (PD-13, AC-45); revocation still keys on `opened_by`.
        setDeviceCredential(db, session.idHash, verified.id);
      })();
    } catch {
      return refuse(c, 'REGISTRATION_FAILED');
    }
    return c.json(sessionBody({ ...session, deviceCredential: verified.id }));
  });

  // ── Re-authentication: a passkey assertion on a live session ──

  api.post('/auth/reauth/options', async (c) => {
    const session = sessionOf(c);
    if (session instanceof Response) return session;
    return c.json(await authenticationOptions(env, 'reauth', session.idHash));
  });

  api.post('/auth/reauth/verify', async (c) => {
    const session = sessionOf(c);
    if (session instanceof Response) return session;
    if (waitRemainingMs(db) > 0) return refuse(c, 'SIGNIN_FAILED');
    const body = await readJson(c);
    const credentialId = body ? await verifyAssertion(db, env, body.response, 'reauth', session.idHash) : null;
    if (!credentialId) {
      recordFailure(db);
      return refuse(c, 'SIGNIN_FAILED');
    }
    recordSuccess(db);
    // The id rotates (PD-13), so the cookie is replaced.
    const rotated = reauthSession(db, session);
    setSessionCookie(c, rotated.cookieValue);
    return c.json(sessionBody(rotated.session));
  });

  // ── Passkeys ──

  api.get('/passkeys', (c) => {
    const session = c.get('session');
    const rows = db.prepare('SELECT id, name, created_at FROM credential ORDER BY created_at, rowid').all() as {
      id: string;
      name: string;
      created_at: number;
    }[];
    // Name, date added and "this device", and nothing else: no last-used time (W7).
    return c.json({ passkeys: rows.map((r) => ({ id: r.id, name: r.name, addedAt: r.created_at, thisDevice: r.id === session.deviceCredential })) });
  });

  api.delete('/passkeys/:id', (c) => {
    const session = c.get('session');
    if (!isFresh(session)) return refuse(c, 'REAUTH_REQUIRED');
    const id = c.req.param('id');
    if (!db.prepare('SELECT 1 FROM credential WHERE id = ?').get(id)) return refuse(c, 'NOT_FOUND');
    const { n } = db.prepare('SELECT count(*) AS n FROM credential').get() as { n: number };
    if (n <= 1) return refuse(c, 'LAST_PASSKEY');
    // The sessions it opened, and the ones that mark it as their device, go with it by cascade (AC-22, AC-45).
    db.prepare('DELETE FROM credential WHERE id = ?').run(id);
    const signedOut = id === session.openedBy || id === session.deviceCredential;
    if (signedOut) clearSessionCookie(c);
    return c.json({ signedOut });
  });

  // ── Enrolment codes and settings ──

  api.post('/enrolment-codes', async (c) => {
    const issued = issueEnrolmentCode(db, env, c.get('session'));
    if (issued === 'REAUTH_REQUIRED') return refuse(c, 'REAUTH_REQUIRED');
    // The QR is drawn here, as an SVG data URL, so the page needs no script and no third party (PD-16).
    const svg = await QRCode.toString(issued.link, { type: 'svg', margin: 1 });
    return c.json({ ...issued, qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` });
  });

  // The two settings the editor starts from: the language of the last save or publish (PD-10, AC-42), and the note's state.
  api.get('/settings', (c) =>
    c.json({ lastLanguage: lastLanguage(db), independenceNoteDismissed: sessionBody(c.get('session')).independenceNoteDismissed }),
  );

  api.post('/settings/independence-note/dismiss', (c) => {
    db.prepare('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(INDEPENDENCE_KEY, '1');
    return c.json({ independenceNoteDismissed: true });
  });

  // ── Entries (B5) and episodes (B7). After the guard, so each route is behind a session (S-12) ──

  api.route('/', entryRoutes(db, { refuse, readJson }));
  api.route('/', episodeRoutes(db, { refuse, readJson }, { siteTz: env.siteTz }));

  // ── Anything else under /admin/api ──

  // Signed out, the guard has already answered 401 and never gets here. Signed in, an unknown path is a
  // JSON NOT_FOUND, not the public site's HTML 404 (S-11). The ceremonies' prefix is outside the guard
  // and stays as it was, the public 404, for a path that is no ceremony: the 401 test lists that prefix.
  api.all('*', (c) => (c.req.path.startsWith('/admin/api/auth/') ? c.notFound() : refuse(c, 'NOT_FOUND')));

  return api;
}

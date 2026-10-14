// Shared setup for the auth tests: a tiny cookie-carrying client over
// `app.request()`, and the ceremonies as one-line helpers. Kept apart from
// helpers.ts so the auth lane and the others never edit the same file.
import type { Hono } from 'hono';
import type { AppEnv } from '../lib/context.ts';
import { issueSetupToken } from '../lib/codes.ts';
import type { Db } from '../lib/db.ts';
import type { Env } from '../lib/env.ts';
import { clearChallenges } from '../lib/webauthn.ts';
import { SoftAuthenticator, type AuthenticatorOptions } from './softAuthenticator.ts';
import { testEnv } from './helpers.ts';

export const COOKIE_NAME = '__Host-imnstr_session';

export interface Reply {
  status: number;
  /** The response body as it left the server: tests compare these bytes. */
  text: string;
  json: Record<string, unknown>;
  headers: Headers;
}

/** One browser: it keeps the session cookie and the CSRF token, and sends the Origin a browser would. */
export class Client {
  cookie: string | null = null;
  csrf: string | null = null;

  constructor(
    readonly app: Hono<AppEnv>,
    readonly env: Env,
  ) {}

  /** `headers` override what the client would send; a value of null removes the header. */
  async call(method: string, path: string, body?: unknown, headers: Record<string, string | null> = {}): Promise<Reply> {
    const sent: Record<string, string> = { Origin: this.env.origin };
    if (body !== undefined) sent['Content-Type'] = 'application/json';
    if (this.cookie) sent.Cookie = `${COOKIE_NAME}=${this.cookie}`;
    if (this.csrf) sent['X-CSRF-Token'] = this.csrf;
    for (const [name, value] of Object.entries(headers)) {
      if (value === null) delete sent[name];
      else sent[name] = value;
    }
    const res = await this.app.request(path, { method, headers: sent, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const line of res.headers.getSetCookie()) {
      const [pair = ''] = line.split(';');
      const eq = pair.indexOf('=');
      if (pair.slice(0, eq) !== COOKIE_NAME) continue;
      const value = pair.slice(eq + 1);
      this.cookie = /Max-Age=0/i.test(line) || value === '' ? null : value;
    }
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* not JSON: the 404 page, say */
    }
    // A session body carries the token for the next write, as the admin would keep it.
    if (typeof json.csrf === 'string') this.csrf = json.csrf;
    return { status: res.status, text, json, headers: res.headers };
  }

  get = (path: string, headers?: Record<string, string | null>) => this.call('GET', path, undefined, headers);
  post = (path: string, body?: unknown, headers?: Record<string, string | null>) => this.call('POST', path, body ?? {}, headers);
  delete = (path: string, headers?: Record<string, string | null>) => this.call('DELETE', path, undefined, headers);

  /** Sign in with `auth`, the whole ceremony. Returns the verify reply. */
  async signIn(auth: SoftAuthenticator): Promise<Reply> {
    const options = await this.post('/admin/api/auth/signin/options');
    return this.post('/admin/api/auth/signin/verify', { response: auth.assert(options.json as never) });
  }

  /** Register `auth` with a code (setup token or enrolment code): options, then verify. Signs this client in. */
  async registerWithCode(auth: SoftAuthenticator, code: string, name = 'Laptop'): Promise<Reply> {
    const options = await this.post('/admin/api/auth/register/options', { code });
    if (options.status !== 200) return options;
    return this.post('/admin/api/auth/register/verify', { code, name, response: auth.register(options.json as never) });
  }

  /** Add `auth` from this client's signed-in session. */
  async registerFromSession(auth: SoftAuthenticator, name = 'Phone'): Promise<Reply> {
    const options = await this.post('/admin/api/auth/register/options');
    if (options.status !== 200) return options;
    return this.post('/admin/api/auth/register/verify', { name, response: auth.register(options.json as never) });
  }

  /** Re-authenticate with `auth`: options, then verify. */
  async reauth(auth: SoftAuthenticator): Promise<Reply> {
    const options = await this.post('/admin/api/auth/reauth/options');
    if (options.status !== 200) return options;
    return this.post('/admin/api/auth/reauth/verify', { response: auth.assert(options.json as never) });
  }
}

export const newAuthenticator = (env: Env, options: Partial<AuthenticatorOptions> = {}): SoftAuthenticator =>
  new SoftAuthenticator({ origin: env.origin, rpId: env.rpId, ...options });

/** Empty every auth table and the in-memory challenges, so each test starts signed out with no passkey. */
export function resetAuth(db: Db): void {
  db.exec(`
    DELETE FROM session;
    DELETE FROM credential;
    DELETE FROM auth_code;
    DELETE FROM setting;
    UPDATE auth_throttle SET failures = 0, last_failure_at = NULL;
  `);
  clearChallenges();
}

/** A setup token, as the CLI would issue it. */
export const setupToken = (db: Db, env: Env = testEnv()): string => issueSetupToken(db, env).token;

/**
 * A client that has signed in, through a setup token, with a fresh passkey. The
 * session is brand new, so it counts as freshly signed in.
 */
export async function signedIn(
  app: Hono<AppEnv>,
  db: Db,
  env: Env,
  options: Partial<AuthenticatorOptions> = {},
): Promise<{ client: Client; auth: SoftAuthenticator }> {
  const client = new Client(app, env);
  const auth = newAuthenticator(env, options);
  const res = await client.registerWithCode(auth, setupToken(db, env), 'Laptop');
  if (res.status !== 200) throw new Error(`setup failed: ${res.text}`);
  return { client, auth };
}

/** An enrolment code, issued from a session `client` holds (which must be fresh). */
export async function enrolmentCode(client: Client): Promise<string> {
  const res = await client.post('/admin/api/enrolment-codes');
  if (res.status !== 200) throw new Error(`no code: ${res.text}`);
  return res.json.code as string;
}


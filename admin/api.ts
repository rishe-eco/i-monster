// The admin's one way to talk to `/admin/api` (plan B4b). Every answer is a
// result: the data, or the code the server refused with (§6.2). Nothing here
// stores anything in the browser: the session is an HttpOnly cookie the script
// can't read, and the CSRF token lives in this module's memory only (AC-10).

/** The refusals `/admin/api` sends (plan §6.2), each as the code and nothing else. */
export type RefusalCode =
  | 'UNAUTHENTICATED'
  | 'CSRF_INVALID'
  | 'ORIGIN_REFUSED'
  | 'REAUTH_REQUIRED'
  | 'SIGNIN_FAILED'
  | 'CODE_REFUSED'
  | 'REGISTRATION_FAILED'
  | 'REQUEST_INVALID'
  | 'NAME_REQUIRED'
  | 'LAST_PASSKEY'
  | 'NOT_FOUND';

/** What goes wrong in the browser rather than at the server: the network, the passkey sheet, the browser itself. */
export type ClientCode = 'NETWORK' | 'UNEXPECTED' | 'CANCELLED' | 'ALREADY_REGISTERED' | 'UNSUPPORTED';

export type Code = RefusalCode | ClientCode;

export type Result<T> = { ok: true; data: T } | { ok: false; code: Code };

export interface SessionInfo {
  csrf: string;
  fresh: boolean;
  deviceCredentialId: string | null;
  independenceNoteDismissed: boolean;
}

export interface Passkey {
  id: string;
  name: string;
  /** UTC milliseconds. */
  addedAt: number;
  thisDevice: boolean;
}

export interface EnrolmentCode {
  /** `K7FQ-2MXP-R9TD`, as the server groups it. */
  code: string;
  link: string;
  qr: string;
}

const REFUSALS: ReadonlySet<string> = new Set<RefusalCode>([
  'UNAUTHENTICATED',
  'CSRF_INVALID',
  'ORIGIN_REFUSED',
  'REAUTH_REQUIRED',
  'SIGNIN_FAILED',
  'CODE_REFUSED',
  'REGISTRATION_FAILED',
  'REQUEST_INVALID',
  'NAME_REQUIRED',
  'LAST_PASSKEY',
  'NOT_FOUND',
]);

let csrf: string | null = null;
let onSignedOut: (() => void) | null = null;

/** The app's answer when any call finds the session gone (401): show the sign-in view. */
export function whenSignedOut(handler: (() => void) | null): void {
  onSignedOut = handler;
}

/** Forget the CSRF token, when the session it belonged to has ended. */
export function forgetSession(): void {
  csrf = null;
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<Result<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrf) headers['X-CSRF-Token'] = csrf;
  let res: Response;
  try {
    res = await fetch(`/admin/api/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // The cookie is same-origin, so it goes without being asked; no credentials option needed.
    });
  } catch {
    return { ok: false, code: 'NETWORK' };
  }
  const json: unknown = await res.json().catch(() => null);
  const record = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : null;
  if (res.ok && record) {
    // A new session, or a re-authenticated one, brings a new token.
    if (typeof record.csrf === 'string') csrf = record.csrf;
    return { ok: true, data: record as T };
  }
  const code = typeof record?.code === 'string' && REFUSALS.has(record.code) ? (record.code as RefusalCode) : 'UNEXPECTED';
  if (code === 'UNAUTHENTICATED') onSignedOut?.();
  return { ok: false, code };
}

// The admin's one way to talk to `/admin/api` (plan B4b). Every answer is a
// result: the data, or the code the server refused with (§6.2). Nothing here
// stores anything in the browser: the session is an HttpOnly cookie the script
// can't read, and the CSRF token lives in this module's memory only (AC-10).
import type { Lang } from '../lib/i18n.ts';
import type { Doc } from '../shared/doc.ts';

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
  | 'BODY_REQUIRED'
  | 'DOC_INVALID'
  | 'LANG_INVALID'
  | 'DESCRIPTION_REQUIRED'
  | 'TAGS_ONE_OR_TWO'
  | 'LINK_REQUIRED'
  | 'LINK_NOT_HTTPS'
  | 'LAST_LINK'
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
  'BODY_REQUIRED',
  'DOC_INVALID',
  'LANG_INVALID',
  'DESCRIPTION_REQUIRED',
  'TAGS_ONE_OR_TWO',
  'LINK_REQUIRED',
  'LINK_NOT_HTTPS',
  'LAST_LINK',
  'NOT_FOUND',
]);

/** One row of the entries list (plate 8). The server sends no count and no total with it. */
export interface EntryRow {
  id: string;
  lang: Lang;
  title: string | null;
  /** The body's opening words, cut at a word: what an untitled entry is called in the list. */
  excerpt: string;
  state: 'draft' | 'published';
  /** A draft that has been published before: it keeps its first date and returns to it (AC-14). */
  wasLive: boolean;
  /** UTC milliseconds; null for a draft that was never published. */
  firstPublishedAt: number | null;
}

export interface EntriesPage {
  entries: EntryRow[];
  /** The cursor for "Older": the last row shown, when more lie behind it. */
  olderBefore: string | null;
  /** The server's clock, UTC milliseconds, so the list's year rule never reads the browser's (AC-31). */
  now: number;
}

/** One entry, whole: B6's editor reads the same shape. */
export interface EntryDetail {
  id: string;
  lang: Lang;
  title: string | null;
  body: Doc;
  state: 'draft' | 'published';
  wasLive: boolean;
  firstPublishedAt: number | null;
}

/** One row of the podcast list (plate 12). The server sends no count and no total with it. */
export interface EpisodeRow {
  id: string;
  lang: Lang;
  name: string | null;
  /** A calendar day, `YYYY-MM-DD`: never an instant. A never-published draft still has one, and the list shows "—" for it. */
  date: string;
  state: 'draft' | 'published';
  /** A draft that has been published before: it keeps its first date and returns to it (AC-14). */
  wasLive: boolean;
  /** UTC milliseconds; null for a draft that was never published. */
  firstPublishedAt: number | null;
}

export interface EpisodesPage {
  episodes: EpisodeRow[];
  /** The cursor for "Older": the last row shown, when more lie behind it. */
  olderBefore: string | null;
  /** The server's day in the site's zone, `YYYY-MM-DD`: the form's date starts here, and the list's year rule reads its year (AC-31). */
  today: string;
  now: number;
}

/** One episode, whole. */
export interface EpisodeDetail {
  id: string;
  lang: Lang;
  name: string | null;
  description: string | null;
  tags: string[];
  date: string;
  links: { label: string; url: string }[];
  state: 'draft' | 'published';
  wasLive: boolean;
  firstPublishedAt: number | null;
}

/** What the editor starts from (PD-10): the language of the last save or publish. */
export interface Settings {
  lastLanguage: Lang;
  independenceNoteDismissed: boolean;
}

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

export interface ApiOptions {
  /**
   * Don't send the person to the sign-in view when this call finds the session gone: answer UNAUTHENTICATED
   * and let the caller deal with it. The editor's writes use it, so a session that ended mid-write signs in
   * over the text instead of unmounting it (W6, AC-16). Every other call keeps the app-wide behaviour.
   */
  keepOnSignedOut?: boolean;
}

export async function api<T>(method: string, path: string, body?: unknown, options: ApiOptions = {}): Promise<Result<T>> {
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
  if (code === 'UNAUTHENTICATED' && !options.keepOnSignedOut) onSignedOut?.();
  return { ok: false, code };
}

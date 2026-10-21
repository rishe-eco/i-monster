// The contact form's messages (change note 08, CT1): reading and checking what was typed, the 24-hour cap,
// and storing, listing and deleting. A message is the three typed fields, the page's language and the time:
// nothing about the sender is read, kept or logged (house rule 9, CT-7).
import type { Db } from './db.ts';
import type { Lang } from './i18n.ts';
import { newId } from './ids.ts';
import { limits } from './limits.ts';

export type ContactField = 'subject' | 'message' | 'reach';

/** The fields in the order the form shows them, and so the order its errors are listed in. */
export const CONTACT_FIELDS: readonly ContactField[] = ['subject', 'message', 'reach'];

export type ContactInput = Record<ContactField, string>;

/** `empty` is nothing (or only blanks) after trimming; `tooLong` is over the field's limit. */
export type FieldProblem = 'empty' | 'tooLong';
export type ContactProblems = Partial<Record<ContactField, FieldProblem>>;

export const CONTACT_MAX: Record<ContactField, number> = {
  subject: limits.contactSubjectMax,
  message: limits.contactMessageMax,
  reach: limits.contactReachMax,
};

/** Characters as SQLite's `length()` counts them (code points), so the CHECKs and this agree. */
const characters = (text: string): number => [...text].length;

// Control characters other than a tab and a line break. A NUL would also end SQLite's `length()` early.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** One field's text as it is kept: line breaks as \n, no control characters, trimmed. Anything not text is nothing. */
function clean(value: unknown, singleLine: boolean): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\r\n?/g, '\n').replace(CONTROL, '');
  return (singleLine ? text.replace(/\s*\n\s*/g, ' ') : text).trim();
}

export interface ContactRead {
  /** The fields as they will be stored, and as the form shows them again after a refusal. */
  input: ContactInput;
  problems: ContactProblems;
}

/** Read the form's fields from a parsed post body. `problems` is empty when the message can be stored. */
export function readContact(form: Record<string, unknown>): ContactRead {
  const input: ContactInput = {
    subject: clean(form.subject, true),
    message: clean(form.message, false),
    reach: clean(form.reach, true),
  };
  const problems: ContactProblems = {};
  for (const field of CONTACT_FIELDS) {
    if (input[field] === '') problems[field] = 'empty';
    else if (characters(input[field]) > CONTACT_MAX[field]) problems[field] = 'tooLong';
  }
  return { input, problems };
}

export type StoreResult = { stored: true; id: string } | { stored: false; reason: 'cap' };

/**
 * Store a message, unless the site has already stored `limits.contactCap` in the 24 hours before `at`. The count
 * and the insert share one transaction. `at` is `now()` from the caller (house rule 5).
 */
export function storeMessage(db: Db, lang: Lang, input: ContactInput, at: number): StoreResult {
  return db.transaction((): StoreResult => {
    const { n } = db.prepare('SELECT count(*) AS n FROM contact_message WHERE received_at > ?').get(at - limits.contactCapWindowMs) as { n: number };
    if (n >= limits.contactCap) return { stored: false, reason: 'cap' };
    const id = newId();
    db.prepare('INSERT INTO contact_message (id, lang, subject, message, reach, received_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      lang,
      input.subject,
      input.message,
      input.reach,
      at,
    );
    return { stored: true, id };
  })();
}

/** A message as the admin reads it. */
export interface AdminMessage {
  id: string;
  lang: Lang;
  subject: string;
  message: string;
  reach: string;
  /** UTC milliseconds. */
  receivedAt: number;
}

interface Row {
  id: string;
  lang: Lang;
  subject: string;
  message: string;
  reach: string;
  received_at: number;
}

const toMessage = (row: Row): AdminMessage => ({
  id: row.id,
  lang: row.lang,
  subject: row.subject,
  message: row.message,
  reach: row.reach,
  receivedAt: row.received_at,
});

export interface AdminMessagePage {
  messages: AdminMessage[];
  /** The cursor for "Older": the last message shown, when more lie behind it. Null otherwise. */
  olderBefore: string | null;
}

/**
 * The messages, newest first, `limit` to a page (the entries list's rule: no count, no total). A cursor that
 * names no message is `null`, which the route answers as NOT_FOUND.
 */
export function listMessages(db: Db, before: string | null, limit: number = limits.pageSize): AdminMessagePage | null {
  let rows: Row[];
  if (before === null) {
    rows = db.prepare('SELECT * FROM contact_message ORDER BY received_at DESC, id ASC LIMIT ?').all(limit + 1) as Row[];
  } else {
    const cursor = db.prepare('SELECT received_at, id FROM contact_message WHERE id = ?').get(before) as { received_at: number; id: string } | undefined;
    if (!cursor) return null;
    rows = db
      .prepare('SELECT * FROM contact_message WHERE received_at < ? OR (received_at = ? AND id > ?) ORDER BY received_at DESC, id ASC LIMIT ?')
      .all(cursor.received_at, cursor.received_at, cursor.id, limit + 1) as Row[];
  }
  const shown = rows.slice(0, limit);
  const last = shown[shown.length - 1];
  return { messages: shown.map(toMessage), olderBefore: rows.length > limit && last ? last.id : null };
}

/** Delete one message. True when it was there. */
export function deleteMessage(db: Db, id: string): boolean {
  return db.prepare('DELETE FROM contact_message WHERE id = ?').run(id).changes > 0;
}

/** Empty the table: the e2e route and the tests use it between runs. */
export function clearMessages(db: Db): void {
  db.prepare('DELETE FROM contact_message').run();
}

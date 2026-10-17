// The body schema (PD-7, house rule 4): doc > paragraph+ > text, with the marks
// `link` and `highlight`. Nothing else is allowed. This file is shared with the
// admin's browser bundle, so it imports nothing from lib/ and nothing Node-only.

export interface LinkMark {
  type: 'link';
  attrs: { href: string };
}
export interface HighlightMark {
  type: 'highlight';
}
export type Mark = LinkMark | HighlightMark;

export interface TextNode {
  type: 'text';
  text: string;
  marks?: Mark[];
}
export interface Paragraph {
  type: 'paragraph';
  content: TextNode[];
}
export interface Doc {
  type: 'doc';
  content: Paragraph[];
}

export type DocResult = { ok: true; doc: Doc } | { ok: false };

const ALLOWED_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

/** True for an address a link may carry: https, http or mailto, and nothing else (PD-7). */
export function isAllowedHref(href: unknown): href is string {
  if (typeof href !== 'string' || href.trim() !== href || href === '') return false;
  try {
    return ALLOWED_PROTOCOLS.has(new URL(href).protocol);
  } catch {
    return false;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function validMarks(value: unknown): Mark[] | null {
  if (!Array.isArray(value)) return null;
  const marks: Mark[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isObject(item) || typeof item.type !== 'string' || seen.has(item.type)) return null;
    seen.add(item.type);
    if (item.type === 'highlight') {
      if (!hasOnlyKeys(item, ['type'])) return null;
      marks.push({ type: 'highlight' });
    } else if (item.type === 'link') {
      if (!hasOnlyKeys(item, ['type', 'attrs']) || !isObject(item.attrs)) return null;
      if (!hasOnlyKeys(item.attrs, ['href']) || !isAllowedHref(item.attrs.href)) return null;
      marks.push({ type: 'link', attrs: { href: item.attrs.href } });
    } else {
      return null;
    }
  }
  return marks;
}

/** Check a parsed JSON value against the schema. Returns a clean copy, or `{ ok: false }` (the API's DOC_INVALID). */
export function validateDoc(json: unknown): DocResult {
  if (!isObject(json) || json.type !== 'doc' || !hasOnlyKeys(json, ['type', 'content'])) return { ok: false };
  if (!Array.isArray(json.content) || json.content.length === 0) return { ok: false };
  const content: Paragraph[] = [];
  for (const p of json.content) {
    if (!isObject(p) || p.type !== 'paragraph' || !hasOnlyKeys(p, ['type', 'content'])) return { ok: false };
    // A paragraph holds at least one text node; ProseMirror never stores an empty text node.
    if (!Array.isArray(p.content) || p.content.length === 0) return { ok: false };
    const texts: TextNode[] = [];
    for (const t of p.content) {
      if (!isObject(t) || t.type !== 'text' || !hasOnlyKeys(t, ['type', 'text', 'marks'])) return { ok: false };
      if (typeof t.text !== 'string' || t.text === '') return { ok: false };
      if (t.marks === undefined) {
        texts.push({ type: 'text', text: t.text });
      } else {
        const marks = validMarks(t.marks);
        if (!marks) return { ok: false };
        texts.push(marks.length ? { type: 'text', text: t.text, marks } : { type: 'text', text: t.text });
      }
    }
    content.push({ type: 'paragraph', content: texts });
  }
  return { ok: true, doc: { type: 'doc', content } };
}

// Control characters XML 1.0 forbids (all of C0 but tab, LF and CR), and the two
// noncharacters. Pasted text can carry them (Word's line break is U+000B); one in
// the feed would make the whole document unreadable to every feed reader. The
// pages and the feed drop them (lib/escape.ts); the API refuses them (S-5).
const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;
const XML_FORBIDDEN_ALL = new RegExp(XML_FORBIDDEN.source, 'g');

/** Whether the text holds a character no XML document may carry. */
export const hasXmlForbidden = (text: string): boolean => XML_FORBIDDEN.test(text);

/** The text without those characters. */
export const stripXmlForbidden = (text: string): string => text.replace(XML_FORBIDDEN_ALL, '');

/** Whether any text or link address of a valid document holds a character XML forbids (S-5). */
export function docHasXmlForbidden(doc: Doc): boolean {
  return doc.content.some((p) =>
    p.content.some((t) => hasXmlForbidden(t.text) || (t.marks ?? []).some((m) => m.type === 'link' && hasXmlForbidden(m.attrs.href))),
  );
}

/**
 * Drop the paragraphs that hold nothing (S-4). ProseMirror stores an empty
 * paragraph as `{type: 'paragraph'}` with no content, which the schema's `text+`
 * refuses; pressing Enter twice must not cost the person their entry. Takes and
 * returns unvalidated JSON: anything that isn't a document with a content array
 * comes back as it was, for `validateDoc` to refuse. The browser runs the same
 * function before it sends (B6).
 */
export function normalizeDoc(json: unknown): unknown {
  if (!isObject(json) || json.type !== 'doc' || !Array.isArray(json.content)) return json;
  const empty = (p: unknown) => isObject(p) && p.type === 'paragraph' && (p.content === undefined || (Array.isArray(p.content) && p.content.length === 0));
  return { ...json, content: json.content.filter((p: unknown) => !empty(p)) };
}

/** A document with no paragraphs, which is what `normalizeDoc` leaves of a body with nothing in it. */
export function isEmptyDoc(json: unknown): boolean {
  return isObject(json) && json.type === 'doc' && hasOnlyKeys(json, ['type', 'content']) && Array.isArray(json.content) && json.content.length === 0;
}

/** The document's text, paragraphs joined by a space: a list's opening words are cut from it. */
export function docText(doc: Doc): string {
  return doc.content.map((p) => p.content.map((t) => t.text).join('')).join(' ');
}

/** Whether the document holds any text that is not whitespace (B5's BODY_REQUIRED). */
export function docHasText(doc: Doc): boolean {
  return doc.content.some((p) => p.content.some((t) => t.text.trim() !== ''));
}

const INLINE = /\[([^\]]+)\]\(([^)\s]+)\)|==(.+?)==/g;

function paragraphFromText(line: string): Paragraph | null {
  const content: TextNode[] = [];
  const push = (text: string, marks?: Mark[]) => {
    if (text === '') return;
    content.push(marks ? { type: 'text', text, marks } : { type: 'text', text });
  };
  let last = 0;
  for (const match of line.matchAll(INLINE)) {
    push(line.slice(last, match.index));
    if (match[1] !== undefined && match[2] !== undefined) {
      // A link whose address isn't allowed stays as plain text, so a seed can't smuggle one in.
      push(match[1], isAllowedHref(match[2]) ? [{ type: 'link', attrs: { href: match[2] } }] : undefined);
    } else if (match[3] !== undefined) {
      push(match[3], [{ type: 'highlight' }]);
    }
    last = match.index + match[0].length;
  }
  push(line.slice(last));
  return content.length ? { type: 'paragraph', content } : null;
}

/**
 * A document from plain text, for seeds and tests: paragraphs are separated by
 * a blank line; `[text](url)` is a link and `==text==` is the highlight (the
 * markup of PD-7's textarea fallback). Single line breaks become spaces.
 */
export function docFromText(text: string): Doc {
  const paragraphs = text
    .split(/\r?\n\s*\r?\n/)
    .map((chunk) => paragraphFromText(chunk.replace(/\s*\r?\n\s*/g, ' ').trim()))
    .filter((p): p is Paragraph => p !== null);
  return { type: 'doc', content: paragraphs };
}

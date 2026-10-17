// Escaping for HTML text and attributes, and for XML. One function, since the
// five characters are the same in both.
import { stripXmlForbidden } from '../shared/doc.ts';

const MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// The characters XML forbids are defined once, in shared/doc.ts, where the API
// refuses them too. They draw nothing on a page, so they are dropped everywhere here.
export function escapeHtml(text: string): string {
  return stripXmlForbidden(text).replace(/[&<>"']/g, (ch) => MAP[ch] ?? ch);
}

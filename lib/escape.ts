// Escaping for HTML text and attributes, and for XML. One function, since the
// five characters are the same in both.
const MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Control characters XML 1.0 forbids (all of C0 but tab, LF and CR), and the two
// noncharacters. Pasted text can carry them (Word's line break is U+000B); one of
// them in the feed would make the whole document unreadable to every feed reader.
// They draw nothing on a page either, so they are dropped everywhere.
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

export function escapeHtml(text: string): string {
  return text.replace(NOT_XML, '').replace(/[&<>"']/g, (ch) => MAP[ch] ?? ch);
}

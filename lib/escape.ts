// Escaping for HTML text and attributes, and for XML. One function, since the
// five characters are the same in both.
const MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => MAP[ch] ?? ch);
}

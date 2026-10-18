// The first words of a text, cut at a word: what names an entry that has no title, in the admin's list and in the
// offer of text that was kept (PL-7). It lives in `shared/` because the admin bundle can't import `lib/entries.ts`,
// which pulls in the database.

/** The first `max` characters of the text, cut at a word, with "…" when something was left out. */
export function excerpt(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  // Characters, not UTF-16 units, so an emoji is never cut in half.
  const chars = Array.from(flat);
  if (chars.length <= max) return flat;
  const head = chars.slice(0, max);
  // A space right after the cut means the head already ends on a word.
  const at = chars[max] === ' ' ? -1 : head.lastIndexOf(' ');
  return `${(at > 0 ? head.slice(0, at) : head).join('').trimEnd()}…`;
}

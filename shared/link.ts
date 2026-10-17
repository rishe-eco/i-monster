// What an episode link may be, as one rule for the server and the admin form (house rule 4): the form
// refuses a bad address at its field, and the API refuses it again, by the same test.

/**
 * Whether the text is a link the site will print: it starts `https://`, parses as a URL and holds no
 * space or control character. The database checks the prefix too (`url LIKE 'https://%'`); `new URL`
 * alone is too kind ("https:example.com" parses), and the prefix alone is too little ("https://").
 */
export function isHttpsLink(text: string): boolean {
  if (!/^https:\/\//i.test(text) || /[\s\p{Cc}]/u.test(text)) return false;
  try {
    return new URL(text).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The address the person probably meant, built from their own text: whatever scheme they started with
 * is dropped and `https://` goes in front. "youtu.be/abc123" and "http://youtu.be/abc123" both give
 * "https://youtu.be/abc123". Only ever shown as a suggestion in a message, never put in the field. Null
 * when there is nothing to build from (a blank field, or text with a space in it).
 */
export function httpsSuggestion(text: string): string | null {
  const rest = text.trim().replace(/^[a-z][a-z0-9+.-]*:(?=\/\/)/i, '').replace(/^\/+/, '');
  if (rest === '' || /[\s\p{Cc}]/u.test(rest)) return null;
  return `https://${rest}`;
}

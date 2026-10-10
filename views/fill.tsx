// Fill a locale template that holds `{name}` placeholders with elements (links,
// an isolated name). The template's own text is plain, so only the parts around
// the placeholders are escaped, by the JSX.
import type { Child } from 'hono/jsx';

export function fill(template: string, parts: Record<string, Child>): Child[] {
  return template.split(/(\{[a-z]+\})/).map((piece) => {
    const name = /^\{([a-z]+)\}$/.exec(piece)?.[1];
    return name && name in parts ? (parts[name] as Child) : piece;
  });
}

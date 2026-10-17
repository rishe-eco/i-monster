// The opening words a list row shows for an untitled entry (plate 8): plain text, about 120
// characters, cut at a word.
import { describe, expect, it } from 'vitest';
import { excerpt } from '../../lib/entries.ts';

describe('excerpt', () => {
  it('returns a short text as it is, with its white space collapsed', () => {
    expect(excerpt('One   two\n three.')).toBe('One two three.');
  });

  it('returns a text of exactly the limit whole', () => {
    const text = 'x'.repeat(120);
    expect(excerpt(text)).toBe(text);
  });

  it('cuts a longer text at the last word that fits and adds an ellipsis', () => {
    const text = `${'word '.repeat(30)}end`;
    const cut = excerpt(text);
    expect(cut.endsWith('word…')).toBe(true);
    expect(Array.from(cut).length).toBeLessThanOrEqual(121);
    expect(text.startsWith(cut.slice(0, -1))).toBe(true);
  });

  it('keeps the last word when the cut falls just after it, and drops a word that does not fit', () => {
    // 120 letters, then a space: the head ends on a word and the next character is the space.
    const whole = 'a'.repeat(120);
    expect(excerpt(`${whole} bbb ccc`)).toBe(`${whole}…`);
    // A word that would cross the limit goes.
    const short = 'a'.repeat(110);
    expect(excerpt(`${short} bbbbbbbbbbbbbbbb`)).toBe(`${short}…`);
  });

  it('cuts a single long word where it stands, never in the middle of a character', () => {
    const cut = excerpt('😀'.repeat(200));
    expect(Array.from(cut)).toHaveLength(121);
    expect(cut.endsWith('😀…')).toBe(true);
  });

  it('cuts Persian at a word too', () => {
    const cut = excerpt('سلام دنیا '.repeat(30).trim());
    expect(cut.endsWith('دنیا…') || cut.endsWith('سلام…')).toBe(true);
  });

  it('gives an empty string for nothing', () => {
    expect(excerpt('   ')).toBe('');
  });
});

// The contrast of every role pair in the design README's colour table, measured from tokens.css in both
// schemes (plan B9, V-2; spec AC-19, AC-32, AC-37). The design computed its dark pairs by eye; this reads
// the hex values the site actually serves and computes the WCAG 2 ratio.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, '..', '..', 'assets', 'css', 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The hex colour tokens declared in one block of declarations. */
const hexTokens = (block: string): Record<string, string> =>
  Object.fromEntries([...block.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1] as string, (m[2] as string).toLowerCase()]));

const lightBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
const darkBlock = /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)\n {2}\}/.exec(css)?.[1] ?? '';
const LIGHT = hexTokens(lightBlock);
// Dark overrides the light values and leaves the rest as they are: the eyes, for one.
const DARK = { ...LIGHT, ...hexTokens(darkBlock) };
const SCHEMES = { light: LIGHT, dark: DARK } as const;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** What a pair is for decides how much contrast it needs. */
const TEXT = 4.5; // WCAG 1.4.3, normal text
const LARGE = 3; // WCAG 1.4.3 large text, and 1.4.11 lines, edges and the focus ring

interface Pair {
  what: string;
  fg: string;
  bg: string;
  min: number;
}

const PAIRS: Pair[] = [
  { what: 'ink on the ground', fg: '--ink', bg: '--ground', min: TEXT },
  { what: 'description text on the ground', fg: '--body-2', bg: '--ground', min: TEXT },
  { what: 'muted meta and footers on the ground', fg: '--muted', bg: '--ground', min: TEXT },
  { what: 'links and green text on the ground', fg: '--link', bg: '--ground', min: TEXT },
  { what: 'the monster green (wordmark, current-page underline): large text and lines only', fg: '--monster', bg: '--ground', min: LARGE },
  { what: 'text on the highlighter', fg: '--highlight-ink', bg: '--highlight', min: TEXT },
  { what: 'ink on a success notice', fg: '--ink', bg: '--success-fill', min: TEXT },
  { what: 'a success notice edge on the ground', fg: '--success-edge', bg: '--ground', min: LARGE },
  { what: 'error text on an error notice', fg: '--error-ink', bg: '--error-fill', min: TEXT },
  { what: 'an error notice edge on the ground', fg: '--error-edge', bg: '--ground', min: LARGE },
  { what: 'an error edge on a field (aria-invalid)', fg: '--error-edge', bg: '--input-fill', min: LARGE },
  { what: 'ink in a field', fg: '--ink', bg: '--input-fill', min: TEXT },
  { what: 'a placeholder in a field', fg: '--placeholder', bg: '--input-fill', min: TEXT },
  { what: 'a field edge on the ground (AC-37)', fg: '--field-edge', bg: '--ground', min: LARGE },
  { what: 'a field edge on the field\'s own fill (AC-37)', fg: '--field-edge', bg: '--input-fill', min: LARGE },
  { what: 'the primary button\'s text on its fill', fg: '--button-ink', bg: '--button-fill', min: TEXT },
  { what: 'the structural rules on the ground', fg: '--rule-strong', bg: '--ground', min: LARGE },
  { what: 'the focus ring on the ground (it is the monster green)', fg: '--monster', bg: '--ground', min: LARGE },
  { what: 'the focus ring on a field', fg: '--monster', bg: '--input-fill', min: LARGE },
  { what: 'the eyes\' edge on the ground', fg: '--ink', bg: '--ground', min: LARGE },
];

/** Colour tokens that are not a text or a boundary pair, so the table above does not hold them. */
const EXEMPT: Record<string, string> = {
  '--eye-white': 'the eyes\' fill: decoration, hidden from assistive technology',
  '--eye-pupil': 'the eyes\' pupil: decoration, hidden from assistive technology',
};

describe('the colour pairs, measured from tokens.css (V-2)', () => {
  it('reads both schemes', () => {
    expect(Object.keys(LIGHT).length).toBeGreaterThan(20);
    expect(DARK['--ground']).toBe('#112019');
    expect(LIGHT['--ground']).toBe('#eff0ea');
    expect(DARK['--eye-white']).toBe(LIGHT['--eye-white']);
  });

  it.each(Object.entries(SCHEMES))('%s: every pair meets its minimum', (_name, tokens) => {
    const below = PAIRS.map((p) => ({ ...p, got: ratio(tokens[p.fg] as string, tokens[p.bg] as string) }))
      .filter((p) => p.got < p.min)
      .map((p) => `${p.what}: ${p.got.toFixed(2)} < ${p.min}`);
    expect(below).toEqual([]);
  });

  it.each(Object.entries(SCHEMES))('%s: every hex colour token is in a pair above, or exempt with a reason', (_name, tokens) => {
    const named = new Set([...PAIRS.flatMap((p) => [p.fg, p.bg]), ...Object.keys(EXEMPT)]);
    // --highlight is a fill under --highlight-ink; --success-fill and the others are the backgrounds of their pairs.
    expect(Object.keys(tokens).filter((token) => !named.has(token))).toEqual([]);
  });

  // The README's table quotes some ratios. These are what the hex values compute to, to one decimal:
  // the README's "3.6:1" for the light field edge is its ratio on the field's fill, not on the ground (3.4),
  // and its "8.3:1" for dark muted text computes to 7.9.
  it.each([
    ['light', '--muted', '--ground', 5.7],
    ['light', '--link', '--ground', 7.4],
    ['light', '--field-edge', '--ground', 3.4],
    ['light', '--field-edge', '--input-fill', 3.6],
    ['dark', '--muted', '--ground', 7.9],
    ['dark', '--field-edge', '--ground', 5.1],
    ['dark', '--field-edge', '--input-fill', 4.5],
  ] as const)('%s: %s on %s is %s:1', (scheme, fg, bg, expected) => {
    const tokens = SCHEMES[scheme];
    expect(Math.round(ratio(tokens[fg] as string, tokens[bg] as string) * 10) / 10).toBe(expected);
  });
});

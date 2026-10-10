import { describe, expect, it } from 'vitest';
import { docFromText, docHasText, isAllowedHref, validateDoc } from '../../shared/doc.ts';

const para = (...content: unknown[]) => ({ type: 'paragraph', content });
const text = (t: string, marks?: unknown) => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });
const doc = (...content: unknown[]) => ({ type: 'doc', content });

describe('validateDoc (PD-7)', () => {
  it('accepts paragraphs of text with link and highlight marks', () => {
    const good = doc(
      para(text('plain '), text('lit', [{ type: 'highlight' }]), text('go', [{ type: 'link', attrs: { href: 'https://example.org/a' } }])),
      para(text('mail', [{ type: 'link', attrs: { href: 'mailto:a@example.org' } }, { type: 'highlight' }])),
    );
    const result = validateDoc(good);
    expect(result.ok).toBe(true);
    expect(result.ok && result.doc).toEqual(good);
  });

  it.each([
    ['not an object', 'x'],
    ['an array', []],
    ['the wrong root type', { type: 'paragraph', content: [] }],
    ['no paragraphs', doc()],
    ['an empty paragraph', doc(para())],
    ['an empty text node', doc(para(text('')))],
    ['a heading', doc({ type: 'heading', content: [text('x')] })],
    ['a nested node', doc(para({ type: 'image', attrs: {} }))],
    ['an unknown mark', doc(para(text('x', [{ type: 'bold' }])))],
    ['a repeated mark', doc(para(text('x', [{ type: 'highlight' }, { type: 'highlight' }])))],
    ['a javascript: link', doc(para(text('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])))],
    ['a data: link', doc(para(text('x', [{ type: 'link', attrs: { href: 'data:text/html,x' } }])))],
    ['a relative link', doc(para(text('x', [{ type: 'link', attrs: { href: '/log' } }])))],
    ['an extra attribute', doc(para(text('x', [{ type: 'link', attrs: { href: 'https://a.example', target: '_blank' } }])))],
    ['an extra key on text', doc(para({ type: 'text', text: 'x', style: 'color:red' }))],
    ['marks that are not an array', doc(para(text('x', 'highlight')))],
  ])('refuses %s', (_name, value) => {
    expect(validateDoc(value).ok).toBe(false);
  });

  it('allows only https, http and mailto addresses', () => {
    expect(isAllowedHref('https://a.example')).toBe(true);
    expect(isAllowedHref('http://a.example')).toBe(true);
    expect(isAllowedHref('mailto:a@a.example')).toBe(true);
    for (const bad of ['ftp://a.example', 'javascript:1', '//a.example', ' https://a.example', '', 3]) {
      expect(isAllowedHref(bad)).toBe(false);
    }
  });
});

describe('docFromText', () => {
  it('splits paragraphs on a blank line and joins single breaks with a space', () => {
    const d = docFromText('One\ntwo.\n\nThree.\n\n\n\nFour.');
    expect(d.content.map((p) => p.content.map((t) => t.text).join(''))).toEqual(['One two.', 'Three.', 'Four.']);
    expect(validateDoc(d).ok).toBe(true);
  });

  it('reads ==highlight== and [text](url)', () => {
    const d = docFromText('A ==bright== [link](https://a.example) end.');
    expect(d.content[0]?.content).toEqual([
      { type: 'text', text: 'A ' },
      { type: 'text', text: 'bright', marks: [{ type: 'highlight' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://a.example' } }] },
      { type: 'text', text: ' end.' },
    ]);
  });

  it('leaves a link with a refused address as plain text', () => {
    const d = docFromText('[x](javascript:alert1)');
    expect(validateDoc(d).ok).toBe(true);
    expect(JSON.stringify(d)).not.toContain('"link"');
  });

  it('gives an empty document for no text, which validateDoc refuses', () => {
    expect(validateDoc(docFromText('  \n\n '))).toEqual({ ok: false });
    expect(docHasText(docFromText('x'))).toBe(true);
  });
});

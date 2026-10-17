import { describe, expect, it } from 'vitest';
import {
  docFromText,
  docHasText,
  docHasXmlForbidden,
  docText,
  hasXmlForbidden,
  isAllowedHref,
  isEmptyDoc,
  normalizeDoc,
  stripXmlForbidden,
  validateDoc,
  type Doc,
} from '../../shared/doc.ts';

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

describe('normalizeDoc (S-4)', () => {
  it('drops a paragraph with no content, or an empty one, and keeps the rest in order', () => {
    const input = doc({ type: 'paragraph' }, para(text('One.')), para(), { type: 'paragraph', content: [] }, para(text('Two.')), { type: 'paragraph' });
    expect(normalizeDoc(input)).toEqual(doc(para(text('One.')), para(text('Two.'))));
  });

  it('leaves a document with nothing to drop as it was, and does not change its input', () => {
    const input = doc(para(text('One.')), para(text('  ')));
    const copy: unknown = JSON.parse(JSON.stringify(input));
    expect(normalizeDoc(input)).toEqual(input);
    expect(input).toEqual(copy);
  });

  it('keeps a paragraph that holds only white space: that is text, for docHasText to judge', () => {
    expect((normalizeDoc(doc(para(text(' ')))) as { content: unknown[] }).content).toHaveLength(1);
  });

  it('returns anything that is not a document with a content array as it came, for validateDoc to refuse', () => {
    for (const value of ['x', null, 4, [], { type: 'paragraph' }, { type: 'doc' }, { type: 'doc', content: 'x' }]) {
      expect(normalizeDoc(value)).toBe(value);
    }
  });

  it('leaves a body of empty paragraphs empty, which validateDoc refuses and isEmptyDoc names', () => {
    const normalized = normalizeDoc(doc({ type: 'paragraph' }, { type: 'paragraph' }));
    expect(isEmptyDoc(normalized)).toBe(true);
    expect(validateDoc(normalized).ok).toBe(false);
  });

  it('makes a document that validates out of one with an empty paragraph before its text', () => {
    expect(validateDoc(normalizeDoc(doc({ type: 'paragraph' }, para(text('Hi.'))))).ok).toBe(true);
  });
});

describe('isEmptyDoc', () => {
  it('is true only for a document with an empty content array', () => {
    expect(isEmptyDoc(doc())).toBe(true);
    expect(isEmptyDoc(doc(para(text('x'))))).toBe(false);
    expect(isEmptyDoc({ type: 'doc', content: [], extra: 1 })).toBe(false);
    expect(isEmptyDoc('x')).toBe(false);
    expect(isEmptyDoc(null)).toBe(false);
  });
});

describe('the characters XML forbids (S-5)', () => {
  const forbidden = ['\u0000', '\u0008', '\u000B', '\u000C', '\u000E', '\u001F', '￾', '￿'];
  const allowed = ['\t', '\n', '\r', ' ', 'a', 'س', '‌', '\u0085', '\u007F'];

  it('finds each of them, and none of the characters XML allows', () => {
    for (const ch of forbidden) expect(hasXmlForbidden(`a${ch}b`), JSON.stringify(ch)).toBe(true);
    for (const ch of allowed) expect(hasXmlForbidden(`a${ch}b`), JSON.stringify(ch)).toBe(false);
  });

  it('answers the same when asked twice of the same text (no regular-expression state)', () => {
    expect(hasXmlForbidden('a\u000Bb')).toBe(true);
    expect(hasXmlForbidden('a\u000Bb')).toBe(true);
  });

  it('strips every one of them and nothing else', () => {
    expect(stripXmlForbidden('a\u000Bb\u0000c￾d\te')).toBe('abcd\te');
  });

  it("is found in a document's text and in a link address", () => {
    const mark = [{ type: 'link', attrs: { href: 'https://a.example/\u0001' } }];
    expect(docHasXmlForbidden(doc(para(text('one\u000Btwo'))) as Doc)).toBe(true);
    expect(docHasXmlForbidden(doc(para(text('x', mark))) as Doc)).toBe(true);
    expect(docHasXmlForbidden(doc(para(text('clean', [{ type: 'highlight' }]))) as Doc)).toBe(false);
  });
});

describe('docText', () => {
  it('joins the text of each paragraph, and the paragraphs with a space', () => {
    expect(docText(docFromText('A ==bold== [link](https://a.example) end.\n\nSecond.'))).toBe('A bold link end. Second.');
  });
});

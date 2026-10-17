// What the editor's model promises, apart from the browser (plan B6): the schema mirrors
// `shared/doc.ts` and nothing else gets in; the conversion to the stored document drops empty
// paragraphs (S-4) and the characters XML forbids (S-5); the bidi decorations are `lib/bidi.ts`'s
// runs (PD-8); a link is only ever one the schema allows. Pasting HTML needs a DOM, so the
// pasted `<b>`, `<mark>` and `javascript:` link are driven in a browser (tests/e2e/editor.spec.ts).
import { Fragment, Slice } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { isolateRuns } from '../../lib/bidi.ts';
import { docFromText, validateDoc, type Doc } from '../../shared/doc.ts';
import { EMPTY_DOC, bidiDecorations, cleanHref, cleanSlice, docOrEmpty, fromPm, highlightOn, isBlank, linkAt, schema, toPm } from '../../admin/editor-model.ts';

const para = (...content: unknown[]) => ({ type: 'paragraph', content });
const text = (value: string, marks?: unknown[]) => (marks ? { type: 'text', text: value, marks } : { type: 'text', text: value });
const doc = (...paragraphs: unknown[]) => ({ type: 'doc', content: paragraphs }) as Doc;

describe('the schema', () => {
  it('has the one block and the two marks of the body schema, and nothing else (PD-7)', () => {
    expect(Object.keys(schema.nodes).sort()).toEqual(['doc', 'paragraph', 'text']);
    expect(Object.keys(schema.marks).sort()).toEqual(['highlight', 'link']);
  });

  it('refuses a node or a mark the body schema has no place for', () => {
    expect(() => schema.nodeFromJSON({ type: 'doc', content: [{ type: 'heading', content: [] }] })).toThrow();
    expect(() => schema.nodeFromJSON(doc(para(text('x', [{ type: 'strong' }]))))).toThrow();
  });
});

describe('the stored document from the editor', () => {
  it('turns an empty editor into the empty document and back into one empty paragraph', () => {
    expect(fromPm(toPm(EMPTY_DOC))).toEqual(EMPTY_DOC);
    expect(isBlank(toPm(EMPTY_DOC))).toBe(true);
    expect(toPm(EMPTY_DOC).childCount).toBe(1);
  });

  it('drops the empty paragraphs the Enter key leaves, before anything is sent (S-4)', () => {
    const pm = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph' }, para(text('One.')), { type: 'paragraph' }, { type: 'paragraph' }, para(text('Two.'))] });
    expect(fromPm(pm)).toEqual(doc(para(text('One.')), para(text('Two.'))));
  });

  it('keeps links and the highlight, and the server accepts what it makes', () => {
    const body = docFromText('See [the paper](https://example.org/paper) and ==this part==.');
    const back = fromPm(toPm(body));
    expect(back).toEqual(body);
    expect(validateDoc(back).ok).toBe(true);
  });

  it('writes each key where the server writes it, so the same words compare equal as text', () => {
    const pm = schema.nodeFromJSON(doc(para(text('a', [{ type: 'link', attrs: { href: 'https://example.org' } }, { type: 'highlight' }]))));
    const sent = fromPm(pm);
    const echoed = validateDoc(JSON.parse(JSON.stringify(sent)));
    expect(echoed.ok && JSON.stringify(echoed.doc)).toBe(JSON.stringify(sent));
  });

  it('strips a character XML forbids from a body that holds one (S-5)', () => {
    const pm = schema.nodeFromJSON(doc(para(text('Line one\u000Bline two')), para(text('\u0001'))));
    expect(fromPm(pm)).toEqual(doc(para(text('Line oneline two'))));
  });

  it('reads a stored value as a document, or as the empty one when it is damaged', () => {
    expect(docOrEmpty(doc(para(text('ok'))))).toEqual(doc(para(text('ok'))));
    expect(docOrEmpty({ type: 'doc', content: [] })).toEqual(EMPTY_DOC);
    expect(docOrEmpty({ type: 'nope' })).toEqual(EMPTY_DOC);
    expect(docOrEmpty(null)).toEqual(EMPTY_DOC);
  });
});

describe('an address, from the field or a paste', () => {
  it('allows https, http and mailto, and drops the XML-forbidden characters and the white space round it', () => {
    expect(cleanHref('https://example.org/a')).toBe('https://example.org/a');
    expect(cleanHref('  http://example.org  ')).toBe('http://example.org');
    expect(cleanHref('mailto:me@example.org')).toBe('mailto:me@example.org');
    expect(cleanHref('https://example.org/\u000Ba')).toBe('https://example.org/a');
  });

  it('refuses every other scheme, and anything that is not an address', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,x', 'ftp://example.org', 'file:///etc/passwd', 'example.org', '', '   ', null, 42]) {
      expect(cleanHref(href)).toBeNull();
    }
  });
});

describe('pasted text (S-5)', () => {
  it('has the characters XML forbids taken out of its text, and its marks left alone', () => {
    const marked = schema.text('a\u000Bb', [schema.marks.highlight!.create()]);
    const slice = cleanSlice(new Slice(Fragment.from(schema.nodes.paragraph!.create(null, [marked, schema.text('\u0002')])), 1, 1));
    expect(slice.content.textBetween(0, slice.content.size)).toBe('ab');
    expect(slice.content.firstChild?.firstChild?.marks.map((mark) => mark.type.name)).toEqual(['highlight']);
  });
});

describe('the bidi decorations (PD-8, AC-48)', () => {
  const runsOf = (body: Doc, lang: 'en' | 'fa') => {
    const pm = toPm(body);
    return bidiDecorations(pm, lang)
      .find()
      // Each decoration's own attributes, and the text it covers.
      .map((d) => ({ text: pm.textBetween(d.from, d.to), attrs: (d as unknown as { type: { attrs: Record<string, string> } }).type.attrs }));
  };

  it('isolates exactly the runs lib/bidi.ts finds, at the positions they sit', () => {
    const body = 'Passkeyها اگر همگام شوند، ببینید https://example.org/x.';
    const found = runsOf(doc(para(text(body))), 'fa');
    const expected = isolateRuns(body, 'fa').filter((run) => run.isolate);
    expect(found.map((run) => run.text)).toEqual(expected.map((run) => run.text));
    expect(found.map((run) => run.text)).toEqual(['Passkey', 'https://example.org/x']);
    expect(found[0]?.attrs).toMatchObject({ nodeName: 'bdi', lang: 'en' });
    expect(found[1]?.attrs).toMatchObject({ nodeName: 'bdi', dir: 'ltr' });
  });

  it('isolates Persian inside an English entry, right to left', () => {
    const found = runsOf(doc(para(text('The word «سلام دنیا» means hello'))), 'en');
    expect(found).toHaveLength(1);
    expect(found[0]?.attrs).toMatchObject({ nodeName: 'bdi', lang: 'fa', dir: 'rtl' });
  });

  it('decorates each text node on its own, as the page does', () => {
    const found = runsOf(doc(para(text('Hello '), text('Google', [{ type: 'highlight' }]), text(' سلام'))), 'fa');
    expect(found.map((run) => run.text)).toEqual(['Hello', 'Google']);
  });

  it("decorates nothing in text of the entry's own script", () => {
    expect(runsOf(doc(para(text('Plain English words.'))), 'en')).toEqual([]);
  });
});

describe('where the caret is, for the toolbar', () => {
  const state = (from: number, to: number) => {
    const body = toPm(
      doc(para(text('See '), text('the paper', [{ type: 'link', attrs: { href: 'https://example.org/paper' } }]), text(' now '), text('marked', [{ type: 'highlight' }]))),
    );
    return EditorState.create({ doc: body, selection: TextSelection.create(body, from, to) });
  };

  it('finds the link when the caret is strictly inside it, and not at either end', () => {
    // "See " is four characters and the paragraph opens at 0, so the link covers 5 to 14.
    expect(linkAt(state(8, 8))).toEqual({ from: 5, to: 14, href: 'https://example.org/paper' });
    expect(linkAt(state(5, 5))).toBeNull();
    expect(linkAt(state(14, 14))).toBeNull();
    expect(linkAt(state(2, 2))).toBeNull();
  });

  it('finds the link for a selection wholly inside it, and not for one that leaves it', () => {
    expect(linkAt(state(6, 10))?.href).toBe('https://example.org/paper');
    expect(linkAt(state(3, 8))).toBeNull();
  });

  it('says whether the highlight is on over the selection', () => {
    expect(highlightOn(state(20, 23))).toBe(true);
    expect(highlightOn(state(6, 8))).toBe(false);
  });
});

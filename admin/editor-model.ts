// What the editor knows about the body, apart from the browser: the ProseMirror
// schema, the two-way conversion to the stored document, the bidi decorations and
// the rules for what pasting and a link's address may let in (plan B6, PD-7, PD-8).
//
// Nothing here draws anything, so the unit tests can run it in Node. The schema
// mirrors `shared/doc.ts` and calls its rules (`isAllowedHref`, `stripXmlForbidden`,
// `normalizeDoc`, `validateDoc`) instead of writing them again (house rule 4).
import { Fragment, Schema, Slice, type Node as PmNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { isolateRuns } from '../lib/bidi.ts';
import type { Lang } from '../lib/i18n.ts';
import { isAllowedHref, isEmptyDoc, normalizeDoc, stripXmlForbidden, validateDoc, type Doc } from '../shared/doc.ts';

/** The document with nothing in it: what an empty editor holds, and what `normalizeDoc` leaves of one. */
export const EMPTY_DOC: Doc = { type: 'doc', content: [] };

/** A new empty document each time: a body handed to the editor is told apart from one it reported by identity, so none may be shared. */
const emptyDoc = (): Doc => ({ type: 'doc', content: [] });

/**
 * An address from a field or a pasted link, cleaned and checked: the characters XML forbids are
 * dropped (S-5) and the ends are trimmed, and then it must be one the schema allows. Null if not.
 */
export function cleanHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const href = stripXmlForbidden(raw).trim();
  return isAllowedHref(href) ? href : null;
}

/**
 * `doc > paragraph+`, text, and the marks `link{href}` and `highlight`; nothing else.
 * Pasted HTML is reduced to this by the parse rules below: a rule exists only for
 * `<p>`, `<mark>` and an `<a>` with an allowed address. So `<b>`, `<strong>` and `<em>`
 * match no rule and their text stays plain, and a link to any other scheme is dropped to its text.
 */
export const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
    text: {},
  },
  marks: {
    link: {
      attrs: { href: {} },
      // Typing at the end of a link carries on outside it, as in every editor.
      inclusive: false,
      parseDOM: [
        {
          tag: 'a[href]',
          getAttrs: (dom) => {
            const href = cleanHref((dom as HTMLElement).getAttribute('href'));
            return href === null ? false : { href };
          },
        },
      ],
      toDOM: (mark) => ['a', { href: mark.attrs.href as string }, 0],
    },
    highlight: { parseDOM: [{ tag: 'mark' }], toDOM: () => ['mark', 0] },
  },
});

/** A ProseMirror document from the stored one. An empty body is one empty paragraph, which is what the editor must hold. */
export function toPm(doc: Doc): PmNode {
  return schema.nodeFromJSON(doc.content.length > 0 ? doc : { type: 'doc', content: [{ type: 'paragraph' }] });
}

function stripText(doc: Doc): Doc {
  return {
    type: 'doc',
    content: doc.content.map((paragraph) => ({
      type: 'paragraph',
      content: paragraph.content
        .map((node) => ({ ...node, text: stripXmlForbidden(node.text) }))
        .filter((node) => node.text !== ''),
    })),
  };
}

/**
 * The stored document from the editor's: empty paragraphs dropped before anything is sent (S-4),
 * then checked against the schema, which also puts every key where the server puts it, so two
 * documents that say the same thing compare equal as text. Nothing the schema refuses can get
 * this far; if it ever did, the body would be sent as it is and the server would refuse it.
 */
export function fromPm(node: PmNode): Doc {
  const json = normalizeDoc(node.toJSON());
  if (isEmptyDoc(json)) return emptyDoc();
  const checked = validateDoc(json);
  if (!checked.ok) return json as Doc;
  // A paragraph that held only a character XML forbids is empty once it is stripped.
  const stripped = stripText(checked.doc);
  const kept = stripped.content.filter((paragraph) => paragraph.content.length > 0);
  return kept.length === 0 ? emptyDoc() : { type: 'doc', content: kept };
}

/** A stored document, or the empty one for anything that isn't a valid document (a damaged buffer). */
export function docOrEmpty(value: unknown): Doc {
  if (isEmptyDoc(value)) return EMPTY_DOC;
  const checked = validateDoc(value);
  return checked.ok ? checked.doc : EMPTY_DOC;
}

/** Whether the editor holds nothing: one paragraph with nothing in it. It decides whether the placeholder shows. */
export const isBlank = (doc: PmNode): boolean => doc.childCount === 1 && (doc.firstChild?.content.size ?? 0) === 0;

// ── Pasting (S-5) ──

/** A slice with the characters XML forbids taken out of its text. Word's line break is one of them (U+000B). */
export function cleanSlice(slice: Slice): Slice {
  const clean = (fragment: Fragment): Fragment => {
    const nodes: PmNode[] = [];
    fragment.forEach((node) => {
      if (node.isText) {
        const text = stripXmlForbidden(node.text ?? '');
        if (text !== '') nodes.push(schema.text(text, node.marks));
      } else {
        nodes.push(node.copy(clean(node.content)));
      }
    });
    return Fragment.from(nodes);
  };
  return new Slice(clean(slice.content), slice.openStart, slice.openEnd);
}

// ── Bidi (PD-8, AC-48) ──

/**
 * `lib/bidi.ts`'s runs as inline decorations: each run of the other script, and each URL, is wrapped
 * in a `<bdi>` that keeps its own order inside the paragraph, as it does on the page. The paragraph's
 * direction is the entry's language (set on the editable element), never its first character.
 * Isolation is per text node, which is what the page does too.
 */
export function bidiDecorations(doc: PmNode, lang: Lang): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    let at = pos;
    for (const run of isolateRuns(node.text, lang)) {
      const end = at + run.text.length;
      if (run.isolate) {
        decorations.push(
          Decoration.inline(at, end, {
            nodeName: 'bdi',
            ...(run.isolate.dir ? { dir: run.isolate.dir } : {}),
            ...(run.isolate.lang ? { lang: run.isolate.lang } : {}),
          }),
        );
      }
      at = end;
    }
  });
  return DecorationSet.create(doc, decorations);
}

// ── Links ──

export interface LinkRange {
  from: number;
  to: number;
  href: string;
}

/** The runs of one paragraph that carry a link, each with its address: neighbours with the same address are one link. */
function linkRuns(paragraph: PmNode, start: number): LinkRange[] {
  const runs: LinkRange[] = [];
  let current: LinkRange | null = null;
  paragraph.forEach((child, offset) => {
    const mark = schema.marks.link ? child.marks.find((m) => m.type === schema.marks.link) : undefined;
    const from = start + offset;
    const href = mark ? (mark.attrs.href as string) : null;
    if (href !== null && current && current.href === href && current.to === from) {
      current.to = from + child.nodeSize;
    } else {
      current = href === null ? null : { from, to: from + child.nodeSize, href };
      if (current) runs.push(current);
    }
  });
  return runs;
}

/**
 * The link the selection is in: a caret strictly inside one, or a selection that lies wholly within
 * one. At the very end of a link the caret is outside it, because typing there goes on outside it.
 * Returns the whole link, which is what the address field edits.
 */
export function linkAt(state: EditorState): LinkRange | null {
  const { $from, $to, from, to, empty } = state.selection;
  if (!$from.sameParent($to)) return null;
  const runs = linkRuns($from.parent, $from.start());
  return runs.find((run) => (empty ? run.from < from && from < run.to : run.from <= from && to <= run.to)) ?? null;
}

/** Whether the highlight is on at the selection: over all of a range, or at a caret that would carry it on. */
export function highlightOn(state: EditorState): boolean {
  const type = schema.marks.highlight;
  if (!type) return false;
  const { from, to, empty, $from } = state.selection;
  if (empty) return Boolean(type.isInSet(state.storedMarks ?? $from.marks()));
  return state.doc.rangeHasMark(from, to, type);
}

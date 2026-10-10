// A document as HTML (PD-7): <p>, <a> and <mark>, every text escaped, and each
// text run isolated for its language (PD-8). Pages and the feed both use it.
import type { Doc, Mark, TextNode } from '../shared/doc.ts';
import { isolate } from './bidi.ts';
import { escapeHtml } from './escape.ts';
import type { Lang } from './i18n.ts';

function renderText(node: TextNode, lang: Lang): string {
  let html = isolate(node.text, lang);
  const marks: Mark[] = node.marks ?? [];
  if (marks.some((m) => m.type === 'highlight')) html = `<mark>${html}</mark>`;
  for (const mark of marks) {
    if (mark.type !== 'link') continue;
    // Outbound web links carry rel="noopener"; a mailto: link opens no page.
    const rel = /^https?:/i.test(mark.attrs.href) ? ' rel="noopener"' : '';
    html = `<a href="${escapeHtml(mark.attrs.href)}"${rel}>${html}</a>`;
  }
  return html;
}

/** Each paragraph's inner HTML, so a page can put the date and title in the first. */
export function renderParagraphs(doc: Doc, lang: Lang): string[] {
  return doc.content.map((p) => p.content.map((t) => renderText(t, lang)).join(''));
}

/** The whole body as `<p>` elements. */
export function renderDoc(doc: Doc, lang: Lang): string {
  return renderParagraphs(doc, lang)
    .map((inner) => `<p>${inner}</p>`)
    .join('');
}

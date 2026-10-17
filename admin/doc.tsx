// An entry's title and body, read-only, as Preact nodes (plan B5). The server's
// pages build HTML strings (lib/render.ts); the admin never does: it builds
// nodes, so nothing a person wrote can become markup (house rule: no raw HTML in
// the bundle). Direction comes from the entry's language, and the runs of the
// other script inside it are isolated by `lib/bidi.ts` (PD-8), as on the public page.
//
// B6 replaces `DocView` with the editor in the same place. `Runs` stays: the
// entries list names an untitled entry by its opening words through it too.
import type { ComponentChildren } from 'preact';
import { isolateRuns } from '../lib/bidi.ts';
import { dirOf, type Lang } from '../lib/i18n.ts';
import type { Doc, TextNode } from '../shared/doc.ts';

/** Text in an entry's language, each run of the other script isolated so it keeps its own order. */
export function Runs({ text, lang }: { text: string; lang: Lang }) {
  return (
    <>
      {isolateRuns(text, lang).map((run, index) =>
        run.isolate ? (
          <bdi key={index} lang={run.isolate.lang} dir={run.isolate.dir}>
            {run.text}
          </bdi>
        ) : (
          run.text
        ),
      )}
    </>
  );
}

function Piece({ node, lang }: { node: TextNode; lang: Lang }) {
  let inner: ComponentChildren = <Runs text={node.text} lang={lang} />;
  const marks = node.marks ?? [];
  if (marks.some((mark) => mark.type === 'highlight')) inner = <mark>{inner}</mark>;
  for (const mark of marks) {
    // The address passed the schema (https, http or mailto only). It opens in a new tab, so the admin stays where it is.
    if (mark.type === 'link') {
      inner = (
        <a href={mark.attrs.href} target="_blank" rel="noopener noreferrer">
          {inner}
        </a>
      );
    }
  }
  return <>{inner}</>;
}

/** The body, one `<p>` a paragraph, in the entry's language and direction. */
export function DocView({ doc, lang, label }: { doc: Doc; lang: Lang; label: string }) {
  return (
    <div class="doc" lang={lang} dir={dirOf(lang)} role="group" aria-label={label}>
      {doc.content.map((paragraph, index) => (
        <p key={index}>
          {paragraph.content.map((node, at) => (
            <Piece key={at} node={node} lang={lang} />
          ))}
        </p>
      ))}
    </div>
  );
}

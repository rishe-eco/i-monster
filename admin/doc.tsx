// Text in an entry's language as Preact nodes (plan B5). The server's pages build
// HTML strings (lib/render.ts); the admin never does: it builds nodes, so nothing a
// person wrote can become markup (house rule: no raw HTML in the bundle). The runs of
// the other script inside it are isolated by `lib/bidi.ts` (PD-8), as on the public
// page. The entries list names an entry by its title or its opening words through it.
// The editor draws the same runs as decorations (editor-model.ts).
import { isolateRuns } from '../lib/bidi.ts';
import type { Lang } from '../lib/i18n.ts';

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

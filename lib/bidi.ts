// Bidirectional isolation, in one place (house rule 4; PD-8). A paragraph's
// direction comes from its entry's language, never from its first character.
// Inside it, runs of the other script, and URLs, are wrapped in <bdi> so they
// keep their own order: Latin names in Persian, Persian in English.
import { escapeHtml } from './escape.ts';
import type { Lang } from './i18n.ts';

export interface Run {
  text: string;
  /** Absent for text that belongs to the paragraph's own direction. */
  isolate?: { lang?: Lang; dir?: 'ltr' | 'rtl' };
}

// URLs first: they hold punctuation the other patterns would cut at.
const URL_RUN = /(?:https?:\/\/|mailto:|www\.)[^\s<>«»"“”]+/gi;
const URL_TRAILING = /[.,;:!?)\]}'’”»،؛؟…]+$/;

const LATIN = 'A-Za-z\\u00C0-\\u024F';
// A Latin run: words, digits, and the joiners that sit between them ("Root 2.0", "example.org/x").
const LATIN_RUN = new RegExp(`[${LATIN}0-9]+(?:[ .\\-_'’/:&+#@]+[${LATIN}0-9]+)*`, 'g');
const HAS_LATIN = new RegExp(`[${LATIN}]`);

const ARABIC = '\\u0600-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF';
const PERSIAN_RUN = new RegExp(`[${ARABIC}\\u200C]+(?:[ \\u200C.\\-:\\u060C\\u061B\\u061F«»]+[${ARABIC}]+)*`, 'g');
const HAS_ARABIC = new RegExp(`[${ARABIC}]`);

function split(text: string, pattern: RegExp, accept: (m: string) => boolean, make: (m: string) => Run): Run[] {
  const runs: Run[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (!accept(match[0])) continue;
    if (match.index > last) runs.push({ text: text.slice(last, match.index) });
    runs.push(make(match[0]));
    last = match.index + match[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs;
}

/** Split text into runs, marking those that need isolating inside a paragraph of `lang`. */
export function isolateRuns(text: string, lang: Lang): Run[] {
  // URLs, without their trailing punctuation, which belongs to the sentence.
  const first: Run[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RUN)) {
    const url = match[0].replace(URL_TRAILING, '');
    if (url === '') continue;
    if (match.index > last) first.push({ text: text.slice(last, match.index) });
    first.push({ text: url, isolate: { dir: 'ltr' } });
    last = match.index + url.length;
  }
  if (last < text.length) first.push({ text: text.slice(last) });

  const out: Run[] = [];
  for (const run of first) {
    if (run.isolate) {
      out.push(run);
    } else if (lang === 'fa') {
      out.push(...split(run.text, LATIN_RUN, (m) => HAS_LATIN.test(m), (m) => ({ text: m, isolate: { lang: 'en' } })));
    } else {
      out.push(
        ...split(run.text, PERSIAN_RUN, (m) => HAS_ARABIC.test(m), (m) => ({ text: m, isolate: { lang: 'fa', dir: 'rtl' } })),
      );
    }
  }
  return out;
}

/** The text as escaped HTML, with each foreign run in a <bdi>. */
export function isolate(text: string, lang: Lang): string {
  return isolateRuns(text, lang)
    .map((run) => {
      const safe = escapeHtml(run.text);
      if (!run.isolate) return safe;
      const attrs = `${run.isolate.lang ? ` lang="${run.isolate.lang}"` : ''}${run.isolate.dir ? ` dir="${run.isolate.dir}"` : ''}`;
      return `<bdi${attrs}>${safe}</bdi>`;
    })
    .join('');
}

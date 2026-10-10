// Where the language switch goes from each kind of page, and which pages carry
// hreflang alternates (plan §6.5; AC-41). One rule, one file.
import { LANG_LABEL, localePath, otherLang, type Lang } from './i18n.ts';

/** The kinds of public page. Paging (`?before=`) doesn't change the kind. */
export type PageKind = 'landing' | 'log' | 'entry' | 'podcast' | 'not-found';

/** The path of each page kind that has a fixed one (an entry's path holds its id). */
const PATHS = {
  landing: '/',
  log: '/log',
  podcast: '/podcast',
} as const;

export interface SwitchTarget {
  lang: Lang;
  href: string;
  /** The other language's name, in that language (AC-41). */
  label: string;
}

/** The page the switch links to: the same kind in the other language, first page. */
export function switchTarget(kind: PageKind, from: Lang): SwitchTarget {
  const lang = otherLang(from);
  // There is no counterpart entry, so an entry goes to the other language's
  // log; a 404 goes to the other landing page (spec §4.5).
  const targetKind = kind === 'entry' ? 'log' : kind === 'not-found' ? 'landing' : kind;
  return { lang, href: localePath(lang, PATHS[targetKind]), label: LANG_LABEL[lang] };
}

export interface Alternate {
  hreflang: Lang;
  href: string;
}

/**
 * The origin hreflang URLs are written against. They must be absolute for
 * search engines to honour them, so this is a constant of the site, not of
 * the request.
 */
export const SITE_ORIGIN = 'https://imnstr.com';

/**
 * The `hreflang` alternates a page carries: landing, log and podcast point at
 * each other, in both languages (AC-41). Other pages carry none.
 */
export function alternates(kind: PageKind): Alternate[] {
  if (kind !== 'landing' && kind !== 'log' && kind !== 'podcast') return [];
  return (['en', 'fa'] as const).map((hreflang) => ({
    hreflang,
    href: SITE_ORIGIN + localePath(hreflang, PATHS[kind]),
  }));
}

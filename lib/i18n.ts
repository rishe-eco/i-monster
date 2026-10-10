// The language of a request comes from its path, and nothing else: `/fa/…` is
// Persian, every other path is English. No cookie, no Accept-Language (AC-41).
import { en } from '../locales/en.ts';
import { fa } from '../locales/fa.ts';
import type { Strings } from '../locales/strings.ts';

export type Lang = 'en' | 'fa';

export const LANGS: readonly Lang[] = ['en', 'fa'];

/** Each language's name in that language: the switch shows the other one's. */
export const LANG_LABEL: Record<Lang, string> = { en: 'English', fa: 'فارسی' };

const STRINGS: Record<Lang, Strings> = { en, fa };

export function strings(lang: Lang): Strings {
  return STRINGS[lang];
}

export function otherLang(lang: Lang): Lang {
  return lang === 'en' ? 'fa' : 'en';
}

export function dirOf(lang: Lang): 'ltr' | 'rtl' {
  return lang === 'fa' ? 'rtl' : 'ltr';
}

/**
 * The language a path belongs to, and the path without its language prefix.
 * `/fa` and `/fa/…` are Persian; `/fax` and `/faq` are not.
 */
export function langFromPath(pathname: string): { lang: Lang; path: string } {
  if (pathname === '/fa') return { lang: 'fa', path: '/' };
  if (pathname.startsWith('/fa/')) return { lang: 'fa', path: pathname.slice(3) };
  return { lang: 'en', path: pathname };
}

/** A site path in a language: `/log` stays `/log` in English and becomes `/fa/log` in Persian. */
export function localePath(lang: Lang, path: string): string {
  if (lang === 'en') return path;
  return path === '/' ? '/fa/' : `/fa${path}`;
}

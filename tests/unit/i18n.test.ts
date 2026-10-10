import { describe, expect, it } from 'vitest';
import { dirOf, langFromPath, localePath, otherLang, strings } from '../../lib/i18n.ts';

describe('langFromPath', () => {
  it('takes Persian from the /fa prefix and strips it', () => {
    expect(langFromPath('/fa/')).toEqual({ lang: 'fa', path: '/' });
    expect(langFromPath('/fa')).toEqual({ lang: 'fa', path: '/' });
    expect(langFromPath('/fa/log')).toEqual({ lang: 'fa', path: '/log' });
    expect(langFromPath('/fa/log/abc')).toEqual({ lang: 'fa', path: '/log/abc' });
  });

  it('takes English from everything else', () => {
    expect(langFromPath('/')).toEqual({ lang: 'en', path: '/' });
    expect(langFromPath('/log')).toEqual({ lang: 'en', path: '/log' });
    expect(langFromPath('/podcast')).toEqual({ lang: 'en', path: '/podcast' });
  });

  it('does not mistake a path that merely starts with "fa" for Persian', () => {
    for (const path of ['/fax', '/faq/x', '/fa-ir/', '/log/fa/x', '/admin/fa']) {
      expect(langFromPath(path).lang).toBe('en');
    }
  });
});

describe('localePath', () => {
  it('leaves English paths alone and prefixes Persian ones', () => {
    expect(localePath('en', '/')).toBe('/');
    expect(localePath('en', '/log')).toBe('/log');
    expect(localePath('fa', '/')).toBe('/fa/');
    expect(localePath('fa', '/log')).toBe('/fa/log');
    expect(localePath('fa', '/log/feed.xml')).toBe('/fa/log/feed.xml');
  });
});

describe('language helpers', () => {
  it('know the other language and the direction', () => {
    expect(otherLang('en')).toBe('fa');
    expect(otherLang('fa')).toBe('en');
    expect(dirOf('en')).toBe('ltr');
    expect(dirOf('fa')).toBe('rtl');
  });

  it('has the same keys in both languages, none of them empty', () => {
    // The Strings type makes a missing key a compile error; this catches an empty one.
    const flat = (value: unknown, prefix = ''): string[] =>
      typeof value === 'string'
        ? value.trim() === ''
          ? [`${prefix} is empty`]
          : []
        : Object.entries(value as object).flatMap(([key, inner]) => flat(inner, `${prefix}.${key}`));
    expect(flat(strings('en'))).toEqual([]);
    expect(flat(strings('fa'))).toEqual([]);
    const keys = (value: unknown, prefix = ''): string[] =>
      typeof value === 'string'
        ? [prefix]
        : Object.entries(value as object).flatMap(([key, inner]) => keys(inner, `${prefix}.${key}`));
    expect(keys(strings('fa'))).toEqual(keys(strings('en')));
  });
});

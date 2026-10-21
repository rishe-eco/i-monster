import { describe, expect, it } from 'vitest';
import { alternates, switchTarget, type PageKind } from '../../lib/switch.ts';

// Plan §6.5, one test per row, from each language.
describe('switchTarget', () => {
  it('goes from a landing page to the other language landing page', () => {
    expect(switchTarget('landing', 'en')).toEqual({ lang: 'fa', href: '/fa/', label: 'فارسی' });
    expect(switchTarget('landing', 'fa')).toEqual({ lang: 'en', href: '/', label: 'English' });
  });

  it('goes from a log page to the other language log, first page', () => {
    expect(switchTarget('log', 'en')).toEqual({ lang: 'fa', href: '/fa/log', label: 'فارسی' });
    expect(switchTarget('log', 'fa')).toEqual({ lang: 'en', href: '/log', label: 'English' });
  });

  it('goes from an entry to the other language log, because there is no counterpart', () => {
    expect(switchTarget('entry', 'en')).toEqual({ lang: 'fa', href: '/fa/log', label: 'فارسی' });
    expect(switchTarget('entry', 'fa')).toEqual({ lang: 'en', href: '/log', label: 'English' });
  });

  it('goes from a podcast page to the other language podcast page', () => {
    expect(switchTarget('podcast', 'en')).toEqual({ lang: 'fa', href: '/fa/podcast', label: 'فارسی' });
    expect(switchTarget('podcast', 'fa')).toEqual({ lang: 'en', href: '/podcast', label: 'English' });
  });

  it('goes from a contact page to the other language contact page', () => {
    expect(switchTarget('contact', 'en')).toEqual({ lang: 'fa', href: '/fa/contact', label: 'فارسی' });
    expect(switchTarget('contact', 'fa')).toEqual({ lang: 'en', href: '/contact', label: 'English' });
  });

  it('goes from a 404 to the other language landing page', () => {
    expect(switchTarget('not-found', 'en')).toEqual({ lang: 'fa', href: '/fa/', label: 'فارسی' });
    expect(switchTarget('not-found', 'fa')).toEqual({ lang: 'en', href: '/', label: 'English' });
  });

  it('names the other language in that language (AC-41)', () => {
    const kinds: PageKind[] = ['landing', 'log', 'entry', 'podcast', 'contact', 'not-found'];
    for (const kind of kinds) {
      expect(switchTarget(kind, 'en').label).toBe('فارسی');
      expect(switchTarget(kind, 'fa').label).toBe('English');
    }
  });
});

describe('alternates', () => {
  it('points the landing pages at each other, with absolute URLs', () => {
    expect(alternates('landing')).toEqual([
      { hreflang: 'en', href: 'https://imnstr.com/' },
      { hreflang: 'fa', href: 'https://imnstr.com/fa/' },
    ]);
  });

  it('does the same for the log, the podcast and the contact page', () => {
    expect(alternates('log')).toEqual([
      { hreflang: 'en', href: 'https://imnstr.com/log' },
      { hreflang: 'fa', href: 'https://imnstr.com/fa/log' },
    ]);
    expect(alternates('podcast')).toEqual([
      { hreflang: 'en', href: 'https://imnstr.com/podcast' },
      { hreflang: 'fa', href: 'https://imnstr.com/fa/podcast' },
    ]);
    expect(alternates('contact')).toEqual([
      { hreflang: 'en', href: 'https://imnstr.com/contact' },
      { hreflang: 'fa', href: 'https://imnstr.com/fa/contact' },
    ]);
  });

  it('gives an entry and a 404 none', () => {
    expect(alternates('entry')).toEqual([]);
    expect(alternates('not-found')).toEqual([]);
  });
});

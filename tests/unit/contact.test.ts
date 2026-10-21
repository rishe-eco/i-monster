// The contact form's field rules (change note 08, CT-4, CT-5): trimming, the limits in characters, and what a
// post body may hold. The route's answers are asserted in tests/integration/contact.test.ts.
import { describe, expect, it } from 'vitest';
import { CONTACT_MAX, readContact } from '../../lib/contact.ts';
import { formOriginAllowed } from '../../lib/origin.ts';
import { formatNumber } from '../../lib/i18n.ts';
import { isolateLtr } from '../../lib/bidi.ts';
import { limits } from '../../lib/limits.ts';

const GOOD = { subject: 'Hello', message: 'A message.', reach: 'someone@example.com' };

describe('readContact', () => {
  it('reads three fields and reports no problem for a good post', () => {
    expect(readContact(GOOD)).toEqual({ input: GOOD, problems: {} });
  });

  it('takes its limits from lib/limits.ts', () => {
    expect(CONTACT_MAX).toEqual({ subject: 120, message: 5000, reach: 200 });
    expect(CONTACT_MAX).toEqual({ subject: limits.contactSubjectMax, message: limits.contactMessageMax, reach: limits.contactReachMax });
  });

  it('trims each field, so a field of blanks is empty', () => {
    const { input, problems } = readContact({ subject: '   ', message: '\n\t \r\n', reach: ' ' });
    expect(input).toEqual({ subject: '', message: '', reach: '' });
    expect(problems).toEqual({ subject: 'empty', message: 'empty', reach: 'empty' });
  });

  it('treats a missing field, a repeated field and a file as empty', () => {
    const { problems } = readContact({ message: ['a', 'b'], reach: new File(['x'], 'x.txt') });
    expect(problems).toEqual({ subject: 'empty', message: 'empty', reach: 'empty' });
  });

  it('allows exactly the limit and refuses one over, per field', () => {
    for (const field of ['subject', 'message', 'reach'] as const) {
      const max = CONTACT_MAX[field];
      expect(readContact({ ...GOOD, [field]: 'x'.repeat(max) }).problems).toEqual({});
      expect(readContact({ ...GOOD, [field]: 'x'.repeat(max + 1) }).problems).toEqual({ [field]: 'tooLong' });
    }
  });

  it('counts characters, not UTF-16 units: an emoji is one, as SQLite counts it', () => {
    expect(readContact({ ...GOOD, subject: '😀'.repeat(120) }).problems).toEqual({});
    expect(readContact({ ...GOOD, subject: '😀'.repeat(121) }).problems).toEqual({ subject: 'tooLong' });
    expect(readContact({ ...GOOD, subject: 'ی'.repeat(120) }).problems).toEqual({});
  });

  it('measures after trimming, so padding never costs a character', () => {
    expect(readContact({ ...GOOD, subject: ` ${'x'.repeat(120)} ` }).problems).toEqual({});
  });

  it('keeps a message’s line breaks as \n, and folds them to a space in the one-line fields', () => {
    const { input } = readContact({ subject: 'a\r\nb', message: 'one\r\ntwo\rthree\n\nfour', reach: 'x\ny' });
    expect(input).toEqual({ subject: 'a b', message: 'one\ntwo\nthree\n\nfour', reach: 'x y' });
  });

  it('drops control characters, a NUL among them, which would cut a SQLite string short', () => {
    expect(readContact({ ...GOOD, subject: 'a\u0000b\u0007c\u007Fd' }).input.subject).toBe('abcd');
    expect(readContact({ ...GOOD, message: 'tab\there' }).input.message).toBe('tab\there');
  });

  it('reports every field that needs a look, in one pass', () => {
    expect(readContact({ subject: '', message: 'x'.repeat(5001), reach: '' }).problems).toEqual({ subject: 'empty', message: 'tooLong', reach: 'empty' });
  });
});

describe('formOriginAllowed', () => {
  const site = 'https://imnstr.com';

  it('lets the site’s own origin through, and a post that sends neither header', () => {
    expect(formOriginAllowed(site, { origin: site })).toBe(true);
    expect(formOriginAllowed(site, { origin: site, secFetchSite: 'same-origin' })).toBe(true);
    expect(formOriginAllowed(site, {})).toBe(true);
    expect(formOriginAllowed(site, { secFetchSite: 'none' })).toBe(true);
  });

  it('refuses another origin, the null origin and a cross-site fetch', () => {
    expect(formOriginAllowed(site, { origin: 'https://elsewhere.example' })).toBe(false);
    expect(formOriginAllowed(site, { origin: 'null' })).toBe(false);
    expect(formOriginAllowed(site, { origin: 'http://imnstr.com' })).toBe(false);
    expect(formOriginAllowed(site, { secFetchSite: 'cross-site' })).toBe(false);
    expect(formOriginAllowed(site, { origin: site, secFetchSite: 'cross-site' })).toBe(false);
  });
});

describe('formatNumber', () => {
  it('writes Persian digits under /fa/, and the language’s own grouping', () => {
    expect(formatNumber(120, 'fa')).toBe('۱۲۰');
    expect(formatNumber(5000, 'fa')).toBe('۵٬۰۰۰');
    expect(formatNumber(120, 'en')).toBe('120');
    expect(formatNumber(5000, 'en')).toBe('5,000');
  });
});

describe('isolateLtr', () => {
  it('wraps a Latin value in its own left-to-right run, escaped', () => {
    expect(isolateLtr('@example')).toBe('<bdi dir="ltr">@example</bdi>');
    expect(isolateLtr('a<b>&c')).toBe('<bdi dir="ltr">a&lt;b&gt;&amp;c</bdi>');
  });
});

// The fixtures plan B3 names (PD-8): a Persian paragraph that starts with an
// English word, a URL with trailing punctuation, "Root 2.0" inside Persian,
// Persian inside English, and digits next to Latin text.
import { describe, expect, it } from 'vitest';
import { isolate, isolateRuns } from '../../lib/bidi.ts';

describe('isolate in a Persian paragraph', () => {
  it('wraps an English word that starts the paragraph', () => {
    expect(isolate('Passkeyها اگر همگام شوند', 'fa')).toBe('<bdi lang="en">Passkey</bdi>ها اگر همگام شوند');
  });

  it('keeps a multi-word English name as one run', () => {
    expect(isolate('Google Password Manager هم همین کار را می‌کند.', 'fa')).toBe(
      '<bdi lang="en">Google Password Manager</bdi> هم همین کار را می‌کند.',
    );
  });

  it('wraps a URL left to right and leaves its trailing punctuation to the sentence', () => {
    expect(isolate('ببینید https://example.org/passkeys.', 'fa')).toBe('ببینید <bdi dir="ltr">https://example.org/passkeys</bdi>.');
    expect(isolate('(https://example.org/a?b=1&c=2)،', 'fa')).toBe('(<bdi dir="ltr">https://example.org/a?b=1&amp;c=2</bdi>)،');
  });

  it('wraps "Root 2.0" whole', () => {
    expect(isolate('نسخهٔ Root 2.0 آمد', 'fa')).toBe('نسخهٔ <bdi lang="en">Root 2.0</bdi> آمد');
  });

  it('takes digits next to Latin text into the run, and leaves lone digits alone', () => {
    expect(isolate('یک iPhone 15 خرید', 'fa')).toBe('یک <bdi lang="en">iPhone 15</bdi> خرید');
    expect(isolate('سال 2026 بود', 'fa')).toBe('سال 2026 بود');
  });

  it('does not take the Persian comma into a run', () => {
    expect(isolate('Root، Tracker', 'fa')).toBe('<bdi lang="en">Root</bdi>، <bdi lang="en">Tracker</bdi>');
  });

  it('escapes text inside a run and outside it', () => {
    expect(isolate('و a&b و <', 'fa')).toBe('و <bdi lang="en">a&amp;b</bdi> و &lt;');
  });

  it('keeps a trailing + or # and a leading dot inside the name (found at B3 verify)', () => {
    expect(isolate('با C++ و C# نوشتم.', 'fa')).toBe('با <bdi lang="en">C++</bdi> و <bdi lang="en">C#</bdi> نوشتم.');
    expect(isolate('فریم‌ورک .NET و Node.js', 'fa')).toBe('فریم‌ورک <bdi lang="en">.NET</bdi> و <bdi lang="en">Node.js</bdi>');
    expect(isolate('پایان Root.', 'fa')).toBe('پایان <bdi lang="en">Root</bdi>.');
  });
});

describe('isolate in an English paragraph', () => {
  it('wraps a Persian phrase right to left, with its own punctuation', () => {
    expect(isolate('The word «سلام دنیا» means hello.', 'en')).toBe(
      'The word «<bdi lang="fa" dir="rtl">سلام دنیا</bdi>» means hello.',
    );
  });

  it('keeps a ZWNJ and Persian digits inside the run', () => {
    expect(isolate('Say می‌خواهم in ۱۴۰۵.', 'en')).toBe(
      'Say <bdi lang="fa" dir="rtl">می‌خواهم</bdi> in <bdi lang="fa" dir="rtl">۱۴۰۵</bdi>.',
    );
  });

  it('wraps a URL left to right too', () => {
    expect(isolate('See https://example.org/x, then stop.', 'en')).toBe('See <bdi dir="ltr">https://example.org/x</bdi>, then stop.');
  });

  it('leaves plain English alone', () => {
    expect(isolate('Nothing to isolate, 2.0 here.', 'en')).toBe('Nothing to isolate, 2.0 here.');
  });
});

describe('isolateRuns', () => {
  it('returns the runs in order, and they join back to the original text', () => {
    const text = 'سلام Root 2.0 و https://a.example/x. پایان';
    expect(
      isolateRuns(text, 'fa')
        .map((r) => r.text)
        .join(''),
    ).toBe(text);
  });
});

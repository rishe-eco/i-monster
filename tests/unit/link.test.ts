// What an episode link may be (B7, AC-17): the one test the server and the admin form both ask.
import { describe, expect, it } from 'vitest';
import { httpsSuggestion, isHttpsLink } from '../../shared/link.ts';

describe('isHttpsLink', () => {
  it('accepts an https address, in any case of the scheme, with a path, query and fragment', () => {
    for (const url of ['https://youtu.be/abc123', 'HTTPS://Example.com/Path?x=1#y', 'https://castbox.fm/episode/a-b_c', 'https://example.com', 'https://[::1]/x', 'https://example.com:8443/x']) {
      expect(isHttpsLink(url), url).toBe(true);
    }
  });

  it('refuses every other scheme, and text that only looks like one', () => {
    for (const url of ['http://youtu.be/abc', 'ftp://example.com', 'javascript:alert(1)', 'data:text/html,x', 'mailto:a@b.co', '//example.com', 'youtu.be/abc123', 'https:example.com', 'https:/example.com', 'https://', 'https:// example.com', '']) {
      expect(isHttpsLink(url), JSON.stringify(url)).toBe(false);
    }
  });

  it('refuses a space or a control character anywhere in it', () => {
    for (const url of ['https://example.com/a b', 'https://example.com/\u0007', 'https://example.com/\n', 'https://exa mple.com', 'https://example.com/\t']) {
      expect(isHttpsLink(url), JSON.stringify(url)).toBe(false);
    }
  });
});

describe("httpsSuggestion (the fix, written from the person's own text)", () => {
  it('puts https:// in front of what was typed', () => {
    expect(httpsSuggestion('youtu.be/abc123')).toBe('https://youtu.be/abc123');
    expect(httpsSuggestion('  youtu.be/abc123  ')).toBe('https://youtu.be/abc123');
    expect(httpsSuggestion('www.example.com/x?y=1')).toBe('https://www.example.com/x?y=1');
  });

  it('swaps another scheme for it, and drops leading slashes', () => {
    expect(httpsSuggestion('http://youtu.be/abc123')).toBe('https://youtu.be/abc123');
    expect(httpsSuggestion('ftp://example.com/x')).toBe('https://example.com/x');
    expect(httpsSuggestion('//example.com/x')).toBe('https://example.com/x');
  });

  it('gives nothing to build from when there is nothing, or a space in it', () => {
    expect(httpsSuggestion('')).toBeNull();
    expect(httpsSuggestion('   ')).toBeNull();
    expect(httpsSuggestion('my link')).toBeNull();
    expect(httpsSuggestion('http://')).toBeNull();
  });

  it('suggests an address that passes the test, for the text a person is likely to type', () => {
    for (const typed of ['youtu.be/abc123', 'http://castbox.fm/episode/1', 'open.spotify.com/episode/xyz']) {
      expect(isHttpsLink(httpsSuggestion(typed) ?? ''), typed).toBe(true);
    }
  });
});

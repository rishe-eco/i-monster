// The record's pure parsers (plan B8, PD-20). No database here.
import { describe, expect, it } from 'vitest';
import { aggregatorOf, isBot, refererDomain, subscribersOf, targetOf } from '../../lib/record.ts';

describe('targetOf: what a request is, by path alone', () => {
  it('names the landing page, the log, the podcast and the feed', () => {
    expect(targetOf('/')).toEqual({ kind: 'view', page: 'landing' });
    expect(targetOf('/log')).toEqual({ kind: 'view', page: 'log' });
    expect(targetOf('/podcast')).toEqual({ kind: 'view', page: 'podcast' });
    expect(targetOf('/log/feed.xml')).toEqual({ kind: 'feed' });
  });

  it('names an entry by its id', () => {
    expect(targetOf('/log/a000000001')).toEqual({ kind: 'view', page: 'a000000001' });
  });

  it('counts nothing else', () => {
    for (const path of ['/admin', '/admin/', '/admin/api/session', '/assets/app.css', '/healthz', '/robots.txt', '/log/nope', '/log/A000000001', '/log/a0000000011', '/anything']) {
      expect(targetOf(path), path).toBeNull();
    }
  });
});

describe('isBot', () => {
  it('skips an empty or missing agent and the usual robots and tools', () => {
    for (const ua of [undefined, '', '   ', 'Googlebot/2.1', 'curl/8.4.0', 'Wget/1.21', 'python-requests/2.31', 'Go-http-client/1.1', 'Java/17', 'okhttp/4.12', 'node-fetch/1.0', 'axios/1.6', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'HeadlessChrome/120', 'Chrome-Lighthouse', 'UptimeRobot/2.0', 'Slackbot-LinkExpanding', 'facebookexternalhit/1.1', 'Mozilla/5.0 Slurp', 'Feedly/1.0']) {
      expect(isBot(ua), String(ua)).toBe(true);
    }
  });

  it('keeps a browser', () => {
    expect(isBot('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36')).toBe(false);
    expect(isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')).toBe(false);
  });
});

// Every user agent below is a GUESS at what the aggregator sends, to be
// confirmed by real fetches once the founder has subscribed in two of them
// (plan §5 B8, trap 1).
describe('R2: feed user agents (all formats are guesses, to be confirmed by real fetches)', () => {
  const cases: [string, string, number][] = [
    // A guess.
    ['Feedly/1.0 (+http://www.feedly.com/fetcher.html; 12 subscribers; like FeedFetcher-Google)', 'Feedly', 12],
    // A guess.
    ['Mozilla/5.0 (compatible; Inoreader/1.0; +http://www.inoreader.com/feed-fetcher; 3 subscribers; )', 'Inoreader', 3],
    // A guess.
    ['NewsBlur Feed Fetcher - 5 subscribers - https://www.newsblur.com/site/123/x', 'NewsBlur', 5],
    // A guess.
    ['Feedbin feed-id:123 - 4 subscribers', 'Feedbin', 4],
    // A guess.
    ['Mozilla/5.0 (compatible; theoldreader.com; 2 subscribers; feed-id=abc)', 'The Old Reader', 2],
  ];

  it.each(cases)('reads %s', (ua, aggregator, n) => {
    expect(subscribersOf(ua)).toBe(n);
    expect(aggregatorOf(ua)).toBe(aggregator);
  });

  it('knows the other named aggregators by substring (guesses)', () => {
    expect(aggregatorOf('BazQux/2.4 (1 reader)')).toBe('BazQux');
    expect(aggregatorOf('Miniflux/2.0 (7 subscribers)')).toBe('Miniflux');
    expect(aggregatorOf('Tiny Tiny RSS/23.1 (https://tt-rss.org/; 9 subscribers)')).toBe('Tiny Tiny RSS');
  });

  it('accepts "reader" and "readers" as well as "subscriber"', () => {
    expect(subscribersOf('Thing/1.0 (1 reader)')).toBe(1);
    expect(subscribersOf('Thing/1.0 (14 readers)')).toBe(14);
    expect(subscribersOf('Thing/1.0 (1 subscriber)')).toBe(1);
  });

  it('falls back to the first product token, skipping Mozilla boilerplate, then to other', () => {
    expect(aggregatorOf('Newsie/3.1 (8 subscribers)')).toBe('Newsie');
    expect(aggregatorOf('Mozilla/5.0 (compatible; Reedr/1.0; 8 subscribers)')).toBe('Reedr');
    expect(aggregatorOf('12345 67890')).toBe('other');
    expect(aggregatorOf('')).toBe('other');
  });

  it('caps a token at 40 characters', () => {
    expect(aggregatorOf(`${'a'.repeat(100)}/1.0 (1 reader)`)).toHaveLength(40);
  });

  it('reports no count when none is there, or when it is zero or absurd', () => {
    expect(subscribersOf('Feedly/1.0')).toBeNull();
    expect(subscribersOf(undefined)).toBeNull();
    expect(subscribersOf('Thing (0 subscribers)')).toBeNull();
    expect(subscribersOf('Thing (1000000 subscribers)')).toBe(1_000_000);
    expect(subscribersOf('Thing (1000001 subscribers)')).toBeNull();
    expect(subscribersOf(`Thing (${'9'.repeat(40)} subscribers)`)).toBeNull();
  });
});

describe('R3: refererDomain', () => {
  const own = 'imnstr.com';

  it('is the lowercased host with one leading www. removed', () => {
    expect(refererDomain('https://News.Example.ORG/some/path?q=1#x', own)).toBe('news.example.org');
    expect(refererDomain('http://www.example.org/', own)).toBe('example.org');
    expect(refererDomain('https://www.www.example.org/', own)).toBe('www.example.org');
    expect(refererDomain('https://example.org./', own)).toBe('example.org');
  });

  it('skips a missing, malformed or non-http(s) Referer', () => {
    for (const r of [undefined, '', 'not a url', 'ftp://example.org/', 'android-app://com.example', 'about:blank', 'javascript:alert(1)']) {
      expect(refererDomain(r, own), String(r)).toBeNull();
    }
  });

  it('skips the site itself, with and without www', () => {
    expect(refererDomain('https://imnstr.com/log', own)).toBeNull();
    expect(refererDomain('https://www.imnstr.com/', own)).toBeNull();
    expect(refererDomain('https://IMNSTR.com/', own)).toBeNull();
    expect(refererDomain('https://blog.imnstr.com/', own)).toBe('blog.imnstr.com');
  });

  it('skips IP literals in every spelling', () => {
    for (const r of ['http://192.168.1.10/', 'https://10.0.0.1:8080/x', 'http://[::1]/', 'http://[2001:db8::1]/', 'http://2130706433/', 'http://0x7f.0.0.1/']) {
      expect(refererDomain(r, own), r).toBeNull();
    }
  });

  it('skips a host over 253 characters', () => {
    const long = `${'a'.repeat(60)}.`.repeat(5);
    expect(long.length).toBeGreaterThan(253);
    expect(refererDomain(`https://${long}com/`, own)).toBeNull();
  });
});

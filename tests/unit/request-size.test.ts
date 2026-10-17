// S-9 (plan B6): the largest request the editor can send, against the 1 MiB Nginx allows
// (`client_max_body_size 1m` in deploy/nginx/imnstr.conf, a stop file this stage does not touch).
// The body is capped at `limits.bodyMaxBytes` by the API, and markup is what inflates a body most:
// a link on every word puts an address and the mark's keys on each one. If even that stays far under
// the proxy's limit, no request the API would accept is ever refused by Nginx first.
import { describe, expect, it } from 'vitest';
import { readBody } from '../../lib/entries.ts';
import { readEpisodeInput } from '../../lib/episodes.ts';
import { limits } from '../../lib/limits.ts';
import type { Doc, Paragraph, TextNode } from '../../shared/doc.ts';

const NGINX_LIMIT = 1024 * 1024;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

/** A body of one-word links, as many as fit under the limit, in paragraphs of ten. */
function fullOfLinks(href: string): Doc {
  const paragraphs: Paragraph[] = [];
  let current: TextNode[] = [];
  const doc = (): Doc => ({ type: 'doc', content: [...paragraphs, ...(current.length ? [{ type: 'paragraph' as const, content: current }] : [])] });
  for (let n = 0; ; n++) {
    const word: TextNode = { type: 'text', text: n % 10 === 9 ? 'word' : 'word ', marks: [{ type: 'link', attrs: { href } }] };
    current.push(word);
    if (bytes(doc()) > limits.bodyMaxBytes) {
      current.pop();
      break;
    }
    if (current.length === 10) {
      paragraphs.push({ type: 'paragraph', content: current });
      current = [];
    }
  }
  return doc();
}

describe('the largest request the editor can send (S-9)', () => {
  it('stays far under Nginx\'s 1 MiB with a link on every word, and the API accepts exactly such a body', () => {
    const body = fullOfLinks('https://example.org/an-address-of-ordinary-length/with/a/path');
    expect(bytes(body)).toBeLessThanOrEqual(limits.bodyMaxBytes);
    expect(bytes(body)).toBeGreaterThan(limits.bodyMaxBytes - 200);
    expect('doc' in readBody(body)).toBe(true);
    // The request, as the editor sends it: the body, the key, the language, the title and the flag.
    const request = { publishKey: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', lang: 'fa', title: 'A title of ordinary length', body, publish: true };
    expect(bytes(request)).toBeLessThan(limits.bodyMaxBytes + 512);
    expect(bytes(request)).toBeLessThan(NGINX_LIMIT / 10);
  });

  it('is refused by the API, not by Nginx, one word over the limit', () => {
    const body = fullOfLinks('https://example.org/x');
    const over: Doc = { type: 'doc', content: [...body.content, { type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(200) }] }] };
    expect(readBody(over)).toEqual({ refusal: 'DOC_INVALID' });
    expect(bytes(over)).toBeLessThan(NGINX_LIMIT);
  });
});

// S-9 for B7: an episode's request, every field at its guard (limits.ts). Each text field is filled with
// a character that takes three bytes in UTF-8, the most a UTF-16 unit costs (an astral character costs
// two units for four bytes, and a quote or a line break costs two bytes for one unit), so this is the
// largest request the editor can send. The editor drops control characters as they arrive, so none
// is counted here: the API strips them, and a body full of them is only ever Nginx's to refuse.
describe('the largest episode request the form can send (S-9)', () => {
  const wide = (n: number) => '€'.repeat(n);
  const lead = 'https://example.com/';
  const largest = () => ({
    publishKey: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    lang: 'fa',
    name: wide(limits.episodeNameMaxChars),
    description: wide(limits.episodeDescriptionMaxChars),
    tags: [wide(limits.episodeTagMaxChars), wide(limits.episodeTagMaxChars)],
    date: '2026-10-10',
    links: Array.from({ length: limits.episodeLinksMax }, () => ({
      label: wide(limits.episodeLinkLabelMaxChars),
      url: lead + wide(limits.episodeLinkUrlMaxChars - lead.length),
    })),
    publish: true,
  });

  it('is accepted by the API reader, and stays far under the 1 MiB Nginx allows', () => {
    const request = largest();
    const read = readEpisodeInput(request);
    expect('input' in read, JSON.stringify('refusal' in read ? read.refusal : '')).toBe(true);
    if ('input' in read) {
      expect(read.input.links).toHaveLength(limits.episodeLinksMax);
      expect(read.input.name).toHaveLength(limits.episodeNameMaxChars);
      expect(read.input.description).toHaveLength(limits.episodeDescriptionMaxChars);
    }
    expect(bytes(request)).toBeLessThan(NGINX_LIMIT / 5);
    // The size, pinned, so a guard raised later fails here and the number gets read again: 53,200 units at three bytes, the 20 ASCII address prefixes, and the keys.
    expect(bytes(request)).toBe(159_392);
  });

  it('is refused by the API, not by Nginx, a link over the count', () => {
    const request = largest();
    request.links.push({ label: 'one more', url: 'https://example.com/x' });
    expect(readEpisodeInput(request)).toEqual({ refusal: 'REQUEST_INVALID' });
    expect(bytes(request)).toBeLessThan(NGINX_LIMIT);
  });
});

import { describe, expect, it } from 'vitest';
import { renderDoc, renderParagraphs } from '../../lib/render.ts';
import { docFromText, type Doc } from '../../shared/doc.ts';

describe('renderDoc (PD-7)', () => {
  it('writes paragraphs, links and <mark>, escaping all text', () => {
    const doc = docFromText('A <script> & ==lit== [go](https://a.example/?x=1&y=2).\n\nSecond.');
    expect(renderDoc(doc, 'en')).toBe(
      '<p>A &lt;script&gt; &amp; <mark>lit</mark> <a href="https://a.example/?x=1&amp;y=2" rel="noopener">go</a>.</p><p>Second.</p>',
    );
  });

  it('gives an https link rel="noopener" and a mailto: link none', () => {
    const html = renderDoc(docFromText('[a](https://a.example) [b](mailto:b@a.example)'), 'en');
    expect(html).toContain('<a href="https://a.example" rel="noopener">a</a>');
    expect(html).toContain('<a href="mailto:b@a.example">b</a>');
  });

  it('nests a highlighted link as <a><mark>', () => {
    const doc: Doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'x', marks: [{ type: 'highlight' }, { type: 'link', attrs: { href: 'https://a.example' } }] }],
        },
      ],
    };
    expect(renderDoc(doc, 'en')).toBe('<p><a href="https://a.example" rel="noopener"><mark>x</mark></a></p>');
  });

  it('isolates by the entry language (AC-48)', () => {
    const doc = docFromText('Passkeyها همگام می‌شوند. https://example.org/passkeys');
    expect(renderDoc(doc, 'fa')).toBe(
      '<p><bdi lang="en">Passkey</bdi>ها همگام می‌شوند. <bdi dir="ltr">https://example.org/passkeys</bdi></p>',
    );
  });

  it('gives each paragraph on its own', () => {
    expect(renderParagraphs(docFromText('a\n\nb'), 'en')).toEqual(['a', 'b']);
  });
});

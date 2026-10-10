import { describe, expect, it } from 'vitest';
import { siteEn } from '../../content/site.en.ts';
import { siteFa } from '../../content/site.fa.ts';
import type { SiteContent } from '../../content/site.ts';

const contents: [string, SiteContent][] = [
  ['en', siteEn],
  ['fa', siteFa],
];

describe.each(contents)('site content (%s)', (_name, content) => {
  const links = [
    ...content.projects.flatMap((project) => (project.url ? [project.url] : [])),
    ...content.show.links.map((link) => link.url),
  ];

  it('has every link on https', () => {
    expect(links.length).toBeGreaterThan(0);
    for (const url of links) {
      expect(url).toMatch(/^https:\/\//);
      expect(() => new URL(url)).not.toThrow();
    }
  });

  it('says who this is, with at least one highlighted phrase', () => {
    expect(content.who.map((segment) => segment.text).join('').trim()).not.toBe('');
    expect(content.who.some((segment) => segment.mark)).toBe(true);
  });

  it('lists projects with a name and a line each', () => {
    expect(content.projects.length).toBeGreaterThan(0);
    for (const project of content.projects) {
      expect(project.name.trim()).not.toBe('');
      expect(project.line.trim()).not.toBe('');
    }
  });

  it('names its show and gives it a link', () => {
    expect(content.show.name.trim()).not.toBe('');
    expect(content.show.links.length).toBeGreaterThan(0);
    for (const link of content.show.links) expect(link.label.trim()).not.toBe('');
  });
});

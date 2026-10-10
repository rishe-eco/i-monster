import type { SiteContent } from './site.ts';

// PLACEHOLDER (P0-6): the copy, the project links and the show links are
// stand-ins from the design, not final. The founder supplies the real ones.
export const siteEn: SiteContent = {
  who: [
    { text: 'I make things so I can ' },
    { text: 'understand them', mark: true },
    { text: '. Right now that’s Root and Tracker. Then I ' },
    { text: 'write down what I learned', mark: true },
    { text: ', before I forget it.' },
  ],
  projects: [
    {
      name: 'Root',
      line: 'A small ecosystem of tools for learning and organising a life.',
      url: 'https://example.com/root',
    },
    {
      name: 'Tracker',
      line: 'Where Root’s ideas get tried on me first.',
    },
    {
      name: 'Root Studio',
      line: 'Root’s website, built as an app. Persian first.',
      url: 'https://example.com/root-studio',
    },
  ],
  show: {
    name: 'Monster Podcast',
    links: [
      { label: 'YouTube', url: 'https://example.com/monster-podcast/youtube' },
      { label: 'Castbox', url: 'https://example.com/monster-podcast/castbox' },
    ],
  },
};

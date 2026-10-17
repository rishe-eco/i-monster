import type { Strings } from './strings.ts';

export const en: Strings = {
  owner: 'iMNSTR',
  siteTitle: 'iMNSTR',
  nav: {
    label: 'Main',
    footerLabel: 'Footer',
    learnings: 'Learnings',
    podcast: 'Podcast',
    feed: 'Feed',
  },
  feedTitle: 'iMNSTR — Learnings',
  landing: {
    description: 'iMNSTR makes things to understand them, then writes down what it learned.',
    learningsTitle: 'Learnings',
    learningsLine: 'things I figured out, newest on top',
    podcastTitle: 'Monster Podcast',
    podcastLine: 'I talk with people, you listen',
    buildingHeading: 'Things I’m building',
  },
  notFound: {
    title: 'Something ate this page.',
    body: 'Maybe it never existed. Maybe it did. Either way, it isn’t here now.',
    readLearnings: 'Read the learnings',
    podcast: 'Monster Podcast',
    goHome: 'Go home',
    ownerLine: 'This is {owner}’s site. No cookies here. The monster ate them.',
  },
  log: {
    title: 'Learnings',
    lede: 'Things I figured out. Newest on top.',
    description: 'Things iMNSTR figured out, newest on top.',
    older: 'Older entries',
    empty: 'Nothing published here at the moment.',
    emptyMeanwhile: 'Meanwhile, there’s {who} and the {podcast}.',
    whoLink: 'who I am',
    podcastLink: 'Monster Podcast',
  },
  podcast: {
    lede: 'I talk with people about making things and learning out loud.',
    description: 'Monster Podcast: iMNSTR talks with people about making things and learning out loud.',
    showOn: 'The show on {platform}',
    older: 'Older episodes',
    empty: 'Episodes will be listed here, with links to listen.',
    tagSeparator: ', ',
  },
  entry: {
    more: 'More learnings',
    writtenBy: 'Written by {owner}, who also makes the {podcast}.',
    podcastLink: 'Monster Podcast',
  },
  footer: {
    noCookies: 'No cookies here. The monster ate them.',
  },
};

// The Atom feed, built by hand with every value escaped (PD-24; no XML
// dependency). One feed per language, the most recent entries in full.
import { now } from './clock.ts';
import { feedDate, formatFeedTitleDate } from './dates.ts';
import { escapeHtml } from './escape.ts';
import type { PublicEntry } from './entries.ts';
import { localePath, strings, type Lang } from './i18n.ts';
import { renderDoc } from './render.ts';
import { SITE_ORIGIN } from './switch.ts';

/** An entry's feed title: its own, or its date written in full (AC-40). */
export function feedTitle(entry: PublicEntry): string {
  return entry.title ?? formatFeedTitleDate(entry.firstPublishedAt, entry.lang);
}

export function buildFeed(lang: Lang, entries: PublicEntry[]): string {
  const t = strings(lang);
  const self = SITE_ORIGIN + localePath(lang, '/log/feed.xml');
  const home = SITE_ORIGIN + localePath(lang, '/log');
  // The feed's own date is its newest entry's (PD-24). An empty feed has no
  // entry to take it from, so it takes the clock.
  const updated = feedDate(entries.length ? Math.max(...entries.map((e) => e.updatedAt)) : now());

  const items = entries.map((entry) => {
    const link = `${SITE_ORIGIN}${localePath(lang, `/log/${entry.id}`)}`;
    // <bdi> is honoured by some readers and stripped by others; the dir wrapper is the floor (plan B3, traps).
    const body = renderDoc(entry.doc, lang);
    const html = lang === 'fa' ? `<div dir="rtl">${body}</div>` : body;
    return [
      '  <entry>',
      `    <id>tag:imnstr.com,2026:entry/${entry.id}</id>`,
      `    <title>${escapeHtml(feedTitle(entry))}</title>`,
      `    <link rel="alternate" type="text/html" href="${escapeHtml(link)}"/>`,
      `    <published>${feedDate(entry.firstPublishedAt)}</published>`,
      `    <updated>${feedDate(entry.updatedAt)}</updated>`,
      `    <content type="html">${escapeHtml(html)}</content>`,
      '  </entry>',
    ].join('\n');
  });

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${lang}">`,
    `  <id>tag:imnstr.com,2026:log/${lang}</id>`,
    `  <title>${escapeHtml(t.feedTitle)}</title>`,
    `  <link rel="self" type="application/atom+xml" href="${escapeHtml(self)}"/>`,
    `  <link rel="alternate" type="text/html" href="${escapeHtml(home)}"/>`,
    `  <updated>${updated}</updated>`,
    `  <author><name>${escapeHtml(t.owner)}</name></author>`,
    ...items,
    '</feed>',
    '',
  ].join('\n');
}

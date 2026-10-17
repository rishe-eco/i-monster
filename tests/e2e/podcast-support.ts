// Seeding the podcast through the e2e-only route (`/__test/episodes`), for the public and the admin specs.
import { expect, type APIRequestContext } from '@playwright/test';
import { DAY, NOW, type Lang } from './support.ts';

export interface SeedEpisode {
  lang: Lang;
  name?: string;
  description?: string;
  tags?: string[];
  /** YYYY-MM-DD. */
  date?: string;
  links?: { label: string; url: string }[];
  /** "published" unless it says "draft"; a draft with a firstPublishedAt is one that was live (AC-14). */
  state?: 'draft' | 'published';
  firstPublishedAt?: number | null;
  id?: string;
}

/** Text in the episode's own language, so nothing needs isolating unless a test says so. */
export const sampleName = (lang: Lang, n: number): string => (lang === 'fa' ? `قسمت شماره ${n}` : `Episode number ${n}`);

/** The day `n` days before the fixed clock, as YYYY-MM-DD (the clock is at noon UTC, so UTC and Tehran agree). */
export const dayBefore = (n: number): string => new Date(NOW - n * DAY).toISOString().slice(0, 10);

/** `count` plain episodes of one language, newest first, a day apart, each with one YouTube link. */
export function plainEpisodes(lang: Lang, count: number): SeedEpisode[] {
  return Array.from({ length: count }, (_, i) => ({
    lang,
    name: sampleName(lang, i + 1),
    description: lang === 'fa' ? `توضیح قسمت ${i + 1}.` : `What episode ${i + 1} is about.`,
    tags: [lang === 'fa' ? 'ساختن' : 'making'],
    date: dayBefore(i + 1),
    links: [{ label: 'YouTube', url: `https://youtu.be/ep${i + 1}` }],
  }));
}

/** Fix the clock, empty the episode table, and insert `episodes`. Returns their ids in order. */
export async function resetPodcast(request: APIRequestContext, episodes: SeedEpisode[] = []): Promise<string[]> {
  expect((await request.post('/__test/clock', { data: { now: NOW } })).ok()).toBe(true);
  expect((await request.delete('/__test/episodes')).ok()).toBe(true);
  if (episodes.length === 0) return [];
  const res = await request.post('/__test/episodes', { data: { episodes } });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { ids: string[] }).ids;
}

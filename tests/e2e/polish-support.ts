// What the two PL1 admin specs share (`polish.spec.ts`: notices and link captions; `polish-rules.spec.ts`: the
// offers' names, the language and the date). The entry and the episode a test works on come in both languages.
import { expect, type Locator, type Page } from '@playwright/test';
import { resetAdmin } from './admin-support.ts';
import type { SeedEpisode } from './podcast-support.ts';
import { DAY, NOW, type Lang } from './support.ts';

export const LANGS: Lang[] = ['en', 'fa'];

export const WORDS: Record<Lang, { title: string; text: string; more: string }> = {
  en: { title: 'An old entry', text: 'Broken link here, see the paper.', more: ' Fixed.' },
  fa: { title: 'نوشتهٔ قدیمی', text: 'پیوند خراب است، مقاله را ببینید.', more: ' درست شد.' },
};

export const language = (lang: Lang): string => (lang === 'fa' ? 'Persian' : 'English');

// ── Entries ──

export const body = (page: Page) => page.getByRole('textbox', { name: 'Entry text' });

export async function write(page: Page, text: string): Promise<void> {
  await body(page).click();
  await page.keyboard.type(text);
}

export async function openEntries(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Entries', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

export async function seedEntry(request: Parameters<typeof resetAdmin>[0], lang: Lang, extra: Record<string, unknown> = {}): Promise<string> {
  const id = 'a000000010';
  const entry: Record<string, unknown> = { id, lang, title: WORDS[lang].title, text: WORDS[lang].text, firstPublishedAt: NOW - 2 * DAY, ...extra };
  // A draft that was never published has no first date at all: the route takes it absent, not null.
  if (entry['firstPublishedAt'] === null) delete entry['firstPublishedAt'];
  const res = await request.post('/__test/entries', { data: { entries: [entry] } });
  expect(res.ok()).toBe(true);
  return id;
}

/** Open an entry's frame: the list names a Persian one in «», which the button's name carries. */
export async function openEntry(page: Page, lang: Lang): Promise<Locator> {
  await openEntries(page);
  await page.getByRole('button', { name: `Edit ${WORDS[lang].title}` }).click();
  await expect(page.locator('.frame .frame__status')).toContainText(/Editing|Draft/);
  return page.locator('.frame');
}

// ── Episodes ──

export const section = (page: Page) => page.locator('#podcast-body');

export async function openPodcast(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Podcast', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

export const episode = (lang: Lang, extra: Partial<SeedEpisode> = {}): SeedEpisode => ({
  lang,
  name: lang === 'fa' ? 'ساختن در جمع' : 'Building in public',
  description: lang === 'fa' ? 'چه چیزی پروژه را زنده نگه می‌دارد.' : 'What keeps a project going.',
  tags: [lang === 'fa' ? 'ساختن' : 'making'],
  date: '2026-10-03',
  links: [{ label: 'YouTube', url: 'https://youtu.be/q81abc' }],
  firstPublishedAt: NOW - 7 * DAY,
  ...extra,
});

export async function openEpisode(page: Page, lang: Lang): Promise<Locator> {
  await openPodcast(page);
  await section(page).getByRole('button', { name: `Edit ${episode(lang).name}` }).click();
  await expect(section(page).locator('.frame .frame__status')).toContainText(/Editing|Draft/);
  return section(page).locator('.frame');
}

export async function chooseLanguage(page: Page, lang: Lang, within: Page | Locator = page): Promise<void> {
  await within.getByRole('radio', { name: lang === 'fa' ? 'فارسی' : 'English' }).check();
}

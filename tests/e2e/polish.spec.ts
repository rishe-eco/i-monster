// The live-review polish in the admin (change note 05, PL1): the episode form's link captions (PL-5) and the
// one place success notices go, directly above the actions (PL-11). The rest of PL1 is proved where its file's
// other tests already live; these two are new behaviour with no home yet. Every test runs in both colour
// schemes, and loops the language of the entry or episode it works on (house rule 8; the admin itself is English).
import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetAdmin, signedInAdmin } from './admin-support.ts';
import { resetPodcast, type SeedEpisode } from './podcast-support.ts';
import { DAY, NOW, expectNoSidewaysScroll, type Lang } from './support.ts';

test.beforeEach(async ({ request }) => {
  await resetAdmin(request, NOW);
});

const LANGS: Lang[] = ['en', 'fa'];
const WORDS: Record<Lang, { title: string; text: string; more: string }> = {
  en: { title: 'An old entry', text: 'Broken link here, see the paper.', more: ' Fixed.' },
  fa: { title: 'نوشتهٔ قدیمی', text: 'پیوند خراب است، مقاله را ببینید.', more: ' درست شد.' },
};

// ── Entries ──

const body = (page: Page) => page.getByRole('textbox', { name: 'Entry text' });

async function write(page: Page, text: string): Promise<void> {
  await body(page).click();
  await page.keyboard.type(text);
}

async function openEntries(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Entries', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

async function seedEntry(request: Parameters<typeof resetAdmin>[0], lang: Lang, extra: Record<string, unknown> = {}): Promise<string> {
  const id = 'a000000010';
  const entry: Record<string, unknown> = { id, lang, title: WORDS[lang].title, text: WORDS[lang].text, firstPublishedAt: NOW - 2 * DAY, ...extra };
  // A draft that was never published has no first date at all: the route takes it absent, not null.
  if (entry['firstPublishedAt'] === null) delete entry['firstPublishedAt'];
  const res = await request.post('/__test/entries', { data: { entries: [entry] } });
  expect(res.ok()).toBe(true);
  return id;
}

/** Open an entry's frame: the list names a Persian one in «», which the button's name carries. */
async function openEntry(page: Page, lang: Lang): Promise<Locator> {
  await openEntries(page);
  await page.getByRole('button', { name: `Edit ${WORDS[lang].title}` }).click();
  await expect(page.locator('.frame .frame__status')).toContainText(/Editing|Draft/);
  return page.locator('.frame');
}

/**
 * What a write said sits directly above the actions, in the place a failure takes, and is the only notice there
 * (PL-11). The viewport is 360 x 400, the phone with its keyboard up, so "in view" is real: the dock is sticky.
 */
async function expectSaidAbove(page: Page, actions: Locator, said: string | RegExp): Promise<void> {
  const notice = actions.locator('xpath=preceding-sibling::*[1]');
  await expect(notice).toContainText(said);
  await expect(notice).toHaveClass(/notice--success/);
  await expect(actions.locator('xpath=..').locator('.notice')).toHaveCount(1);
  await expect(page.locator('.dock .notice--error')).toHaveCount(0);
  const box = await notice.boundingBox();
  const size = page.viewportSize() ?? { width: 360, height: 400 };
  expect(box, 'the notice has a box').not.toBeNull();
  expect(box?.y ?? -1, 'the notice is below the top of the screen').toBeGreaterThanOrEqual(0);
  expect((box?.y ?? 0) + (box?.height ?? 0), 'the notice is above the bottom of the screen').toBeLessThanOrEqual(size.height);
  expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= size.width).toBe(true);
}

test('a new entry: Draft saved and Published say so directly above the actions, never beside a failure (PL-11)', async ({ browser, baseURL, request }) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await page.setViewportSize({ width: 360, height: 400 });
  const actions = page.locator('.composer__actions');
  await write(page, 'A first line.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expectSaidAbove(page, actions, 'Draft saved.');
  // A failure takes the place and the success goes; a success after it takes the place back.
  await admin.context.setOffline(true);
  await page.getByRole('button', { name: /^Publish/ }).click();
  await expect(page.locator('.dock .notice--error')).toHaveCount(1);
  await expect(page.locator('.dock .notice--success')).toHaveCount(0);
  await admin.context.setOffline(false);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expectSaidAbove(page, actions, "Published. It's out there.");
  await expect(page.getByRole('link', { name: 'Open' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();
  // With that long notice in the dock and the keyboard up, the editor still keeps two lines in view (the note's F5 trap).
  const room = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>('.editor__body');
    const dock = document.querySelector<HTMLElement>('.dock');
    if (!editor || !dock) throw new Error('no editor or dock');
    // What is left of the screen above the dock is where the lines being typed scroll to: the editor scrolls the caret's line above the dock.
    return { visible: window.innerHeight - dock.getBoundingClientRect().height, line: parseFloat(getComputedStyle(editor).lineHeight) };
  });
  expect(room.visible, 'the screen above the dock holds two lines of the editor').toBeGreaterThanOrEqual(room.line * 2);
  // The next keystroke clears it, as it always did.
  await write(page, 'x');
  await expect(page.locator('.dock .notice--success')).toHaveCount(0);
  await expectNoSidewaysScroll(page, 360);
  admin.problems.splice(0, admin.problems.length, ...admin.problems.filter((message) => !/ERR_INTERNET_DISCONNECTED/.test(message)));
  expect(admin.problems).toEqual([]);
});

for (const lang of LANGS) {
  test(`an entry's frame: Saved, Unpublished and Published say so directly above the actions, in ${lang === 'fa' ? 'Persian' : 'English'} (PL-11)`, async ({ browser, baseURL, request }) => {
    await seedEntry(request, lang);
    const { page } = await signedInAdmin(browser, baseURL as string, request);
    await page.setViewportSize({ width: 360, height: 400 });
    const frame = await openEntry(page, lang);
    const actions = frame.locator('.composer__actions');
    await body(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(WORDS[lang].more);
    await frame.getByRole('button', { name: 'Save', exact: true }).click();
    await expectSaidAbove(page, actions, 'Saved.');
    await frame.getByRole('button', { name: 'Unpublish' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Unpublish' }).click();
    await expectSaidAbove(page, actions, 'Unpublished.');
    await frame.getByRole('button', { name: 'Publish', exact: true }).click();
    await expectSaidAbove(page, actions, 'Published, at');
    await expect(frame.getByRole('link', { name: 'Open' })).toBeVisible();
  });

  test(`a draft's frame: Draft saved and Published say so directly above the actions, in ${lang === 'fa' ? 'Persian' : 'English'} (PL-11)`, async ({ browser, baseURL, request }) => {
    await seedEntry(request, lang, { state: 'draft', firstPublishedAt: null });
    const { page } = await signedInAdmin(browser, baseURL as string, request);
    await page.setViewportSize({ width: 360, height: 400 });
    const frame = await openEntry(page, lang);
    const actions = frame.locator('.composer__actions');
    await frame.getByRole('button', { name: 'Save draft' }).click();
    await expectSaidAbove(page, actions, 'Draft saved.');
    await frame.getByRole('button', { name: 'Publish', exact: true }).click();
    await expectSaidAbove(page, actions, "Published. It's out there.");
  });
}

test('an edit closed by Save says so in the composer it returns to, directly above its actions (PL-11)', async ({ browser, baseURL, request }) => {
  await seedEntry(request, 'en');
  const { page } = await signedInAdmin(browser, baseURL as string, request);
  await page.setViewportSize({ width: 360, height: 400 });
  await write(page, 'Not sent yet.');
  const frame = await openEntry(page, 'en');
  await body(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Fixed.');
  await frame.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.frame')).toHaveCount(0);
  await expectSaidAbove(page, page.locator('.composer__actions'), 'Saved.');
});

// ── Episodes ──

const section = (page: Page) => page.locator('#podcast-body');

async function openPodcast(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Podcast', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

const episode = (lang: Lang, extra: Partial<SeedEpisode> = {}): SeedEpisode => ({
  lang,
  name: lang === 'fa' ? 'ساختن در جمع' : 'Building in public',
  description: lang === 'fa' ? 'چه چیزی پروژه را زنده نگه می‌دارد.' : 'What keeps a project going.',
  tags: [lang === 'fa' ? 'ساختن' : 'making'],
  date: '2026-10-03',
  links: [{ label: 'YouTube', url: 'https://youtu.be/q81abc' }],
  firstPublishedAt: NOW - 7 * DAY,
  ...extra,
});

async function openEpisode(page: Page, lang: Lang): Promise<Locator> {
  await openPodcast(page);
  await section(page).getByRole('button', { name: `Edit ${episode(lang).name}` }).click();
  await expect(section(page).locator('.frame .frame__status')).toContainText(/Editing|Draft/);
  return section(page).locator('.frame');
}

for (const lang of LANGS) {
  test(`an episode's frame: Saved, Unpublished and Published say so directly above the actions, in ${lang === 'fa' ? 'Persian' : 'English'} (PL-11)`, async ({ browser, baseURL, request }) => {
    await resetPodcast(request, [episode(lang)]);
    const { page } = await signedInAdmin(browser, baseURL as string, request);
    await page.setViewportSize({ width: 360, height: 400 });
    const frame = await openEpisode(page, lang);
    const actions = frame.locator('.composer__actions');
    await frame.getByLabel('Description', { exact: true }).fill('Changed.');
    await frame.getByRole('button', { name: 'Save', exact: true }).click();
    await expectSaidAbove(page, actions, 'Saved.');
    await frame.getByRole('button', { name: 'Unpublish', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Unpublish' }).click();
    await expectSaidAbove(page, actions, 'Unpublished.');
    await frame.getByRole('button', { name: /^Publish/ }).click();
    await expectSaidAbove(page, actions, /Published|Back/);
  });

  test(`a new episode, saved or published, says so directly above New episode, in ${lang === 'fa' ? 'Persian' : 'English'} (PL-11)`, async ({ browser, baseURL, request }) => {
    await resetPodcast(request, []);
    const { page } = await signedInAdmin(browser, baseURL as string, request);
    await page.setViewportSize({ width: 360, height: 400 });
    await openPodcast(page);
    const newEpisode = section(page).getByRole('button', { name: 'New episode', exact: true });
    const fill = async () => {
      await newEpisode.click();
      if (lang === 'fa') await section(page).getByRole('radio', { name: 'فارسی' }).check();
      await section(page).getByLabel('Name', { exact: true }).fill(episode(lang).name ?? '');
      await section(page).getByLabel('Description', { exact: true }).fill(episode(lang).description ?? '');
      await section(page).getByLabel('Tag', { exact: true }).fill(episode(lang).tags?.[0] ?? '');
      await section(page).getByRole('button', { name: 'YouTube', exact: true }).click();
      await section(page).getByLabel('Address', { exact: true }).fill('https://youtu.be/q81abc');
    };
    await fill();
    await section(page).getByRole('button', { name: 'Save draft' }).click();
    await expectSaidAbove(page, newEpisode, 'Draft saved.');
    await fill();
    await section(page).getByRole('button', { name: /^Publish/ }).click();
    await expectSaidAbove(page, newEpisode, "Published. It's on the podcast page.");
  });
}

// ── The episode form's link captions (PL-5) ──

for (const lang of LANGS) {
  test(`one link has no caption of its own, and two or more are Link 1, Link 2, in ${lang === 'fa' ? 'Persian' : 'English'} (PL-5)`, async ({ browser, baseURL, request }) => {
    await resetPodcast(request, []);
    const { page } = await signedInAdmin(browser, baseURL as string, request);
    await openPodcast(page);
    await section(page).getByRole('button', { name: 'New episode', exact: true }).click();
    if (lang === 'fa') await section(page).getByRole('radio', { name: 'فارسی' }).check();
    const links = section(page).locator('fieldset.links');
    // With one link: the legend, the label and the address, and no "Link" over them.
    await expect(links.locator('legend')).toHaveText('Links');
    await expect(links.getByText('Link', { exact: true })).toHaveCount(0);
    await expect(links.locator('.linkrow__head')).toHaveCount(0);
    await section(page).getByRole('button', { name: 'YouTube', exact: true }).click();
    await section(page).getByRole('button', { name: '+ Another link', exact: true }).click();
    await section(page).getByLabel('Label', { exact: true }).nth(1).fill('Castbox');
    await expect(links.locator('.linkrow__head .field__label')).toHaveText(['Link 1', 'Link 2']);
    // Each Remove keeps its name, from the link's own label.
    await expect(links.getByRole('button', { name: 'Remove YouTube' })).toBeVisible();
    await expect(links.getByRole('button', { name: 'Remove Castbox' })).toBeVisible();
    for (const width of [360, 180]) {
      await expectNoSidewaysScroll(page, width);
    }
    await page.setViewportSize({ width: 360, height: 800 });
    // Back to one: the caption goes again.
    await links.getByRole('button', { name: 'Remove Castbox' }).click();
    await expect(links.locator('.linkrow__head')).toHaveCount(0);
  });
}

// The entries list and the edit view's frame in a real browser (plan B5, plate 8): the list's
// states, the year rule around 1 January in Tehran, "Older", Edit, the unpublish confirm and
// the republish notice. Every test runs in both colour schemes at 360 px (spec §4.6, AC-32).
import { expect, test, type Page } from '@playwright/test';
import { signedInAdmin, resetAdmin, type Admin } from './admin-support.ts';
import { DAY, MIXED, NOW, expectColourScheme, expectNoSidewaysScroll, expectNoThirdParty, type Lang } from './support.ts';

const MINUTE = 60_000;

test.beforeEach(async ({ request }) => {
  await resetAdmin(request, NOW);
});

interface Seed {
  id: string;
  lang: Lang;
  title?: string;
  text: string;
  state?: 'draft' | 'published';
  firstPublishedAt?: number;
  createdAt?: number;
}

const seed = async (request: Parameters<typeof resetAdmin>[0], entries: Seed[]) => {
  const res = await request.post('/__test/entries', { data: { entries } });
  expect(res.ok()).toBe(true);
};

const entriesToggle = (page: Page) => page.getByRole('button', { name: 'Entries', exact: true });
const rows = (page: Page) => page.locator('.entry-row');

async function openEntries(page: Page): Promise<void> {
  if ((await entriesToggle(page).getAttribute('aria-expanded')) !== 'true') await entriesToggle(page).click();
  await expect(entriesToggle(page)).toHaveAttribute('aria-expanded', 'true');
}

/** Close the list and open it again, which reads it again: the clock may have moved. */
async function reopenEntries(page: Page): Promise<void> {
  await entriesToggle(page).click();
  await entriesToggle(page).click();
}

/** What a row shows, as the plate draws it: the date, the name, and its pills. */
async function rowAt(page: Page, index: number) {
  const row = rows(page).nth(index);
  return {
    date: await row.locator('.entry-row__date').innerText(),
    name: await row.locator('.entry-row__name').innerText(),
    pills: await row.locator('.pill').allInnerTexts(),
  };
}

/** What every view must hold at 360 px, in the scheme under test. */
async function expectFits(admin: Admin, info: Parameters<typeof expectColourScheme>[1]): Promise<void> {
  await expectNoSidewaysScroll(admin.page);
  await expectColourScheme(admin.page, info);
  await expectNoThirdParty(admin.page, admin.requests);
  expect(admin.problems).toEqual([]);
}

test('the shell is in W1 order, and the list is collapsed and asks for nothing until it is opened', async ({ browser, baseURL, request }, info) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await expect(entriesToggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#entries-body')).toBeHidden();
  // The editor slot is empty until Edit; then Entries, then Passkeys (the Podcast slot, B7, draws nothing yet), then Sign out.
  expect(await page.locator('h2 .disclosure > span:first-child').allInnerTexts()).toEqual(['Entries', 'Passkeys']);
  expect(admin.requests.filter((url) => url.includes('/admin/api/entries'))).toEqual([]);
  await openEntries(page);
  await expect(page.getByText('Entries you write will be listed here.')).toBeVisible();
  expect(admin.requests.filter((url) => url.includes('/admin/api/entries'))).toHaveLength(1);
  // Entries sits above Passkeys, and Sign out is last.
  const follows = await page.evaluate(() => {
    const entries = document.querySelector('#entries-body');
    const passkeys = document.querySelector('#passkeys-body');
    return Boolean(entries && passkeys && entries.compareDocumentPosition(passkeys) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(follows).toBe(true);
  await expect(page.locator('main > :last-child')).toContainText('Sign out');
  await expectFits(admin, info);
});

test('the empty list says so in words and counts nothing (AC-42, W2)', async ({ browser, baseURL, request }, info) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  await openEntries(admin.page);
  await expect(rows(admin.page)).toHaveCount(0);
  await expect(admin.page.locator('#entries-body')).toHaveText('Entries you write will be listed here.');
  await expectFits(admin, info);
});

test('the list draws every state as plate 8 does: date, name, pills, Edit (J2.6, AC-14, AC-31, AC-42)', async ({ browser, baseURL, request }, info) => {
  await seed(request, [
    { id: 'a000000001', lang: 'en', title: 'Two passkeys can be one key', text: 'Body one.', firstPublishedAt: NOW - 2 * DAY },
    { id: 'a000000002', lang: 'fa', title: 'دو کلید، یک کلید', text: 'متن.', firstPublishedAt: NOW - 3 * DAY },
    { id: 'a000000003', lang: 'en', text: 'A blank page with a good question about how we learn.', firstPublishedAt: NOW - 4 * DAY },
    { id: 'a000000004', lang: 'en', title: 'Counting', text: 'Was here.', state: 'draft', firstPublishedAt: NOW - 5 * DAY, createdAt: NOW - 40 * DAY },
    { id: 'a000000005', lang: 'en', text: 'Half a thought about nothing in particular', state: 'draft', createdAt: NOW - 6 * DAY },
    { id: 'a000000006', lang: 'en', text: 'Notes are not learning.', firstPublishedAt: Date.UTC(2025, 11, 14, 12) },
  ]);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openEntries(page);
  await expect(rows(page)).toHaveCount(6);

  expect(await rowAt(page, 0)).toEqual({ date: '8 Oct', name: 'Two passkeys can be one key', pills: [] });
  expect(await rowAt(page, 1)).toEqual({ date: '7 Oct', name: 'دو کلید، یک کلید', pills: ['Persian'] });
  // An untitled entry is its opening words, in quotes.
  expect(await rowAt(page, 2)).toEqual({ date: '6 Oct', name: '“A blank page with a good question about how we learn.”', pills: [] });
  // A draft that was live keeps its date and says so; a never-published draft has "—".
  expect(await rowAt(page, 3)).toEqual({ date: '5 Oct', name: 'Counting', pills: ['was live'] });
  expect(await rowAt(page, 4)).toEqual({ date: '—', name: '“Half a thought about nothing in particular”', pills: ['draft'] });
  // Another year shows its year.
  expect(await rowAt(page, 5)).toEqual({ date: '14 Dec 2025', name: '“Notes are not learning.”', pills: [] });

  // The Persian row is Persian and reads right to left; the others do not.
  const fa = rows(page).nth(1).locator('.entry-row__name');
  await expect(fa).toHaveAttribute('dir', 'rtl');
  await expect(fa).toHaveAttribute('lang', 'fa');
  await expect(rows(page).nth(0).locator('.entry-row__name')).toHaveAttribute('dir', 'ltr');
  // The pills: draft and was-live are dashed, Persian is solid.
  const style = (row: number, pill: number) => rows(page).nth(row).locator('.pill').nth(pill).evaluate((el) => getComputedStyle(el).borderTopStyle);
  expect(await style(1, 0)).toBe('solid');
  expect(await style(3, 0)).toBe('dashed');
  expect(await style(4, 0)).toBe('dashed');

  // Nothing counts: no total, no "n of m", no number beside the section's name.
  await expect(entriesToggle(page)).toHaveText(/^Entries\s*−$/);
  const text = await page.locator('#entries-body').innerText();
  expect(text).not.toMatch(/\b\d+\s+(entries|drafts|of|total)\b|\bof \d+\b|\btotal\b/i);

  // Every Edit is a labelled 44 px target.
  for (const edit of await page.locator('.entry-row .text-btn').all()) {
    const box = await edit.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(43.5);
    expect(await edit.getAttribute('aria-label')).toMatch(/^Edit \S/);
  }
  await expectFits(admin, info);
  // No row is wider than the phone, however long its name: the name cuts with an ellipsis.
  for (const row of await rows(page).all()) {
    expect((await row.boundingBox())?.width ?? 0).toBeLessThanOrEqual(360);
  }
});

test('a Persian draft that was live carries both its pills at 360 px without pushing the row wider', async ({ browser, baseURL, request }, info) => {
  await seed(request, [
    { id: 'a000000001', lang: 'fa', title: 'یک عنوان بسیار بلند که باید در یک خط بریده شود و هرگز ردیف را پهن نکند', text: 'متن.', state: 'draft', firstPublishedAt: NOW - DAY },
  ]);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  await openEntries(admin.page);
  expect(await rowAt(admin.page, 0)).toMatchObject({ date: '9 Oct', pills: ['was live', 'Persian'] });
  const edit = rows(admin.page).nth(0).locator('.text-btn');
  expect((await edit.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(43.5);
  await expectFits(admin, info);
});

test('the year turns in Tehran, not in UTC: "31 Dec" until midnight there, "31 Dec 2026" a minute later (AC-31)', async ({ browser, baseURL, request }, info) => {
  // 23:59 on 31 December in Tehran is 20:29 UTC.
  const lastMinute = Date.UTC(2026, 11, 31, 20, 29);
  await resetAdmin(request, lastMinute);
  await seed(request, [
    { id: 'a000000001', lang: 'en', text: 'Next year.', firstPublishedAt: lastMinute + MINUTE },
    { id: 'a000000002', lang: 'en', text: 'The last minute.', firstPublishedAt: lastMinute },
    { id: 'a000000003', lang: 'en', text: 'The day before.', firstPublishedAt: Date.UTC(2026, 11, 30, 12) },
    { id: 'a000000004', lang: 'en', text: 'A year ago.', firstPublishedAt: Date.UTC(2025, 11, 31, 12) },
  ]);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openEntries(page);
  await expect(rows(page).locator('.entry-row__date')).toHaveText(['1 Jan 2027', '31 Dec', '30 Dec', '31 Dec 2025']);

  // One minute on, it is 1 January in Tehran, though 20:30 UTC is still 2026 there.
  expect((await request.post('/__test/clock', { data: { now: lastMinute + MINUTE } })).ok()).toBe(true);
  await reopenEntries(page);
  // The list reads again when it is opened; wait for the new answer, not the old rows.
  await expect(rows(page).locator('.entry-row__date')).toHaveText(['1 Jan', '31 Dec 2026', '30 Dec 2026', '31 Dec 2025']);
  await expectFits(admin, info);
});

test('"Older" brings the next page and goes when there is no more, and says nothing of how many (AC-30)', async ({ browser, baseURL, request }, info) => {
  await seed(
    request,
    Array.from({ length: 22 }, (_, i) => ({
      id: `b${String(i + 1).padStart(9, '0')}`,
      lang: 'en' as const,
      text: `Entry number ${i + 1}`,
      firstPublishedAt: NOW - (i + 1) * DAY,
    })),
  );
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openEntries(page);
  await expect(rows(page)).toHaveCount(20);
  const older = page.getByRole('button', { name: 'Older', exact: true });
  await expect(older).toBeVisible();
  expect((await older.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5);
  await older.click();
  await expect(rows(page)).toHaveCount(22);
  await expect(older).toHaveCount(0);
  // The two pages join with no repeat and no gap, newest first.
  const names = await rows(page).locator('.entry-row__name').allInnerTexts();
  expect(names).toEqual(Array.from({ length: 22 }, (_, i) => `“Entry number ${i + 1}”`));
  await expectFits(admin, info);
});

test('a never-published draft opens with its header and no action: B6 publishes it', async ({ browser, baseURL, request }, info) => {
  await seed(request, [{ id: 'a000000001', lang: 'en', text: 'Half a thought.', state: 'draft', createdAt: NOW - DAY }]);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openEntries(page);
  await page.getByRole('button', { name: /^Edit “Half a thought/ }).click();
  const frame = page.locator('.frame');
  await expect(frame.locator('.frame__status')).toHaveText('Draft');
  await expect(frame.locator('.doc')).toHaveText('Half a thought.');
  await expect(frame.getByRole('button', { name: /Unpublish|Publish/ })).toHaveCount(0);
  await expect(frame.locator('.frame__notice')).toHaveCount(0);
  await expect(frame.getByRole('button', { name: 'Cancel' })).toBeVisible();
  // The text is read-only here: no field, no editable region.
  await expect(frame.locator('input, textarea, [contenteditable]')).toHaveCount(0);
  await expectFits(admin, info);
  await frame.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.frame')).toHaveCount(0);
});

for (const lang of ['en', 'fa'] as const) {
  test(`Edit opens the frame, and Unpublish and Publish work through their confirm and notice, for a ${lang === 'fa' ? 'Persian' : 'English'} entry (J2.7 to J2.10, AC-14, AC-34)`, async ({ browser, baseURL, request }, info) => {
    const id = 'a000000010';
    const path = `${lang === 'fa' ? '/fa' : ''}/log/${id}`;
    await seed(request, [
      { id, lang, title: MIXED[lang].title, text: `${MIXED[lang].text}\n\nSee [the paper](https://example.org/paper).`, firstPublishedAt: NOW - 2 * DAY },
      { id: 'a000000011', lang: 'en', text: 'A newer entry.', firstPublishedAt: NOW - DAY },
    ]);
    const admin = await signedInAdmin(browser, baseURL as string, request);
    const { page } = admin;
    expect((await request.get(path)).status()).toBe(200);
    await openEntries(page);
    await page.getByRole('button', { name: `Edit ${MIXED[lang].title}` }).click();

    // The frame: its header, and the title and body read-only, in the entry's own direction.
    const frame = page.locator('.frame');
    await expect(frame.locator('.frame__status')).toHaveText('Editing · published 8 Oct 2026');
    await expect(frame.locator('.frame__status')).toBeFocused();
    await expect(frame.locator('.frame__title')).toHaveAttribute('dir', lang === 'fa' ? 'rtl' : 'ltr');
    await expect(frame.locator('.doc')).toHaveAttribute('dir', lang === 'fa' ? 'rtl' : 'ltr');
    await expect(frame.locator('.doc')).toHaveAttribute('lang', lang);
    await expect(frame.locator('input, textarea, [contenteditable]')).toHaveCount(0);
    // The runs of the other script are isolated, as on the public page (PD-8), and the marks are kept.
    await expect(frame.locator(lang === 'fa' ? '.doc bdi[lang="en"]' : '.doc bdi[lang="fa"][dir="rtl"]').first()).toBeVisible();
    await expect(frame.locator('.doc bdi[dir="ltr"]').first()).toContainText('https://example.org/passkeys/');
    await expect(frame.locator('.doc mark')).toHaveCount(1);
    const link = frame.locator('.doc a[href="https://example.org/paper"]');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveAttribute('target', '_blank');
    // The title is text and isolated runs, nothing else: what a person wrote can't become markup.
    expect(await frame.locator('.frame__title').evaluate((el) => el.querySelectorAll(':not(bdi)').length)).toBe(0);
    await expectFits(admin, info);

    // Unpublish is outlined, not the filled primary (F19), and asks once.
    const unpublish = frame.getByRole('button', { name: 'Unpublish' });
    expect(await unpublish.evaluate((el) => el.classList.contains('btn--solid') || el.classList.contains('btn--primary'))).toBe(false);
    await expect(frame.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0);
    await unpublish.click();
    const dialog = page.getByRole('dialog', { name: 'Take this entry off the site?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('It leaves the log and the feed, and its link stops working. It stays here as a draft.');
    for (const button of await dialog.getByRole('button').all()) expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5);
    const box = await dialog.boundingBox();
    expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= 360).toBe(true);
    await expectNoSidewaysScroll(page);

    // "Keep it live" leaves everything as it was.
    await dialog.getByRole('button', { name: 'Keep it live' }).click();
    await expect(dialog).toHaveCount(0);
    expect((await request.get(path)).status()).toBe(200);
    await expect(frame.locator('.frame__status')).toHaveText('Editing · published 8 Oct 2026');

    // Unpublish: no reason asked, and the result is said in the plate's words.
    await unpublish.click();
    await dialog.getByRole('button', { name: 'Unpublish' }).click();
    await expect(frame.getByRole('status')).toHaveText("Unpublished. It's in your entries as a draft.");
    expect((await request.get(path)).status()).toBe(404);
    // It is a draft that was live, with its original date, and it says where it returns before it does.
    await expect(frame.locator('.frame__status')).toHaveText('Draft · first published 8 Oct 2026');
    await expect(frame.locator('.frame__notice')).toHaveText("Publishing puts it back at 8 Oct 2026, its original date. It won't be at the top of the log.");
    await expect(frame.locator('.frame__notice mark')).toHaveText('8 Oct 2026');
    await expect(unpublish).toHaveCount(0);
    // And the list, behind it, shows it as "was live" at the date it keeps.
    const listed = rows(page).filter({ hasText: MIXED[lang].title });
    await expect(listed.locator('.pill')).toContainText(lang === 'fa' ? ['was live', 'Persian'] : ['was live']);
    await expect(listed.locator('.entry-row__date')).toHaveText('8 Oct');
    await expectFits(admin, info);

    // Publish puts it back at the original date, and names it after.
    const publish = frame.getByRole('button', { name: 'Publish', exact: true });
    expect(await publish.evaluate((el) => el.classList.contains('btn--solid'))).toBe(true);
    await publish.click();
    await expect(frame.getByRole('status')).toContainText('Published, at 8 Oct 2026.');
    await expect(frame.getByRole('link', { name: 'Open' })).toHaveAttribute('href', path);
    await expect(frame.locator('.frame__status')).toHaveText('Editing · published 8 Oct 2026');
    await expect(frame.locator('.frame__notice')).toHaveCount(0);
    expect((await request.get(path)).status()).toBe(200);
    await expect(rows(page).filter({ hasText: MIXED[lang].title }).locator('.pill')).toHaveCount(lang === 'fa' ? 1 : 0);
    // It came back at its place in the log, below the newer English entry, not on top (G9). The Persian log holds only itself.
    const log = await (await request.get(lang === 'fa' ? '/fa/log' : '/log')).text();
    expect(log).toContain(id);
    if (lang === 'en') expect(log.indexOf('a000000011')).toBeLessThan(log.indexOf(id));
    await expectFits(admin, info);

    await frame.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.frame')).toHaveCount(0);
  });
}

// The access sweep over the admin (plan B9; AC-19, AC-32, AC-35 to AC-38): the sign-in and its failure, the
// setup page, the signed-in shell with each section open, the composer new in each language, the edit
// frame, both write-time failures, the discard dialog, the episode form (new, refused at a field, and
// published with the last-link note) and the passkeys with an enrolment code. One test per state runs every
// check in `sweep-support.ts`; the two projects are the two colour schemes.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { resetAdmin, signedInAdmin, type Admin } from './admin-support.ts';
import { plainEpisodes, resetPodcast, type SeedEpisode } from './podcast-support.ts';
import { DAY, MIXED, NOW, PAST_IDLE, watchCsp, type Lang } from './support.ts';
import { highlightedButtons, sweep } from './sweep-support.ts';


test.beforeEach(async ({ request }) => {
  await resetAdmin(request, NOW);
});

const body = (page: Page) => page.getByRole('textbox', { name: 'Entry text' });
const section = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const podcast = (page: Page) => page.locator('#podcast-body');
const language = (page: Page, lang: Lang, within: Page | ReturnType<Page['locator']> = page) => within.getByRole('radio', { name: lang === 'fa' ? 'فارسی' : 'English' });

async function openSection(page: Page, name: 'Entries' | 'Podcast' | 'Passkeys'): Promise<void> {
  const toggle = section(page, name);
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

/** A page in a context of its own with no one signed in, as the sign-in and the setup page are first seen. */
async function signedOutPage(browser: Browser, baseURL: string, path: string): Promise<Page> {
  const context = await browser.newContext({ baseURL });
  await watchCsp(context);
  const page = await context.newPage();
  await page.goto(path);
  return page;
}

async function setupToken(request: Parameters<typeof resetAdmin>[0]): Promise<string> {
  const res = await request.post('/__test/auth/setup-token');
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { token: string }).token;
}

/** Entries of both languages in the list: one with emphasis and a link, a plain Persian one. */
async function seedEntries(request: Parameters<typeof resetAdmin>[0]): Promise<void> {
  const res = await request.post('/__test/entries', {
    data: {
      entries: [
        { id: 'a000000010', lang: 'en', title: 'An old entry', text: 'Broken link here, see ==the paper==.', firstPublishedAt: NOW - 2 * DAY },
        { id: 'a000000011', lang: 'fa', title: MIXED.fa.title, text: MIXED.fa.text, firstPublishedAt: NOW - 3 * DAY },
        { id: 'a000000012', lang: 'en', text: 'Untitled, so its opening words stand in.', firstPublishedAt: NOW - 4 * DAY },
      ],
    },
  });
  expect(res.ok()).toBe(true);
}

/** Type into the body one key at a time, then mark the last words with Highlight, so a `<mark>` sits in the editor. */
async function writeWithMark(page: Page, lang: Lang): Promise<void> {
  await body(page).click();
  await page.keyboard.type(lang === 'fa' ? 'متن آزمایشی برای نشانه' : 'Some words worth a mark');
  for (let i = 0; i < (lang === 'fa' ? 5 : 4); i++) await page.keyboard.press(lang === 'fa' ? 'Shift+ArrowRight' : 'Shift+ArrowLeft');
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  await expect(body(page).locator('mark')).toHaveCount(1);
}

/** Going offline makes the browser log a failed load, which is the point of the test and not a problem with the page. */
const forgiveOffline = (admin: Admin) => {
  admin.problems.splice(0, admin.problems.length, ...admin.problems.filter((message) => !/ERR_INTERNET_DISCONNECTED/.test(message)));
};

const COLUMN = 'main';

// ── Signed out ──

test('the sign-in view, with its eyes', async ({ browser, baseURL }, info) => {
  const page = await signedOutPage(browser, baseURL as string, '/admin');
  await expect(page.getByRole('heading', { name: "It's you, right?" })).toBeVisible();
  await expect(page.locator('#eyes .eyes--big [data-eye]')).toHaveCount(2);
  await sweep(page, info, { column: COLUMN, browser, baseURL, reducedAt: '/admin' });
});

test('the sign-in view, after a failure', async ({ browser, baseURL, request }, info) => {
  // A passkey the authenticator holds and the server has forgotten: the one failure message (plate 6).
  const admin = await signedInAdmin(browser, baseURL as string, request);
  expect((await request.delete('/__test/auth')).ok()).toBe(true);
  await admin.page.goto('/admin');
  await admin.page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(admin.page.getByRole('alert')).toHaveText("Sign-in didn't work. Try again.");
  await sweep(admin.page, info, { column: COLUMN });
});

test('the setup page', async ({ browser, baseURL, request }, info) => {
  const token = await setupToken(request);
  const page = await signedOutPage(browser, baseURL as string, `/admin/setup/${token}`);
  await expect(page.getByRole('heading', { name: 'Register this device' })).toBeVisible();
  await sweep(page, info, { column: COLUMN, browser, baseURL, reducedAt: `/admin/setup/${token}` });
});

// ── The signed-in shell ──

test('the shell, Entries open, with a list of both languages', async ({ browser, baseURL, request }, info) => {
  await seedEntries(request);
  const { page } = await signedInAdmin(browser, baseURL as string, request);
  await openSection(page, 'Entries');
  await expect(page.getByRole('button', { name: 'Edit An old entry' })).toBeVisible();
  await sweep(page, info, { column: COLUMN });
});

test('the shell, Podcast open, with episodes and a draft', async ({ browser, baseURL, request }, info) => {
  const episodes: SeedEpisode[] = [...plainEpisodes('en', 2), ...plainEpisodes('fa', 1).map((e) => ({ ...e, date: '2026-10-01' })), { lang: 'en', name: 'A draft that was live', description: 'x', tags: ['t'], date: '2026-09-20', links: [{ label: 'YouTube', url: 'https://youtu.be/d' }], state: 'draft', firstPublishedAt: NOW - 20 * DAY }];
  await resetPodcast(request, episodes);
  const { page } = await signedInAdmin(browser, baseURL as string, request);
  await openSection(page, 'Podcast');
  await expect(podcast(page).getByRole('button', { name: 'New episode', exact: true })).toBeVisible();
  await sweep(page, info, { column: COLUMN });
});

test('the shell, Passkeys open', async ({ browser, baseURL, request }, info) => {
  const { page } = await signedInAdmin(browser, baseURL as string, request);
  await openSection(page, 'Passkeys');
  await expect(page.locator('.passkey')).toHaveCount(1);
  await sweep(page, info, { column: COLUMN });
});

test('the shell, all three sections closed', async ({ browser, baseURL, request }, info) => {
  const { page } = await signedInAdmin(browser, baseURL as string, request);
  for (const name of ['Entries', 'Podcast', 'Passkeys'] as const) {
    const toggle = section(page, name);
    if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  }
  await sweep(page, info, { column: COLUMN });
});

// ── The composer and the edit frame ──

for (const lang of ['en', 'fa'] as const) {
  test(`the composer, new, in ${lang === 'fa' ? 'Persian' : 'English'}, with a highlighted phrase`, async ({ browser, baseURL, request }, info) => {
    const { page } = await signedInAdmin(browser, baseURL as string, request);
    if (lang === 'fa') await language(page, 'fa').check();
    await page.getByLabel('Title (optional)').fill(lang === 'fa' ? 'عنوان' : 'A title');
    await writeWithMark(page, lang);
    await sweep(page, info, { column: COLUMN });
  });
}

test('the edit frame, an entry with emphasis', async ({ browser, baseURL, request }, info) => {
  await seedEntries(request);
  const { page } = await signedInAdmin(browser, baseURL as string, request);
  await openSection(page, 'Entries');
  await page.getByRole('button', { name: 'Edit An old entry' }).click();
  await expect(page.locator('.frame .frame__status')).toContainText('Editing');
  await expect(body(page).locator('mark')).toHaveCount(1);
  await sweep(page, info, { column: COLUMN });
});

// ── Write-time failures and the dialog ──

test('the write-time failure: offline', async ({ browser, baseURL, request }, info) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await page.getByLabel('Title (optional)').fill('On the train');
  await body(page).click();
  await page.keyboard.type('Written with no signal.');
  await admin.context.setOffline(true);
  await page.getByRole('button', { name: /^Publish/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Not published yet.' })).toContainText('The connection dropped.');
  forgiveOffline(admin);
  await sweep(page, info, { column: COLUMN });
  await admin.context.setOffline(false);
});

test('the write-time failure: signed out', async ({ browser, baseURL, request }, info) => {
  const { page } = await signedInAdmin(browser, baseURL as string, request);
  await body(page).click();
  await page.keyboard.type('Still here after the session ended.');
  expect((await request.post('/__test/clock', { data: { now: NOW + PAST_IDLE } })).ok()).toBe(true);
  await page.getByRole('button', { name: /^Publish/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Not published yet.' })).toContainText('Sign in to finish.');
  await sweep(page, info, { column: COLUMN });
});

test('the discard dialog', async ({ browser, baseURL, request }, info) => {
  const { page } = await signedInAdmin(browser, baseURL as string, request);
  await body(page).click();
  await page.keyboard.type('To be discarded, or not.');
  await page.reload();
  const offer = page.getByRole('status').filter({ hasText: 'You left something here.' });
  await offer.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByRole('dialog', { name: 'Discard this text?' })).toBeVisible();
  await sweep(page, info, { column: COLUMN });
});

// ── The episode form ──

async function openNew(page: Page): Promise<void> {
  await openSection(page, 'Podcast');
  await podcast(page).getByRole('button', { name: 'New episode', exact: true }).click();
  await expect(podcast(page).getByLabel('Name', { exact: true })).toBeVisible();
}

for (const lang of ['en', 'fa'] as const) {
  test(`the episode form, new, in ${lang === 'fa' ? 'Persian' : 'English'}`, async ({ browser, baseURL, request }, info) => {
    const { page } = await signedInAdmin(browser, baseURL as string, request);
    await openNew(page);
    if (lang === 'fa') await language(page, 'fa', podcast(page)).check();
    await podcast(page).getByLabel('Name', { exact: true }).fill(lang === 'fa' ? 'نام قسمت' : 'Building in public');
    await podcast(page).getByRole('button', { name: 'YouTube', exact: true }).click();
    await podcast(page).getByLabel('Address', { exact: true }).fill('https://youtu.be/abc123');
    await sweep(page, info, { column: COLUMN });
  });
}

test('the episode form, a link refused at its field (not https)', async ({ browser, baseURL, request }, info) => {
  const { page } = await signedInAdmin(browser, baseURL as string, request);
  await openNew(page);
  await podcast(page).getByLabel('Name', { exact: true }).fill('Building in public');
  await podcast(page).getByRole('button', { name: 'YouTube', exact: true }).click();
  await podcast(page).getByLabel('Address', { exact: true }).fill('youtu.be/abc123');
  await podcast(page).getByRole('button', { name: /^Publish/ }).click();
  await expect(podcast(page).getByRole('alert').filter({ hasText: 'This link needs to start with https://' })).toBeVisible();
  await sweep(page, info, { column: COLUMN });
});

test('the episode form, a published episode with the last-link note', async ({ browser, baseURL, request }, info) => {
  await resetPodcast(request, [{ lang: 'en', name: 'The wrong video was live', description: 'Fixing a link after the fact.', tags: ['mistakes'], date: '2026-10-03', links: [{ label: 'YouTube', url: 'https://youtu.be/wrong-video' }], firstPublishedAt: NOW - 7 * DAY }]);
  const { page } = await signedInAdmin(browser, baseURL as string, request);
  await openSection(page, 'Podcast');
  await podcast(page).getByRole('button', { name: 'Edit The wrong video was live' }).click();
  await expect(page.getByText('A published episode keeps at least one link. Add the right one, then remove this.')).toBeVisible();
  await sweep(page, info, { column: COLUMN });
});

// ── Passkeys ──

test('the passkeys, with an enrolment code', async ({ browser, baseURL, request }, info) => {
  const { page } = await signedInAdmin(browser, baseURL as string, request);
  await openSection(page, 'Passkeys');
  await page.getByRole('button', { name: 'Enrol another device' }).click();
  await expect(page.getByRole('heading', { name: 'Enrol a new device' })).toBeVisible();
  await expect(page.locator('.code')).toHaveText(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  await sweep(page, info, { column: COLUMN });
});

// ── The eyes, in the admin ──

test('the sign-in view\'s eyes follow the pointer, and are gone once signed in (HIG #9)', async ({ browser, baseURL, request }) => {
  const page = await signedOutPage(browser, baseURL as string, '/admin');
  const pupils = page.locator('#eyes .eye__pupil');
  await expect(pupils).toHaveCount(2);
  await page.mouse.move(350, 790);
  await expect.poll(() => pupils.first().evaluate((el) => parseFloat(el.style.getPropertyValue('--eye-x')))).toBeGreaterThan(0);
  await page.mouse.move(1, 1);
  await expect.poll(() => pupils.first().evaluate((el) => parseFloat(el.style.getPropertyValue('--eye-x')))).toBeLessThan(0);
  // Signed in, no other admin view has eyes: its header is the plain text wordmark.
  const admin = await signedInAdmin(browser, baseURL as string, request);
  await expect(admin.page.locator('[data-eye]')).toHaveCount(0);
  await expect(admin.page.locator('.admin-header .wordmark')).toHaveText('iMNSTR');
});

// ── The date input's year (B7's record: "10/10/202" at 180 px) ──

test('the date input keeps its whole year in view at 180 px: its padding narrows there, and it stays in the column', async ({ browser, baseURL, request }, info) => {
  const { page } = await signedInAdmin(browser, baseURL as string, request);
  await openNew(page);
  const date = podcast(page).getByLabel('Date', { exact: true });
  const padding = () => date.evaluate((el) => parseFloat(getComputedStyle(el).paddingInlineStart));
  const wide = await padding();
  await page.setViewportSize({ width: 180, height: 800 });
  const narrow = await padding();
  // The native control draws its digits and its picker icon inside the field; 134 px holds "10/10/2026" and the icon only with the smaller padding.
  expect(narrow).toBeLessThan(wide);
  expect(narrow).toBeLessThanOrEqual(8);
  // Looked at, not measured: the browser draws the digits itself, so the page can't read how far they run. This is the picture the fix was made from.
  await date.screenshot({ path: info.outputPath('date-at-180.png') });
});

// ── The check for PL-1 shows it fails on the old look ──

test('the highlighter check passes on the composer, allows a Highlight tool that is on, and fails on a primary drawn in the highlighter (PL-1)', async ({ browser, baseURL, request }) => {
  const { page } = await signedInAdmin(browser, baseURL as string, request);
  await writeWithMark(page, 'en');
  // The tool is pressed after Highlight, and is the one button allowed the highlighter.
  await expect(page.getByRole('button', { name: 'Highlight', exact: true })).toHaveAttribute('aria-pressed', /true|false/);
  expect(await highlightedButtons(page)).toEqual([]);
  // The old look: Publish drawn in the highlighter. The check names it.
  await page.getByRole('button', { name: /^Publish/ }).evaluate((el) => {
    el.style.setProperty('background-color', 'var(--highlight)', 'important');
  });
  expect(await highlightedButtons(page)).toEqual([expect.stringContaining('Publish')]);
});

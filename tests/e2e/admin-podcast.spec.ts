// The episode form in a real browser (plan B7, plates 11 and 12; J5, J6.7): adding an episode in both
// languages, the https refusal at the field, nothing lost (offline, a lost answer, a session that ended,
// a closed tab), the last link, unpublish and republish naming the date, the language fixed while a send
// is unanswered (S-19), and every screen at 360 x 400 and at 180 px in both colour schemes.
import { expect, test, type Page } from '@playwright/test';
import { expectDialogPlace, resetAdmin, signedInAdmin, type Admin } from './admin-support.ts';
import { dayBefore, resetPodcast, type SeedEpisode } from './podcast-support.ts';
import { DAY, NOW, expectColourScheme, expectNoSidewaysScroll, expectNoThirdParty, expectWithinColumn, type Lang } from './support.ts';

test.beforeEach(async ({ request }) => {
  await resetAdmin(request, NOW);
});

const MINUTE = 60_000;
const section = (page: Page) => page.locator('#podcast-body');
const podcastToggle = (page: Page) => page.getByRole('button', { name: 'Podcast', exact: true });

async function openPodcast(page: Page): Promise<void> {
  if ((await podcastToggle(page).getAttribute('aria-expanded')) !== 'true') await podcastToggle(page).click();
}

const nameField = (page: Page) => section(page).getByLabel('Name', { exact: true });
const descriptionField = (page: Page) => section(page).getByLabel('Description', { exact: true });
const tagField = (page: Page) => section(page).getByLabel('Tag', { exact: true });
const secondTagField = (page: Page) => section(page).getByLabel('Second tag (optional)', { exact: true });
const dateField = (page: Page) => section(page).getByLabel('Date', { exact: true });
const labelField = (page: Page, n = 0) => section(page).getByLabel('Label', { exact: true }).nth(n);
const addressField = (page: Page, n = 0) => section(page).getByLabel('Address', { exact: true }).nth(n);
const language = (page: Page, lang: Lang) => section(page).getByRole('radio', { name: lang === 'fa' ? 'فارسی' : 'English' });
const publishButton = (page: Page) => section(page).getByRole('button', { name: /^Publish/ });
const saveDraftButton = (page: Page) => section(page).getByRole('button', { name: /^Save draft|^Saved$/ });
const publishedNotice = (page: Page) => section(page).getByRole('status').filter({ hasText: "Published. It's on the podcast page." });
const alertWith = (page: Page, text: string) => section(page).getByRole('alert').filter({ hasText: text });
const frame = (page: Page) => section(page).locator('.frame');

/** What the server lists, as the signed-in page sees it. */
async function listed(admin: Admin) {
  const res = await admin.context.request.get('/admin/api/episodes');
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { episodes: { id: string; lang: Lang; name: string | null; state: string; wasLive: boolean; date: string }[] }).episodes;
}

/** The episode as the server has it, by id. */
async function episodeOf(admin: Admin, id: string) {
  const res = await admin.context.request.get(`/admin/api/episodes/${id}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { episode: { name: string | null; description: string | null; tags: string[]; date: string; links: { label: string; url: string }[]; state: string; wasLive: boolean } }).episode;
}

/** A buffer as the page keeps it on this device, or null. */
async function buffer<T = Record<string, unknown>>(page: Page, name: 'unsent' | 'edit' | 'kept'): Promise<T | null> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), `imnstr:episode:${name}`);
  return raw === null ? null : (JSON.parse(raw) as T);
}

/** The publish keys of every request that creates an episode, in order. */
function watchKeys(page: Page): string[] {
  const keys: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/admin/api/episodes')) keys.push((r.postDataJSON() as { publishKey: string }).publishKey);
  });
  return keys;
}

/** Going offline makes the browser log a failed load, which is the point of the test and not a problem with the page. */
const forgiveOffline = (admin: Admin) => {
  admin.problems.splice(0, admin.problems.length, ...admin.problems.filter((message) => !/ERR_INTERNET_DISCONNECTED/.test(message)));
};

/** What every view must hold at 360 px, in the scheme under test. */
async function expectFits(admin: Admin, info: Parameters<typeof expectColourScheme>[1]): Promise<void> {
  await expectNoSidewaysScroll(admin.page);
  await expectColourScheme(admin.page, info);
  await expectNoThirdParty(admin.page, admin.requests);
  expect(admin.problems).toEqual([]);
}

const ENGLISH = {
  name: 'Building in public',
  description: "What keeps a project going when nobody's watching yet.",
  tag: 'making',
  second: 'habits',
  url: 'https://youtu.be/q81abc',
};
const PERSIAN = {
  name: 'ساختن در جمع',
  description: 'چه چیزی پروژه را زنده نگه می‌دارد.',
  tag: 'ساختن',
  second: 'عادت',
  url: 'https://youtu.be/fa81abc',
};

/** Fill the new-episode form: the fields, one YouTube link by its chip. */
async function fillNew(page: Page, lang: Lang, extra: { second?: boolean; url?: string } = {}): Promise<void> {
  const words = lang === 'fa' ? PERSIAN : ENGLISH;
  await nameField(page).fill(words.name);
  await descriptionField(page).fill(words.description);
  await tagField(page).fill(words.tag);
  if (extra.second) await secondTagField(page).fill(words.second);
  await section(page).getByRole('button', { name: 'YouTube', exact: true }).click();
  await addressField(page).fill(extra.url ?? words.url);
}

async function openNew(page: Page): Promise<void> {
  await openPodcast(page);
  await section(page).getByRole('button', { name: 'New episode', exact: true }).click();
  await expect(nameField(page)).toBeVisible();
}

async function openEdit(page: Page, name: string): Promise<void> {
  await openPodcast(page);
  await section(page).getByRole('button', { name: `Edit ${name}` }).click();
  await expect(frame(page).locator('.frame__status')).toContainText(/Editing|Draft/);
}

const publishedEpisode = (extra: Partial<SeedEpisode> = {}): SeedEpisode => ({
  lang: 'en',
  name: 'The wrong video was live',
  description: 'Fixing a link after the fact.',
  tags: ['mistakes'],
  date: '2026-10-03',
  links: [{ label: 'YouTube', url: 'https://youtu.be/wrong-video' }],
  firstPublishedAt: NOW - 7 * DAY,
  ...extra,
});

// ── The section ──

test('the Podcast section sits between Entries and Passkeys, collapsed, and holds New episode and "No episodes yet." (plate 11, J5.3)', async ({ browser, baseURL, request }, info) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  const order = await page.evaluate(() => {
    const at = (id: string) => document.querySelector(id);
    const before = (a: Element | null, b: Element | null) => Boolean(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return { entriesThenPodcast: before(at('#entries-heading'), at('#podcast-heading')), podcastThenPasskeys: before(at('#podcast-heading'), at('#passkeys-heading')) };
  });
  expect(order).toEqual({ entriesThenPodcast: true, podcastThenPasskeys: true });
  // Collapsed, and asking for nothing until it is opened.
  await expect(podcastToggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(section(page)).toBeHidden();
  await podcastToggle(page).click();
  await expect(section(page).getByRole('button', { name: 'New episode', exact: true })).toBeVisible();
  await expect(section(page).getByText('No episodes yet.', { exact: true })).toBeVisible();
  await expect(page.getByText('No episodes yet.')).toHaveCount(1);
  await expectFits(admin, info);
});

test('the list shows the date or "—", the name or "No name yet", the pills, and Edit, in the order of the podcast page, with no count (plate 12, J5.10)', async ({ browser, baseURL, request }) => {
  await resetPodcast(request, [
    publishedEpisode({ name: 'Building in public without an audience', date: '2026-10-24', firstPublishedAt: NOW }),
    publishedEpisode({ name: 'Why a monster?', date: '2026-10-10', id: 'e000000002' }),
    publishedEpisode({ name: 'The wrong video was live', date: '2026-10-03', state: 'draft', firstPublishedAt: NOW - 7 * DAY, id: 'e000000003' }),
    { lang: 'fa', name: 'قسمت سه، شاید', description: 'پیش‌نویس.', tags: ['الف'], date: '2026-09-01', state: 'draft', firstPublishedAt: null, id: 'e000000004' },
    { lang: 'en', state: 'draft', date: '2025-12-01', firstPublishedAt: null, id: 'e000000005' },
    publishedEpisode({ name: 'Old one', date: '2025-06-04', id: 'e000000006' }),
  ]);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openPodcast(page);
  const rows = section(page).locator('.entry-row');
  await expect(rows).toHaveCount(6);
  const text = (n: number) => rows.nth(n).innerText();
  // Date, then the name, then pills, then Edit; the year only when it isn't this year (AC-31).
  expect(await text(0)).toMatch(/^24 Oct\s+Building in public without an audience\s+Edit$/);
  expect(await text(1)).toMatch(/^10 Oct\s+Why a monster\?\s+Edit$/);
  expect(await text(2)).toMatch(/^3 Oct\s+The wrong video was live\s+was live\s+Edit$/);
  expect(await text(3)).toMatch(/^—\s+قسمت سه، شاید\s+draft\s+Persian\s+Edit$/);
  expect(await text(4)).toMatch(/^—\s+No name yet\s+draft\s+Edit$/);
  expect(await text(5)).toMatch(/^4 Jun 2025\s+Old one\s+Edit$/);
  expect(await section(page).innerText()).not.toMatch(/\b\d+\s+(episodes?|links?|drafts?)\b/i);
  // The Persian row's name is in its own language and direction (AC-42).
  await expect(rows.nth(3).locator('.entry-row__name')).toHaveAttribute('dir', 'rtl');
  expect(admin.problems).toEqual([]);
});

test('"Older" in the list reads the next page, and ends when there are no more', async ({ browser, baseURL, request }) => {
  await resetPodcast(
    request,
    Array.from({ length: 21 }, (_, i) => ({ lang: 'en' as const, name: `Episode ${String(i).padStart(2, '0')}`, description: 'x', tags: ['t'], date: dayBefore(i + 1), links: [{ label: 'YouTube', url: `https://youtu.be/${i}` }] })),
  );
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openPodcast(page);
  await expect(section(page).locator('.entry-row')).toHaveCount(20);
  await section(page).getByRole('button', { name: 'Older', exact: true }).click();
  await expect(section(page).locator('.entry-row')).toHaveCount(21);
  await expect(section(page).getByRole('button', { name: 'Older', exact: true })).toHaveCount(0);
});

// ── Adding an episode ──

for (const lang of ['en', 'fa'] as const) {
  test(`J5.4 to J5.7: add an episode in ${lang === 'fa' ? 'Persian' : 'English'}, publish it once, and read it on the podcast page (AC-6, AC-17, AC-42)`, async ({ browser, baseURL, request }, info) => {
    const admin = await signedInAdmin(browser, baseURL as string, request);
    const { page } = admin;
    await openNew(page);
    await expect(language(page, 'en')).toBeChecked();
    if (lang === 'fa') await language(page, 'fa').check();
    const words = lang === 'fa' ? PERSIAN : ENGLISH;
    // The language sets lang and dir on the text fields (AC-42); the address is always left to right.
    for (const el of [nameField(page), descriptionField(page), tagField(page), labelField(page)]) {
      await expect(el).toHaveAttribute('lang', lang);
      await expect(el).toHaveAttribute('dir', lang === 'fa' ? 'rtl' : 'ltr');
    }
    await expect(addressField(page)).toHaveAttribute('dir', 'ltr');
    // The date starts at the server's today, and the fields stop at the API's caps, so the person never meets a refusal.
    await expect(dateField(page)).toHaveValue('2026-10-10');
    await expect(nameField(page)).toHaveAttribute('maxlength', '1000');
    await expect(descriptionField(page)).toHaveAttribute('maxlength', '10000');
    await expect(tagField(page)).toHaveAttribute('maxlength', '100');
    await expect(labelField(page)).toHaveAttribute('maxlength', '100');
    await expect(addressField(page)).toHaveAttribute('maxlength', '2000');

    await fillNew(page, lang, { second: true });
    // The YouTube chip filled the label, and is gone: a label that is there needs no suggestion.
    await expect(labelField(page)).toHaveValue('YouTube');
    await expectFits(admin, info);
    await publishButton(page).click();

    const done = publishedNotice(page);
    await expect(done).toBeVisible();
    const path = lang === 'fa' ? '/fa/podcast' : '/podcast';
    await expect(done).toContainText(path);
    await expect(done.getByRole('link', { name: 'Open' })).toHaveAttribute('href', path);
    // The form is done, and the list holds the episode.
    await expect(nameField(page)).toHaveCount(0);
    const episodes = await listed(admin);
    expect(episodes.map((e) => [e.lang, e.name, e.state, e.date])).toEqual([[lang, words.name, 'published', '2026-10-10']]);
    expect(await episodeOf(admin, episodes[0]?.id as string)).toMatchObject({ tags: [words.tag, words.second], links: [{ label: 'YouTube', url: words.url }], description: words.description });
    await expect(section(page).locator('.entry-row')).toContainText(words.name);
    await expect(section(page).locator('.entry-row .entry-row__date')).toHaveText('10 Oct');
    // And the reader sees it, in its own language, at the date typed.
    const public_ = await request.get(path);
    const html = await public_.text();
    expect(html).toContain(words.name);
    expect(html).toContain(words.url);
    expect(html).toContain(lang === 'fa' ? '۱۸ مهر ۱۴۰۵' : '10 Oct 2026');
    // The buffer is gone, and the next episode starts in the language just used.
    expect(await buffer(page, 'unsent')).toBeNull();
    await section(page).getByRole('button', { name: 'New episode', exact: true }).click();
    await expect(language(page, lang)).toBeChecked();
    await expectFits(admin, info);
  });
}

test('J5.5, AC-17: a link that is not https is refused at its field, with the fix built from the typed text, and nothing is sent', async ({ browser, baseURL, request }, info) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  const keys = watchKeys(page);
  await openNew(page);
  await nameField(page).fill('Building in public');
  await section(page).getByRole('button', { name: 'YouTube', exact: true }).click();
  await addressField(page).fill('youtu.be/abc123');
  await publishButton(page).click();
  const refusal = section(page).getByRole('alert').filter({ hasText: 'This link needs to start with https://' });
  await expect(refusal).toHaveText('This link needs to start with https://, like https://youtu.be/abc123. Everything else you typed is still here.');
  // Never prefixed for them, and everything else is still there; the field is focused for the fix.
  await expect(addressField(page)).toHaveValue('youtu.be/abc123');
  await expect(addressField(page)).toBeFocused();
  await expect(addressField(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(nameField(page)).toHaveValue('Building in public');
  expect(keys).toHaveLength(0);
  expect(await listed(admin)).toHaveLength(0);
  await expectFits(admin, info);
  await expectWithinColumn(page, '#podcast-body');

  // Typing again clears the refusal; the fix is the person's own, then Save draft goes through, and so does the draft's link.
  await addressField(page).fill('https://youtu.be/abc123');
  await expect(refusal).toHaveCount(0);
  await saveDraftButton(page).click();
  await expect(section(page).getByRole('status').filter({ hasText: 'Draft saved.' })).toBeVisible();
  expect(keys).toHaveLength(1);
  const [episode] = await listed(admin);
  expect(await episodeOf(admin, episode?.id as string)).toMatchObject({ state: 'draft', links: [{ label: 'YouTube', url: 'https://youtu.be/abc123' }] });
});

test('J5.5: another scheme is refused the same way, and its fix swaps the scheme', async ({ browser, baseURL, request }) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openNew(page);
  await labelField(page).fill('Castbox');
  await addressField(page).fill('http://castbox.fm/episode/9');
  await saveDraftButton(page).click();
  await expect(section(page).getByRole('alert').filter({ hasText: 'like https://castbox.fm/episode/9.' })).toBeVisible();
  expect(await listed(admin)).toHaveLength(0);
});

test('an address with no label is refused at the label, and a draft needs nothing else (PD-23)', async ({ browser, baseURL, request }) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openNew(page);
  await addressField(page).fill('https://youtu.be/abc123');
  await saveDraftButton(page).click();
  await expect(section(page).getByRole('alert').filter({ hasText: 'Name this link' })).toBeVisible();
  await expect(labelField(page)).toBeFocused();
  expect(await listed(admin)).toHaveLength(0);
  await labelField(page).fill('YouTube');
  await saveDraftButton(page).click();
  await expect(section(page).getByRole('status').filter({ hasText: 'Draft saved.' })).toBeVisible();
  expect((await listed(admin)).map((e) => [e.name, e.state])).toEqual([[null, 'draft']]);
});

test('Publish with something missing says what, above the actions, and keeps everything (PD-23)', async ({ browser, baseURL, request }, info) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openNew(page);
  await publishButton(page).click();
  const failure = alertWith(page, 'Not published yet.');
  await expect(failure).toContainText('Give the episode a name before publishing.');
  await nameField(page).fill('Named');
  await publishButton(page).click();
  await expect(failure).toContainText('Add a description before publishing.');
  await descriptionField(page).fill('Described.');
  await publishButton(page).click();
  await expect(failure).toContainText('Give the episode one or two tags before publishing.');
  await tagField(page).fill('tag');
  await publishButton(page).click();
  await expect(failure).toContainText('Add a link to listen before publishing.');
  expect(await listed(admin)).toHaveLength(0);
  await expect(nameField(page)).toHaveValue('Named');
  // The error sits right above the actions, where the eye is (W5).
  const [fail, actions] = [await failure.boundingBox(), await section(page).locator('.composer__actions').boundingBox()];
  expect((actions?.y ?? 0) - ((fail?.y ?? 0) + (fail?.height ?? 0))).toBeLessThan(24);
  await expectFits(admin, info);
});

test('+ Another link adds a row, Remove is on each of two or more and takes the row away, and Cancel on an edit undoes a Remove (F10, plate 11)', async ({ browser, baseURL, request }) => {
  await resetPodcast(request, [publishedEpisode({ links: [{ label: 'YouTube', url: 'https://youtu.be/a' }, { label: 'Castbox', url: 'https://castbox.fm/a' }] })]);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openNew(page);
  // One link: nothing to remove.
  await expect(section(page).getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  await section(page).getByRole('button', { name: '+ Another link', exact: true }).click();
  await expect(section(page).getByLabel('Label', { exact: true })).toHaveCount(2);
  await expect(section(page).getByRole('button', { name: /^Remove/ })).toHaveCount(2);
  await labelField(page, 1).fill('Spotify');
  await section(page).getByRole('button', { name: 'Remove Spotify' }).click();
  await expect(section(page).getByLabel('Label', { exact: true })).toHaveCount(1);
  await expect(section(page).getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  // A new form is not the place to continue: leave it for the edit.
  await section(page).getByRole('button', { name: 'Edit The wrong video was live' }).click();
  await expect(frame(page)).toBeVisible();
  await expect(frame(page).getByRole('button', { name: /^Remove/ })).toHaveCount(2);
  await frame(page).getByRole('button', { name: 'Remove YouTube' }).click();
  await expect(frame(page).getByLabel('Label', { exact: true })).toHaveCount(1);
  // Cancel undoes it: the server never heard of the Remove, and the form opens again with both links.
  await frame(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Leave' }).click();
  await openEdit(page, 'The wrong video was live');
  await expect(frame(page).getByLabel('Label', { exact: true })).toHaveCount(2);
  expect((await episodeOf(admin, (await listed(admin))[0]?.id as string)).links).toHaveLength(2);
});

// ── The last link ──

test('J5.8a, AC-17: a published episode keeps at least one link: its only link has no Remove, and says why, until another is added (plate 12)', async ({ browser, baseURL, request }, info) => {
  await resetPodcast(request, [publishedEpisode()]);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openEdit(page, 'The wrong video was live');
  await expect(frame(page).locator('.frame__status')).toHaveText('Editing · published 3 Oct 2026');
  await expect(frame(page).getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  await expect(frame(page).getByText('A published episode keeps at least one link. Add the right one, then remove this.')).toBeVisible();
  await expectFits(admin, info);
  // Add the right one, then the wrong one can go.
  await frame(page).getByRole('button', { name: '+ Another link', exact: true }).click();
  await expect(frame(page).getByRole('button', { name: /^Remove/ })).toHaveCount(2);
  await frame(page).getByLabel('Label', { exact: true }).nth(1).fill('YouTube');
  await frame(page).getByLabel('Address', { exact: true }).nth(1).fill('https://youtu.be/the-right-one');
  await frame(page).getByRole('button', { name: 'Remove YouTube' }).first().click();
  await expect(frame(page).getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  await expect(frame(page).getByText('A published episode keeps at least one link.')).toBeVisible();
  await frame(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(frame(page).getByRole('status').filter({ hasText: 'Saved. The episode keeps its date and its place.' })).toBeVisible();
  const [episode] = await listed(admin);
  expect((await episodeOf(admin, episode?.id as string)).links).toEqual([{ label: 'YouTube', url: 'https://youtu.be/the-right-one' }]);
  expect(admin.problems).toEqual([]);
});

test('the server refuses it too: a save with the last link taken away is LAST_LINK, and the form says what is true', async ({ browser, baseURL, request }) => {
  await resetPodcast(request, [publishedEpisode({ links: [{ label: 'YouTube', url: 'https://youtu.be/a' }, { label: 'Castbox', url: 'https://castbox.fm/a' }] })]);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openEdit(page, 'The wrong video was live');
  // Both links removed in the form leave one the form can't remove; but the server's own answer is shown if it comes.
  await page.route('**/admin/api/episodes/*', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 409, contentType: 'application/json', body: '{"code":"LAST_LINK"}' });
      return;
    }
    await route.continue();
  });
  await frame(page).getByLabel('Address', { exact: true }).first().fill('https://youtu.be/b');
  await frame(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(alertWith(page, 'Not saved.')).toContainText('A published episode keeps at least one link. Add the right one, then remove this.');
});

// ── Unpublish and republish ──

test('F13, J5.10: unpublish, then publish again, which names the date and says the episode is back in its place (plate 12)', async ({ browser, baseURL, request }, info) => {
  const [id] = await resetPodcast(request, [publishedEpisode({ id: 'e000000010' })]);
  expect((await request.get('/podcast')).status()).toBe(200);
  expect(await (await request.get('/podcast')).text()).toContain('The wrong video was live');
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openEdit(page, 'The wrong video was live');
  await frame(page).getByRole('button', { name: 'Unpublish', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Take this episode off the site?');
  await expectDialogPlace(page, dialog);
  await dialog.getByRole('button', { name: 'Unpublish' }).click();
  await expect(frame(page).getByRole('status').filter({ hasText: "Unpublished. It's in your podcast list as a draft." })).toBeVisible();
  expect(await (await request.get('/podcast')).text()).not.toContain('The wrong video was live');
  expect(await episodeOf(admin, id as string)).toMatchObject({ state: 'draft', wasLive: true, date: '2026-10-03' });
  // A draft that was live says where it returns, before it does.
  await expect(frame(page).locator('.frame__status')).toHaveText('Draft · first published 3 Oct 2026');
  await expect(frame(page).locator('.frame__notice')).toHaveText('Publishing puts it back at 3 Oct 2026, its date. It keeps its place on the podcast page.');
  await expect(frame(page).locator('.frame__notice mark')).toHaveText('3 Oct 2026');
  await expectFits(admin, info);
  await frame(page).getByRole('button', { name: /^Publish/ }).click();
  const back = frame(page).getByRole('status').filter({ hasText: 'Published, at 3 Oct 2026.' });
  await expect(back).toContainText("It's back in its place on the podcast page.");
  // At its own date and in its own place; the episode is on the public page again.
  expect(await episodeOf(admin, id as string)).toMatchObject({ state: 'published', date: '2026-10-03' });
  expect(await (await request.get('/podcast')).text()).toContain('The wrong video was live');
  await expect(section(page).locator('.entry-row').first().locator('.entry-row__date')).toHaveText('3 Oct');
  await expectFits(admin, info);
});

test('Save on a live episode keeps its date and its place, and an edit needs no unpublish (plate 11)', async ({ browser, baseURL, request }) => {
  const [id] = await resetPodcast(request, [publishedEpisode({ id: 'e000000011' })]);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openEdit(page, 'The wrong video was live');
  await frame(page).getByLabel('Name', { exact: true }).fill('The right video is live');
  await frame(page).getByRole('button', { name: '+ Another link', exact: true }).click();
  await frame(page).getByRole('button', { name: 'Castbox', exact: true }).click();
  await frame(page).getByLabel('Address', { exact: true }).nth(1).fill('https://castbox.fm/episode/1');
  await frame(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(frame(page).getByRole('status').filter({ hasText: 'Saved. The episode keeps its date and its place.' })).toBeVisible();
  expect(await episodeOf(admin, id as string)).toMatchObject({ name: 'The right video is live', state: 'published', date: '2026-10-03', links: [{ label: 'YouTube', url: 'https://youtu.be/wrong-video' }, { label: 'Castbox', url: 'https://castbox.fm/episode/1' }] });
  const html = await (await request.get('/podcast')).text();
  expect(html).toContain('The right video is live');
  expect(html).toContain('3 Oct 2026');
  // The edit buffer is gone with the confirmation.
  expect(await buffer(page, 'edit')).toBeNull();
});

test('clearing the date in an edit puts the episode\'s own date back, which is the date a save keeps, and is no unsaved change', async ({ browser, baseURL, request }) => {
  const [id] = await resetPodcast(request, [publishedEpisode({ id: 'e000000012' })]);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openEdit(page, 'The wrong video was live');
  const date = frame(page).getByLabel('Date', { exact: true });
  await expect(date).toHaveValue('2026-10-03');
  // An edit that sends no date keeps the episode's own, so the field must show that, not today (10 Oct).
  await date.fill('');
  await expect(date).toHaveValue('2026-10-03');
  expect(await buffer(page, 'edit')).toBeNull();
  // Nothing changed, so Cancel leaves without asking.
  await frame(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(frame(page)).toBeHidden();
  expect((await episodeOf(admin, id as string)).date).toBe('2026-10-03');
});

test('a draft that was never published opens as a draft, and Publish makes it live at its date (J5.9)', async ({ browser, baseURL, request }) => {
  const [id] = await resetPodcast(request, [{ lang: 'en', name: 'Episode three', description: 'Maybe.', tags: ['a'], date: '2026-10-12', links: [{ label: 'YouTube', url: 'https://youtu.be/3' }], state: 'draft', firstPublishedAt: null, id: 'e000000012' }]);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openEdit(page, 'Episode three');
  await expect(frame(page).locator('.frame__status')).toHaveText('Draft');
  await expect(frame(page).locator('.frame__notice')).toHaveCount(0);
  await frame(page).getByRole('button', { name: /^Publish/ }).click();
  await expect(frame(page).getByRole('status').filter({ hasText: "Published. It's on the podcast page." })).toBeVisible();
  expect(await episodeOf(admin, id as string)).toMatchObject({ state: 'published', date: '2026-10-12' });
});

// ── Nothing is lost (AC-16, AC-43) ──

test('J3.1, J3.2, AC-16: the network drops during a publish. It says so, keeps everything, sends nothing by itself, and a tap sends it again with the same key: one episode', async ({ browser, baseURL, request }, info) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  const keys = watchKeys(page);
  await openNew(page);
  await fillNew(page, 'en', { second: true });
  await expect(section(page).getByText('Kept on this phone', { exact: true })).toBeVisible();

  await admin.context.setOffline(true);
  await publishButton(page).click();
  const failure = alertWith(page, 'Not published yet.');
  await expect(failure).toHaveText('Not published yet. The connection dropped. Everything you typed is kept on this phone.Try again');
  // Everything is exactly where it was, editable, and on the device.
  await expect(nameField(page)).toHaveValue(ENGLISH.name);
  await expect(addressField(page)).toHaveValue(ENGLISH.url);
  expect(await buffer(page, 'unsent')).toMatchObject({ name: ENGLISH.name, lang: 'en', key: keys[0] });
  forgiveOffline(admin);
  await expectFits(admin, info);

  // Back online, nothing is sent by itself: only a tap retries.
  await admin.context.setOffline(false);
  await page.waitForTimeout(1500);
  expect(keys).toHaveLength(1);
  expect(await listed(admin)).toHaveLength(0);
  await failure.getByRole('button', { name: 'Try again' }).click();
  await expect(publishedNotice(page)).toBeVisible();
  // The same key, so the server could only ever make one episode of it.
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect((await listed(admin)).map((e) => [e.name, e.state])).toEqual([[ENGLISH.name, 'published']]);
  expect(await buffer(page, 'unsent')).toBeNull();
  await expectFits(admin, info);
});

test('S-19, AC-25: a lost answer, then another language before the retry. The language is fixed until an answer comes, so no episode is made twice', async ({ browser, baseURL, request }) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  const keys = watchKeys(page);
  let lost = true;
  await page.route('**/admin/api/episodes', async (route) => {
    if (route.request().method() === 'POST' && lost) {
      lost = false;
      // The server does the work; the answer never arrives.
      await route.fetch();
      await route.abort('connectionreset');
      return;
    }
    await route.continue();
  });
  await openNew(page);
  await fillNew(page, 'en');
  await publishButton(page).click();
  const failure = alertWith(page, 'Not published yet.');
  await expect(failure).toBeVisible();
  // The row may exist in English: the control is fixed, and Persian can't be chosen.
  await expect(language(page, 'fa')).toBeDisabled();
  await expect(language(page, 'en')).toBeDisabled();
  // Emptying the fields doesn't free the key either: typing again is the same composition.
  await nameField(page).fill('');
  await nameField(page).fill('Building in public, retried');
  await failure.getByRole('button', { name: 'Try again' }).click();
  await expect(publishedNotice(page)).toBeVisible();
  expect(new Set(keys).size).toBe(1);
  const episodes = await listed(admin);
  expect(episodes.map((e) => [e.lang, e.name, e.state])).toEqual([['en', 'Building in public, retried', 'published']]);
  // Answered, the next episode is new text again, and its language can be chosen.
  await section(page).getByRole('button', { name: 'New episode', exact: true }).click();
  await expect(language(page, 'fa')).toBeEnabled();
});

test('AC-25: the answer is lost, and a plain retry finds the same episode: one episode, however many taps', async ({ browser, baseURL, request }) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  let lost = true;
  await page.route('**/admin/api/episodes', async (route) => {
    if (route.request().method() === 'POST' && lost) {
      lost = false;
      await route.fetch();
      await route.abort('connectionreset');
      return;
    }
    await route.continue();
  });
  await openNew(page);
  await fillNew(page, 'en');
  await publishButton(page).click();
  await alertWith(page, 'Not published yet.').getByRole('button', { name: 'Try again' }).click();
  await expect(publishedNotice(page)).toBeVisible();
  expect(await listed(admin)).toHaveLength(1);
});

test('J5.5a, W6: the session ends while writing. Everything stays, Sign in and publish signs in over the form, and the publish runs once on the new session', async ({ browser, baseURL, request }, info) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  const keys = watchKeys(page);
  await openNew(page);
  await fillNew(page, 'en');
  // Typing alone does not keep a session alive, so an hour idle ends it.
  expect((await request.post('/__test/clock', { data: { now: NOW + 70 * MINUTE } })).ok()).toBe(true);
  await publishButton(page).click();
  const failure = alertWith(page, 'Not published yet.');
  await expect(failure).toContainText('You were signed out. Sign in to finish. Your episode stays right here.');
  // The form was not unmounted: the same fields, still editable, and the app did not leave for the sign-in view.
  await expect(nameField(page)).toHaveValue(ENGLISH.name);
  await expect(page.getByRole('heading', { name: "It's you, right?" })).toHaveCount(0);
  const signIn = failure.getByRole('button', { name: 'Sign in and publish' });
  expect((await signIn.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5);
  await expectFits(admin, info);
  await signIn.click();
  await expect(publishedNotice(page)).toBeVisible();
  expect((await listed(admin)).map((e) => [e.name, e.state])).toEqual([[ENGLISH.name, 'published']]);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect(await buffer(page, 'unsent')).toBeNull();
  // The new session is the page's now: Passkeys still marks this device.
  await page.getByRole('button', { name: 'Passkeys', exact: true }).click();
  await expect(page.locator('.passkey').filter({ hasText: 'this device' })).toHaveCount(1);
});

test('Sign in and save, over an edit: the session ended, the changes stay, and the save runs once after signing in', async ({ browser, baseURL, request }) => {
  const [id] = await resetPodcast(request, [publishedEpisode({ id: 'e000000013' })]);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openEdit(page, 'The wrong video was live');
  await frame(page).getByLabel('Description', { exact: true }).fill('Fixed after an hour.');
  expect((await request.post('/__test/clock', { data: { now: NOW + 90 * MINUTE } })).ok()).toBe(true);
  await frame(page).getByRole('button', { name: 'Save', exact: true }).click();
  const failure = alertWith(page, 'Not saved.');
  await expect(failure).toContainText('You were signed out. Sign in to finish. Your episode stays right here.');
  await failure.getByRole('button', { name: 'Sign in and save' }).click();
  await expect(frame(page).getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(await episodeOf(admin, id as string)).toMatchObject({ description: 'Fixed after an hour.' });
});

test('Save on a live episode that fails says the live episode has not changed, and a tap saves it', async ({ browser, baseURL, request }) => {
  const [id] = await resetPodcast(request, [publishedEpisode({ id: 'e000000014' })]);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openEdit(page, 'The wrong video was live');
  await frame(page).getByLabel('Description', { exact: true }).fill('Now fixed.');
  await expect(frame(page).getByText('Kept on this phone', { exact: true })).toBeVisible();
  await admin.context.setOffline(true);
  await frame(page).getByRole('button', { name: 'Save', exact: true }).click();
  const failure = alertWith(page, 'Not saved.');
  await expect(failure).toContainText("The connection dropped. Your changes are kept here, and the live episode hasn't changed.");
  await admin.context.setOffline(false);
  expect(await episodeOf(admin, id as string)).toMatchObject({ description: 'Fixing a link after the fact.' });
  expect(await buffer(page, 'edit')).toMatchObject({ id });
  forgiveOffline(admin);
  await failure.getByRole('button', { name: 'Try again' }).click();
  await expect(frame(page).getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(await episodeOf(admin, id as string)).toMatchObject({ description: 'Now fixed.' });
  expect(await buffer(page, 'edit')).toBeNull();
});

test('Unpublish that fails says it is still live, and nothing has changed', async ({ browser, baseURL, request }) => {
  const [id] = await resetPodcast(request, [publishedEpisode({ id: 'e000000015' })]);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openEdit(page, 'The wrong video was live');
  await admin.context.setOffline(true);
  await frame(page).getByRole('button', { name: 'Unpublish', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Unpublish' }).click();
  await expect(alertWith(page, 'Not unpublished.')).toContainText("It's still live.");
  await admin.context.setOffline(false);
  expect(await episodeOf(admin, id as string)).toMatchObject({ state: 'published' });
  forgiveOffline(admin);
});

for (const lang of ['en', 'fa'] as const) {
  test(`J3.3, AC-43: a closed tab. The page opens with the ${lang === 'fa' ? 'Persian' : 'English'} episode offered back, marked not published, and Put it back restores it with its key`, async ({ browser, baseURL, request }, info) => {
    const admin = await signedInAdmin(browser, baseURL as string, request);
    const { page } = admin;
    await openNew(page);
    if (lang === 'fa') await language(page, 'fa').check();
    await fillNew(page, lang, { second: true });
    const before = await buffer(page, 'unsent');
    expect(before).toMatchObject({ lang, name: (lang === 'fa' ? PERSIAN : ENGLISH).name });

    // The tab is closed and the page opened again: the section opens itself, so the offer is never hidden.
    await page.reload();
    await expect(podcastToggle(page)).toHaveAttribute('aria-expanded', 'true');
    const offer = section(page).getByRole('status').filter({ hasText: 'You left something here.' });
    await expect(offer).toContainText("An unsent episode from earlier on this phone. It isn't published.");
    // Set aside, so typing in the form can't write over it.
    expect(await buffer(page, 'unsent')).toBeNull();
    expect(await buffer<unknown[]>(page, 'kept')).toHaveLength(1);
    await expectFits(admin, info);

    await offer.getByRole('button', { name: 'Put it back' }).click();
    const words = lang === 'fa' ? PERSIAN : ENGLISH;
    await expect(nameField(page)).toHaveValue(words.name);
    await expect(descriptionField(page)).toHaveValue(words.description);
    await expect(tagField(page)).toHaveValue(words.tag);
    await expect(addressField(page)).toHaveValue(words.url);
    await expect(language(page, lang)).toBeChecked();
    await expect(section(page).getByRole('status').filter({ hasText: 'Back to your unsent episode.' })).toBeVisible();
    // The key survived the reload: the same composition, so a publish from here is the same episode.
    expect(await buffer(page, 'unsent')).toMatchObject({ key: (before as { key: string }).key });
    await publishButton(page).click();
    await expect(publishedNotice(page)).toBeVisible();
    expect(await listed(admin)).toHaveLength(1);
    expect(await buffer(page, 'kept')).toBeNull();
  });
}

test('J3.3, AC-43: Discard asks twice, and only the second answer drops the text', async ({ browser, baseURL, request }) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openNew(page);
  await fillNew(page, 'en');
  await page.reload();
  const offer = section(page).getByRole('status').filter({ hasText: 'You left something here.' });
  await offer.getByRole('button', { name: 'Discard' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Discard this text?');
  await expectDialogPlace(page, dialog);
  await dialog.getByRole('button', { name: 'Keep it' }).click();
  await expect(offer).toBeVisible();
  expect(await buffer<unknown[]>(page, 'kept')).not.toBeNull();
  await offer.getByRole('button', { name: 'Discard' }).click();
  await dialog.getByRole('button', { name: 'Discard' }).click();
  await expect(offer).toHaveCount(0);
  expect(await buffer(page, 'kept')).toBeNull();
});

test('AC-43: Edit over an unsent episode keeps it, says so, and brings it back when the edit ends', async ({ browser, baseURL, request }) => {
  await resetPodcast(request, [publishedEpisode({ id: 'e000000016' })]);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openNew(page);
  await nameField(page).fill('Half an episode');
  await openEdit(page, 'The wrong video was live');
  await expect(frame(page).getByRole('status').filter({ hasText: 'Your unsent episode is kept.' })).toContainText('It comes back when you save or cancel here.');
  expect(await buffer<{ name: string }[]>(page, 'kept')).toEqual([expect.objectContaining({ name: 'Half an episode' })]);
  // Cancel on an edit with nothing changed: the unsent episode is back in a new form, and says so.
  await frame(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(section(page).getByRole('status').filter({ hasText: 'Back to your unsent episode.' })).toBeVisible();
  await expect(nameField(page)).toHaveValue('Half an episode');
  expect(await buffer(page, 'unsent')).toMatchObject({ name: 'Half an episode' });
});

test('AC-43: changes left in an edit are offered back after a reload, and Cancel with unsaved changes asks before dropping them', async ({ browser, baseURL, request }) => {
  const [id] = await resetPodcast(request, [publishedEpisode({ id: 'e000000017' })]);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openEdit(page, 'The wrong video was live');
  await frame(page).getByLabel('Description', { exact: true }).fill('Changed, never saved.');
  expect(await buffer(page, 'edit')).toMatchObject({ id, description: 'Changed, never saved.' });
  await page.reload();
  const offer = section(page).getByRole('status').filter({ hasText: 'You left changes here.' });
  await expect(offer).toContainText("Edits to an episode, from earlier on this phone. They aren't saved, and the episode hasn't changed.");
  await offer.getByRole('button', { name: 'Put them back' }).click();
  await expect(frame(page).getByLabel('Description', { exact: true })).toHaveValue('Changed, never saved.');
  // Leaving asks, and Keep editing stays.
  await frame(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Leave without saving?');
  await expectDialogPlace(page, dialog);
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(frame(page).getByLabel('Description', { exact: true })).toHaveValue('Changed, never saved.');
  await frame(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.getByRole('button', { name: 'Leave' }).click();
  await expect(frame(page)).toHaveCount(0);
  expect(await buffer(page, 'edit')).toBeNull();
  expect(await episodeOf(admin, id as string)).toMatchObject({ description: 'Fixing a link after the fact.' });
});

// ── Every screen at 360 x 400 and at 180 px ──

test('at 360 x 400, as with the keyboard up, the actions stay in view with a long form and nothing scrolls sideways (AC-15)', async ({ browser, baseURL, request }, info) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openNew(page);
  await page.setViewportSize({ width: 360, height: 400 });
  await fillNew(page, 'en', { second: true });
  for (let n = 0; n < 4; n++) {
    await section(page).getByRole('button', { name: '+ Another link', exact: true }).click();
    await labelField(page, n + 1).fill(`Link ${n}`);
    await addressField(page, n + 1).fill(`https://example.org/${n}`);
  }
  await descriptionField(page).fill(Array.from({ length: 12 }, (_, i) => `Line ${i + 1} of a description that is taller than the screen.`).join('\n'));
  for (const name of ['Save draft', 'Publish'] as const) {
    const box = await section(page).getByRole('button', { name }).first().boundingBox();
    expect(box, name).not.toBeNull();
    expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= 360, `${name} is within the width`).toBe(true);
    expect((box?.y ?? -1) >= 0 && (box?.y ?? 0) + (box?.height ?? 0) <= 400, `${name} is within the height`).toBe(true);
  }
  await expectNoSidewaysScroll(page);
  await expectColourScheme(page, info);
  expect(admin.problems).toEqual([]);
});

for (const lang of ['en', 'fa'] as const) {
  test(`at 200% zoom (180 px) the new form and an edit fit, with a refusal showing, in ${lang === 'fa' ? 'Persian' : 'English'}: no sideways scroll, every control in the column (HIG #8)`, async ({ browser, baseURL, request }, info) => {
    const word = 'Supercalifragilistic'.repeat(5);
    await resetPodcast(request, [
      publishedEpisode({
        lang,
        name: lang === 'fa' ? `${'نام بلند '.repeat(8)}${word}` : `${'A long name '.repeat(8)}${word}`,
        description: `${word}\n${'text '.repeat(40)}`,
        tags: [word, word],
        links: [
          { label: word, url: `https://example.org/${word}${word}` },
          { label: 'Castbox', url: 'https://castbox.fm/a' },
        ],
        id: 'e000000020',
      }),
    ]);
    const admin = await signedInAdmin(browser, baseURL as string, request);
    const { page } = admin;
    await openNew(page);
    if (lang === 'fa') await language(page, 'fa').check();
    await nameField(page).fill(word);
    await labelField(page).fill(word);
    await addressField(page).fill(`http://example.org/${word}${word}`);
    await publishButton(page).click();
    await expect(section(page).getByRole('alert').filter({ hasText: 'This link needs to start with https://' })).toBeVisible();
    await expectNoSidewaysScroll(page, 180);
    await expectWithinColumn(page, '#podcast-body');
    await expectColourScheme(page, info);

    // The frame, with a long published episode in it.
    await nameField(page).fill('');
    await page.reload();
    await openPodcast(page);
    // The reload set the half-written form aside; leave it where it is and open the episode.
    await section(page).locator('.entry-row').first().getByRole('button', { name: /^Edit/ }).click();
    await expect(frame(page).locator('.frame__status')).toContainText('Editing');
    await expectNoSidewaysScroll(page, 180);
    await expectWithinColumn(page, '.frame');
    expect(admin.problems).toEqual([]);
  });
}

test('every control of the form is a 44 px target, in both colour schemes (HIG #1)', async ({ browser, baseURL, request }, info) => {
  await resetPodcast(request, [publishedEpisode({ id: 'e000000030' })]);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openNew(page);
  for (const control of await section(page).locator('.composer button, .composer .segmented__option, .composer input:not([type=radio]), .composer textarea').all()) {
    const box = await control.boundingBox();
    const name = (await control.innerText().catch(() => '')) || ((await control.getAttribute('id')) ?? '');
    expect(box?.height ?? 0, name).toBeGreaterThanOrEqual(43.5);
  }
  await expectColourScheme(page, info);
});

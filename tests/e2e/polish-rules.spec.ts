// The live-review polish, the admin's rules and words (change note 05, PL1): an offer of kept text names the text
// (PL-7), a never-published draft may change language (PL-8), and an episode date after today is refused (PL-9).
// Every test runs in both colour schemes and loops the language of the entry or episode it works on (house rule 8).
import { expect, test } from '@playwright/test';
import { resetAdmin, signedInAdmin } from './admin-support.ts';
import { resetPodcast } from './podcast-support.ts';
import { LANGS, WORDS, body, chooseLanguage, episode, language, openEntries, openEntry, openEpisode, openPodcast, section, seedEntry, write } from './polish-support.ts';
import { DAY, NOW, expectNoSidewaysScroll, type Lang } from './support.ts';

test.beforeEach(async ({ request }) => {
  await resetAdmin(request, NOW);
});

// ── F1: an offer of kept text names the text (PL-7) ──

const SECOND: Record<Lang, { text: string; opening: string }> = {
  en: { text: 'A second thought, untitled.', opening: '“A second thought, untitled.”' },
  fa: { text: 'فکر دوم، بی‌عنوان.', opening: '«فکر دوم، بی‌عنوان.»' },
};

for (const lang of LANGS) {
  test(`with two entries kept, the offer names the newest, then the older after Put it back, in ${language(lang)} (PL-7)`, async ({ browser, baseURL, request }) => {
    const { page } = await signedInAdmin(browser, baseURL as string, request);
    // First text, titled; the page opens again, so it is set aside.
    await chooseLanguage(page, lang);
    await page.getByLabel('Title (optional)').fill(WORDS[lang].title);
    await write(page, WORDS[lang].text);
    await page.reload();
    // Second text, untitled; the page opens again, so both are kept and the newest is on top.
    await chooseLanguage(page, lang);
    await write(page, SECOND[lang].text);
    await page.reload();
    const offer = page.getByRole('status').filter({ hasText: 'You left something here.' });
    const name = offer.locator('.offer__name');
    await expect(name).toHaveText(SECOND[lang].opening);
    await expect(name).toHaveAttribute('dir', lang === 'fa' ? 'rtl' : 'ltr');
    await expect(name).toHaveAttribute('lang', lang);
    await offer.getByRole('button', { name: 'Put it back' }).click();
    await expect(body(page)).toHaveText(SECOND[lang].text);
    // Now the older one is what Put it back would restore, and the offer says so by its title.
    await expect(offer.locator('.offer__name')).toHaveText(WORDS[lang].title);
    await offer.getByRole('button', { name: 'Put it back' }).click();
    await expect(page.getByLabel('Title (optional)')).toHaveValue(WORDS[lang].title);
  });

  test(`changes left in an edit are offered under the entry's title, in ${language(lang)} (PL-7)`, async ({ browser, baseURL, request }) => {
    await seedEntry(request, lang);
    const { page } = await signedInAdmin(browser, baseURL as string, request);
    await openEntry(page, lang);
    await body(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(WORDS[lang].more);
    await page.reload();
    const offer = page.getByRole('status').filter({ hasText: 'You left changes here.' });
    await expect(offer.locator('.offer__name')).toHaveText(WORDS[lang].title);
    await expect(offer.locator('.offer__name')).toHaveAttribute('dir', lang === 'fa' ? 'rtl' : 'ltr');
    for (const width of [360, 180]) await expectNoSidewaysScroll(page, width);
  });

  test(`with two episodes kept, the offer names the newest ("No name yet" if it has none), then the older, in ${language(lang)} (PL-7)`, async ({ browser, baseURL, request }) => {
    await resetPodcast(request, []);
    const { page } = await signedInAdmin(browser, baseURL as string, request);
    await openPodcast(page);
    const start = async (named: boolean) => {
      await section(page).getByRole('button', { name: 'New episode', exact: true }).click();
      await chooseLanguage(page, lang, section(page));
      if (named) await section(page).getByLabel('Name', { exact: true }).fill(episode(lang).name ?? '');
      else await section(page).getByLabel('Description', { exact: true }).fill(episode(lang).description ?? '');
      await page.reload();
      await openPodcast(page);
    };
    await start(true);
    await start(false);
    const offer = section(page).getByRole('status').filter({ hasText: 'You left something here.' });
    await expect(offer.locator('.offer__name')).toHaveText('No name yet');
    await expect(offer.locator('.offer__name')).toHaveAttribute('dir', lang === 'fa' ? 'rtl' : 'ltr');
    await offer.getByRole('button', { name: 'Put it back' }).click();
    const next = section(page).getByRole('status').filter({ hasText: 'You left something here.' });
    await expect(next.locator('.offer__name')).toHaveText(episode(lang).name ?? '');
    for (const width of [360, 180]) await expectNoSidewaysScroll(page, width);
  });

  test(`changes left in an episode edit are offered under its name, in ${language(lang)} (PL-7)`, async ({ browser, baseURL, request }) => {
    await resetPodcast(request, [episode(lang)]);
    const { page } = await signedInAdmin(browser, baseURL as string, request);
    const frame = await openEpisode(page, lang);
    await frame.getByLabel('Description', { exact: true }).fill('Changed, never saved.');
    await page.reload();
    await openPodcast(page);
    const offer = section(page).getByRole('status').filter({ hasText: 'You left changes here.' });
    await expect(offer.locator('.offer__name')).toHaveText(episode(lang).name ?? '');
  });
}

// ── F2: a never-published draft may change language; a published or was-live one may not (PL-8) ──

for (const [from, to] of [['en', 'fa'], ['fa', 'en']] as const) {
  test(`a new entry written in ${from}, saved as a draft, then switched to ${to} and published, lands on the ${to} log only (PL-8)`, async ({ browser, baseURL, request }) => {
    const { page } = await signedInAdmin(browser, baseURL as string, request);
    await chooseLanguage(page, from);
    await write(page, WORDS[from].text);
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Draft saved.' })).toBeVisible();
    // The control is still usable, and the body turns with it.
    await expect(page.getByRole('radio', { name: from === 'fa' ? 'فارسی' : 'English' })).toBeEnabled();
    await chooseLanguage(page, to);
    await expect(body(page)).toHaveAttribute('dir', to === 'fa' ? 'rtl' : 'ltr');
    await page.getByRole('button', { name: /^Publish/ }).click();
    await expect(page.getByRole('status').filter({ hasText: "Published. It's out there." })).toBeVisible();
    // One entry, not two: the draft changed language and kept its row. It is on its new language's log, and not on the old one's.
    const list = await page.context().request.get('/admin/api/entries');
    const { entries } = (await list.json()) as { entries: { id: string; lang: string }[] };
    expect(entries.map((e) => e.lang)).toEqual([to]);
    const id = entries[0]?.id ?? '';
    expect((await request.get(`${to === 'fa' ? '/fa' : ''}/log/${id}`)).status()).toBe(200);
    expect((await request.get(`${to === 'fa' ? '' : '/fa'}/log/${id}`)).status()).toBe(404);
    expect(await (await request.get(to === 'fa' ? '/fa/log' : '/log')).text()).toContain(id);
    expect(await (await request.get(to === 'fa' ? '/log' : '/fa/log')).text()).not.toContain(id);
    // The last language used is the new one (AC-42).
    await expect(page.getByRole('radio', { name: to === 'fa' ? 'فارسی' : 'English' })).toBeChecked();
  });
}

test('an opened never-published entry shows the language control, and Save draft changes it in the list; a published and a was-live one show none (PL-8)', async ({ browser, baseURL, request }) => {
  const res = await request.post('/__test/entries', {
    data: {
      entries: [
        { id: 'a000000011', lang: 'en', title: 'A new draft', text: 'Never published.', state: 'draft' },
        { id: 'a000000012', lang: 'en', title: 'Was live', text: 'It was out.', state: 'draft', firstPublishedAt: NOW - 3 * DAY },
        { id: 'a000000013', lang: 'en', title: 'Published one', text: 'It is out.', firstPublishedAt: NOW - 4 * DAY },
      ],
    },
  });
  expect(res.ok()).toBe(true);
  const { page } = await signedInAdmin(browser, baseURL as string, request);
  await openEntries(page);
  for (const name of ['Was live', 'Published one']) {
    await page.getByRole('button', { name: `Edit ${name}` }).click();
    await expect(page.locator('.frame .frame__status')).toContainText(/Editing|Draft/);
    await expect(page.locator('.frame').getByRole('radio')).toHaveCount(0);
    await page.locator('.frame').getByRole('button', { name: 'Cancel' }).click();
  }
  await page.getByRole('button', { name: 'Edit A new draft' }).click();
  const frame = page.locator('.frame');
  await expect(frame.getByRole('radio')).toHaveCount(2);
  await chooseLanguage(page, 'fa', frame);
  await expect(body(page)).toHaveAttribute('dir', 'rtl');
  await frame.getByRole('button', { name: 'Save draft' }).click();
  await expect(frame.getByRole('status').filter({ hasText: 'Draft saved.' })).toBeVisible();
  const row = page.locator('.entry-row').filter({ hasText: 'A new draft' });
  await expect(row.locator('.pill', { hasText: 'Persian' })).toHaveCount(1);
  // Publishing then fixes it: the control is gone from the frame.
  await frame.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(frame.getByRole('status').filter({ hasText: "Published. It's out there." })).toBeVisible();
  await expect(frame.getByRole('radio')).toHaveCount(0);
  expect((await request.get('/fa/log/a000000011')).status()).toBe(200);
  expect((await request.get('/log/a000000011')).status()).toBe(404);
});

test('a language change left unsaved at a reload comes back with Put them back (AC-43, PL-8)', async ({ browser, baseURL, request }) => {
  await seedEntry(request, 'en', { state: 'draft', firstPublishedAt: null });
  const { page } = await signedInAdmin(browser, baseURL as string, request);
  const frame = await openEntry(page, 'en');
  await chooseLanguage(page, 'fa', frame);
  await page.reload();
  const offer = page.getByRole('status').filter({ hasText: 'You left changes here.' });
  await expect(offer).toBeVisible();
  await offer.getByRole('button', { name: 'Put them back' }).click();
  await expect(page.locator('.frame').getByRole('radio', { name: 'فارسی' })).toBeChecked();
  await expect(body(page)).toHaveAttribute('dir', 'rtl');
});

test("a buffer stored before PL1, with no language, opens in the row's own language (AC-43, PL-8)", async ({ browser, baseURL, request }) => {
  await seedEntry(request, 'fa', { state: 'draft', firstPublishedAt: null });
  const { page } = await signedInAdmin(browser, baseURL as string, request);
  await page.evaluate(
    (title) => localStorage.setItem('imnstr:entry:edit', JSON.stringify({ id: 'a000000010', title, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ویرایش قدیمی.' }] }] } })),
    WORDS.fa.title,
  );
  await page.reload();
  const offer = page.getByRole('status').filter({ hasText: 'You left changes here.' });
  await offer.getByRole('button', { name: 'Put them back' }).click();
  // Never read as English: the row is Persian, and so is the form.
  await expect(page.locator('.frame').getByRole('radio', { name: 'فارسی' })).toBeChecked();
  await expect(body(page)).toHaveAttribute('dir', 'rtl');
});

for (const [from, to] of [['en', 'fa'], ['fa', 'en']] as const) {
  test(`an episode saved as a draft in ${from} and switched to ${to} in its frame publishes onto the ${to} podcast page only (PL-8)`, async ({ browser, baseURL, request }) => {
    await resetPodcast(request, [episode(from, { state: 'draft', firstPublishedAt: null })]);
    const { page } = await signedInAdmin(browser, baseURL as string, request);
    const frame = await openEpisode(page, from);
    await expect(frame.getByRole('radio')).toHaveCount(2);
    await chooseLanguage(page, to, frame);
    await frame.getByRole('button', { name: /^Publish/ }).click();
    await expect(frame.getByRole('status').filter({ hasText: "Published. It's on the podcast page." })).toBeVisible();
    await expect(frame.getByRole('radio')).toHaveCount(0);
    const name = from === 'fa' ? 'ساختن در جمع' : 'Building in public';
    expect(await (await request.get(to === 'fa' ? '/fa/podcast' : '/podcast')).text()).toContain(name);
    expect(await (await request.get(to === 'fa' ? '/podcast' : '/fa/podcast')).text()).not.toContain(name);
    const list = await page.context().request.get('/admin/api/episodes');
    expect(((await list.json()) as { episodes: { lang: string }[] }).episodes.map((e) => e.lang)).toEqual([to]);
  });
}

test('a published and a was-live episode show no language control; a never-published one does (PL-8)', async ({ browser, baseURL, request }) => {
  await resetPodcast(request, [
    episode('en', { id: 'e000000001', name: 'Published one' }),
    episode('en', { id: 'e000000002', name: 'Was live', state: 'draft', firstPublishedAt: NOW - 4 * DAY }),
    episode('en', { id: 'e000000003', name: 'Fresh draft', state: 'draft', firstPublishedAt: null }),
  ]);
  const { page } = await signedInAdmin(browser, baseURL as string, request);
  await openPodcast(page);
  for (const [name, count] of [['Published one', 0], ['Was live', 0], ['Fresh draft', 2]] as const) {
    await section(page).getByRole('button', { name: `Edit ${name}` }).click();
    await expect(section(page).locator('.frame .frame__status')).toContainText(/Editing|Draft/);
    await expect(section(page).locator('.frame').getByRole('radio')).toHaveCount(count);
    await section(page).locator('.frame').getByRole('button', { name: 'Cancel', exact: true }).click();
  }
});

// ── F3: an episode date after today is refused at the date field (PL-9) ──

for (const lang of LANGS) {
  test(`a date after today is refused at the date field with nothing lost, in ${language(lang)} (PL-9)`, async ({ browser, baseURL, request }) => {
    await resetPodcast(request, []);
    const { page } = await signedInAdmin(browser, baseURL as string, request);
    await openPodcast(page);
    await section(page).getByRole('button', { name: 'New episode', exact: true }).click();
    await chooseLanguage(page, lang, section(page));
    await section(page).getByLabel('Name', { exact: true }).fill(episode(lang).name ?? '');
    await section(page).getByLabel('Description', { exact: true }).fill(episode(lang).description ?? '');
    await section(page).getByLabel('Tag', { exact: true }).fill(episode(lang).tags?.[0] ?? '');
    await section(page).getByRole('button', { name: 'YouTube', exact: true }).click();
    await section(page).getByLabel('Address', { exact: true }).fill('https://youtu.be/q81abc');
    // The field's `max` is the server's today, which the list carries.
    const today = ((await (await page.context().request.get('/admin/api/episodes')).json()) as { today: string }).today;
    const date = section(page).getByLabel('Date', { exact: true });
    await expect(date).toHaveAttribute('max', today);
    const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + DAY).toISOString().slice(0, 10);
    await date.fill(tomorrow);
    await section(page).getByRole('button', { name: /^Publish/ }).click();
    const problem = section(page).locator('.field__error');
    await expect(problem).toHaveText("That day hasn't come yet. Pick today or an earlier day.");
    await expect(date).toHaveAttribute('aria-invalid', 'true');
    await expect(date).toHaveAttribute('aria-describedby', (await problem.getAttribute('id')) ?? '');
    await expect(date).toBeFocused();
    // Said once, at the field: no failure notice in the dock, and everything typed is still there.
    await expect(section(page).locator('.dock .notice--error')).toHaveCount(0);
    await expect(section(page).getByLabel('Name', { exact: true })).toHaveValue(episode(lang).name ?? '');
    await expect(section(page).getByLabel('Address', { exact: true })).toHaveValue('https://youtu.be/q81abc');
    for (const width of [360, 180]) await expectNoSidewaysScroll(page, width);
    await page.setViewportSize({ width: 360, height: 800 });
    // An earlier day clears the refusal and publishes.
    await date.fill(today);
    await expect(problem).toHaveCount(0);
    await section(page).getByRole('button', { name: /^Publish/ }).click();
    await expect(section(page).getByRole('status').filter({ hasText: "Published. It's on the podcast page." })).toBeVisible();
  });
}

test('an edit that keeps a date after today saves, and a new later date is refused at the field (PL-9)', async ({ browser, baseURL, request }) => {
  // Seeded after the fixed clock, as the fixtures in the other specs are: the exception is why they still save.
  await resetPodcast(request, [episode('en', { date: '2026-10-24' })]);
  const { page } = await signedInAdmin(browser, baseURL as string, request);
  const frame = await openEpisode(page, 'en');
  await frame.getByLabel('Description', { exact: true }).fill('A typo fixed.');
  await frame.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(frame.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await frame.getByLabel('Date', { exact: true }).fill('2026-10-25');
  await frame.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(frame.locator('.field__error')).toHaveText("That day hasn't come yet. Pick today or an earlier day.");
  await expect(frame.getByLabel('Description', { exact: true })).toHaveValue('A typo fixed.');
});

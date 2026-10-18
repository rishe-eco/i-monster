// The editor in a real browser (plan B6, plates 7, 8, 12, 14): the bare editor first. Writing and
// publishing in both languages, the toolbar, pasting, the bidi runs, Save draft and Save, and the
// 360 px phone with the keyboard up and at 200% zoom. Every test runs in both colour schemes.
// "Nothing lost" (buffers, failures, signing in over the text) has its own tests below these.
import { expect, test, type Page } from '@playwright/test';
import { expectDialogPlace, expectSolidInk, signedInAdmin, resetAdmin, type Admin } from './admin-support.ts';
import { DAY, MIXED, NOW, expectColourScheme, expectNoSidewaysScroll, expectNoThirdParty, expectWithinColumn, type Lang } from './support.ts';

test.beforeEach(async ({ request }) => {
  await resetAdmin(request, NOW);
});

const PROMPT = 'What did you learn? Say it so someone else would get it.';

const body = (page: Page) => page.getByRole('textbox', { name: 'Entry text' });
const titleField = (page: Page) => page.getByLabel('Title (optional)');
const publishButton = (page: Page) => page.getByRole('button', { name: /^Publish/ });
const saveDraftButton = (page: Page) => page.getByRole('button', { name: /^Save draft|^Saved$/ });
const language = (page: Page, lang: Lang) => page.getByRole('radio', { name: lang === 'fa' ? 'فارسی' : 'English' });

/** Type into the body, one key at a time, as a phone's keyboard would. */
async function write(page: Page, text: string): Promise<void> {
  await body(page).click();
  await page.keyboard.type(text);
}

/** Select the last `count` characters before the caret. In right-to-left text, "back" is the right arrow. */
async function selectBack(page: Page, count: number, lang: Lang = 'en'): Promise<void> {
  for (let i = 0; i < count; i++) await page.keyboard.press(lang === 'fa' ? 'Shift+ArrowRight' : 'Shift+ArrowLeft');
  // Key presses come faster than any hand; let the editor see the final selection before a toolbar button reads it.
  await settle(page);
}

/** Let the browser report a selection change before the next key moves it again: it merges the changes of two quick key presses into one. */
const settle = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

/** What the server lists, as the signed-in page sees it. */
async function listed(admin: Admin) {
  const res = await admin.context.request.get('/admin/api/entries');
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { entries: { id: string; lang: Lang; title: string | null; state: string; excerpt: string }[] }).entries;
}

/** What every view must hold at 360 px, in the scheme under test. */
async function expectFits(admin: Admin, info: Parameters<typeof expectColourScheme>[1]): Promise<void> {
  await expectNoSidewaysScroll(admin.page);
  await expectColourScheme(admin.page, info);
  await expectNoThirdParty(admin.page, admin.requests);
  expect(admin.problems).toEqual([]);
}

const idOf = async (page: Page): Promise<string> => {
  const href = (await page.getByRole('link', { name: 'Open' }).getAttribute('href')) ?? '';
  return href.slice(href.lastIndexOf('/') + 1);
};

test('the editor is first and empty, with its labels and its prompt, in the language last used (W1, AC-18, AC-42, J2.2)', async ({ browser, baseURL, request }, info) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await expect(page.getByRole('group', { name: 'Language' })).toBeVisible();
  // English on the very first entry (decision 4).
  await expect(language(page, 'en')).toBeChecked();
  await expect(language(page, 'fa')).not.toBeChecked();
  // The title field stops at the API's cap, so the person never meets the refusal (F-16).
  await expect(titleField(page)).toHaveAttribute('maxlength', '1000');
  // The language control comes first, then the title, then the body, then the actions: the editor above Entries.
  const order = await page.evaluate(() => {
    const at = (selector: string) => document.querySelector(selector);
    const before = (a: Element | null, b: Element | null) => Boolean(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return {
      languageThenTitle: before(at('.segmented'), at('input[id$="-title"]')),
      titleThenBody: before(at('input[id$="-title"]'), at('.ProseMirror')),
      bodyThenActions: before(at('.ProseMirror'), at('.composer__actions')),
      editorThenEntries: before(at('.composer'), at('#entries-body')),
    };
  });
  expect(order).toEqual({ languageThenTitle: true, titleThenBody: true, bodyThenActions: true, editorThenEntries: true });
  // Real labels: the title's <label>, and the body named for assistive technology.
  await expect(titleField(page)).toBeVisible();
  await expect(body(page)).toBeVisible();
  // The prompt is a placeholder drawn by CSS, and goes when there is text (AC-18).
  const prompt = () => page.locator('.editor__body').evaluate((el) => getComputedStyle(el, '::before').content);
  expect(await prompt()).toBe(`"${PROMPT}"`);
  await body(page).click();
  await page.keyboard.type('x');
  expect(await prompt()).toBe('none');
  await page.keyboard.press('Backspace');
  expect(await prompt()).toBe(`"${PROMPT}"`);
  // The two actions, by their words; neither is an icon (HIG #6).
  await expect(saveDraftButton(page)).toHaveText('Save draft');
  await expect(publishButton(page)).toHaveText('Publish');
  await expect(page.getByRole('button', { name: 'Link', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Highlight', exact: true })).toBeVisible();
  // No style attribute anywhere in the editor: the CSP refuses them.
  expect(await page.locator('.composer [style]').count()).toBe(0);
  // Every control is a 44 px target.
  for (const control of await page.locator('.composer button, .composer .segmented__option').all()) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
  }
  await expectFits(admin, info);
});

for (const lang of ['en', 'fa'] as const) {
  test(`J1.6 to J1.10: write two paragraphs and a link, publish once, and read it as a reader would, in ${lang === 'fa' ? 'Persian' : 'English'} (AC-12, AC-18, AC-42)`, async ({ browser, baseURL, request }, info) => {
    const admin = await signedInAdmin(browser, baseURL as string, request);
    const { page } = admin;
    if (lang === 'fa') await language(page, 'fa').check();
    await expect(language(page, lang)).toBeChecked();
    // The language sets lang and dir on the title and the body (AC-42).
    for (const el of [titleField(page), body(page)]) {
      await expect(el).toHaveAttribute('lang', lang);
      await expect(el).toHaveAttribute('dir', lang === 'fa' ? 'rtl' : 'ltr');
    }

    const first = lang === 'fa' ? 'امروز یاد گرفتم که کوچک شروع کنم.' : 'A streak turns a habit I chose into a debt I owe.';
    const second = lang === 'fa' ? 'ببینید مقاله' : 'See the paper';
    await write(page, first);
    await page.keyboard.press('Enter');
    await page.keyboard.type(second);
    await selectBack(page, lang === 'fa' ? 5 : 9, lang);
    await page.getByRole('button', { name: 'Link', exact: true }).click();
    const address = page.getByLabel('Link address');
    await expect(address).toBeFocused();
    await address.fill('https://example.org/paper');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(body(page).locator('a[href="https://example.org/paper"]')).toHaveCount(1);
    await expectFits(admin, info);

    // The title is optional: none typed, and one tap publishes (AC-12, AC-18).
    await publishButton(page).click();
    const done = page.getByRole('status').filter({ hasText: "Published. It's out there." });
    await expect(done).toBeVisible();
    const id = await idOf(page);
    const path = `${lang === 'fa' ? '/fa' : ''}/log/${id}`;
    await expect(done).toContainText(`localhost`);
    await expect(done).toContainText(path);
    await expect(page.getByRole('link', { name: 'Open' })).toHaveAttribute('href', path);
    // The editor is empty again, and the next entry starts in the language just used.
    await expect(body(page)).toHaveText('');
    await expect(titleField(page)).toHaveValue('');
    await expect(language(page, lang)).toBeChecked();
    await expect(publishButton(page)).toBeEnabled();

    // One entry, dated by the server, with the two paragraphs and the link, on the public page and in the feed.
    expect((await listed(admin)).map((entry) => [entry.id, entry.lang, entry.title, entry.state])).toEqual([[id, lang, null, 'published']]);
    const html = await (await request.get(path)).text();
    expect(html).toContain(first);
    expect(html).toContain('<a href="https://example.org/paper"');
    expect((html.match(/<p[ >]/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(await (await request.get(lang === 'fa' ? '/fa/log/feed.xml' : '/log/feed.xml')).text()).toContain(id);

    // The next entry starts in that language on a fresh page, too: the server remembers it (PD-10).
    await page.reload();
    await expect(language(page, lang)).toBeChecked();
    await expectFits(admin, info);
  });
}

test('a title, once typed, is published with the entry and shown by the list (AC-42)', async ({ browser, baseURL, request }, info) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await titleField(page).fill('Two passkeys can be one key');
  await write(page, 'Body text.');
  await publishButton(page).click();
  await expect(page.getByRole('status').filter({ hasText: "Published. It's out there." })).toBeVisible();
  expect((await listed(admin)).map((entry) => entry.title)).toEqual(['Two passkeys can be one key']);
  await expect(titleField(page)).toHaveValue('');
  await expectFits(admin, info);
});

test('Publish says Publishing… while it works, cannot be tapped twice, and makes one entry (PD-11, AC-25, HIG #5)', async ({ browser, baseURL, request }, info) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  // The server answers slowly, so the window in which a second tap could land is wide open.
  const posts: string[] = [];
  await page.route('**/admin/api/entries', async (route) => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().url());
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    await route.continue();
  });
  await write(page, 'One entry, however many taps.');
  const publish = publishButton(page);
  await publish.dblclick();
  // While it is in flight: the button is the spinner, and the text can be read and not changed.
  await expect(page.getByRole('button', { name: 'Publishing…' })).toBeDisabled();
  await expect(body(page)).toHaveAttribute('contenteditable', 'false');
  await expect(page.getByRole('status').filter({ hasText: "Published. It's out there." })).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(await listed(admin)).toHaveLength(1);
  // Solid ink, apart from the highlighter (HIG #5, PL-1): the primary button is the ink, in the scheme under test.
  await expectSolidInk(publish);
  expect(await publish.evaluate((el) => el.classList.contains('btn--solid'))).toBe(false);
  await expectFits(admin, info);
});

test('the toolbar: Highlight marks the selection, and Link wraps it and opens its address in place, refuses a bad one, edits and removes it (F5, PD-7)', async ({ browser, baseURL, request }, info) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await write(page, 'Say it so someone else would get it');
  const highlight = page.getByRole('button', { name: 'Highlight', exact: true });
  const link = page.getByRole('button', { name: 'Link', exact: true });

  // Highlight: on for the selected words, pressed while the caret is in them.
  await selectBack(page, 6);
  await highlight.click();
  await expect(body(page).locator('mark')).toHaveText('get it');
  await expect(highlight).toHaveAttribute('aria-pressed', 'true');
  // The same words again turn it off.
  await highlight.click();
  await expect(body(page).locator('mark')).toHaveCount(0);
  await expect(highlight).toHaveAttribute('aria-pressed', 'false');

  // Link with nothing selected says what to do, and does not open a field.
  await page.keyboard.press('ArrowRight');
  await link.click();
  await expect(page.getByText('Select the words to link first.')).toBeVisible();
  await expect(page.getByLabel('Link address')).toHaveCount(0);

  // Link on selected words: the field opens in place, with the cursor in it.
  await selectBack(page, 12);
  await link.click();
  const address = page.getByLabel('Link address');
  await expect(address).toBeFocused();
  await expect(page.getByRole('button', { name: 'Remove link' })).toHaveCount(0);
  await expectFits(admin, info);

  // An address the schema refuses is refused at the field: nothing changes, and no dialog opens.
  await address.fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByText("That address can't be used.")).toBeVisible();
  await expect(body(page).locator('a')).toHaveCount(0);
  await address.fill('example.org');
  await address.press('Enter');
  await expect(page.getByText("That address can't be used.")).toBeVisible();
  await expect(body(page).locator('a')).toHaveCount(0);

  // An allowed one wraps the words.
  await address.fill('https://example.org/paper');
  await address.press('Enter');
  await expect(body(page).locator('a')).toHaveAttribute('href', 'https://example.org/paper');
  await expect(body(page).locator('a')).toHaveText('else would get it'.slice(-12));
  await expect(page.getByLabel('Link address')).toHaveCount(0);

  // The caret inside the link opens the same field, with its address, and Remove link.
  await page.keyboard.press('ArrowRight');
  await settle(page);
  await page.keyboard.press('ArrowLeft');
  await settle(page);
  await expect(page.getByLabel('Link address')).toHaveValue('https://example.org/paper');
  await expect(body(page)).toBeFocused();
  await page.getByLabel('Link address').fill('mailto:me@example.org');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(body(page).locator('a')).toHaveAttribute('href', 'mailto:me@example.org');
  // Done closes the field while the caret stays in the link; Link opens it again, on that link.
  await expect(page.getByLabel('Link address')).toHaveCount(0);
  await link.click();
  await expect(page.getByLabel('Link address')).toHaveValue('mailto:me@example.org');
  await page.getByRole('button', { name: 'Remove link' }).click();
  await expect(body(page).locator('a')).toHaveCount(0);
  await expect(body(page)).toHaveText('Say it so someone else would get it');
  await expectFits(admin, info);
});

test('pasting reduces anything to the schema: <b> and <em> are plain text, <mark> is the highlight, a javascript: link is its text (PD-7, S-5)', async ({ browser, baseURL, request }, info) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await body(page).click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    // U+000B is Word's line break; one in an entry would make the whole feed unreadable (S-5).
    data.setData(
      'text/html',
      '<p>plain <b>bold</b> <strong>strong</strong> <em>em</em> <mark>marked</mark> <a href="javascript:alert(1)">bad link</a> <a href="https://ok.example/page">good link</a> vt\u000Bchar</p><h2>a heading</h2>',
    );
    data.setData('text/plain', 'plain bold strong em marked bad link good link');
    const target = document.querySelector('.ProseMirror');
    target?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  const editor = body(page);
  await expect(editor.locator('b, strong, em, h2, [style]')).toHaveCount(0);
  await expect(editor.locator('mark')).toHaveText('marked');
  await expect(editor.locator('a')).toHaveCount(1);
  await expect(editor.locator('a')).toHaveAttribute('href', 'https://ok.example/page');
  await expect(editor.locator('a')).toHaveText('good link');
  const text = await editor.innerText();
  expect(text).toContain('bad link');
  expect(text).toContain('bold strong em');
  expect(text).not.toContain('\u000B');
  // The document it makes is one the server accepts: publish it.
  await publishButton(page).click();
  await expect(page.getByRole('status').filter({ hasText: "Published. It's out there." })).toBeVisible();
  const [entry] = await listed(admin);
  expect(entry?.state).toBe('published');
  const html = await (await request.get(`/log/${entry?.id}`)).text();
  expect(html).not.toContain('javascript:');
  expect(html).not.toContain('<strong>');
  expect(html).toContain('<a href="https://ok.example/page"');
  await expectFits(admin, info);
});

test('plain text pasted with line breaks becomes paragraphs, and an XML-forbidden character is dropped (S-5)', async ({ browser, baseURL, request }) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await body(page).click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'First line\nSecond\u000Bline\n\nThird');
    document.querySelector('.ProseMirror')?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  const paragraphs = await body(page).locator('p').allInnerTexts();
  expect(paragraphs.join('|')).toBe('First line|Secondline|Third');
  expect(admin.problems).toEqual([]);
});

test('Enter twice leaves no empty paragraph in what is sent (S-4)', async ({ browser, baseURL, request }) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await write(page, 'One.');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Two.');
  const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/admin/api/entries'));
  await publishButton(page).click();
  const json = (await (await sent).postDataJSON()) as { body: { content: { type: string; content?: unknown[] }[] } };
  expect(json.body.content).toHaveLength(2);
  expect(json.body.content.every((p) => Array.isArray(p.content) && p.content.length > 0)).toBe(true);
  await expect(page.getByRole('status').filter({ hasText: "Published. It's out there." })).toBeVisible();
});

test('nothing typed: Publish says so at once, in words, and sends nothing (AC-18, BODY_REQUIRED)', async ({ browser, baseURL, request }) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  const posts: string[] = [];
  page.on('request', (r) => r.method() === 'POST' && r.url().includes('/admin/api/entries') && posts.push(r.url()));
  await publishButton(page).click();
  await expect(page.getByRole('alert').filter({ hasText: "There's nothing to save yet. Write something first." })).toBeVisible();
  expect(posts).toEqual([]);
  // A title alone is not a body.
  await titleField(page).fill('Only a title');
  await saveDraftButton(page).click();
  await expect(page.getByRole('alert')).toContainText('Write something first.');
  expect(posts).toEqual([]);
});

for (const lang of ['en', 'fa'] as const) {
  test(`a ${lang === 'fa' ? 'Persian' : 'English'} paragraph with a word and a URL of the other script keeps its order in the editor and on the page (PD-8, AC-48)`, async ({ browser, baseURL, request }, info) => {
    const admin = await signedInAdmin(browser, baseURL as string, request);
    const { page } = admin;
    if (lang === 'fa') await language(page, 'fa').check();
    const plain = MIXED[lang].text.replace(/==/g, '');
    await titleField(page).fill(MIXED[lang].title);
    await write(page, plain);
    const editor = body(page);
    // The paragraph's direction is the language's, whatever its first character is.
    await expect(editor).toHaveAttribute('dir', lang === 'fa' ? 'rtl' : 'ltr');
    await expect(editor).toHaveAttribute('lang', lang);
    // The runs of the other script, and the URL, are isolated spans, as lib/bidi.ts finds them.
    const isolated = await editor.locator('bdi').evaluateAll((els) => els.map((el) => ({ text: el.textContent, lang: el.getAttribute('lang'), dir: el.getAttribute('dir') })));
    expect(isolated.length).toBeGreaterThan(1);
    const url = isolated.find((run) => run.dir === 'ltr');
    expect(url?.text).toContain('https://example.org/passkeys/');
    if (lang === 'fa') expect(isolated.some((run) => run.lang === 'en' && run.text === 'Passkey')).toBe(true);
    else expect(isolated.some((run) => run.lang === 'fa' && run.dir === 'rtl')).toBe(true);
    // Typing char by char, with every keystroke redrawing the runs, left the text exactly as typed.
    expect((await editor.innerText()).replace(/\s+/g, ' ').trim()).toBe(plain.replace(/\s+/g, ' ').trim());
    await info.attach('editor', { body: await page.locator('.composer').screenshot(), contentType: 'image/png' });

    await publishButton(page).click();
    await expect(page.getByRole('status').filter({ hasText: "Published. It's out there." })).toBeVisible();
    const id = await idOf(page);
    // The page isolates the same runs the editor did (AC-48: the page and the editor agree).
    const pageHtml = await (await request.get(`${lang === 'fa' ? '/fa' : ''}/log/${id}`)).text();
    const pageBody = pageHtml.slice(pageHtml.indexOf('entry-page__body'), pageHtml.indexOf('</article>'));
    const onPage = [...pageBody.matchAll(/<bdi[^>]*>([^<]*)<\/bdi>/g)].map((m) => (m[1] ?? '').replace(/&amp;/g, '&'));
    expect(onPage).toEqual(isolated.map((run) => run.text));
    await expectFits(admin, info);
  });
}

test('Save draft keeps the entry on the server, off every public page, and the button then reads Saved (AC-44, J2.11)', async ({ browser, baseURL, request }, info) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await titleField(page).fill('On the bus');
  await write(page, 'Half a thought about why the second passkey matters more than the first.');
  await saveDraftButton(page).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved.' })).toContainText("It's in Entries, not on the site. Open it from any signed-in device.");
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeDisabled();
  // The text stays in the editor: the person may go on, and publish from here.
  await expect(titleField(page)).toHaveValue('On the bus');
  await expect(body(page)).toContainText('Half a thought');
  const [entry] = await listed(admin);
  expect(entry).toMatchObject({ lang: 'en', title: 'On the bus', state: 'draft' });
  expect(await (await request.get('/log')).text()).not.toContain(entry?.id ?? '-');
  expect((await request.get(`/log/${entry?.id}`)).status()).toBe(404);
  // The language is the row's now: the control can't change it under a saved draft.
  await expect(language(page, 'fa')).toBeDisabled();
  await expectFits(admin, info);

  // Going on: the next change brings Save draft back, and saves onto the same row.
  await body(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' More.');
  await expect(saveDraftButton(page)).toHaveText('Save draft');
  await saveDraftButton(page).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeDisabled();
  expect(await listed(admin)).toHaveLength(1);

  // Publishing a saved draft is the same row, published: still one entry, and the editor is empty.
  await body(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Done.');
  await publishButton(page).click();
  await expect(page.getByRole('status').filter({ hasText: "Published. It's out there." })).toBeVisible();
  const after = await listed(admin);
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({ id: entry?.id, state: 'published' });
  expect(await (await request.get(`/log/${entry?.id}`)).text()).toContain('More. Done.');
  await expect(titleField(page)).toHaveValue('');
  await expect(language(page, 'fa')).toBeEnabled();
});

test('a draft saved on one device is in the list on a second, opens there, and publishes there; it was on no public page until then (AC-44, J2.11, J2.12)', async ({ browser, baseURL, request }, info) => {
  const phone = await signedInAdmin(browser, baseURL as string, request);
  const laptop = await signedInAdmin(browser, baseURL as string, request);
  await phone.page.getByLabel('Title (optional)').fill('On the bus');
  await write(phone.page, 'Half a thought. Not ready yet.');
  await saveDraftButton(phone.page).click();
  await expect(phone.page.getByRole('status').filter({ hasText: 'Draft saved.' })).toBeVisible();

  const { page } = laptop;
  await page.getByRole('button', { name: 'Entries', exact: true }).click();
  const row = page.locator('.entry-row').filter({ hasText: 'On the bus' });
  await expect(row).toHaveCount(1);
  await expect(row.locator('.pill')).toHaveText(['draft']);
  const id = (await listed(laptop))[0]?.id ?? '';
  expect((await request.get(`/log/${id}`)).status()).toBe(404);
  await row.getByRole('button', { name: /^Edit/ }).click();
  const frame = page.locator('.frame');
  await expect(frame.locator('.frame__status')).toHaveText('Draft');
  await expect(frame.getByLabel('Title (optional)')).toHaveValue('On the bus');
  await expect(frame.getByRole('textbox', { name: 'Entry text' })).toContainText('Half a thought. Not ready yet.');
  await frame.getByRole('textbox', { name: 'Entry text' }).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Finished at home.');
  await frame.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(frame.getByRole('status').filter({ hasText: "Published. It's out there." })).toBeVisible();
  expect(await (await request.get(`/log/${id}`)).text()).toContain('Finished at home.');
  // One row, dated at this first publish.
  const after = await listed(laptop);
  expect(after).toHaveLength(1);
  expect(after[0]?.state).toBe('published');
  await expectFits(laptop, info);
  await phone.context.close();
});

test('Copy link copies the entry\'s address, says Copied for a moment, then goes back (F16)', async ({ browser, baseURL, request }) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await admin.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL as string });
  await write(page, 'Link me.');
  await publishButton(page).click();
  const done = page.getByRole('status').filter({ hasText: "Published. It's out there." });
  await expect(done).toBeVisible();
  const id = await idOf(page);
  const copy = done.getByRole('button', { name: 'Copy link' });
  await copy.click();
  await expect(done.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${baseURL}/log/${id}`);
  // Back to Copy link after its moment (limits.copiedMs, two seconds).
  await expect(done.getByRole('button', { name: 'Copy link', exact: true })).toBeVisible({ timeout: 5000 });
  // The confirmation goes when the next entry is started.
  await page.keyboard.press('Escape');
  await body(page).click();
  await page.keyboard.type('Next.');
  await expect(done).toHaveCount(0);
});

for (const lang of ['en', 'fa'] as const) {
  test(`an edit: Edit puts the ${lang === 'fa' ? 'Persian' : 'English'} entry in the same editor, with no language control, and Save changes the text and nothing else (J2.7, AC-13)`, async ({ browser, baseURL, request }, info) => {
    const id = 'a000000010';
    const path = `${lang === 'fa' ? '/fa' : ''}/log/${id}`;
    const seeded = await request.post('/__test/entries', {
      data: { entries: [{ id, lang, title: MIXED[lang].title, text: `${MIXED[lang].text}\n\nSee [the paper](https://example.org/paper).`, firstPublishedAt: NOW - 2 * DAY }] },
    });
    expect(seeded.ok()).toBe(true);
    const admin = await signedInAdmin(browser, baseURL as string, request);
    const { page } = admin;
    await page.getByRole('button', { name: 'Entries', exact: true }).click();
    await page.getByRole('button', { name: `Edit ${MIXED[lang].title}` }).click();
    const frame = page.locator('.frame');
    await expect(frame.locator('.frame__status')).toHaveText('Editing · published 8 Oct 2026');
    // The same editor, in the frame: title, body, toolbar; no language control, since an edit never changes it (AC-13).
    await expect(frame.getByRole('group', { name: 'Language' })).toHaveCount(0);
    await expect(frame.getByLabel('Title (optional)')).toHaveValue(MIXED[lang].title);
    await expect(frame.getByLabel('Title (optional)')).toHaveAttribute('dir', lang === 'fa' ? 'rtl' : 'ltr');
    const editor = frame.getByRole('textbox', { name: 'Entry text' });
    await expect(editor).toHaveAttribute('dir', lang === 'fa' ? 'rtl' : 'ltr');
    await expect(editor).toHaveAttribute('lang', lang);
    // The marks come in: the highlight, the link, and the isolated runs.
    await expect(editor.locator('mark')).toHaveCount(1);
    await expect(editor.locator('a[href="https://example.org/paper"]')).toHaveCount(1);
    await expect(editor.locator('bdi[dir="ltr"]').first()).toContainText('https://example.org/passkeys/');
    // Actions for a published entry: Unpublish and Save.
    await expect(frame.getByRole('button', { name: 'Unpublish', exact: true })).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    await expect(frame.getByRole('button', { name: /Publish/ })).toHaveCount(0);
    await expectFits(admin, info);

    // Fix the link and save: the text changes on the page, its URL and date stay, and nothing marks it edited.
    const before = await (await request.get(path)).text();
    await frame.getByLabel('Title (optional)').fill('A better title');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' Fixed.');
    await frame.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(frame.getByRole('status').filter({ hasText: 'Saved.' })).toContainText("The live entry shows this now. Its link and date haven't changed.");
    const after = await (await request.get(path)).text();
    expect(after).toContain('Fixed');
    expect(after).toContain('A better title');
    expect(after).not.toMatch(/edited|updated/i);
    const dateOf = (html: string) => /<time[^>]*datetime="([^"]+)"/.exec(html)?.[1];
    expect(dateOf(after)).toBe(dateOf(before));
    const [entry] = await listed(admin);
    expect(entry).toMatchObject({ id, state: 'published', title: 'A better title' });
    await expect(frame.locator('.frame__status')).toHaveText('Editing · published 8 Oct 2026');
    await expectFits(admin, info);
  });
}

test('at 360 x 400, as with the keyboard up, the tools and actions stay in view and nothing scrolls sideways (AC-15, J1.7)', async ({ browser, baseURL, request }, info) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await page.setViewportSize({ width: 360, height: 400 });
  await titleField(page).fill('A title');
  await write(page, Array.from({ length: 14 }, (_, i) => `Paragraph ${i + 1} is here to make the body taller than the screen.`).join('\n'));
  const inView = async (name: string | RegExp) => {
    const box = await page.getByRole('button', { name }).first().boundingBox();
    expect(box, String(name)).not.toBeNull();
    expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= 360, `${String(name)} is within the width`).toBe(true);
    expect((box?.y ?? -1) >= 0 && (box?.y ?? 0) + (box?.height ?? 0) <= 400, `${String(name)} is within the height`).toBe(true);
  };
  for (const name of ['Link', 'Highlight', 'Save draft', 'Publish'] as const) await inView(name);
  // The caret's line is in view too, above the dock.
  const caret = await page.evaluate(() => {
    const rect = getSelection()?.getRangeAt(0).getBoundingClientRect();
    return { top: rect?.top ?? -1, bottom: rect?.bottom ?? -1 };
  });
  const dock = await page.locator('.dock').boundingBox();
  expect(caret.top).toBeGreaterThanOrEqual(0);
  expect(caret.bottom).toBeLessThanOrEqual((dock?.y ?? 0) + 1);
  await expectNoSidewaysScroll(page);
  await expectColourScheme(page, info);
  expect(admin.problems).toEqual([]);
});

test('at 200% zoom (180 px) nothing scrolls sideways and the toolbar, the actions and the link field fit (HIG #8)', async ({ browser, baseURL, request }, info) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await write(page, 'Zoomed in, and still within reach.');
  await selectBack(page, 11);
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await page.getByLabel('Link address').fill('https://example.org/a-rather-long-address-to-test-wrapping');
  await expectNoSidewaysScroll(page, 180);
  await expectWithinColumn(page, '.composer');
  await expectColourScheme(page, info);

  // The frame too, with a Persian entry in it: the same editor, other actions (the B5 lesson: every view at 180 px).
  expect((await request.post('/__test/entries', { data: { entries: [{ id: 'a000000020', lang: 'fa', title: MIXED.fa.title, text: MIXED.fa.text, firstPublishedAt: NOW - 2 * DAY }] } })).ok()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Entries', exact: true }).click();
  await page.getByRole('button', { name: /^Edit/ }).first().click();
  await expect(page.locator('.frame .frame__status')).toContainText('Editing');
  await expectNoSidewaysScroll(page, 180);
  await expectWithinColumn(page, '.frame');
  expect(admin.problems).toEqual([]);
});

// ── Nothing is lost (plan B6, PD-12, AC-16, AC-43): buffers, failures, and signing in over the text ──

const MINUTE = 60_000;

/** A buffer as the page keeps it on this device, or null. */
async function buffer(page: Page, name: 'unsent' | 'edit' | 'kept'): Promise<Record<string, unknown> | null> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), `imnstr:entry:${name}`);
  return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
}

const publishedNotice = (page: Page) => page.getByRole('status').filter({ hasText: "Published. It's out there." });
const alertWith = (page: Page, text: string) => page.getByRole('alert').filter({ hasText: text });

/** Going offline makes the browser log a failed load, which is the point of the test and not a problem with the page. */
const forgiveOffline = (admin: Admin) => {
  admin.problems.splice(0, admin.problems.length, ...admin.problems.filter((message) => !/ERR_INTERNET_DISCONNECTED/.test(message)));
};

/** The publish keys of every request that creates an entry, in order. */
function watchKeys(page: Page): string[] {
  const keys: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/admin/api/entries')) keys.push((r.postDataJSON() as { publishKey: string }).publishKey);
  });
  return keys;
}

/** Seed one published entry and return its id. */
async function seedPublished(request: Parameters<typeof resetAdmin>[0], lang: Lang = 'en'): Promise<string> {
  const id = 'a000000010';
  const res = await request.post('/__test/entries', { data: { entries: [{ id, lang, title: 'An old entry', text: 'Broken link here, see the paper.', firstPublishedAt: NOW - 2 * DAY }] } });
  expect(res.ok()).toBe(true);
  return id;
}

async function openEdit(page: Page): Promise<void> {
  const entries = page.getByRole('button', { name: 'Entries', exact: true });
  if ((await entries.getAttribute('aria-expanded')) !== 'true') await entries.click();
  await page.getByRole('button', { name: 'Edit An old entry' }).click();
  await expect(page.locator('.frame .frame__status')).toContainText('Editing');
}

test('J3.1, J3.2: the network drops during a publish. It says so, keeps the text, sends nothing by itself, and a tap sends it again with the same key: one entry (AC-16, AC-25, G4)', async ({ browser, baseURL, request }, info) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  const keys = watchKeys(page);
  await titleField(page).fill('On the train');
  await write(page, 'Written with no signal.');
  await expect(page.getByText('Kept on this phone', { exact: true })).toBeVisible();

  await admin.context.setOffline(true);
  await publishButton(page).click();
  const failure = alertWith(page, 'Not published yet.');
  await expect(failure).toContainText('The connection dropped. Your text is kept on this phone.');
  // The one fact first, in words; and the error sits right above the actions, where the eye is (W5).
  const [fail, actions] = [await failure.boundingBox(), await page.locator('.composer__actions').boundingBox()];
  expect((actions?.y ?? 0) - ((fail?.y ?? 0) + (fail?.height ?? 0))).toBeLessThan(24);
  expect((actions?.y ?? 0) - ((fail?.y ?? 0) + (fail?.height ?? 0))).toBeGreaterThanOrEqual(-1);
  // The text is exactly where it was, editable, and on the device.
  await expect(titleField(page)).toHaveValue('On the train');
  await expect(body(page)).toHaveText('Written with no signal.');
  await expect(body(page)).toHaveAttribute('contenteditable', 'true');
  await expect(page.getByText('Kept on this phone', { exact: true })).toBeVisible();
  expect(await buffer(page, 'unsent')).toMatchObject({ title: 'On the train', lang: 'en', key: keys[0] });
  forgiveOffline(admin);
  await expectFits(admin, info);

  // Back online, nothing is sent by itself: only a tap retries.
  await admin.context.setOffline(false);
  await page.waitForTimeout(1500);
  expect(keys).toHaveLength(1);
  expect(await listed(admin)).toHaveLength(0);
  await expect(failure).toBeVisible();

  await failure.getByRole('button', { name: 'Try again' }).click();
  await expect(publishedNotice(page)).toBeVisible();
  // The same key, so the server could only ever make one entry of it.
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  const entries = await listed(admin);
  expect(entries.map((entry) => [entry.title, entry.state])).toEqual([['On the train', 'published']]);
  // Only now is the buffer cleared and the editor empty.
  expect(await buffer(page, 'unsent')).toBeNull();
  await expect(body(page)).toHaveText('');
  await expect(page.getByText('Kept on this phone', { exact: true })).toHaveCount(0);
  await expectFits(admin, info);
});

test('a lost answer, then another language before the retry: the language is fixed until an answer comes, so nothing is published twice (AC-25, AC-42)', async ({ browser, baseURL, request }) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  const keys = watchKeys(page);
  let lost = true;
  await page.route('**/admin/api/entries', async (route) => {
    if (route.request().method() === 'POST' && lost) {
      lost = false;
      await route.fetch();
      await route.abort('connectionreset');
      return;
    }
    await route.continue();
  });
  await write(page, 'Published in English, though the answer never came.');
  await publishButton(page).click();
  const failure = alertWith(page, 'Not published yet.');
  await expect(failure).toBeVisible();
  // The row may exist in English: the control is fixed, and Persian can't be chosen.
  await expect(language(page, 'fa')).toBeDisabled();
  // Emptying the text doesn't free the key either: typing again is the same composition.
  await body(page).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('Published in English, then retried.');
  await failure.getByRole('button', { name: 'Try again' }).click();
  await expect(publishedNotice(page)).toBeVisible();
  expect(new Set(keys).size).toBe(1);
  const entries = await listed(admin);
  expect(entries.map((entry) => [entry.lang, entry.state])).toEqual([['en', 'published']]);
  expect(await (await request.get(`/log/${entries[0]?.id}`)).text()).toContain('then retried.');
  // Answered, the next entry is new text again, and its language can be chosen.
  await expect(language(page, 'fa')).toBeEnabled();
});

test('G4, AC-25: the server got the publish and the answer was lost. The retry finds the same entry: one entry, however many taps', async ({ browser, baseURL, request }) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  let lost = true;
  await page.route('**/admin/api/entries', async (route) => {
    if (route.request().method() === 'POST' && lost) {
      lost = false;
      // The server does the work; the answer never arrives.
      await route.fetch();
      await route.abort('connectionreset');
      return;
    }
    await route.continue();
  });
  await write(page, 'Sent, and the answer was lost.');
  await publishButton(page).click();
  await alertWith(page, 'Not published yet.').getByRole('button', { name: 'Try again' }).click();
  await expect(publishedNotice(page)).toBeVisible();
  expect(await listed(admin)).toHaveLength(1);
  await expect(body(page)).toHaveText('');
});

test('a retry after the person changed the text sends what is there now, onto the row the first try made', async ({ browser, baseURL, request }) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  let lost = true;
  await page.route('**/admin/api/entries', async (route) => {
    if (route.request().method() === 'POST' && lost) {
      lost = false;
      await route.fetch();
      await route.abort('connectionreset');
      return;
    }
    await route.continue();
  });
  await write(page, 'First version.');
  await publishButton(page).click();
  const failure = alertWith(page, 'Not published yet.');
  await expect(failure).toBeVisible();
  // The text is editable after a failure, and what is there at the retry is what is sent.
  await body(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Second thoughts.');
  await failure.getByRole('button', { name: 'Try again' }).click();
  await expect(publishedNotice(page)).toBeVisible();
  const entries = await listed(admin);
  expect(entries).toHaveLength(1);
  expect(await (await request.get(`/log/${entries[0]?.id}`)).text()).toContain('Second thoughts.');
});

test('AC-16: Save on a live entry that fails says the live entry has not changed, and a tap saves it', async ({ browser, baseURL, request }, info) => {
  const id = await seedPublished(request);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openEdit(page);
  const frame = page.locator('.frame');
  await body(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Now fixed.');
  await expect(frame.getByText('Kept on this phone', { exact: true })).toBeVisible();
  await admin.context.setOffline(true);
  await frame.getByRole('button', { name: 'Save', exact: true }).click();
  const failure = alertWith(page, 'Not saved.');
  await expect(failure).toContainText("The connection dropped. Your changes are kept here, and the live entry hasn't changed.");
  await admin.context.setOffline(false);
  expect(await (await request.get(`/log/${id}`)).text()).not.toContain('Now fixed.');
  await expect(body(page)).toContainText('Now fixed.');
  expect(await buffer(page, 'edit')).toMatchObject({ id });
  forgiveOffline(admin);
  await expectFits(admin, info);
  await failure.getByRole('button', { name: 'Try again' }).click();
  await expect(frame.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(await (await request.get(`/log/${id}`)).text()).toContain('Now fixed.');
  // Saved: the edit buffer is gone and the marker with it.
  expect(await buffer(page, 'edit')).toBeNull();
  await expect(frame.getByText('Kept on this phone', { exact: true })).toHaveCount(0);
});

test('AC-16: Unpublish that fails says it is still live, and nothing has changed', async ({ browser, baseURL, request }) => {
  const id = await seedPublished(request);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openEdit(page);
  const frame = page.locator('.frame');
  await frame.getByRole('button', { name: 'Unpublish', exact: true }).click();
  await admin.context.setOffline(true);
  await page.getByRole('dialog').getByRole('button', { name: 'Unpublish' }).click();
  await expect(alertWith(page, 'Not unpublished.')).toContainText("It's still live.");
  await admin.context.setOffline(false);
  expect((await request.get(`/log/${id}`)).status()).toBe(200);
  await frame.getByRole('button', { name: 'Unpublish', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Unpublish' }).click();
  await expect(frame.getByRole('status').filter({ hasText: 'Unpublished.' })).toBeVisible();
  expect((await request.get(`/log/${id}`)).status()).toBe(404);
});

test('J3.4, J3.5, W6: the session ends while writing. The text stays, Sign in and publish signs in over it, and the publish runs once on the new session', async ({ browser, baseURL, request }, info) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  const keys = watchKeys(page);
  await titleField(page).fill('Interrupted');
  await write(page, 'Interrupted for seventy minutes, then finished.');
  // Typing alone does not keep a session alive, so an hour idle ends it (S-17).
  expect((await request.post('/__test/clock', { data: { now: NOW + 70 * MINUTE } })).ok()).toBe(true);
  await publishButton(page).click();
  const failure = alertWith(page, 'Not published yet.');
  await expect(failure).toContainText('You were signed out. Sign in to finish. Your text stays right here.');
  // The editor was not unmounted: it is the same text, still editable, and the app did not leave for the sign-in view.
  await expect(body(page)).toHaveText('Interrupted for seventy minutes, then finished.');
  await expect(titleField(page)).toHaveValue('Interrupted');
  await expect(page.getByRole('heading', { name: "It's you, right?" })).toHaveCount(0);
  const signIn = failure.getByRole('button', { name: 'Sign in and publish' });
  await expect(signIn).toBeVisible();
  expect((await signIn.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5);
  await expectFits(admin, info);

  await signIn.click();
  // Signed in over the editor, then the publish ran once: one entry, from the same key, and the editor empty.
  await expect(publishedNotice(page)).toBeVisible();
  const entries = await listed(admin);
  expect(entries.map((entry) => [entry.title, entry.state])).toEqual([['Interrupted', 'published']]);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  await expect(body(page)).toHaveText('');
  expect(await buffer(page, 'unsent')).toBeNull();
  // The new session is the page's now: later writes work, and Passkeys still marks this device.
  await write(page, 'The next one.');
  await publishButton(page).click();
  await expect(publishedNotice(page)).toBeVisible();
  await page.getByRole('button', { name: 'Passkeys', exact: true }).click();
  await expect(page.locator('.passkey').filter({ hasText: 'this device' })).toHaveCount(1);
  await expectFits(admin, info);
});

test('W6: a second refusal after signing in says so again and never loops; the text is still there', async ({ browser, baseURL, request }) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  let posts = 0;
  // Every write is refused as signed-out, however fresh the session: the worst case for a loop.
  await page.route('**/admin/api/entries', async (route) => {
    if (route.request().method() === 'POST') {
      posts += 1;
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'UNAUTHENTICATED' }) });
      return;
    }
    await route.continue();
  });
  await write(page, 'Refused twice.');
  await publishButton(page).click();
  const failure = alertWith(page, 'Not published yet.');
  await failure.getByRole('button', { name: 'Sign in and publish' }).click();
  // Signed in once, the action ran once more, was refused, and the notice is back: exactly two requests, and the person decides what next.
  await expect(failure.getByRole('button', { name: 'Sign in and publish' })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(posts).toBe(2);
  await expect(body(page)).toHaveText('Refused twice.');
  expect(await listed(admin)).toHaveLength(0);
});

test('Sign in and save, over an edit: the session ended, the changes stay, and the save runs once after signing in (W6, AC-16)', async ({ browser, baseURL, request }) => {
  const id = await seedPublished(request);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openEdit(page);
  const frame = page.locator('.frame');
  await body(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Fixed after an hour.');
  expect((await request.post('/__test/clock', { data: { now: NOW + 90 * MINUTE } })).ok()).toBe(true);
  await frame.getByRole('button', { name: 'Save', exact: true }).click();
  const failure = alertWith(page, 'Not saved.');
  await expect(failure).toContainText('Sign in to finish.');
  await failure.getByRole('button', { name: 'Sign in and save' }).click();
  await expect(frame.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(await (await request.get(`/log/${id}`)).text()).toContain('Fixed after an hour.');
});

test('a cancelled passkey sheet is not an error: it says so, and the text and the way back stay', async ({ browser, baseURL, request }) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await write(page, 'Still here.');
  expect((await request.post('/__test/clock', { data: { now: NOW + 70 * MINUTE } })).ok()).toBe(true);
  await publishButton(page).click();
  const failure = alertWith(page, 'Not published yet.');
  // The browser's sheet is closed without choosing: the ceremony rejects with NotAllowedError.
  await page.evaluate(() => {
    navigator.credentials.get = () => Promise.reject(new DOMException('The operation was cancelled.', 'NotAllowedError'));
  });
  await failure.getByRole('button', { name: 'Sign in and publish' }).click();
  await expect(page.getByText("Not signed in. Try again when you're ready.")).toBeVisible();
  await expect(failure.getByRole('button', { name: 'Sign in and publish' })).toBeEnabled();
  await expect(body(page)).toHaveText('Still here.');
});

for (const lang of ['en', 'fa'] as const) {
  test(`J3.3: a closed tab. The page opens with the ${lang === 'fa' ? 'Persian' : 'English'} text offered back, marked not published, and Put it back restores it with its key (AC-16)`, async ({ browser, baseURL, request }, info) => {
    const admin = await signedInAdmin(browser, baseURL as string, request);
    const { page } = admin;
    if (lang === 'fa') await language(page, 'fa').check();
    const words = lang === 'fa' ? 'متنی که ارسال نشد.' : 'Text that was never sent.';
    await titleField(page).fill('Left behind');
    await write(page, words);
    const before = await buffer(page, 'unsent');
    expect(before).toMatchObject({ lang, title: 'Left behind' });

    // The tab is closed and the page opened again.
    await page.reload();
    const offer = page.getByRole('status').filter({ hasText: 'You left something here.' });
    await expect(offer).toContainText("Unsent text from earlier on this phone. It isn't published.");
    // The editor is first and empty in view, with the offer above it (J2.2); the text is set aside, not dropped.
    await expect(body(page)).toHaveText('');
    expect(await buffer(page, 'unsent')).toBeNull();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('imnstr:entry:kept') ?? '[]'))).toHaveLength(1);
    // No time, no count: "from earlier", never "3 hours ago".
    expect(await offer.innerText()).not.toMatch(/\d/);
    for (const button of await offer.getByRole('button').all()) expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5);
    await expectFits(admin, info);

    // Typing in the empty editor does not write over the offered text.
    await body(page).click();
    await page.keyboard.type('New.');
    await expect(offer).toBeVisible();
    // Put it back: the earlier text returns with its title, its language and its key, and what was typed since is set aside in turn.
    await offer.getByRole('button', { name: 'Put it back' }).click();
    await expect(body(page)).toHaveText(words);
    await expect(titleField(page)).toHaveValue('Left behind');
    await expect(language(page, lang)).toBeChecked();
    expect(await buffer(page, 'unsent')).toMatchObject({ key: before?.key, lang, title: 'Left behind' });
    await expect(offer).toBeVisible();
    await offer.getByRole('button', { name: 'Put it back' }).click();
    await expect(body(page)).toHaveText('New.');
    await offer.getByRole('button', { name: 'Put it back' }).click();
    await expect(body(page)).toHaveText(words);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('imnstr:entry:kept') ?? '[]'))).toHaveLength(1);

    // And it publishes, once, under the key it had.
    await page.getByRole('button', { name: 'Discard' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Keep it' }).click();
    await publishButton(page).click();
    await expect(publishedNotice(page)).toBeVisible();
    expect((await listed(admin)).map((entry) => [entry.lang, entry.title])).toEqual([[lang, 'Left behind']]);
    expect(await buffer(page, 'unsent')).toBeNull();
    await expectFits(admin, info);
  });
}

test('Discard asks once more, and a text that was offered back is gone only when the person says so twice (J3.3, PD-12)', async ({ browser, baseURL, request }) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await write(page, 'To be discarded, or not.');
  await page.reload();
  const offer = page.getByRole('status').filter({ hasText: 'You left something here.' });
  await offer.getByRole('button', { name: 'Discard' }).click();
  const dialog = page.getByRole('dialog', { name: 'Discard this text?' });
  await expect(dialog).toContainText("It's only on this phone.");
  await expectDialogPlace(page, dialog);
  await dialog.getByRole('button', { name: 'Keep it' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(offer).toBeVisible();
  await page.reload();
  await expect(offer).toBeVisible();
  await offer.getByRole('button', { name: 'Discard' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
  await expect(offer).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('imnstr:entry:kept'))).toBeNull();
  await page.reload();
  await expect(offer).toHaveCount(0);
});

test('J2.6a, AC-43: Edit over unsent text keeps it and says so, and Save brings it back, with Discard asking once more', async ({ browser, baseURL, request }, info) => {
  const id = await seedPublished(request);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await titleField(page).fill('Not sent yet');
  await write(page, 'Coming back is the habit.');
  await openEdit(page);
  const frame = page.locator('.frame');
  // Said before anything is replaced; the unsent text is in the kept buffer, out of the editor.
  await expect(frame.getByRole('status').filter({ hasText: 'Your unsent entry is kept.' })).toContainText('It comes back when you save or cancel here.');
  expect(await buffer(page, 'unsent')).toBeNull();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('imnstr:entry:kept') ?? '[]'))).toHaveLength(1);
  await expect(frame.getByRole('textbox', { name: 'Entry text' })).toHaveText('Broken link here, see the paper.');
  await expectFits(admin, info);

  await body(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Fixed.');
  await frame.getByRole('button', { name: 'Save', exact: true }).click();
  // The edit is done: the frame closes, says what it did, and the unsent entry is back in the editor, not published.
  await expect(page.locator('.frame')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toContainText("Its link and date haven't changed.");
  const back = page.getByRole('status').filter({ hasText: 'Back to your unsent entry.' });
  await expect(back).toContainText("It isn't published.");
  await expect(titleField(page)).toHaveValue('Not sent yet');
  await expect(body(page)).toHaveText('Coming back is the habit.');
  expect(await (await request.get(`/log/${id}`)).text()).toContain('Fixed.');
  expect(await listed(admin)).toHaveLength(1);
  await expectFits(admin, info);

  // Discard asks once more; Keep it leaves everything.
  await back.getByRole('button', { name: 'Discard' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Keep it' }).click();
  await expect(body(page)).toHaveText('Coming back is the habit.');
  await back.getByRole('button', { name: 'Discard' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
  await expect(body(page)).toHaveText('');
  await expect(titleField(page)).toHaveValue('');
  expect(await buffer(page, 'unsent')).toBeNull();
});

test('AC-43: Cancel on the edit brings the unsent text back too', async ({ browser, baseURL, request }) => {
  await seedPublished(request);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await write(page, 'Unsent, and kept while I look at something.');
  await openEdit(page);
  await page.locator('.frame').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.frame')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Back to your unsent entry.' })).toBeVisible();
  await expect(body(page)).toHaveText('Unsent, and kept while I look at something.');
});

test('AC-43: two edits in a row, before the unsent text is chosen, lose nothing: each comes back in its turn', async ({ browser, baseURL, request }) => {
  await seedPublished(request);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await write(page, 'First unsent text.');
  await page.reload();
  // The page opened with text: it is offered, not in the editor. Writing something else, then editing, sets both aside.
  await write(page, 'Second unsent text.');
  await openEdit(page);
  await page.locator('.frame').getByRole('button', { name: 'Cancel' }).click();
  await expect(body(page)).toHaveText('Second unsent text.');
  const offer = page.getByRole('status').filter({ hasText: 'You left something here.' });
  await expect(offer).toBeVisible();
  await offer.getByRole('button', { name: 'Put it back' }).click();
  await expect(body(page)).toHaveText('First unsent text.');
});

test('leaving an edit that holds unsaved changes asks first; Keep editing leaves everything, Leave drops only the changes', async ({ browser, baseURL, request }) => {
  const id = await seedPublished(request);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openEdit(page);
  const frame = page.locator('.frame');
  // Nothing changed: Cancel closes at once, with nothing asked.
  await frame.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.frame')).toHaveCount(0);
  await openEdit(page);
  await body(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Unsaved.');
  await frame.getByRole('button', { name: 'Cancel' }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave without saving?' });
  await expect(dialog).toContainText("The changes to this entry aren't saved yet.");
  await expectDialogPlace(page, dialog);
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(body(page)).toContainText('Unsaved.');
  await frame.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Leave' }).click();
  await expect(page.locator('.frame')).toHaveCount(0);
  expect(await buffer(page, 'edit')).toBeNull();
  expect(await (await request.get(`/log/${id}`)).text()).not.toContain('Unsaved.');
});

test('AC-43: Leave over unsaved changes drops only the changes; the unsent text comes back and says so, with Discard', async ({ browser, baseURL, request }) => {
  await seedPublished(request);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await write(page, 'Unsent while I fix an old one.');
  await openEdit(page);
  const frame = page.locator('.frame');
  await frame.getByRole('textbox', { name: 'Entry text' }).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Not kept.');
  await frame.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Leave' }).click();
  await expect(page.locator('.frame')).toHaveCount(0);
  const back = page.getByRole('status').filter({ hasText: 'Back to your unsent entry.' });
  await expect(back).toContainText("It isn't published.");
  await expect(back.getByRole('button', { name: 'Discard' })).toBeVisible();
  await expect(body(page)).toHaveText('Unsent while I fix an old one.');
  expect(await buffer(page, 'edit')).toBeNull();
  expect(await buffer(page, 'unsent')).toMatchObject({ doc: { type: 'doc' } });
});

test('changes left in an edit when the page was closed are offered back, and Put them back opens the entry with them (AC-16)', async ({ browser, baseURL, request }) => {
  const id = await seedPublished(request);
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await openEdit(page);
  await body(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Typed before the tab closed.');
  await titleField(page).fill('A new title');
  expect(await buffer(page, 'edit')).toMatchObject({ id, title: 'A new title' });
  await page.reload();
  const offer = page.getByRole('status').filter({ hasText: 'You left changes here.' });
  await expect(offer).toContainText("They aren't saved, and the entry hasn't changed.");
  await expect(page.locator('.frame')).toHaveCount(0);
  await offer.getByRole('button', { name: 'Put them back' }).click();
  const frame = page.locator('.frame');
  await expect(frame.getByLabel('Title (optional)')).toHaveValue('A new title');
  await expect(frame.getByRole('textbox', { name: 'Entry text' })).toContainText('Typed before the tab closed.');
  await frame.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(frame.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(await (await request.get(`/log/${id}`)).text()).toContain('Typed before the tab closed.');
  expect(await buffer(page, 'edit')).toBeNull();

  // Discard, with the second ask.
  await body(page).click();
  await page.keyboard.type(' Another.');
  await page.reload();
  await page.getByRole('status').filter({ hasText: 'You left changes here.' }).getByRole('button', { name: 'Discard' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'You left changes here.' })).toHaveCount(0);
  expect(await buffer(page, 'edit')).toBeNull();
});

test('"Kept on this phone" is the only draft signal: it shows while text is on the device, and nothing counts or times anything (W7, house rule 1)', async ({ browser, baseURL, request }, info) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  const kept = page.getByText('Kept on this phone', { exact: true });
  await expect(kept).toHaveCount(0);
  await write(page, 'Eleven words are not counted anywhere, and neither are letters.');
  await expect(kept).toBeVisible();
  await saveDraftButton(page).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved.' })).toBeVisible();
  // Nothing in the editor's slot counts words or characters, or says "saving…" or "saved 2 min ago".
  const text = await page.locator('.composer').innerText();
  expect(text).not.toMatch(/\b\d+\s*(words?|characters?|chars?|letters?|minutes?|mins?|seconds?|secs?|ago)\b/i);
  expect(text).not.toMatch(/saving|saved \d|last saved|autosav/i);
  await body(page).click();
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await titleField(page).fill('');
  // A draft on the server has its row, so its buffer stays (it works by id); an empty composition with no row has none.
  expect(await buffer(page, 'unsent')).toMatchObject({ id: expect.any(String) });
  await expectFits(admin, info);
});

test('an empty composition with no row keeps nothing on the device', async ({ browser, baseURL, request }) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await write(page, 'x');
  expect(await buffer(page, 'unsent')).not.toBeNull();
  await page.keyboard.press('Backspace');
  expect(await buffer(page, 'unsent')).toBeNull();
  await expect(page.getByText('Kept on this phone', { exact: true })).toHaveCount(0);
});

test('a browser that will not store text is told, not lied to: the failure does not claim the text is kept', async ({ browser, baseURL, request }) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  // Storage is full: every write is refused.
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
  });
  await write(page, 'Nowhere to keep this.');
  await expect(page.getByText('Kept on this phone', { exact: true })).toHaveCount(0);
  await admin.context.setOffline(true);
  await publishButton(page).click();
  await expect(alertWith(page, 'Not published yet.')).toContainText("this browser isn't keeping a copy");
  await expect(alertWith(page, 'Not published yet.')).not.toContainText('kept on this phone');
  await admin.context.setOffline(false);
});

test('Persian: the failure and its retry read the same in a Persian entry, and the text keeps its direction (AC-16, AC-42)', async ({ browser, baseURL, request }) => {
  const admin = await signedInAdmin(browser, baseURL as string, request);
  const { page } = admin;
  await language(page, 'fa').check();
  await write(page, MIXED.fa.text.replace(/==/g, ''));
  await admin.context.setOffline(true);
  await publishButton(page).click();
  const failure = alertWith(page, 'Not published yet.');
  await expect(failure).toBeVisible();
  await expect(body(page)).toHaveAttribute('dir', 'rtl');
  await admin.context.setOffline(false);
  await failure.getByRole('button', { name: 'Try again' }).click();
  await expect(publishedNotice(page)).toBeVisible();
  expect((await listed(admin)).map((entry) => entry.lang)).toEqual(['fa']);
});

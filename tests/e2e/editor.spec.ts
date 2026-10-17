// The editor in a real browser (plan B6, plates 7, 8, 12, 14): the bare editor first. Writing and
// publishing in both languages, the toolbar, pasting, the bidi runs, Save draft and Save, and the
// 360 px phone with the keyboard up and at 200% zoom. Every test runs in both colour schemes.
// "Nothing lost" (buffers, failures, signing in over the text) has its own tests below these.
import { expect, test, type Page } from '@playwright/test';
import { signedInAdmin, resetAdmin, type Admin } from './admin-support.ts';
import { DAY, MIXED, NOW, expectColourScheme, expectNoSidewaysScroll, expectNoThirdParty, type Lang } from './support.ts';

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
  // Solid ink, apart from the highlighter (HIG #5).
  expect(await publish.evaluate((el) => el.classList.contains('btn--solid'))).toBe(true);
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
  for (const control of await page.locator('.composer button, .composer input:not([type=radio]), .segmented__options').all()) {
    const box = await control.boundingBox();
    expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= 180, `${await control.innerText().catch(() => '')} fits 180 px`).toBe(true);
  }
  await expectColourScheme(page, info);
  expect(admin.problems).toEqual([]);
});

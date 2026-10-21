// The contact page and the Messages section in a real browser (change note 08, CT1): both languages and both
// colour schemes at 360 px and at 200% zoom (180 px), the nav, a send, a refusal, and the admin reading the
// message and deleting it. The founder's real links are never here: the server runs with invented ones
// (playwright.config.ts).
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { expectDialogPlace, resetAdmin, signedInAdmin } from './admin-support.ts';
import {
  NOW,
  cspViolations,
  expectColourScheme,
  expectLangAndDir,
  expectNoCookies,
  expectNoFallbackFont,
  expectNoSidewaysScroll,
  expectNoThirdParty,
  expectTapTargets,
  expectWithinColumn,
  scheme,
  watchCsp,
  watchRequests,
  type Lang,
} from './support.ts';
import { sweep } from './sweep-support.ts';

const LANGS: Lang[] = ['en', 'fa'];
const contactPath = (lang: Lang) => (lang === 'fa' ? '/fa/contact' : '/contact');
/** Where a look at the page is written, for the review (named in the lane's report). */
const shot = (name: string) => `.tmp/ct1-screens/${name}.png`;

const T = {
  en: {
    title: 'Contact',
    subject: 'Subject',
    message: 'Message',
    reach: 'How can I reach you?',
    send: 'Send',
    sent: 'Sent. Thank you, I’ll get back to you.',
    summary: 'Some fields need a look:',
    subjectEmpty: 'Write a subject.',
    reachEmpty: 'Say how I can reach you.',
    writings: 'Writings',
    podcast: 'Podcast',
  },
  fa: {
    title: 'تماس',
    subject: 'موضوع',
    message: 'پیام',
    reach: 'چطور با شما تماس بگیرم؟',
    send: 'بفرستید',
    sent: 'فرستاده شد. ممنون، جواب می‌دهم.',
    summary: 'چند خانه را بررسی کنید:',
    subjectEmpty: 'موضوع را بنویسید.',
    reachEmpty: 'بگویید چطور با شما تماس بگیرم.',
    writings: 'نوشته‌ها',
    podcast: 'پادکست',
  },
} as const;

// The invented links the e2e server is started with.
const LINKS = { email: 'someone@example.com', telegram: 'example_channel', instagram: 'example' };

test.beforeEach(async ({ request }) => {
  // The fixed clock, and no messages left over from another run: the daily cap would carry over otherwise.
  expect((await request.post('/__test/clock', { data: { now: NOW } })).ok()).toBe(true);
  expect((await request.delete('/__test/messages')).ok()).toBe(true);
});

const field = (page: Page, lang: Lang, name: 'subject' | 'message' | 'reach') => page.getByLabel(T[lang][name], { exact: true });

async function fillForm(page: Page, lang: Lang, values: { subject?: string; message?: string; reach?: string }): Promise<void> {
  if (values.subject !== undefined) await field(page, lang, 'subject').fill(values.subject);
  if (values.message !== undefined) await field(page, lang, 'message').fill(values.message);
  if (values.reach !== undefined) await field(page, lang, 'reach').fill(values.reach);
}

const send = (page: Page, lang: Lang) => page.getByRole('button', { name: T[lang].send, exact: true });

/** The header's nav is one row at 360 px: its box is one tap target tall, not two. */
async function expectHeaderOneLine(page: Page): Promise<void> {
  const height = await page.locator('header.site-header').evaluate((el) => el.getBoundingClientRect().height);
  // The header's own top padding plus one 44 px row; a wrapped nav would be two rows.
  expect(height).toBeLessThan(80);
}

for (const lang of LANGS) {
  test.describe(`the contact page, ${lang}`, () => {
    test('fits 360 px and 200% zoom in the colour scheme, with the links, and loads nothing off its own origin (CT-2, CT-3, CT-7)', async ({ page }, info) => {
      await watchCsp(page);
      const requests = watchRequests(page);
      await page.goto(contactPath(lang));
      await expectLangAndDir(page, lang);
      await expectColourScheme(page, info);
      await expectTapTargets(page);
      await expectHeaderOneLine(page);
      await expect(page.locator('h1.page-title')).toHaveText(T[lang].title);

      // The founder's links, from the server's environment, with the new-tab ones opening safely (AC-33).
      const links = page.locator('main .rows--contact a');
      await expect(links).toHaveCount(3);
      await expect(page.locator('a[data-link=email]')).toHaveAttribute('href', `mailto:${LINKS.email}`);
      await expect(page.locator('a[data-link=email]')).not.toHaveAttribute('target', /.*/);
      for (const [key, href] of [
        ['telegram', `https://t.me/${LINKS.telegram}`],
        ['instagram', `https://www.instagram.com/${LINKS.instagram}/`],
      ] as const) {
        await expect(page.locator(`a[data-link=${key}]`)).toHaveAttribute('href', href);
        await expect(page.locator(`a[data-link=${key}]`)).toHaveAttribute('target', '_blank');
        await expect(page.locator(`a[data-link=${key}]`)).toHaveAttribute('rel', 'noopener');
      }
      for (const link of await links.all()) expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

      // The form: three labelled fields, no script of its own.
      for (const name of ['subject', 'message', 'reach'] as const) await expect(field(page, lang, name)).toBeVisible();
      await expect(page.locator('form script')).toHaveCount(0);

      await expectNoThirdParty(page, requests);
      await expectNoCookies(page);
      expect(await cspViolations(page)).toEqual([]);
      await expectNoFallbackFont(page);
      await page.screenshot({ path: shot(`contact-${lang}-${scheme(info)}`), fullPage: true });
      await expectNoSidewaysScroll(page, 360);
      await expectNoSidewaysScroll(page, 180);
    });

    test('is linked from the footer on a phone and from the header from the tablet width up, current on its own page (CT-2)', async ({ page }) => {
      const here = T[lang];
      await page.goto(contactPath(lang));
      // 360 px: the header keeps Writings, Podcast and the switch; Contact is in the footer, marked current.
      await expect(page.locator('header .nav-contact')).toBeHidden();
      await expect(page.locator('footer').getByRole('link', { name: here.title, exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('header').getByRole('link', { name: here.writings, exact: true })).toBeVisible();
      await expect(page.locator('header').getByRole('link', { name: here.podcast, exact: true })).toBeVisible();
      // 48em (768 px): the header gains Contact, current here.
      await page.setViewportSize({ width: 800, height: 800 });
      await expect(page.locator('header .nav-contact')).toBeVisible();
      await expect(page.locator('header .nav-contact')).toHaveAttribute('aria-current', 'page');
      await expectHeaderOneLine(page);
      // Every other public page links to it too, and it is not current there.
      for (const other of [lang === 'fa' ? '/fa/' : '/', lang === 'fa' ? '/fa/log' : '/log', lang === 'fa' ? '/fa/podcast' : '/podcast', lang === 'fa' ? '/fa/nope' : '/nope']) {
        await page.goto(other);
        await expect(page.locator('footer').getByRole('link', { name: here.title, exact: true })).toHaveAttribute('href', contactPath(lang));
        await expect(page.locator('footer').getByRole('link', { name: here.title, exact: true })).not.toHaveAttribute('aria-current', 'page');
        await expect(page.locator('header .nav-contact')).toBeVisible();
      }
      // The language switch from the contact page goes to the other language's contact page.
      await page.goto(contactPath(lang));
      await page.locator('header a[hreflang]').click();
      await expect(page).toHaveURL(contactPath(lang === 'fa' ? 'en' : 'fa'));
    });

    test('keeps the header on one line at 360 px, with the Persian words the widest (PL-6)', async ({ page }) => {
      for (const where of [contactPath(lang), lang === 'fa' ? '/fa/log' : '/log']) {
        await page.goto(where);
        await expectHeaderOneLine(page);
      }
    });

    test('sends a message, goes to ?sent=1 with a thank-you and an empty form (CT-4)', async ({ page }, info) => {
      await page.goto(contactPath(lang));
      await fillForm(page, lang, { subject: 'A question', message: 'Hello.\nTwo lines.', reach: 'someone@example.com' });
      await send(page, lang).click();
      await expect(page).toHaveURL(`${contactPath(lang)}?sent=1`);
      await expect(page.getByRole('status')).toHaveText(T[lang].sent);
      for (const name of ['subject', 'message', 'reach'] as const) await expect(field(page, lang, name)).toHaveValue('');
      await expectColourScheme(page, info);
      await expectNoCookies(page);
      await expectNoSidewaysScroll(page, 360);
      await page.screenshot({ path: shot(`contact-${lang}-sent-${scheme(info)}`), fullPage: true });
    });

    test('refuses an empty field with the error at the field and a linked summary, and keeps what was typed (CT-5)', async ({ page }, info) => {
      await page.goto(contactPath(lang));
      await fillForm(page, lang, { message: 'Keep this text' });
      const answer = page.waitForResponse((r) => r.request().method() === 'POST');
      await send(page, lang).click();
      expect((await answer).status()).toBe(400);
      // The summary takes focus, and each of its links goes to the field it names.
      const summary = page.locator('.contact-summary');
      await expect(summary).toContainText(T[lang].summary);
      await expect(summary).toBeFocused();
      await expect(summary.getByRole('link')).toHaveCount(2);
      await expect(field(page, lang, 'subject')).toHaveAttribute('aria-invalid', 'true');
      await expect(field(page, lang, 'reach')).toHaveAttribute('aria-invalid', 'true');
      await expect(field(page, lang, 'message')).not.toHaveAttribute('aria-invalid', 'true');
      await expect(field(page, lang, 'subject')).toHaveAccessibleDescription(T[lang].subjectEmpty);
      await expect(page.locator('#contact-subject-error')).toHaveText(T[lang].subjectEmpty);
      await expect(field(page, lang, 'message')).toHaveValue('Keep this text');
      await summary.getByRole('link', { name: T[lang].reachEmpty }).click();
      await expect(page).toHaveURL(/#contact-reach$/);
      await expect(field(page, lang, 'reach')).toBeInViewport();
      await expectColourScheme(page, info);
      await expectNoSidewaysScroll(page, 360);
      await expectNoSidewaysScroll(page, 180);
      await page.screenshot({ path: shot(`contact-${lang}-refused-${scheme(info)}`), fullPage: true });
    });

    test('fills the whole form by keyboard, and the honeypot is neither seen nor reachable (CT-6)', async ({ page }) => {
      await page.goto(contactPath(lang));
      await expect(page.locator('input[name=website]')).toBeHidden();
      // Three text boxes in the accessibility tree, and none of them is the trap.
      await expect(page.getByRole('textbox')).toHaveCount(3);
      await field(page, lang, 'subject').focus();
      await page.keyboard.type('Keyboard');
      await page.keyboard.press('Tab');
      await page.keyboard.type('From the keyboard.');
      await page.keyboard.press('Tab');
      await page.keyboard.type('someone@example.com');
      await page.keyboard.press('Tab');
      // The next stop is the send button, not the hidden field.
      await expect(send(page, lang)).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(`${contactPath(lang)}?sent=1`);
    });

    test('answers at the daily cap with a notice and keeps the typed text (CT-5)', async ({ page, request }) => {
      // Thirty sends through the form's own endpoint fill the day; the thirty-first is refused.
      for (let n = 0; n < 30; n++) {
        // No Origin goes with it, as with an old client's post, which the form accepts.
        const res = await request.post(contactPath(lang), { form: { subject: `S${n}`, message: 'm', reach: 'r' }, maxRedirects: 0 });
        expect(res.status(), `send ${n}`).toBe(303);
      }
      await page.goto(contactPath(lang));
      await fillForm(page, lang, { subject: 'Thirty-first', message: 'Still here', reach: 'r' });
      const answer = page.waitForResponse((r) => r.request().method() === 'POST');
      await send(page, lang).click();
      expect((await answer).status()).toBe(429);
      await expect(page.getByRole('alert')).toContainText(lang === 'fa' ? 'امروز پیام زیادی رسیده' : 'Too many messages today');
      await expect(field(page, lang, 'message')).toHaveValue('Still here');
    });
  });
}

test.describe('the Messages section of the admin (CT-8)', () => {
  test.beforeEach(async ({ request }) => {
    await resetAdmin(request, NOW);
  });

  test('lists what was sent, newest first, with its language and date, and Delete asks first', async ({ browser, baseURL, request }, info: TestInfo) => {
    const admin = await signedInAdmin(browser, baseURL as string, request);
    const { page } = admin;

    // Two visitors write, an hour apart on the test clock: an English message, then a Persian one.
    const visitor = await admin.context.newPage();
    await visitor.goto('/contact');
    await fillForm(visitor, 'en', { subject: 'A question about the podcast', message: 'Line one.\nLine two.', reach: 'someone@example.com' });
    await send(visitor, 'en').click();
    await expect(visitor).toHaveURL('/contact?sent=1');
    expect((await request.post('/__test/clock', { data: { now: NOW + 60 * 60 * 1000 } })).ok()).toBe(true);
    await visitor.goto('/fa/contact');
    await fillForm(visitor, 'fa', { subject: 'سلام', message: 'یک پرسش دارم.', reach: '@example' });
    await send(visitor, 'fa').click();
    await expect(visitor).toHaveURL('/fa/contact?sent=1');
    await visitor.close();

    // Signed in again with the clock where the messages were sent, so the session is as fresh as it was.
    await page.reload();
    const toggle = page.getByRole('button', { name: 'Messages', exact: true });
    const body = page.locator('#messages-body');
    // Between Podcast and Passkeys, collapsed, and asking for nothing until it is opened. The shell draws after the
    // reload's session check, so wait for it before reading the order.
    await expect(toggle).toBeVisible();
    const order = await page.evaluate(() => {
      const at = (id: string) => document.querySelector(id);
      const before = (a: Element | null, b: Element | null) => Boolean(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return { afterPodcast: before(at('#podcast-heading'), at('#messages-heading')), beforePasskeys: before(at('#messages-heading'), at('#passkeys-heading')) };
    });
    expect(order).toEqual({ afterPodcast: true, beforePasskeys: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(body).toBeHidden();
    await toggle.click();
    await expect(body).toBeVisible();

    const rows = body.locator('li.message');
    await expect(rows).toHaveCount(2);
    // Newest first: the Persian one, then the English one. The date is the admin's (AC-31): English, no year this year, in Tehran time.
    await expect(rows.nth(0).locator('.message__subject')).toHaveText('سلام');
    await expect(rows.nth(0).locator('.message__subject')).toHaveAttribute('dir', 'rtl');
    await expect(rows.nth(0).locator('.message__meta')).toHaveText('FA · 10 Oct, 16:30 · Reach: @example');
    await expect(rows.nth(1).locator('.message__subject')).toHaveText('A question about the podcast');
    await expect(rows.nth(1).locator('.message__meta')).toHaveText('EN · 10 Oct, 15:30 · Reach: someone@example.com');
    // The sender's line breaks are kept.
    await expect(rows.nth(1).locator('.message__text')).toHaveText('Line one.\nLine two.');
    expect(await rows.nth(1).locator('.message__text').evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('pre-wrap');
    // Nothing counts (house rule 1): no number of messages, no "new", no total.
    await expect(body).not.toContainText(/\b\d+\s+messages?\b|\bnew\b|\bunread\b|\btotal\b/i);
    await expect(toggle).toHaveText(/^Messages/);
    await expect(page.locator('#messages-heading')).not.toContainText(/\d/);
    await expectWithinColumn(page, '#messages-body');
    await page.screenshot({ path: shot(`admin-messages-${scheme(info)}`), fullPage: true });

    // Delete asks first, and "Keep it" keeps it.
    await rows.nth(0).getByRole('button', { name: 'Delete سلام' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete this message? It can’t be undone.' });
    await expect(dialog).toBeVisible();
    await expectDialogPlace(page, dialog);
    await dialog.getByRole('button', { name: 'Keep it' }).click();
    await expect(dialog).toBeHidden();
    await expect(rows).toHaveCount(2);

    // Delete removes that message and no other.
    await rows.nth(0).getByRole('button', { name: 'Delete سلام' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator('.message__subject')).toHaveText('A question about the podcast');
    await expect(toggle).toBeFocused();
    const left = await admin.context.request.get('/admin/api/messages');
    expect(((await left.json()) as { messages: unknown[] }).messages).toHaveLength(1);

    // Deleting the last one leaves the plain line.
    await rows.first().getByRole('button', { name: /^Delete/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(body.getByText('No messages.', { exact: true })).toBeVisible();
    await expect(rows).toHaveCount(0);

    await expectNoSidewaysScroll(page, 360);
    await expectNoSidewaysScroll(page, 180);
    await expectColourScheme(page, info);
    await expectNoThirdParty(page, admin.requests);
    expect(admin.problems).toEqual([]);
    await admin.context.close();
  });
});

// ── The access sweep: axe, tap targets, forced colours, zoom, reduced motion (plan B9) on each state ──

for (const lang of LANGS) {
  test.describe(`the sweep, contact, ${lang}`, () => {
    test('the page, with the links and the empty form', async ({ page, browser, baseURL }, info) => {
      await watchCsp(page);
      await page.goto(contactPath(lang));
      await sweep(page, info, { browser, baseURL, reducedAt: contactPath(lang) });
    });

    test('the page after a refusal, with the summary and the errors at their fields', async ({ page, browser, baseURL }, info) => {
      await watchCsp(page);
      await page.goto(contactPath(lang));
      await fillForm(page, lang, { message: 'Keep this text' });
      await send(page, lang).click();
      await expect(page.locator('.contact-summary')).toBeVisible();
      await sweep(page, info, { browser, baseURL, reducedAt: contactPath(lang) });
    });

    test('the page after a send, with the thank-you', async ({ page, browser, baseURL }, info) => {
      await watchCsp(page);
      await page.goto(contactPath(lang));
      await fillForm(page, lang, { subject: 'A question', message: 'Hello.', reach: 'someone@example.com' });
      await send(page, lang).click();
      await expect(page.getByRole('status')).toHaveText(T[lang].sent);
      await sweep(page, info, { browser, baseURL, reducedAt: `${contactPath(lang)}?sent=1` });
    });
  });
}

test.describe('the sweep, the admin Messages section', () => {
  test.beforeEach(async ({ request }) => {
    await resetAdmin(request, NOW);
  });

  test('open, with an English and a Persian message, and its delete confirmation', async ({ browser, baseURL, request }, info) => {
    const admin = await signedInAdmin(browser, baseURL as string, request);
    const { page } = admin;
    const visitor = await admin.context.newPage();
    const longAddress = 'https://example.org/a-path-that-keeps-going-to-test-wrapping-at-small-widths';
    for (const [lang, values] of [
      ['en', { subject: 'A question', message: `Line one.\nA long address ${longAddress}.`, reach: 'someone@example.com' }],
      ['fa', { subject: 'سلام', message: 'یک پرسش دارم.', reach: '@example' }],
    ] as const) {
      await visitor.goto(contactPath(lang));
      await fillForm(visitor, lang, values);
      await send(visitor, lang).click();
      await expect(visitor).toHaveURL(`${contactPath(lang)}?sent=1`);
    }
    await visitor.close();
    await page.reload();
    await page.getByRole('button', { name: 'Messages', exact: true }).click();
    await expect(page.locator('#messages-body li.message')).toHaveCount(2);
    await sweep(page, info, { column: 'main' });
    await page.getByRole('button', { name: 'Delete A question' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await sweep(page, info, { column: 'main', skip: { scroll180: 'a modal sheet is a fixed box, measured by its own test' } });
    await admin.context.close();
  });
});

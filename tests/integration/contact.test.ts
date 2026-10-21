// The contact page and its form (change note 08, CT1): the rename (CT-1), the page and its links (CT-2, CT-3), the
// form and its refusals (CT-4, CT-5), the honeypot (CT-6), privacy (CT-7) and the table's CHECKs by direct SQL
// (CT-10, house rule 6). The founder's real links are never here: every value is invented.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMessages } from '../../lib/contact.ts';
import { clearEntries, insertPublished } from '../../lib/entries.ts';
import { resetClock, setNow } from '../../lib/clock.ts';
import { limits } from '../../lib/limits.ts';
import { docFromText } from '../../shared/doc.ts';
import { DAY, NOW, tempDb, testApp, testEnv } from '../helpers.ts';

const t = tempDb();
afterAll(() => t.cleanup());

const LINKS = { CONTACT_EMAIL: 'someone@example.com', CONTACT_TELEGRAM: 'example_channel', CONTACT_INSTAGRAM: 'example' };
const env = testEnv();
const app = testApp(t.db, LINKS);
const bare = testApp(t.db);

beforeEach(() => {
  setNow(NOW);
  clearMessages(t.db);
});
afterEach(() => {
  resetClock();
  vi.restoreAllMocks();
});

type Lang = 'en' | 'fa';
const LANGS: Lang[] = ['en', 'fa'];
const path = (lang: Lang) => (lang === 'fa' ? '/fa/contact' : '/contact');

const GOOD = { subject: 'A question', message: 'Hello there.\nSecond line.', reach: 'someone@example.com' };

interface Reply {
  status: number;
  headers: Headers;
  text: string;
}

async function reply(res: Response): Promise<Reply> {
  return { status: res.status, headers: res.headers, text: await res.text() };
}

/** A form post as a browser sends it from this site: urlencoded, with the site's own Origin. */
async function post(where: string, fields: Record<string, string>, headers: Record<string, string | null> = {}, target = app): Promise<Reply> {
  const sent: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Origin: env.origin };
  for (const [name, value] of Object.entries(headers)) {
    if (value === null) delete sent[name];
    else sent[name] = value;
  }
  return reply(await target.request(where, { method: 'POST', headers: sent, body: new URLSearchParams(fields).toString() }));
}

const get = async (where: string, target = app) => reply(await target.request(where));
const rows = () => t.db.prepare('SELECT * FROM contact_message ORDER BY received_at, rowid').all() as Record<string, unknown>[];
const count = () => (t.db.prepare('SELECT count(*) AS n FROM contact_message').get() as { n: number }).n;

describe('CT-1: the log is Writings', () => {
  const entry = 'e000000001';
  const entryFa = 'e000000002';
  beforeEach(() => {
    clearEntries(t.db);
    insertPublished(t.db, { lang: 'en', id: entry, body: docFromText('One.'), firstPublishedAt: NOW - DAY });
    insertPublished(t.db, { lang: 'fa', id: entryFa, body: docFromText('یک.'), firstPublishedAt: NOW - DAY });
  });

  const PAGES = ['/', '/fa/', '/log', '/fa/log', `/log/${entry}`, `/fa/log/${entryFa}`, '/podcast', '/fa/podcast', '/contact', '/fa/contact', '/nope', '/fa/nope', '/log/feed.xml', '/fa/log/feed.xml'];

  it.each(PAGES)('%s never calls the section Learnings or آموخته‌ها', async (where) => {
    const { text } = await get(where);
    expect(text).not.toMatch(/learnings/i);
    // The sentences that say the founder writes down what was learned describe the site, not the section, and stay.
    expect(text).not.toContain('آموخته‌ها');
  });

  it.each([
    ['en', 'Writings'],
    ['fa', 'نوشته‌ها'],
  ] as const)('names it in the nav, the footer, the landing row, the log, the feed and the 404, %s', async (lang, name) => {
    const prefix = lang === 'fa' ? '/fa' : '';
    for (const where of [`${prefix}/`, `${prefix}/log`, `${prefix}/podcast`, `${prefix}/contact`]) {
      const { text } = await get(where);
      // The header nav (not on the landing page's hero) and the footer nav both carry it.
      expect(text, where).toContain(`href="${prefix}/log"`);
      expect(text.split(`>${name}<`).length - 1, where).toBeGreaterThanOrEqual(2);
    }
    expect((await get(`${prefix}/log`)).text).toContain(`<h1 class="page-title">${name}</h1>`);
    expect((await get(`${prefix}/log/feed.xml`)).text).toContain(`<title>iMNSTR — ${name}</title>`);
    expect((await get(`${prefix}/nope`)).text).toContain(lang === 'fa' ? 'نوشته‌ها را بخوانید' : 'Read the writings');
    expect((await get(`${prefix}/log/${lang === 'fa' ? entryFa : entry}`)).text).toContain(lang === 'fa' ? 'نوشته‌های بیشتر' : 'More writings');
  });

  it('keeps /log and /fa/log answering as before', async () => {
    for (const where of ['/log', '/fa/log']) expect((await get(where)).status).toBe(200);
  });
});

describe.each(LANGS)('CT-2: the page, %s', (lang) => {
  it('answers 200 in its language and direction, with the switch pointing at the other language', async () => {
    const res = await get(path(lang));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/^text\/html/);
    expect(res.text).toContain(lang === 'fa' ? '<html lang="fa" dir="rtl">' : '<html lang="en" dir="ltr">');
    const other = lang === 'fa' ? '/contact' : '/fa/contact';
    expect(res.text).toContain(`<a href="${other}" lang="${lang === 'fa' ? 'en' : 'fa'}" hreflang="${lang === 'fa' ? 'en' : 'fa'}">`);
    expect(res.text).toContain(`<title>${lang === 'fa' ? 'تماس' : 'Contact'} · iMNSTR</title>`);
  });

  it('is linked from the header (from the tablet breakpoint up) and the footer of every public page, current on its own', async () => {
    const prefix = lang === 'fa' ? '/fa' : '';
    for (const from of [`${prefix}/`, `${prefix}/log`, `${prefix}/podcast`, `${prefix}/nope`, path(lang)]) {
      const { text } = await get(from);
      const links = [...text.matchAll(/<a (?:class="nav-contact" )?href="([^"]*)"( aria-current="page")?>\s*(?:Contact|تماس)\s*<\/a>/g)];
      // One in the header's nav, one in the footer's.
      expect(links, from).toHaveLength(2);
      for (const link of links) expect(link[1]).toBe(path(lang));
      expect(text, from).toContain('class="nav-contact"');
      const current = links.filter((l) => l[2]);
      expect(current, from).toHaveLength(from === path(lang) ? 2 : 0);
    }
  });

  it('carries hreflang alternates for both languages', async () => {
    const { text } = await get(path(lang));
    expect(text).toContain('<link rel="alternate" hreflang="en" href="https://imnstr.com/contact"/>');
    expect(text).toContain('<link rel="alternate" hreflang="fa" href="https://imnstr.com/fa/contact"/>');
  });

  it('is not counted by the reader record, and a post never is', async () => {
    await app.request(path(lang), { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0' } });
    await post(path(lang), GOOD);
    expect((t.db.prepare('SELECT count(*) AS n FROM record_view').get() as { n: number }).n).toBe(0);
  });
});

describe.each(LANGS)('CT-3: the founder’s links, %s', (lang) => {
  it('shows a mailto link and the two new-tab links, built from the environment', async () => {
    const { text } = await get(path(lang));
    expect(text).toContain('href="mailto:someone@example.com"');
    expect(text).toMatch(/<a class="big-row" href="https:\/\/t\.me\/example_channel" target="_blank" rel="noopener"/);
    expect(text).toMatch(/<a class="big-row" href="https:\/\/www\.instagram\.com\/example\/" target="_blank" rel="noopener"/);
    // The mailto link opens no page, so it has no target.
    expect(text).not.toMatch(/href="mailto:[^"]*"[^>]*target=/);
    // Each value is isolated left to right, so the @ stays put in a right-to-left line.
    expect(text).toContain('<bdi dir="ltr">someone@example.com</bdi>');
    expect(text).toContain('<bdi dir="ltr">@example_channel</bdi>');
  });

  it('leaves out a link whose variable is unset or invalid, and nothing else moves', async () => {
    const only = testApp(t.db, { CONTACT_TELEGRAM: 'example_channel', CONTACT_EMAIL: 'not an address', CONTACT_INSTAGRAM: 'a/b' });
    const { text } = await get(path(lang), only);
    expect(text).toContain('https://t.me/example_channel');
    expect(text).not.toContain('mailto:');
    expect(text).not.toContain('instagram.com');
    const none = await get(path(lang), bare);
    expect(none.status).toBe(200);
    expect(none.text).not.toContain('rows--contact');
    expect(none.text).toContain('<form method="post"');
  });
});

describe.each(LANGS)('CT-4: the form, %s', (lang) => {
  it('has three labelled, required fields and a send button, posting to its own page with no script', async () => {
    const { text } = await get(path(lang));
    expect(text).toContain(`<form method="post" action="${path(lang)}" novalidate="">`);
    for (const [name, id] of [
      ['subject', 'contact-subject'],
      ['message', 'contact-message'],
      ['reach', 'contact-reach'],
    ]) {
      expect(text).toContain(`<label class="contact-field__label" for="${id}">`);
      expect(text).toMatch(new RegExp(`<(input|textarea)[^>]*id="${id}"[^>]*name="${name}"[^>]*aria-required="true"|<(input|textarea)[^>]*name="${name}"[^>]*id="${id}"[^>]*aria-required="true"`));
    }
    expect(text).toContain('type="submit"');
    // The only script on the page is the wordmark's, an external file.
    expect([...text.matchAll(/<script\b[^>]*>/g)].map((m) => m[0])).toEqual([expect.stringMatching(/^<script defer="" src="\/assets\/wordmark\.[0-9a-f]{10}\.js">$/)]);
  });

  it('stores a valid post with its language and time, and answers 303 to the page with ?sent=1', async () => {
    const res = await post(path(lang), GOOD);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(`${path(lang)}?sent=1`);
    expect(rows()).toEqual([expect.objectContaining({ ...GOOD, lang, received_at: NOW })]);
    expect(rows()[0]?.id).toMatch(/^[0-9a-hjkmnp-tv-z]{10}$/);
  });

  it('shows a thank-you notice and an empty form after the redirect', async () => {
    const res = await get(`${path(lang)}?sent=1`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(lang === 'fa' ? 'فرستاده شد. ممنون، جواب می‌دهم.' : 'Sent. Thank you, I’ll get back to you.');
    expect(res.text).toContain('role="status"');
    expect(res.text).not.toContain('contact-field__error');
    // The bare page has no notice.
    expect((await get(path(lang))).text).not.toContain('contact-notice');
  });

  it('serves ?sent=1 with the same headers as the bare page, so it is never cached as the form', async () => {
    const bareReply = await get(path(lang));
    const sent = await get(`${path(lang)}?sent=1`);
    for (const name of ['Cache-Control', 'Content-Security-Policy', 'Content-Type']) {
      expect(sent.headers.get(name), name).toBe(bareReply.headers.get(name));
    }
    expect(sent.headers.get('Cache-Control')).toBe('no-cache');
    // The two bodies differ, so their validators do too.
    expect(sent.headers.get('ETag')).not.toBe(bareReply.headers.get('ETag'));
  });

  it('trims the fields, keeps line breaks in the message, and folds them in a one-line field', async () => {
    await post(path(lang), { subject: '  Hi\nthere  ', message: '\r\n  Line one\r\nLine two  \r\n', reach: '\t@example\u0000 ' });
    expect(rows()[0]).toMatchObject({ subject: 'Hi there', message: 'Line one\nLine two', reach: '@example' });
  });

  it('stores fields exactly at their limits, counted in characters', async () => {
    const edge = { subject: 'س'.repeat(limits.contactSubjectMax), message: '😀'.repeat(limits.contactMessageMax), reach: 'r'.repeat(limits.contactReachMax) };
    const res = await post(path(lang), edge);
    expect(res.status).toBe(303);
    expect(rows()[0]).toMatchObject(edge);
  });
});

describe.each(LANGS)('CT-5: refusals, %s', (lang) => {
  const T =
    lang === 'fa'
      ? { summary: 'چند خانه را بررسی کنید:', subject: 'موضوع را بنویسید.', message: 'پیام را بنویسید.', reach: 'بگویید چطور با شما تماس بگیرم.', cap: 'امروز پیام زیادی رسیده. فردا دوباره بفرستید، یا به ایمیل بالا بنویسید.', capNoEmail: 'امروز پیام زیادی رسیده. فردا دوباره بفرستید.', origin: 'این فرم را فقط از همین سایت می‌شود فرستاد.' }
      : { summary: 'Some fields need a look:', subject: 'Write a subject.', message: 'Write a message.', reach: 'Say how I can reach you.', cap: 'Too many messages today. Try again tomorrow, or use the email above.', capNoEmail: 'Too many messages today. Try again tomorrow.', origin: 'This form can only be sent from this site.' };

  it('answers 400 with the page, the values kept and the error next to each field, linked from a summary', async () => {
    const res = await post(path(lang), { subject: '   ', message: 'Keep <this> & that', reach: '' });
    expect(res.status).toBe(400);
    expect(count()).toBe(0);
    expect(res.text).toContain(T.summary);
    // The summary links to each field that needs a look, and only those.
    expect(res.text).toContain(`<a href="#contact-subject">${T.subject}</a>`);
    expect(res.text).toContain(`<a href="#contact-reach">${T.reach}</a>`);
    expect(res.text).not.toContain(`<a href="#contact-message">`);
    // Each refused field says so, and is described by its error.
    expect(res.text).toContain(`<p class="contact-field__error" id="contact-subject-error">${T.subject}</p>`);
    expect(res.text).toMatch(/id="contact-subject"[^>]*aria-invalid="true"[^>]*aria-describedby="contact-subject-error"|aria-describedby="contact-subject-error"[^>]*aria-invalid="true"/);
    expect(res.text).toMatch(/aria-describedby="contact-reach-hint contact-reach-error"/);
    expect(res.text).not.toContain(T.message);
    // What was typed comes back, escaped.
    expect(res.text).toContain('Keep &lt;this&gt; &amp; that</textarea>');
  });

  it('refuses a field over its limit, naming the limit in the language’s digits', async () => {
    const over = (n: number) => 'x'.repeat(n + 1);
    const res = await post(path(lang), { subject: over(limits.contactSubjectMax), message: over(limits.contactMessageMax), reach: over(limits.contactReachMax) });
    expect(res.status).toBe(400);
    expect(count()).toBe(0);
    const say = (max: string) => (lang === 'fa' ? `کمتر از ${max} نویسه بنویسید.` : `Keep it under ${max} characters.`);
    const digits = lang === 'fa' ? ['۱۲۰', '۵٬۰۰۰', '۲۰۰'] : ['120', '5,000', '200'];
    for (const max of digits) expect(res.text).toContain(say(max));
  });

  it('counts an emoji as one character, not two', async () => {
    const res = await post(path(lang), { ...GOOD, subject: '😀'.repeat(limits.contactSubjectMax) });
    expect(res.status).toBe(303);
    expect((await post(path(lang), { ...GOOD, subject: '😀'.repeat(limits.contactSubjectMax + 1) })).status).toBe(400);
  });

  it('answers a body that is not a form as empty fields', async () => {
    const res = await app.request(path(lang), { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: env.origin }, body: JSON.stringify(GOOD) });
    expect(res.status).toBe(400);
    expect(count()).toBe(0);
  });

  it('answers 413 to a body past the limit, before it is read', async () => {
    const res = await post(path(lang), { ...GOOD, message: 'x'.repeat(limits.contactBodyMaxBytes + 1) });
    expect(res.status).toBe(413);
    expect(res.text).toBe('REQUEST_TOO_LARGE');
    expect(count()).toBe(0);
  });

  it('answers 403 to a post from another origin, with the page and a notice, and stores nothing', async () => {
    const elsewhere: Record<string, string | null>[] = [{ Origin: 'https://elsewhere.example' }, { Origin: 'null' }, { Origin: null, 'Sec-Fetch-Site': 'cross-site' }];
    for (const headers of elsewhere) {
      const res = await post(path(lang), GOOD, headers);
      expect(res.status, JSON.stringify(headers)).toBe(403);
      expect(res.text).toContain(T.origin);
      expect(res.text).toContain('<form method="post"');
    }
    expect(count()).toBe(0);
  });

  it('lets a post with no Origin and no Sec-Fetch-Site through (an old client), and one from this site', async () => {
    expect((await post(path(lang), GOOD, { Origin: null })).status).toBe(303);
    expect((await post(path(lang), GOOD, { 'Sec-Fetch-Site': 'same-origin' })).status).toBe(303);
    expect(count()).toBe(2);
  });

  it('checks the origin before the honeypot, and the honeypot before the fields', async () => {
    // A post from elsewhere that also fills the honeypot is a 403, not a pretended success.
    expect((await post(path(lang), { ...GOOD, website: 'x' }, { Origin: 'https://elsewhere.example' })).status).toBe(403);
    // A filled honeypot with empty fields is a success to the script, not a 400.
    expect((await post(path(lang), { subject: '', message: '', reach: '', website: 'x' })).status).toBe(303);
    expect(count()).toBe(0);
  });

  it('answers 429 with the page and a notice once 30 messages have been stored in 24 hours, and stores nothing more', async () => {
    for (let n = 0; n < limits.contactCap; n++) {
      expect((await post(path(lang), { ...GOOD, subject: `Message ${n}` })).status, `message ${n}`).toBe(303);
    }
    const refused = await post(path(lang), { ...GOOD, subject: 'One too many' });
    expect(refused.status).toBe(429);
    expect(refused.text).toContain(T.cap);
    // The values are kept, so nothing has to be written again.
    expect(refused.text).toContain('value="One too many"');
    expect(count()).toBe(limits.contactCap);
    // It is a rolling window on the clock: still full a millisecond before the first has aged out, free at the instant it has.
    setNow(NOW + DAY - 1);
    expect((await post(path(lang), GOOD)).status).toBe(429);
    setNow(NOW + DAY);
    expect((await post(path(lang), GOOD)).status).toBe(303);
    expect(count()).toBe(limits.contactCap + 1);
  });

  it('does not point to an email link at the cap when the server has none', async () => {
    for (let n = 0; n < limits.contactCap; n++) await post(path(lang), GOOD, {}, bare);
    const refused = await post(path(lang), GOOD, {}, bare);
    expect(refused.status).toBe(429);
    expect(refused.text).not.toContain(T.cap);
    expect(refused.text).toContain(T.capNoEmail);
  });

  it('counts the cap across both languages, since it cannot tell senders apart', async () => {
    for (let n = 0; n < limits.contactCap; n++) await post(n % 2 ? '/contact' : '/fa/contact', GOOD);
    expect((await post(path(lang), GOOD)).status).toBe(429);
  });
});

describe.each(LANGS)('CT-6: the honeypot, %s', (lang) => {
  it('answers a post that fills it exactly as a valid post, and stores nothing', async () => {
    for (const website of ['https://spam.example', ' ', '0']) {
      const res = await post(path(lang), { ...GOOD, website });
      expect(res.status).toBe(303);
      expect(res.headers.get('Location')).toBe(`${path(lang)}?sent=1`);
    }
    expect(count()).toBe(0);
  });

  it('is hidden by a class, out of the tab order and the accessibility tree, and never by a style attribute', async () => {
    const { text } = await get(path(lang));
    expect(text).toContain('<div class="contact__trap" aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off"/></div>');
    expect(text).not.toMatch(/\sstyle=/);
  });

  it('accepts an empty honeypot, as every real visitor sends it', async () => {
    expect((await post(path(lang), { ...GOOD, website: '' })).status).toBe(303);
    expect(count()).toBe(1);
  });
});

describe.each(LANGS)('CT-7: privacy, %s', (lang) => {
  it('sends no Set-Cookie from the page, its post, its refusals or its redirect', async () => {
    const replies = [
      await get(path(lang)),
      await get(`${path(lang)}?sent=1`),
      await post(path(lang), GOOD),
      await post(path(lang), { ...GOOD, subject: '' }),
      await post(path(lang), GOOD, { Origin: 'https://elsewhere.example' }),
      await post(path(lang), { ...GOOD, website: 'x' }),
    ];
    for (const res of replies) expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('is the same for a signed-in request and a signed-out one: it reads no cookie', async () => {
    const plain = await get(path(lang));
    const withCookie = await reply(await app.request(path(lang), { headers: { Cookie: '__Host-imnstr_session=anything' } }));
    expect(withCookie.text).toBe(plain.text);
    expect(withCookie.headers.getSetCookie()).toEqual([]);
  });

  it('loads nothing off-origin, and has no inline script or style attribute, on every state of the page', async () => {
    const states = [
      await get(path(lang)),
      await get(`${path(lang)}?sent=1`),
      await post(path(lang), { subject: '', message: '', reach: '' }),
      await post(path(lang), GOOD, { Origin: 'https://elsewhere.example' }),
    ];
    for (const res of states) {
      expect(res.text).not.toMatch(/\sstyle=/);
      expect(res.text).not.toMatch(/<script(?![^>]*\ssrc=)/);
      expect(res.text).not.toMatch(/\son[a-z]+=/);
      // Everything the page loads (src, stylesheet, preload) is on this origin; the founder's links are only links.
      const loads = [...res.text.matchAll(/<(?:script|link|img)\b[^>]*\s(?:src|href)="([^"]*)"/g)].map((m) => m[1]);
      for (const url of loads) expect(url, url).toMatch(/^(\/(?!\/)|data:|https:\/\/imnstr\.com\/)/);
      // The form posts to this origin (the CSP's form-action 'self' says so as well).
      expect(res.text).toContain(`action="${path(lang)}"`);
      expect(res.headers.get('Content-Security-Policy')).toContain("form-action 'self'");
    }
  });

  it('logs nothing of a message or its sender', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    await post(path(lang), { subject: 'Secret subject', message: 'Secret message', reach: 'secret@example.com' }, { 'User-Agent': 'SecretAgent/1.0', 'X-Forwarded-For': '203.0.113.9' });
    await post(path(lang), { subject: '', message: '', reach: '' });
    await post(path(lang), GOOD, { Origin: 'https://elsewhere.example' });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('has no column for an address, an agent or anything not typed into the form', () => {
    const columns = (t.db.prepare('PRAGMA table_info(contact_message)').all() as { name: string }[]).map((c) => c.name);
    expect(columns.sort()).toEqual(['id', 'lang', 'message', 'reach', 'received_at', 'subject']);
  });
});

describe('CT-10: the table’s CHECKs, by direct SQL (house rule 6)', () => {
  const insert = (fields: Partial<Record<'id' | 'lang' | 'subject' | 'message' | 'reach' | 'received_at', unknown>> = {}) => {
    const row = { id: 'aaaaaaaaaa', lang: 'en', subject: 's', message: 'm', reach: 'r', received_at: NOW, ...fields };
    t.db.prepare('INSERT INTO contact_message (id, lang, subject, message, reach, received_at) VALUES (@id, @lang, @subject, @message, @reach, @received_at)').run(row);
  };

  it('accepts a row at each limit, counting characters', () => {
    expect(() => insert({ subject: 'س'.repeat(120), message: '😀'.repeat(5000), reach: 'r'.repeat(200) })).not.toThrow();
    expect(count()).toBe(1);
  });

  it.each([
    ['an empty subject', { subject: '' }],
    ['a subject of 121 characters', { subject: 'x'.repeat(121) }],
    ['an empty message', { message: '' }],
    ['a message of 5001 characters', { message: 'x'.repeat(5001) }],
    ['an empty reach', { reach: '' }],
    ['a reach of 201 characters', { reach: 'x'.repeat(201) }],
    ['a language that is not en or fa', { lang: 'de' }],
    ['a null subject', { subject: null }],
    ['a null time', { received_at: null }],
  ])('refuses %s', (_name, fields) => {
    expect(() => insert(fields)).toThrow(/CHECK constraint|NOT NULL constraint/);
    expect(count()).toBe(0);
  });

  it('refuses a second row with the same id', () => {
    insert();
    expect(() => insert()).toThrow(/UNIQUE|PRIMARY KEY/);
  });

  it('is indexed by time, for the cap and the list', () => {
    const plan = t.db.prepare('EXPLAIN QUERY PLAN SELECT count(*) FROM contact_message WHERE received_at > ?').all(0) as { detail: string }[];
    expect(plan.map((p) => p.detail).join(' ')).toContain('contact_message_received');
  });
});

// The episodes API (plan B7): save, edit, publish, unpublish and the list, behind the guard. AC-17,
// AC-25, AC-42, and the refusals of §6.2, each asserted by the bytes of the body, not only the status
// (house rule 3), and the triggers by direct SQL (house rule 6).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetClock, setNow } from '../../lib/clock.ts';
import { clearEpisodes, insertEpisodeFixture } from '../../lib/episodes.ts';
import { limits } from '../../lib/limits.ts';
import { Client, resetAuth, signedIn } from '../authHelpers.ts';
import { DAY, HOUR, NOW, tempDb, testApp, testEnv } from '../helpers.ts';

const t = tempDb();
const env = testEnv();
const app = testApp(t.db);
afterAll(() => {
  resetClock();
  t.cleanup();
});

let client: Client;
beforeEach(async () => {
  setNow(NOW);
  resetAuth(t.db);
  clearEpisodes(t.db);
  client = (await signedIn(app, t.db, env)).client;
});

/** Move the clock and sign in again: a session idles out after an hour, and these tests jump by days. */
async function clockTo(instant: number): Promise<void> {
  setNow(instant);
  client = (await signedIn(app, t.db, env)).client;
}

interface Episode {
  id: string;
  lang: string;
  name: string | null;
  description: string | null;
  tags: string[];
  date: string;
  links: { label: string; url: string }[];
  state: string;
  wasLive: boolean;
  firstPublishedAt: number | null;
}

const YT = { label: 'YouTube', url: 'https://youtu.be/abc123' };
const CB = { label: 'Castbox', url: 'https://castbox.fm/episode/abc' };
/** A whole episode, ready to publish. */
const whole = (extra: Record<string, unknown> = {}) => ({ name: 'Why a monster?', description: 'Where the name comes from.', tags: ['origins'], links: [YT], ...extra });

const count = () => (t.db.prepare('SELECT count(*) AS n FROM episode').get() as { n: number }).n;
const rowOf = (id: string) => t.db.prepare('SELECT * FROM episode WHERE id = ?').get(id) as Record<string, unknown>;
const linkRows = (id: string) => t.db.prepare('SELECT position, label, url FROM episode_link WHERE episode_id = ? ORDER BY position').all(id) as { position: number; label: string; url: string }[];
const lastLanguage = async (c: Client = client) => (await c.get('/admin/api/settings')).json.lastLanguage;

/** Save a new episode; returns the episode the API answered with. */
async function save(fields: Record<string, unknown> = {}, c: Client = client) {
  const res = await c.post('/admin/api/episodes', { publishKey: randomUUID(), lang: 'en', publish: false, ...fields });
  expect(res.status, res.text).toBe(200);
  return res.json.episode as Episode;
}

const attempt = (fields: Record<string, unknown>) => client.post('/admin/api/episodes', { publishKey: randomUUID(), lang: 'en', ...fields });
const put = (id: string, fields: Record<string, unknown>) => client.call('PUT', `/admin/api/episodes/${id}`, fields);
const publicPage = (lang: 'en' | 'fa', query = '') => app.request(`${lang === 'fa' ? '/fa' : ''}/podcast${query}`);
const never = 'a000000099';

describe('AC-17: an episode is added, edited, unpublished and republished', () => {
  it('saves a draft with a language alone, and shows the public nothing', async () => {
    const episode = await save({});
    expect(episode).toMatchObject({ lang: 'en', name: null, description: null, tags: [], links: [], state: 'draft', wasLive: false, firstPublishedAt: null });
    expect(episode.date).toBe('2026-10-10');
    expect(await (await publicPage('en')).text()).not.toContain(episode.id);
  });

  it('publishes new text in one request: the links go in before the publish (S-3)', async () => {
    const episode = await save({ ...whole({ links: [YT, CB] }), publish: true });
    expect(episode).toMatchObject({ state: 'published', firstPublishedAt: NOW, links: [YT, CB], tags: ['origins'] });
    const page = await (await publicPage('en')).text();
    expect(page).toContain('Why a monster?');
    expect(page).toContain('https://castbox.fm/episode/abc');
    // The row, as it is: the date is the day the episode was made, in the site's zone.
    expect(rowOf(episode.id)).toMatchObject({ state: 'published', date: '2026-10-10', tag1: 'origins', tag2: null, first_published_at: NOW });
  });

  it('keeps one or two tags, in order, and drops blank ones', async () => {
    expect((await save({ tags: ['one', 'two'] })).tags).toEqual(['one', 'two']);
    expect((await save({ tags: ['  spaced  ', '   '] })).tags).toEqual(['spaced']);
    expect((await save({ tags: ['', 'second'] })).tags).toEqual(['second']);
    expect((await save({ tags: null })).tags).toEqual([]);
  });

  it('edits the text, tags, date and links of a published episode, and keeps its state, language and first date', async () => {
    const episode = await save({ ...whole(), publish: true });
    await clockTo(NOW + 3 * DAY);
    const res = await put(episode.id, {
      name: 'After',
      description: 'New words.',
      tags: ['a', 'b'],
      date: '2026-10-01',
      links: [YT, CB],
      state: 'draft',
      firstPublishedAt: 1,
      publishKey: randomUUID(),
    });
    expect(res.status, res.text).toBe(200);
    expect(res.json.episode).toMatchObject({ id: episode.id, lang: 'en', name: 'After', tags: ['a', 'b'], date: '2026-10-01', state: 'published', firstPublishedAt: NOW, links: [YT, CB] });
    expect(rowOf(episode.id)).toMatchObject({ lang: 'en', state: 'published', first_published_at: NOW, created_at: NOW, updated_at: NOW + 3 * DAY, publish_key: rowOf(episode.id).publish_key });
    const page = await (await publicPage('en')).text();
    expect(page).toContain('New words.');
    expect(page).not.toContain('Where the name comes from.');
  });

  it('unpublishes to a draft that was live, with its date, and republishes at the original first date', async () => {
    const episode = await save({ ...whole(), publish: true });
    await clockTo(NOW + 5 * DAY);
    const off = await client.post(`/admin/api/episodes/${episode.id}/unpublish`);
    expect(off.json.episode).toMatchObject({ id: episode.id, state: 'draft', wasLive: true, firstPublishedAt: NOW, date: '2026-10-10' });
    expect(await (await publicPage('en')).text()).not.toContain('Why a monster');
    // The episode's page is the list, so "gone" is the list without it; its links survive the unpublish.
    expect(linkRows(episode.id)).toHaveLength(1);
    await clockTo(NOW + 9 * DAY);
    const on = await client.post(`/admin/api/episodes/${episode.id}/publish`);
    expect(on.json.episode).toMatchObject({ state: 'published', wasLive: false, firstPublishedAt: NOW, date: '2026-10-10' });
    expect(await (await publicPage('en')).text()).toContain('Why a monster?');
    // A second unpublish of a draft changes nothing.
    await client.post(`/admin/api/episodes/${episode.id}/unpublish`);
    const again = await client.post(`/admin/api/episodes/${episode.id}/unpublish`);
    expect(again.json.episode).toMatchObject({ state: 'draft', wasLive: true });
  });

  it('takes a link away in an edit when others remain, and a published episode keeps at least one (AC-17)', async () => {
    const episode = await save({ ...whole({ links: [YT, CB] }), publish: true });
    const one = await put(episode.id, whole({ links: [CB] }));
    expect(one.json.episode).toMatchObject({ links: [CB] });
    expect(linkRows(episode.id).map((row) => row.label)).toEqual(['Castbox']);
  });

  it('refuses an empty list on a published episode with LAST_LINK (409), and leaves its links as they were', async () => {
    const episode = await save({ ...whole({ links: [YT, CB] }), publish: true });
    const before = linkRows(episode.id);
    const res = await put(episode.id, whole({ links: [] }));
    expect(res.status).toBe(409);
    expect(res.text).toBe('{"code":"LAST_LINK"}');
    expect(linkRows(episode.id)).toEqual(before);
    // A list of only blank rows is an empty list.
    expect((await put(episode.id, whole({ links: [{ label: '', url: '' }] }))).text).toBe('{"code":"LAST_LINK"}');
    expect(linkRows(episode.id)).toEqual(before);
  });

  it('lets a draft lose every link, and refuses to publish it without one (LINK_REQUIRED)', async () => {
    const episode = await save(whole({ links: [YT] }));
    expect((await put(episode.id, whole({ links: [] }))).status).toBe(200);
    expect(linkRows(episode.id)).toEqual([]);
    const res = await client.post(`/admin/api/episodes/${episode.id}/publish`);
    expect(res.status).toBe(400);
    expect(res.text).toBe('{"code":"LINK_REQUIRED"}');
    expect(rowOf(episode.id).state).toBe('draft');
  });

  it('refuses a link that is not https, on every save and on a publish, with the bytes LINK_NOT_HTTPS (400)', async () => {
    const bad = ['http://youtu.be/abc', 'ftp://example.com/x', 'javascript:alert(1)', 'youtu.be/abc123', 'https:example.com', 'https://', 'https://exa mple.com', '//example.com', 'mailto:a@b.co'];
    for (const url of bad) {
      for (const publish of [false, true]) {
        const res = await attempt({ ...whole({ links: [{ label: 'YouTube', url }] }), publish });
        expect(res.status, url).toBe(400);
        expect(res.text, url).toBe('{"code":"LINK_NOT_HTTPS"}');
      }
    }
    expect(count()).toBe(0);
    const episode = await save(whole());
    for (const url of bad) expect((await put(episode.id, whole({ links: [{ label: 'YouTube', url }] }))).text, url).toBe('{"code":"LINK_NOT_HTTPS"}');
    expect(linkRows(episode.id)).toHaveLength(1);
    // A label with no address is a link that doesn't start with https:// either.
    expect((await attempt(whole({ links: [{ label: 'YouTube', url: '' }] }))).text).toBe('{"code":"LINK_NOT_HTTPS"}');
  });

  it('accepts https in any case, stores the text as typed, and takes a free-text label', async () => {
    const episode = await save(whole({ links: [{ label: 'My own site', url: '  HTTPS://Example.com/Path?x=1#y  ' }, { label: 'Spotify', url: 'https://open.spotify.com/episode/xyz' }] }));
    expect(episode.links).toEqual([
      { label: 'My own site', url: 'HTTPS://Example.com/Path?x=1#y' },
      { label: 'Spotify', url: 'https://open.spotify.com/episode/xyz' },
    ]);
  });

  it('drops a link row with nothing in it, and refuses an address with no label (REQUEST_INVALID)', async () => {
    expect((await save(whole({ links: [YT, { label: '  ', url: '' }, { url: null }] }))).links).toEqual([YT]);
    const res = await attempt(whole({ links: [{ label: '', url: 'https://youtu.be/x' }] }));
    expect(res.status).toBe(400);
    expect(res.text).toBe('{"code":"REQUEST_INVALID"}');
  });
});

describe('PD-23: what an episode needs to be published', () => {
  it('asks in the plan\'s order: name, description, tags, then a link (400 each)', async () => {
    const steps: [Record<string, unknown>, string][] = [
      [{}, 'NAME_REQUIRED'],
      [{ name: 'Name' }, 'DESCRIPTION_REQUIRED'],
      [{ name: 'Name', description: 'Words.' }, 'TAGS_ONE_OR_TWO'],
      [{ name: 'Name', description: 'Words.', tags: ['a'] }, 'LINK_REQUIRED'],
    ];
    for (const [fields, code] of steps) {
      // As a new episode published at once: nothing is made.
      const made = await attempt({ ...fields, publish: true });
      expect(made.status, code).toBe(400);
      expect(made.text, code).toBe(`{"code":"${code}"}`);
      // As a saved draft, then asked to publish: the draft stays a draft.
      const draft = await save(fields);
      const res = await client.post(`/admin/api/episodes/${draft.id}/publish`);
      expect(res.text, code).toBe(`{"code":"${code}"}`);
      expect(rowOf(draft.id).state).toBe('draft');
    }
    expect(count()).toBe(4);
  });

  it('treats a blank name or description as missing, and a published episode must keep them (PUT)', async () => {
    expect((await attempt({ ...whole({ name: '   ' }), publish: true })).text).toBe('{"code":"NAME_REQUIRED"}');
    expect((await attempt({ ...whole({ description: '\n \n' }), publish: true })).text).toBe('{"code":"DESCRIPTION_REQUIRED"}');
    const episode = await save({ ...whole(), publish: true });
    expect((await put(episode.id, whole({ name: '' }))).text).toBe('{"code":"NAME_REQUIRED"}');
    expect((await put(episode.id, whole({ description: null }))).text).toBe('{"code":"DESCRIPTION_REQUIRED"}');
    expect((await put(episode.id, whole({ tags: [] }))).text).toBe('{"code":"TAGS_ONE_OR_TWO"}');
    expect(rowOf(episode.id)).toMatchObject({ name: 'Why a monster?', description: 'Where the name comes from.', tag1: 'origins' });
    // A draft may be saved without any of them.
    expect((await put((await save(whole())).id, { name: '', links: [] })).status).toBe(200);
  });

  it('refuses three tags on any save: there is nowhere to keep a third', async () => {
    for (const publish of [false, true]) {
      const res = await attempt({ ...whole({ tags: ['a', 'b', 'c'] }), publish });
      expect(res.status).toBe(400);
      expect(res.text).toBe('{"code":"TAGS_ONE_OR_TWO"}');
    }
    expect(count()).toBe(0);
  });

  it('rolls back the whole request when publishing is refused: no row, no links, no remembered language', async () => {
    const res = await attempt({ ...whole(), lang: 'fa', links: [YT, { label: 'Bad', url: 'http://x.example' }], publish: true });
    expect(res.text).toBe('{"code":"LINK_NOT_HTTPS"}');
    expect(count()).toBe(0);
    expect(t.db.prepare('SELECT count(*) AS n FROM episode_link').get()).toEqual({ n: 0 });
    expect(await lastLanguage()).toBe('en');
  });
});

describe('the guards (limits.ts), each REQUEST_INVALID (400)', () => {
  const over = (n: number) => 'x'.repeat(n + 1);
  const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ['name', { name: 'x'.repeat(limits.episodeNameMaxChars) }, { name: over(limits.episodeNameMaxChars) }],
    ['description', { description: 'x'.repeat(limits.episodeDescriptionMaxChars) }, { description: over(limits.episodeDescriptionMaxChars) }],
    ['tag', { tags: ['x'.repeat(limits.episodeTagMaxChars)] }, { tags: [over(limits.episodeTagMaxChars)] }],
    [
      'label',
      { links: [{ label: 'x'.repeat(limits.episodeLinkLabelMaxChars), url: YT.url }] },
      { links: [{ label: over(limits.episodeLinkLabelMaxChars), url: YT.url }] },
    ],
    [
      'address',
      { links: [{ label: 'L', url: `https://example.com/${'x'.repeat(limits.episodeLinkUrlMaxChars - 'https://example.com/'.length)}` }] },
      { links: [{ label: 'L', url: `https://example.com/${'x'.repeat(limits.episodeLinkUrlMaxChars - 'https://example.com/'.length + 1)}` }] },
    ],
    ['links', { links: Array.from({ length: limits.episodeLinksMax }, (_, n) => ({ label: `L${n}`, url: `https://example.com/${n}` })) }, { links: Array.from({ length: limits.episodeLinksMax + 1 }, (_, n) => ({ label: `L${n}`, url: `https://example.com/${n}` })) }],
  ];

  it.each(cases)('keeps a %s at its limit and refuses one past it', async (_name, atLimit, past) => {
    expect((await attempt(atLimit)).status).toBe(200);
    const res = await attempt(past);
    expect(res.status).toBe(400);
    expect(res.text).toBe('{"code":"REQUEST_INVALID"}');
  });

  it('counts after trimming, so spaces around a name at the limit are not refused', async () => {
    expect((await save({ name: `  ${'x'.repeat(limits.episodeNameMaxChars)}  ` })).name).toHaveLength(limits.episodeNameMaxChars);
  });

  it('refuses a field of the wrong shape, a line break in a one-line field, and a bad language and key', async () => {
    for (const fields of [{ name: 5 }, { description: ['x'] }, { tags: 'one' }, { tags: [5] }, { links: 'x' }, { links: [5] }, { links: [{ label: 5, url: YT.url }] }, { name: 'two\nlines' }, { tags: ['a\tb'] }, { links: [{ label: 'a\nb', url: YT.url }] }, { date: 20261010 }, { publish: 'yes' }]) {
      const res = await attempt(fields);
      expect(res.status, JSON.stringify(fields)).toBe(400);
      expect(res.text, JSON.stringify(fields)).toBe('{"code":"REQUEST_INVALID"}');
    }
    expect((await attempt({ lang: 'de' })).text).toBe('{"code":"LANG_INVALID"}');
    expect((await client.post('/admin/api/episodes', { lang: 'en', publishKey: 'not-a-uuid' })).text).toBe('{"code":"REQUEST_INVALID"}');
    expect((await client.post('/admin/api/episodes', { lang: 'en' })).text).toBe('{"code":"REQUEST_INVALID"}');
    expect((await client.call('POST', '/admin/api/episodes', undefined)).status).toBe(400);
    expect(count()).toBe(0);
  });

  it('strips the characters XML forbids from every text field, and keeps the description\'s line breaks', async () => {
    const episode = await save({
      name: 'Na\u000Bme\u0000',
      description: 'First\r\nsecond\u0001\n\nthird\rfourth',
      tags: ['t\u0008ag'],
      links: [{ label: 'La\u000Cbel', url: 'https://example.com/\u0007x' }],
    });
    expect(episode).toMatchObject({ name: 'Name', description: 'First\nsecond\n\nthird\nfourth', tags: ['tag'], links: [{ label: 'Label', url: 'https://example.com/x' }] });
  });
});

describe('PD-23, the date: a calendar day, filled in with today in SITE_TZ', () => {
  it('fills a missing date with today in the site\'s zone, not UTC\'s: at 23:30 UTC the next day has begun in Tehran', async () => {
    const lateUtc = Date.UTC(2026, 9, 10, 23, 30);
    await clockTo(lateUtc);
    expect((await save({})).date).toBe('2026-10-11');
    const list = await client.get('/admin/api/episodes');
    expect(list.json.today).toBe('2026-10-11');
    expect(list.json.now).toBe(lateUtc);
  });

  it('follows SITE_TZ: the same instant is still the 10th in Los Angeles', async () => {
    const lateUtc = Date.UTC(2026, 9, 10, 23, 30);
    setNow(lateUtc);
    const laEnv = testEnv({ SITE_TZ: 'America/Los_Angeles' });
    const laApp = testApp(t.db, { SITE_TZ: 'America/Los_Angeles' });
    const la = (await signedIn(laApp, t.db, laEnv)).client;
    expect((await save({}, la)).date).toBe('2026-10-10');
    expect((await la.get('/admin/api/episodes')).json.today).toBe('2026-10-10');
    // A zone ahead of UTC at noon UTC: still the same day in Tehran and in Auckland, ahead by 13 h.
    setNow(NOW);
    const nz = (await signedIn(testApp(t.db, { SITE_TZ: 'Pacific/Auckland' }), t.db, testEnv({ SITE_TZ: 'Pacific/Auckland' }))).client;
    expect((await save({}, nz)).date).toBe('2026-10-11');
  });

  it('turns the list\'s year with the site\'s zone, not UTC\'s: `today` is what the admin\'s year rule reads (AC-31)', async () => {
    // 20:45 UTC on 31 December: New Year has begun in Tehran, and not in Los Angeles.
    const newYear = Date.UTC(2026, 11, 31, 20, 45);
    await clockTo(newYear);
    expect((await client.get('/admin/api/episodes')).json.today).toBe('2027-01-01');
    setNow(newYear);
    const la = (await signedIn(testApp(t.db, { SITE_TZ: 'America/Los_Angeles' }), t.db, testEnv({ SITE_TZ: 'America/Los_Angeles' }))).client;
    expect((await la.get('/admin/api/episodes')).json.today).toBe('2026-12-31');
  });

  it('keeps a date that was sent, and an edit without one keeps the episode\'s own', async () => {
    const episode = await save({ date: '2026-09-30' });
    expect(episode.date).toBe('2026-09-30');
    await clockTo(NOW + 40 * DAY);
    expect((await put(episode.id, whole())).json.episode).toMatchObject({ date: '2026-09-30' });
    expect((await put(episode.id, whole({ date: '2026-10-02' }))).json.episode).toMatchObject({ date: '2026-10-02' });
    expect((await put(episode.id, whole({ date: '' }))).json.episode).toMatchObject({ date: '2026-10-02' });
  });

  it('refuses anything that is not a real day written YYYY-MM-DD', async () => {
    for (const date of ['2026-02-30', '2026-13-01', '10/10/2026', '2026-1-1', 'today', '2026-10-10T00:00:00Z', '2026-10-10 ']) {
      const res = await attempt({ date });
      expect(res.status, date).toBe(400);
      expect(res.text, date).toBe('{"code":"REQUEST_INVALID"}');
    }
    // A leap day that has passed: a date after today is refused now (PL-9).
    expect((await save({ date: '2024-02-29' })).date).toBe('2024-02-29');
  });

  it('shows the date as a day on the public page, without conversion, in both languages', async () => {
    const en = await save({ ...whole({ date: '2026-10-10' }), publish: true });
    const fa = await save({ ...whole({ name: 'نام', description: 'متن.', date: '2026-10-10' }), lang: 'fa', publish: true });
    expect(en.date).toBe(fa.date);
    // The clock is at 23:30 UTC, which is the 11th in Tehran: the page still says the 10th.
    await clockTo(Date.UTC(2026, 9, 10, 23, 30));
    expect(await (await publicPage('en')).text()).toContain('10 Oct 2026');
    expect(await (await publicPage('fa')).text()).toContain('۱۸ مهر ۱۴۰۵');
  });
});

describe('AC-25: one publish key, one row', () => {
  it('answers the same key twice with one row, and the second answer is the first', async () => {
    const publishKey = randomUUID();
    const first = await client.post('/admin/api/episodes', { publishKey, lang: 'en', ...whole(), publish: true });
    await clockTo(NOW + DAY);
    const second = await client.post('/admin/api/episodes', { publishKey, lang: 'en', ...whole(), publish: true });
    expect(second.status).toBe(200);
    expect(second.text).toBe(first.text);
    expect(count()).toBe(1);
    expect(rowOf((first.json.episode as Episode).id)).toMatchObject({ first_published_at: NOW, updated_at: NOW });
    expect(t.db.prepare('SELECT count(*) AS n FROM episode_link').get()).toEqual({ n: 1 });
  });

  it('gives one row, and one set of links, for requests in parallel', async () => {
    const publishKey = randomUUID();
    const replies = await Promise.all(Array.from({ length: 6 }, () => client.post('/admin/api/episodes', { publishKey, lang: 'en', ...whole({ links: [YT, CB] }), publish: true })));
    expect(count()).toBe(1);
    for (const reply of replies) expect(reply.text).toBe(replies[0]?.text);
    expect((replies[0]?.json.episode as Episode).state).toBe('published');
    expect(t.db.prepare('SELECT count(*) AS n FROM episode_link').get()).toEqual({ n: 2 });
  });

  it('publishes twice as one publish: the second changes nothing', async () => {
    const episode = await save(whole());
    await clockTo(NOW + DAY);
    const first = await client.post(`/admin/api/episodes/${episode.id}/publish`);
    expect(first.json.episode).toMatchObject({ state: 'published', firstPublishedAt: NOW + DAY });
    await clockTo(NOW + 4 * DAY);
    const second = await client.post(`/admin/api/episodes/${episode.id}/publish`);
    expect(second.text).toBe(first.text);
    expect(rowOf(episode.id)).toMatchObject({ first_published_at: NOW + DAY, updated_at: NOW + DAY });
  });

  it('changes nothing for an existing key: not the text, links, language, state or last language', async () => {
    const publishKey = randomUUID();
    const first = await client.post('/admin/api/episodes', { publishKey, lang: 'en', ...whole(), publish: false });
    const id = (first.json.episode as Episode).id;
    await clockTo(NOW + DAY);
    const second = await client.post('/admin/api/episodes', { publishKey, lang: 'fa', ...whole({ name: 'Second', links: [CB] }), publish: true });
    expect(second.text).toBe(first.text);
    expect(rowOf(id)).toMatchObject({ lang: 'en', name: 'Why a monster?', state: 'draft', first_published_at: null, updated_at: NOW });
    expect(linkRows(id).map((row) => row.label)).toEqual(['YouTube']);
    expect(await lastLanguage()).toBe('en');
    expect(count()).toBe(1);
  });

  it('treats the key without regard to case, and a different key as its own row', async () => {
    const publishKey = randomUUID();
    await client.post('/admin/api/episodes', { publishKey, lang: 'en' });
    await client.post('/admin/api/episodes', { publishKey: publishKey.toUpperCase(), lang: 'en' });
    expect(count()).toBe(1);
    await save();
    expect(count()).toBe(2);
  });
});

describe('AC-42: the last language, and the languages stay apart', () => {
  it('remembers the language of a save, an edit and a publish, shared with entries', async () => {
    expect(await lastLanguage()).toBe('en');
    const fa = await save({ lang: 'fa' });
    expect(await lastLanguage()).toBe('fa');
    await save({ lang: 'en' });
    expect(await lastLanguage()).toBe('en');
    await put(fa.id, { name: 'نام' });
    expect(await lastLanguage()).toBe('fa');
    const en = await save(whole());
    await client.post(`/admin/api/episodes/${en.id}/publish`);
    expect(await lastLanguage()).toBe('en');
  });

  it('shows an episode only on its own language\'s page', async () => {
    await save({ ...whole(), publish: true });
    await save({ ...whole({ name: 'Persian one', description: 'متن.' }), lang: 'fa', publish: true });
    const en = await (await publicPage('en')).text();
    const fa = await (await publicPage('fa')).text();
    expect(en).toContain('Why a monster?');
    expect(en).not.toContain('Persian one');
    expect(fa).toContain('Persian one');
    expect(fa).not.toContain('Why a monster?');
  });
});

describe('the list and the read', () => {
  it('lists every episode of both languages and every state, date first, then by id, with a day or "—" decided by the page', async () => {
    const a = insertEpisodeFixture(t.db, { lang: 'en', id: 'e000000001', name: 'Old', date: '2026-09-01', links: [YT] });
    const b = insertEpisodeFixture(t.db, { lang: 'fa', id: 'e000000002', name: 'نو', date: '2026-10-05', links: [YT] });
    const c = insertEpisodeFixture(t.db, { lang: 'en', id: 'e000000003', date: '2026-10-05', state: 'draft' });
    const d = insertEpisodeFixture(t.db, { lang: 'en', id: 'e000000004', name: 'Was live', date: '2026-10-08', state: 'draft', firstPublishedAt: NOW - DAY, links: [YT] });
    const res = await client.get('/admin/api/episodes');
    expect(res.status).toBe(200);
    expect((res.json.episodes as { id: string }[]).map((row) => row.id)).toEqual([d, b, c, a]);
    expect(res.json.episodes).toEqual([
      { id: d, lang: 'en', name: 'Was live', date: '2026-10-08', state: 'draft', wasLive: true, firstPublishedAt: NOW - DAY },
      { id: b, lang: 'fa', name: 'نو', date: '2026-10-05', state: 'published', wasLive: false, firstPublishedAt: NOW },
      { id: c, lang: 'en', name: null, date: '2026-10-05', state: 'draft', wasLive: false, firstPublishedAt: null },
      { id: a, lang: 'en', name: 'Old', date: '2026-09-01', state: 'published', wasLive: false, firstPublishedAt: NOW },
    ]);
    expect(res.json.olderBefore).toBeNull();
  });

  it('carries no count, total or page number in any list or episode body (house rule 1)', async () => {
    const episode = await save(whole());
    const list = await client.get('/admin/api/episodes');
    expect(Object.keys(list.json).sort()).toEqual(['episodes', 'now', 'olderBefore', 'today']);
    const one = await client.get(`/admin/api/episodes/${episode.id}`);
    expect(Object.keys(one.json)).toEqual(['episode']);
    expect(Object.keys(one.json.episode as object).sort()).toEqual(['date', 'description', 'firstPublishedAt', 'id', 'lang', 'links', 'name', 'state', 'tags', 'wasLive']);
    expect(one.text).not.toMatch(/count|total|page|number|ago/i);
  });

  it('pages by (date, id): twenty to a page, an older cursor, and an unknown or malformed one is NOT_FOUND', async () => {
    const ids: string[] = [];
    for (let n = 0; n < 21; n++) ids.push(insertEpisodeFixture(t.db, { lang: 'en', id: `e${String(n).padStart(9, '0')}`, name: `Episode ${n}`, date: `2026-09-${String(30 - Math.floor(n / 2)).padStart(2, '0')}`, links: [YT] }));
    const first = await client.get('/admin/api/episodes');
    const firstRows = first.json.episodes as { id: string }[];
    expect(firstRows).toHaveLength(limits.pageSize);
    expect(firstRows.map((row) => row.id)).toEqual(ids.slice(0, 20));
    const cursor = first.json.olderBefore as string;
    expect(cursor).toBe(ids[19]);
    const second = await client.get(`/admin/api/episodes?before=${cursor}`);
    expect((second.json.episodes as { id: string }[]).map((row) => row.id)).toEqual([ids[20]]);
    expect(second.json.olderBefore).toBeNull();
    for (const bad of [never, 'nope', '']) {
      const res = await client.get(`/admin/api/episodes?before=${bad}`);
      expect(res.status, bad).toBe(404);
      expect(res.text, bad).toBe('{"code":"NOT_FOUND"}');
    }
  });

  it('answers 404 NOT_FOUND for an unknown id on every episode route', async () => {
    for (const [method, path, body] of [
      ['GET', `/admin/api/episodes/${never}`, undefined],
      ['PUT', `/admin/api/episodes/${never}`, whole()],
      ['POST', `/admin/api/episodes/${never}/publish`, {}],
      ['POST', `/admin/api/episodes/${never}/unpublish`, {}],
      ['GET', '/admin/api/episodes/not-an-id', undefined],
    ] as const) {
      const res = await client.call(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(res.text).toBe('{"code":"NOT_FOUND"}');
    }
  });

  it('is behind the guard: signed out, every episode route is the one 401', async () => {
    const out = new Client(app, env);
    for (const [method, path] of [
      ['GET', '/admin/api/episodes'],
      ['POST', '/admin/api/episodes'],
      ['GET', `/admin/api/episodes/${never}`],
      ['PUT', `/admin/api/episodes/${never}`],
      ['POST', `/admin/api/episodes/${never}/publish`],
      ['POST', `/admin/api/episodes/${never}/unpublish`],
    ] as const) {
      const res = await out.call(method, path, method === 'GET' ? undefined : {});
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(res.text).toBe('{"code":"UNAUTHENTICATED"}');
    }
    // There is no route to delete one link: Remove is part of the edit (plate 11).
    expect((await client.delete(`/admin/api/episodes/${never}/links/0`)).status).toBe(404);
  });

  it('needs the CSRF token to write, like every admin write', async () => {
    const res = await client.post('/admin/api/episodes', { publishKey: randomUUID(), lang: 'en' }, { 'X-CSRF-Token': null });
    expect(res.status).toBe(403);
    expect(res.text).toBe('{"code":"CSRF_INVALID"}');
    expect(count()).toBe(0);
  });
});

describe('the links table, by direct SQL (house rule 6)', () => {
  it('a save writes the new rows before it removes the old, so the trigger never fires, whatever the list', async () => {
    const episode = await save({ ...whole({ links: [YT, CB] }), publish: true });
    // Many saves in a row, growing and shrinking, positions never collide and the order is the list's.
    const lists = [[CB], [YT, CB, { label: 'Third', url: 'https://example.com/3' }], [{ label: 'Only', url: 'https://example.com/only' }], [YT, CB]];
    for (const links of lists) {
      const res = await put(episode.id, whole({ links }));
      expect(res.status, res.text).toBe(200);
      expect(linkRows(episode.id).map(({ label, url }) => ({ label, url }))).toEqual(links);
    }
    // The positions stay small: two bands, never growing with the number of saves.
    expect(Math.max(...linkRows(episode.id).map((row) => row.position))).toBeLessThan(2000);
  });

  it('does not rewrite links that did not change', async () => {
    const episode = await save(whole({ links: [YT, CB] }));
    const before = linkRows(episode.id);
    await put(episode.id, whole({ name: 'Renamed', links: [YT, CB] }));
    expect(linkRows(episode.id)).toEqual(before);
  });

  it('the episode_last_link trigger refuses the delete of a published episode\'s only link', async () => {
    const episode = await save({ ...whole(), publish: true });
    expect(() => t.db.prepare('DELETE FROM episode_link WHERE episode_id = ?').run(episode.id)).toThrow(/LAST_LINK/);
    expect(linkRows(episode.id)).toHaveLength(1);
  });

  it('the episode_publish_needs_link triggers refuse a publish with no link, by update and by insert', async () => {
    const draft = await save(whole({ links: [] }));
    expect(() => t.db.prepare("UPDATE episode SET state = 'published', first_published_at = ? WHERE id = ?").run(NOW, draft.id)).toThrow(/LINK_REQUIRED/);
    expect(() =>
      t.db.prepare("INSERT INTO episode (id, lang, date, state, first_published_at, created_at, updated_at) VALUES ('zzzzzzzzzz', 'en', '2026-10-10', 'published', ?, 1, 1)").run(NOW),
    ).toThrow(/LINK_REQUIRED/);
    expect(rowOf(draft.id).state).toBe('draft');
  });

  it('the url CHECK refuses an address that does not start https:// whatever the route says', async () => {
    const episode = await save(whole());
    expect(() => t.db.prepare("INSERT INTO episode_link (episode_id, position, label, url) VALUES (?, 5, 'x', 'http://x.example')").run(episode.id)).toThrow(/CHECK constraint failed/);
    expect(() => t.db.prepare("INSERT INTO episode_link (episode_id, position, label, url) VALUES (?, 5, 'x', 'https:x.example')").run(episode.id)).toThrow(/CHECK constraint failed/);
  });
});

describe('a session that ended an hour ago still cannot write', () => {
  it('answers 401 for a write after the idle hour', async () => {
    setNow(NOW + 2 * HOUR);
    const res = await client.post('/admin/api/episodes', { publishKey: randomUUID(), lang: 'en' });
    expect(res.status).toBe(401);
    expect(res.text).toBe('{"code":"UNAUTHENTICATED"}');
  });
});

describe('PL-8: a never-published episode may change language, a published or was-live one may not', () => {
  it('changes the language of a never-published draft, and remembers it as the last language used (AC-42)', async () => {
    const draft = await save({ lang: 'en' });
    const res = await put(draft.id, { ...whole(), lang: 'fa' });
    expect(res.status, res.text).toBe(200);
    expect(res.json.episode).toMatchObject({ id: draft.id, lang: 'fa', state: 'draft', firstPublishedAt: null });
    expect(rowOf(draft.id)).toMatchObject({ lang: 'fa', first_published_at: null, publish_key: rowOf(draft.id).publish_key });
    expect(await lastLanguage()).toBe('fa');
    expect(count()).toBe(1);
    // It publishes onto the other language's page, and not this one's.
    expect((await client.call('POST', `/admin/api/episodes/${draft.id}/publish`, {})).status).toBe(200);
    expect(await (await publicPage('fa')).text()).toContain('Why a monster');
    expect(await (await publicPage('en')).text()).not.toContain('Why a monster');
  });

  it('refuses a language change on a published episode with LANG_FIXED (409), and changes nothing', async () => {
    const episode = await save({ ...whole(), publish: true });
    const before = rowOf(episode.id);
    const res = await put(episode.id, { ...whole({ name: 'Changed' }), lang: 'fa' });
    expect(res.status).toBe(409);
    expect(res.text).toBe('{"code":"LANG_FIXED"}');
    expect(rowOf(episode.id)).toEqual(before);
    expect(linkRows(episode.id)).toHaveLength(1);
    expect(await lastLanguage()).toBe('en');
  });

  it('refuses it on a draft that was live, too (AC-14)', async () => {
    const episode = await save({ ...whole(), publish: true });
    await client.call('POST', `/admin/api/episodes/${episode.id}/unpublish`, {});
    const before = rowOf(episode.id);
    const res = await put(episode.id, { ...whole(), lang: 'fa' });
    expect(res.status).toBe(409);
    expect(res.text).toBe('{"code":"LANG_FIXED"}');
    expect(rowOf(episode.id)).toEqual(before);
  });

  it('accepts the language it already has, and refuses one that is not en or fa with LANG_INVALID (400)', async () => {
    const episode = await save({ ...whole(), publish: true });
    expect((await put(episode.id, { ...whole(), lang: 'en' })).status).toBe(200);
    for (const lang of ['de', '', 7, null, 'FA']) {
      const res = await put(episode.id, { ...whole(), lang });
      expect(res.status, String(lang)).toBe(400);
      expect(res.text, String(lang)).toBe('{"code":"LANG_INVALID"}');
    }
  });

  it('behaves as it did with no lang', async () => {
    const draft = await save({ lang: 'fa' });
    const res = await put(draft.id, whole());
    expect(res.status).toBe(200);
    expect(res.json.episode).toMatchObject({ lang: 'fa' });
    expect(await lastLanguage()).toBe('fa');
  });
});

describe('PL-9: an episode date after today is refused, an edit may keep the date it has', () => {
  // The fixed clock is 10 Oct 2026 in the site's zone.
  it('refuses a new episode dated tomorrow with DATE_FUTURE (400), and accepts today', async () => {
    const res = await attempt({ ...whole(), date: '2026-10-11' });
    expect(res.status).toBe(400);
    expect(res.text).toBe('{"code":"DATE_FUTURE"}');
    expect(count()).toBe(0);
    expect((await attempt({ ...whole(), date: '2026-10-10' })).status).toBe(200);
    expect((await attempt({ ...whole(), date: '2026-10-09' })).status).toBe(200);
  });

  it('refuses it on a publish too, with no row made and no language remembered', async () => {
    const res = await attempt({ ...whole(), date: '2026-12-01', publish: true, lang: 'fa' });
    expect(res.status).toBe(400);
    expect(res.text).toBe('{"code":"DATE_FUTURE"}');
    expect(count()).toBe(0);
    expect(await lastLanguage()).toBe('en');
  });

  it('lets a save send the date the episode already has, even after today, and refuses a different later one', async () => {
    // Seeded directly, as a fixture dated after the clock is: the route would have refused it.
    insertEpisodeFixture(t.db, { lang: 'en', id: 'e000000024', name: 'Later', description: 'x', tags: ['t'], date: '2026-10-24', links: [YT] });
    expect((await put('e000000024', { ...whole({ name: 'Typo fixed' }), date: '2026-10-24' })).status).toBe(200);
    expect(rowOf('e000000024')).toMatchObject({ name: 'Typo fixed', date: '2026-10-24' });
    const res = await put('e000000024', { ...whole(), date: '2026-10-25' });
    expect(res.status).toBe(400);
    expect(res.text).toBe('{"code":"DATE_FUTURE"}');
    expect(rowOf('e000000024')).toMatchObject({ date: '2026-10-24' });
    // And an earlier day is always allowed.
    expect((await put('e000000024', { ...whole(), date: '2026-10-09' })).status).toBe(200);
    // Once moved, the old later date is no longer "its own".
    expect((await put('e000000024', { ...whole(), date: '2026-10-24' })).text).toBe('{"code":"DATE_FUTURE"}');
  });

  it('is decided in the site\'s zone, not UTC: at 23:30 UTC the 11th has begun in Tehran, so the 11th is today', async () => {
    await clockTo(Date.UTC(2026, 9, 10, 23, 30));
    expect((await attempt({ ...whole(), date: '2026-10-11' })).status).toBe(200);
    expect((await attempt({ ...whole(), date: '2026-10-12' })).text).toBe('{"code":"DATE_FUTURE"}');
    // Just before midnight in the zone (20:29 UTC is 23:59 in Tehran, UTC+3:30), the 11th has not begun.
    await clockTo(Date.UTC(2026, 9, 10, 20, 29));
    expect((await attempt({ ...whole(), date: '2026-10-11' })).text).toBe('{"code":"DATE_FUTURE"}');
    await clockTo(Date.UTC(2026, 9, 10, 20, 31));
    expect((await attempt({ ...whole(), date: '2026-10-11' })).status).toBe(200);
  });
});

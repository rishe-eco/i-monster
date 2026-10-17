// The podcast page (plan B7; AC-4, AC-6, AC-29, AC-30, AC-33, AC-39, AC-48, PD-19, PD-25), in both
// languages: the show's links with and without episodes, the episodes, paging by cursor, microdata.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { siteEn } from '../../content/site.en.ts';
import { siteFa } from '../../content/site.fa.ts';
import { resetClock, setNow } from '../../lib/clock.ts';
import { clearEpisodes, getPublishedEpisode, insertEpisodeFixture, listPublishedEpisodes } from '../../lib/episodes.ts';
import { NOW, tempDb, testApp } from '../helpers.ts';

const t = tempDb();
afterAll(() => {
  resetClock();
  t.cleanup();
});
const app = testApp(t.db);
beforeEach(() => {
  setNow(NOW);
  clearEpisodes(t.db);
});

type Lang = 'en' | 'fa';
const prefix = (lang: Lang) => (lang === 'fa' ? '/fa' : '');
const html = async (path: string) => (await app.request(path)).text();
const content = { en: siteEn, fa: siteFa };

/** An id that sorts in the order given. */
const id = (n: number) => `e${String(n).padStart(9, '0')}`;
const YT = { label: 'YouTube', url: 'https://youtu.be/abc123' };
const CB = { label: 'Castbox', url: 'https://castbox.fm/episode/abc' };

function seed(lang: Lang, n: number, extra: Partial<Parameters<typeof insertEpisodeFixture>[1]> = {}) {
  // Newest is n = 1: each is a day older than the last.
  const day = String(28 - n).padStart(2, '0');
  return insertEpisodeFixture(t.db, {
    lang,
    id: id(n),
    name: lang === 'fa' ? `نام ${n}` : `Name ${n}`,
    description: lang === 'fa' ? `توضیح ${n}.` : `Description ${n}.`,
    tags: [lang === 'fa' ? 'برچسب' : 'tag'],
    date: `2026-09-${day}`,
    links: [YT],
    ...extra,
  });
}

describe.each<Lang>(['en', 'fa'])('the podcast page, %s', (lang) => {
  const path = `${prefix(lang)}/podcast`;
  const show = content[lang].show;

  it('shows the show links from the content file with zero episodes, and the designed empty state (AC-4, AC-29)', async () => {
    const res = await app.request(path);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('class="empty"');
    expect(body).toContain(lang === 'fa' ? 'قسمت‌ها اینجا فهرست می‌شوند، با لینک برای شنیدن.' : 'Episodes will be listed here, with links to listen.');
    for (const link of show.links) {
      expect(body).toContain(`href="${link.url}"`);
      expect(body).toContain(link.label);
    }
    expect(body).not.toContain('itemtype');
    expect(body).not.toContain('Older episodes');
  });

  it('gives each show link target=_blank and rel=noopener (AC-33), the same on every pill', async () => {
    seed(lang, 1);
    const body = await html(path);
    for (const link of show.links) {
      const anchor = new RegExp(`<a class="big-row" href="${link.url}" target="_blank" rel="noopener">`);
      expect(body).toMatch(anchor);
    }
    // Every outbound link on the page opens in a new tab with noopener: the show's and every episode's.
    const outbound = [...body.matchAll(/<a [^>]*href="https:\/\/[^"]*"[^>]*>/g)].map((m) => m[0]);
    expect(outbound.length).toBe(show.links.length + 1);
    for (const anchor of outbound) {
      expect(anchor).toContain('target="_blank"');
      expect(anchor).toContain('rel="noopener"');
    }
  });

  it('puts the show\'s name and links above the episodes on every page, the "Older" page included', async () => {
    for (let n = 1; n <= 21; n++) seed(lang, n);
    const first = await html(path);
    const second = await html(`${path}?before=${id(20)}`);
    for (const body of [first, second]) {
      expect(body.indexOf('page-title')).toBeLessThan(body.indexOf('class="rows rows--show"'));
      expect(body.indexOf('class="rows rows--show"')).toBeLessThan(body.indexOf('class="episodes"'));
      for (const link of show.links) expect(body).toContain(`href="${link.url}"`);
    }
  });

  it('lists an episode with its date, tags, name, description and one pill per link, in order (AC-6)', async () => {
    seed(lang, 1, {
      name: lang === 'fa' ? 'نام قسمت' : 'Building in public',
      tags: lang === 'fa' ? ['ساختن', 'عادت'] : ['making', 'habits'],
      links: [YT, CB, { label: 'Spotify', url: 'https://open.spotify.com/episode/xyz' }],
      date: '2026-10-24',
    });
    const body = await html(path);
    expect(body).toContain(lang === 'fa' ? '۲ آبان ۱۴۰۵' : '24 Oct 2026');
    expect(body).toContain(lang === 'fa' ? 'ساختن</span>، <span itemprop="keywords">عادت' : 'making</span>, <span itemprop="keywords">habits');
    expect(body).toContain(lang === 'fa' ? 'نام قسمت' : 'Building in public');
    expect(body).toContain('Description 1.'.replace('Description 1.', lang === 'fa' ? 'توضیح 1.' : 'Description 1.'));
    const labels = [...body.matchAll(/<span class="pill-link__label">(.*?)<\/span>/g)].map((m) => m[1]);
    expect(labels.map((l) => l?.replace(/<[^>]*>/g, ''))).toEqual(['YouTube', 'Castbox', 'Spotify']);
    // An unknown label keeps the same pill: no icon, no class of its own, no greyed or "coming soon" pill.
    expect(body.match(/class="pill-link"/g)?.length).toBe(3);
    expect(body).not.toMatch(/coming soon|greyed|disabled/i);
  });

  it('shows only the links an episode has, and no pill for a platform it lacks (J5.6)', async () => {
    seed(lang, 1, { links: [YT] });
    const body = await html(path);
    expect(body.match(/class="pill-link"/g)?.length).toBe(1);
    // The Castbox name is in the page once: the show's own link, not an episode's.
    expect(body.match(/Castbox/g)?.length).toBe(1);
  });

  it('carries microdata for every episode: PodcastEpisode with name, description, datePublished, partOfSeries (PD-19)', async () => {
    seed(lang, 1, { date: '2026-10-10' });
    seed(lang, 2);
    const body = await html(path);
    expect(body.match(/itemscope="" itemtype="https:\/\/schema\.org\/PodcastEpisode"/g)?.length).toBe(2);
    expect(body.match(/itemprop="name"/g)?.length).toBe(4);
    expect(body.match(/itemprop="description"/g)?.length).toBe(2);
    expect(body).toContain('<time datetime="2026-10-10" itemprop="datePublished">');
    expect(body.match(/itemprop="partOfSeries" itemscope itemtype="https:\/\/schema\.org\/PodcastSeries"/g)?.length).toBe(2);
    // The series sits inside each episode's markup, not hoisted into <head> (Hono's JSX would do that to a <meta>).
    const series = `<span itemprop="partOfSeries" itemscope itemtype="https://schema.org/PodcastSeries"><meta itemprop="name" content="${show.name}"><link itemprop="url" href="https://imnstr.com${path}"></span>`;
    expect(body.split(series).length - 1).toBe(2);
    expect(body.split(`<meta itemprop="inLanguage" content="${lang}">`).length - 1).toBe(2);
    expect(body.slice(0, body.indexOf('</head>'))).not.toContain('itemprop');
    // Microdata, not JSON-LD: no inline script on the page, only the external wordmark.js (PD-18, PD-19, B9).
    expect(body).not.toMatch(/<script(?![^>]*\ssrc=)/);
    expect([...body.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1])).toEqual([
      expect.stringMatching(/^\/assets\/wordmark\.[0-9a-f]{10}\.js$/),
    ]);
  });

  it('keeps an episode\'s line breaks in its description, and escapes markup in every field', async () => {
    seed(lang, 1, { name: '<b>Bold</b> & "quoted"', description: 'First line\nsecond line\n\nNew paragraph <i>x</i>', tags: ['<t>'], links: [{ label: '<l>', url: 'https://example.com/?a=1&b=2' }] });
    // Isolation (<bdi>) is tested on its own below; here only what the text is.
    const body = (await html(path)).replace(/<\/?bdi[^>]*>/g, '');
    expect(body).toContain('<p>First line<br>second line</p><p>New paragraph &lt;i&gt;x&lt;/i&gt;</p>');
    expect(body).toContain('&lt;b&gt;Bold&lt;/b&gt; &amp; &quot;quoted&quot;');
    expect(body).toContain('&lt;t&gt;');
    expect(body).toContain('&lt;l&gt;');
    expect(body).toContain('href="https://example.com/?a=1&amp;b=2"');
    expect(body).not.toContain('<b>Bold</b>');
  });

  it('isolates the other script inside a name, a description, a tag and a label (AC-48)', async () => {
    if (lang === 'fa') {
      seed(lang, 1, { name: 'گفتگو با Root Studio', description: 'درباره https://example.com/x و Tracker.', tags: ['Root'], links: [{ label: 'YouTube', url: 'https://youtu.be/x' }] });
      const body = await html(path);
      expect(body).toContain('<bdi lang="en">Root Studio</bdi>');
      expect(body).toContain('<bdi dir="ltr">https://example.com/x</bdi>');
      expect(body).toContain('<bdi lang="en">Tracker</bdi>');
      expect(body).toContain('<span itemprop="keywords"><bdi lang="en">Root</bdi></span>');
      expect(body).toContain('<span class="pill-link__label"><bdi lang="en">YouTube</bdi></span>');
    } else {
      seed(lang, 1, { name: 'About فارسی', description: 'See سلام.', tags: ['سلام'], links: [{ label: 'پخش', url: 'https://example.com/x' }] });
      const body = await html(path);
      expect(body).toContain('<bdi lang="fa" dir="rtl">فارسی</bdi>');
      expect(body).toContain('<span itemprop="keywords"><bdi lang="fa" dir="rtl">سلام</bdi></span>');
      expect(body).toContain('<span class="pill-link__label"><bdi lang="fa" dir="rtl">پخش</bdi></span>');
    }
  });

  it('orders by date then id, not by first publish, and shows no draft (plan B7, traps)', async () => {
    // Published in the order 2, 3, 1, but dated 1 newest.
    seed(lang, 2, { firstPublishedAt: NOW - 3000 });
    seed(lang, 3, { firstPublishedAt: NOW - 2000 });
    seed(lang, 1, { firstPublishedAt: NOW - 1000, date: '2026-10-09' });
    // Two on one day: the lower id first.
    insertEpisodeFixture(t.db, { lang, id: id(9), name: lang === 'fa' ? 'نه' : 'Nine', description: 'x', tags: ['t'], date: '2026-09-26', links: [YT] });
    seed(lang, 7, { state: 'draft', name: 'Hidden draft', date: '2026-10-20', links: [YT] });
    seed(lang, 8, { state: 'draft', name: 'Hidden was live', date: '2026-10-21', firstPublishedAt: NOW - 5, links: [YT] });
    const body = await html(path);
    const at = (name: string) => body.indexOf(name);
    expect(at(lang === 'fa' ? 'نام 1' : 'Name 1')).toBeLessThan(at(lang === 'fa' ? 'نام 2' : 'Name 2'));
    expect(at(lang === 'fa' ? 'نام 2' : 'Name 2')).toBeLessThan(at(lang === 'fa' ? 'نام 3' : 'Name 3'));
    // 3 is dated 2026-09-25, 9 is dated 2026-09-26, 2 is dated 2026-09-26: ids e…2 before e…9.
    expect(at(lang === 'fa' ? 'نه' : 'Nine')).toBeGreaterThan(at(lang === 'fa' ? 'نام 2' : 'Name 2'));
    expect(at(lang === 'fa' ? 'نه' : 'Nine')).toBeLessThan(at(lang === 'fa' ? 'نام 3' : 'Name 3'));
    expect(body).not.toContain('Hidden');
  });

  it('shows 20 to a page with an Older link that is a plain link, and the 21st on the next page (AC-30)', async () => {
    for (let n = 1; n <= 21; n++) seed(lang, n);
    const first = await html(path);
    expect(first.match(/<article class="episode"/g)?.length).toBe(20);
    expect(first).toContain(`href="${path}?before=${id(20)}"`);
    expect(first).toContain(lang === 'fa' ? 'قسمت‌های قدیمی‌تر' : 'Older episodes');
    expect(first).not.toContain(lang === 'fa' ? 'نام 21' : 'Name 21');
    const second = await html(`${path}?before=${id(20)}`);
    expect(second.match(/<article class="episode"/g)?.length).toBe(1);
    expect(second).toContain(lang === 'fa' ? 'نام 21' : 'Name 21');
    expect(second).not.toContain('Older episodes');
    expect(second).not.toContain('قسمت‌های قدیمی‌تر');
  });

  it('shows no count, no page number and no "latest" anywhere (AC-5, AC-30)', async () => {
    for (let n = 1; n <= 21; n++) seed(lang, n);
    for (const body of [await html(path), await html(`${path}?before=${id(20)}`)]) {
      const text = body.replace(/<[^>]*>/g, ' ');
      expect(text).not.toMatch(/\b(episodes?|page|total|latest|new) ?[#:]?\s*\d+\b|\d+ (episodes|links|results)/i);
      expect(body).not.toMatch(/Episode \d|Page \d|[?&]page=/);
    }
  });

  it('answers 404 for a malformed, unknown, unpublished or other-language cursor (PD-25)', async () => {
    seed(lang, 1);
    seed(lang, 2, { state: 'draft' });
    seed(lang === 'en' ? 'fa' : 'en', 3);
    const other = await app.request(`${path}?before=${id(3)}`);
    const unknown = await app.request(`${path}?before=a000000099`);
    expect(other.status).toBe(404);
    expect(await other.text()).toBe(await unknown.text());
    for (const cursor of ['nope', id(2), '', 'e000000001%20', 'E000000001']) {
      expect((await app.request(`${path}?before=${cursor}`)).status, cursor).toBe(404);
    }
    expect((await app.request(`${path}?before=${id(1)}`)).status).toBe(200);
  });

  it('is the same page whether or not a session cookie came with the request, and sets no cookie (AC-7)', async () => {
    seed(lang, 1);
    const plain = await app.request(path);
    const signed = await app.request(path, { headers: { Cookie: '__Host-imnstr_session=whatever' } });
    expect(plain.headers.get('set-cookie')).toBeNull();
    expect(signed.headers.get('set-cookie')).toBeNull();
    expect(await signed.text()).toBe(await plain.text());
  });

  it('marks the podcast nav link current, switches to the other language\'s podcast, and carries hreflang alternates', async () => {
    const body = await html(path);
    expect(body).toMatch(new RegExp(`<a href="${prefix(lang)}/podcast" aria-current="page">`));
    const other = lang === 'en' ? '/fa/podcast' : '/podcast';
    expect(body).toContain(`<a href="${other}" lang="${lang === 'en' ? 'fa' : 'en'}"`);
    expect(body).toContain('hreflang="en" href="https://imnstr.com/podcast"');
    expect(body).toContain('hreflang="fa" href="https://imnstr.com/fa/podcast"');
    expect(body).toContain(`<html lang="${lang}" dir="${lang === 'fa' ? 'rtl' : 'ltr'}">`);
  });

  it('has no inline style and no third-party address (CSP, AC-7)', async () => {
    seed(lang, 1);
    const body = await html(path);
    expect(body).not.toMatch(/\sstyle=/);
    const hosts = [...body.matchAll(/(?:src|href)="(https?:\/\/[^"/]+)/g)].map((m) => m[1]);
    // The only outbound addresses are the show's and the episodes', which are links, not loads; the alternates name this site.
    for (const host of hosts) expect(['https://youtu.be', 'https://imnstr.com', ...show.links.map((l) => new URL(l.url).origin)]).toContain(host);
    expect(body).not.toMatch(/<(script(?![^>]*\ssrc="\/assets\/)|img|iframe|link rel="stylesheet" href="https)/);
  });
});

describe('an episode of one language does not appear on the other\'s page (AC-39)', () => {
  it('keeps each page to its own', async () => {
    seed('en', 1, { name: 'English only' });
    seed('fa', 2, { name: 'فقط فارسی' });
    const en = await html('/podcast');
    const fa = await html('/fa/podcast');
    expect(en).toContain('English only');
    expect(en).not.toContain('فقط فارسی');
    expect(fa).toContain('فقط فارسی');
    expect(fa).not.toContain('English only');
    // The Persian show's links are the Persian show's, not the English one's (AC-29).
    for (const link of siteEn.show.links) expect(fa).not.toContain(link.url);
    for (const link of siteFa.show.links) expect(en).not.toContain(link.url);
  });
});

describe('the read side in lib/episodes.ts', () => {
  it('returns one published episode of its own language, or null', () => {
    const a = seed('en', 1);
    const draft = seed('en', 2, { state: 'draft' });
    expect(getPublishedEpisode(t.db, 'en', a)?.name).toBe('Name 1');
    expect(getPublishedEpisode(t.db, 'fa', a)).toBeNull();
    expect(getPublishedEpisode(t.db, 'en', draft)).toBeNull();
    expect(getPublishedEpisode(t.db, 'en', 'a000000099')).toBeNull();
  });

  it('pages with a limit, one more read than shown, and a cursor that is the last shown', () => {
    for (let n = 1; n <= 5; n++) seed('en', n);
    const first = listPublishedEpisodes(t.db, 'en', null, 2);
    expect(first.episodes.map((e) => e.id)).toEqual([id(1), id(2)]);
    expect(first.olderBefore).toBe(id(2));
    const cursor = getPublishedEpisode(t.db, 'en', id(2));
    const second = listPublishedEpisodes(t.db, 'en', cursor, 2);
    expect(second.episodes.map((e) => e.id)).toEqual([id(3), id(4)]);
    const last = listPublishedEpisodes(t.db, 'en', getPublishedEpisode(t.db, 'en', id(4)), 2);
    expect(last.episodes.map((e) => e.id)).toEqual([id(5)]);
    expect(last.olderBefore).toBeNull();
  });
});

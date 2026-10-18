// The admin's episode routes (plan B7, §6.1): list, read, save, edit, publish and unpublish. Mounted
// inside `adminApiRoutes`, after its guard, so none of them can be reached without a session (AC-8,
// S-12). Nothing here reads a cookie or checks a token: the guard has done both before a handler runs.
//
// There is no route to delete one link. A save carries the whole list, so removing a link is part of
// an edit and Cancel undoes it (plate 11); the plan's `DELETE episodes/<id>/links/<n>` was dropped.
import { Hono } from 'hono';
import type { AppEnv } from '../lib/context.ts';
import type { Db } from '../lib/db.ts';
import { now } from '../lib/clock.ts';
import { todayIn } from '../lib/dates.ts';
import {
  createEpisode,
  dateRefusal,
  getEpisode,
  listEpisodesForAdmin,
  publishEpisode,
  readEpisodeInput,
  unpublishEpisode,
  updateEpisode,
  type AdminEpisode,
  type EpisodeRefusal,
} from '../lib/episodes.ts';
import { isId } from '../lib/ids.ts';
import type { Lang } from '../lib/i18n.ts';
import type { ApiKit } from './admin-entries.ts';

// A client-made publish key (PD-11): any UUID, which `crypto.randomUUID()` makes.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The episode as the API sends it: dates are a day or an instant, never an elapsed time. */
const episodeJson = (episode: AdminEpisode) => ({
  id: episode.id,
  lang: episode.lang,
  name: episode.name,
  description: episode.description,
  tags: episode.tags,
  date: episode.date,
  links: episode.links,
  state: episode.state,
  wasLive: episode.wasLive,
  firstPublishedAt: episode.firstPublishedAt,
});

const isLang = (value: unknown): value is Lang => value === 'en' || value === 'fa';
const refused = (value: AdminEpisode | { refusal: EpisodeRefusal }): value is { refusal: EpisodeRefusal } => 'refusal' in value;

export function episodeRoutes(db: Db, { refuse, readJson }: ApiKit, options: { siteTz: string }): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get('/episodes', (c) => {
    const cursor = c.req.query('before') ?? null;
    // A malformed or unknown cursor is the one refusal a read has: NOT_FOUND.
    if (cursor !== null && !isId(cursor)) return refuse(c, 'NOT_FOUND');
    const page = listEpisodesForAdmin(db, cursor);
    if (!page) return refuse(c, 'NOT_FOUND');
    // `today` and `now` are the server's: the form's date starts at today, and the list's year rule (AC-31)
    // needs the year. The bundle never reads the time.
    return c.json({ episodes: page.episodes, olderBefore: page.olderBefore, today: todayIn(now(), options.siteTz), now: now() });
  });

  routes.get('/episodes/:id', (c) => {
    const id = c.req.param('id');
    const episode = isId(id) ? getEpisode(db, id) : null;
    return episode ? c.json({ episode: episodeJson(episode) }) : refuse(c, 'NOT_FOUND');
  });

  routes.post('/episodes', async (c) => {
    const json = await readJson(c);
    if (!json) return refuse(c, 'REQUEST_INVALID');
    // The order is fixed: language, then the shape of the request, then the fields, then (to publish) what publishing needs.
    if (!isLang(json.lang)) return refuse(c, 'LANG_INVALID');
    if (typeof json.publishKey !== 'string' || !UUID.test(json.publishKey)) return refuse(c, 'REQUEST_INVALID');
    if (json.publish !== undefined && typeof json.publish !== 'boolean') return refuse(c, 'REQUEST_INVALID');
    const read = readEpisodeInput(json);
    if ('refusal' in read) return refuse(c, read.refusal);
    // A day that hasn't come yet is refused (PL-9). A new episode has no date of its own to keep.
    const today = todayIn(now(), options.siteTz);
    const future = dateRefusal(read.input.date, today);
    if (future) return refuse(c, future);
    const episode = createEpisode(db, {
      publishKey: json.publishKey.toLowerCase(),
      lang: json.lang,
      input: read.input,
      publish: json.publish === true,
      today,
    });
    if (refused(episode)) return refuse(c, episode.refusal);
    // New or existing, the same answer: a retry can't tell, and needn't (AC-25).
    return c.json({ episode: episodeJson(episode) });
  });

  routes.put('/episodes/:id', async (c) => {
    const id = c.req.param('id');
    const existing = isId(id) ? getEpisode(db, id) : null;
    if (!isId(id) || !existing) return refuse(c, 'NOT_FOUND');
    const json = await readJson(c);
    if (!json) return refuse(c, 'REQUEST_INVALID');
    // `state` and the dates but `date` are not read: an edit changes the text, tags, date and links, and the language
    // while the episode has never been published (PL-8). A `lang` that isn't one of the two is refused first.
    if (json.lang !== undefined && !isLang(json.lang)) return refuse(c, 'LANG_INVALID');
    const read = readEpisodeInput(json);
    if ('refusal' in read) return refuse(c, read.refusal);
    // The date the episode already has is let through, even after today, so a fixture or a typo fix can be saved (PL-9).
    const future = dateRefusal(read.input.date, todayIn(now(), options.siteTz), existing.date);
    if (future) return refuse(c, future);
    const episode = updateEpisode(db, id, read.input, isLang(json.lang) ? json.lang : undefined);
    if (!episode) return refuse(c, 'NOT_FOUND');
    if (refused(episode)) return refuse(c, episode.refusal);
    return c.json({ episode: episodeJson(episode) });
  });

  routes.post('/episodes/:id/publish', (c) => {
    const id = c.req.param('id');
    const episode = isId(id) ? publishEpisode(db, id) : null;
    if (!episode) return refuse(c, 'NOT_FOUND');
    if (refused(episode)) return refuse(c, episode.refusal);
    return c.json({ episode: episodeJson(episode) });
  });

  routes.post('/episodes/:id/unpublish', (c) => {
    const id = c.req.param('id');
    const episode = isId(id) ? unpublishEpisode(db, id) : null;
    return episode ? c.json({ episode: episodeJson(episode) }) : refuse(c, 'NOT_FOUND');
  });

  return routes;
}

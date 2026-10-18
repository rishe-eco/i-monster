// The episode form's requests (plan B7, PD-11), in the shape of `writes.ts`: each returns the episode
// the server answered with, or the code it refused with, and none of them touches the screen or a buffer.
//
// New text is sent with its publish key, once. When the server answers with a row, the text is worked
// on by that row's id from then on: Save is a PUT, and publishing a draft is a PUT and then a publish.
// A key the server already knew answers with the row as it first was and writes nothing (AC-25), so a
// retry after a lost answer is followed by a PUT when the text has changed since, and the row is
// published if it isn't yet. A PUT carries the whole list of links: Remove is part of the edit.
import type { Lang } from '../lib/i18n.ts';
import { api, type EpisodeDetail, type Result } from './api.ts';
import type { EpisodeText } from './buffers.ts';

export type EpisodeWrite = Result<{ episode: EpisodeDetail }>;

// The form's writes keep the form on screen when the session has ended (W6).
const IN_PLACE = { keepOnSignedOut: true } as const;

const episodePath = (id: string) => `episodes/${encodeURIComponent(id)}`;

/** The tags and links the way the server keeps them: trimmed, and with the blank ones gone. */
const keptTags = (text: EpisodeText): string[] => text.tags.map((tag) => tag.trim()).filter((tag) => tag !== '');
const keptLinks = (text: EpisodeText) =>
  text.links.map((link) => ({ label: link.label.trim(), url: link.url.trim() })).filter((link) => link.label !== '' || link.url !== '');

/** What the form sends besides the key and the language. A date the person hasn't chosen is left out, and the server fills it. */
function fieldsOf(text: EpisodeText) {
  return {
    name: text.name,
    description: text.description,
    tags: text.tags,
    date: text.date === '' ? undefined : text.date,
    links: text.links,
  };
}

/** Whether the episode, as the server has it, already holds this text: the same name, description, tags, date and links. */
function holds(episode: EpisodeDetail, text: EpisodeText): boolean {
  return (
    episode.name === (text.name.trim() || null) &&
    episode.description === (text.description.replace(/\r\n?/g, '\n').trim() || null) &&
    JSON.stringify(episode.tags) === JSON.stringify(keptTags(text)) &&
    (text.date === '' || episode.date === text.date) &&
    JSON.stringify(episode.links) === JSON.stringify(keptLinks(text))
  );
}

async function publishRow(episode: EpisodeDetail): Promise<EpisodeWrite> {
  if (episode.state === 'published') return { ok: true, data: { episode } };
  return api<{ episode: EpisodeDetail }>('POST', `${episodePath(episode.id)}/publish`, {}, IN_PLACE);
}

/** `lang` goes with the PUT only for an episode that has never been published: the server refuses a change for any other (PL-8). */
function putText(id: string, text: EpisodeText, lang?: Lang): Promise<EpisodeWrite> {
  return api<{ episode: EpisodeDetail }>('PUT', episodePath(id), { ...fieldsOf(text), ...(lang ? { lang } : {}) }, IN_PLACE);
}

/** New text: saved as a draft, or published. `onRow` hears the row's id the moment the server has made it. */
export async function writeNewEpisode(
  composition: EpisodeText & { key: string; id: string | null; lang: Lang },
  publish: boolean,
  onRow: (id: string) => void,
): Promise<EpisodeWrite> {
  let episode: EpisodeDetail;
  if (composition.id === null) {
    const made = await api<{ episode: EpisodeDetail }>(
      'POST',
      'episodes',
      { publishKey: composition.key, lang: composition.lang, ...fieldsOf(composition), publish },
      IN_PLACE,
    );
    if (!made.ok) return made;
    episode = made.data.episode;
    onRow(episode.id);
    if (!holds(episode, composition)) {
      const updated = await putText(episode.id, composition, composition.lang);
      if (!updated.ok) return updated;
      episode = updated.data.episode;
    }
  } else {
    // The row exists and has never been published, so its language may have changed since it was made (PL-8).
    const updated = await putText(composition.id, composition, composition.lang);
    if (!updated.ok) return updated;
    episode = updated.data.episode;
  }
  return publish ? publishRow(episode) : { ok: true, data: { episode } };
}

/** An episode that exists: its text saved, and, for a draft, published after. */
export async function writeEditEpisode(id: string, text: EpisodeText, publish: boolean, lang?: Lang): Promise<EpisodeWrite> {
  const updated = await putText(id, text, lang);
  if (!updated.ok) return updated;
  return publish ? publishRow(updated.data.episode) : updated;
}

export const unpublishEpisode = (id: string): Promise<EpisodeWrite> => api<{ episode: EpisodeDetail }>('POST', `${episodePath(id)}/unpublish`, {}, IN_PLACE);

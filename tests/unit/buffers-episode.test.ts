// B7: one reducer, and a reader and a "has content" check per kind (S-19). `buffers.test.ts` is the
// reducer's own, for entries; these say the episode kind brings its own reader and its own check, uses the
// same reducer, and never meets the entries' buffers.
import { describe, expect, it } from 'vitest';
import {
  EMPTY,
  createBuffers,
  episodeHasContent as has,
  reduce,
  type EpisodeEdit,
  type EpisodeText,
  type Snapshot,
  type StorageLike,
  type UnsentEpisode,
} from '../../admin/buffers.ts';
import { docFromText } from '../../shared/doc.ts';

const KEY = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const text = (extra: Partial<EpisodeText> = {}): EpisodeText => ({ name: '', description: '', tags: ['', ''], date: '', links: [{ label: '', url: '' }], ...extra });
const episode = (extra: Partial<UnsentEpisode> = {}): UnsentEpisode => ({ key: KEY, id: null, lang: 'en', ...text({ name: 'Why a monster?' }), ...extra });
const edit = (name: string, id = 'a000000001'): EpisodeEdit => ({ id, ...text({ name }) });
const none: Snapshot<UnsentEpisode, EpisodeEdit> = { unsent: null, edit: null, kept: [] };

function memory(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe('what counts as an episode worth keeping', () => {
  it('is any field with text; the date, empty rows and spaces are none', () => {
    expect(has(text())).toBe(false);
    expect(has(text({ date: '2026-10-10' }))).toBe(false);
    expect(has(text({ name: '   ', description: '\n', tags: [' ', ' '], links: [{ label: ' ', url: '' }] }))).toBe(false);
    expect(has(text({ name: 'N' }))).toBe(true);
    expect(has(text({ description: 'D' }))).toBe(true);
    expect(has(text({ tags: ['', 't'] }))).toBe(true);
    expect(has(text({ links: [{ label: '', url: 'https://x.example' }] }))).toBe(true);
    expect(has(text({ links: [{ label: 'YouTube', url: '' }] }))).toBe(true);
  });
});

describe('the reducer, for episodes', () => {
  it('keeps a composition with content, and drops one with none and no row', () => {
    expect(reduce(none, { type: 'typed', unsent: episode(text()) }, has).unsent).toBeNull();
    expect(reduce(none, { type: 'typed', unsent: episode() }, has).unsent).toEqual(episode());
    // A row on the server is something, even with nothing left in the fields.
    expect(reduce(none, { type: 'typed', unsent: episode({ ...text(), id: 'a000000001' }) }, has).unsent).not.toBeNull();
  });

  it('sets an unsent episode aside when a page opens, and puts it back, as for entries (AC-43)', () => {
    const aside = reduce({ ...none, unsent: episode() }, { type: 'opened' }, has);
    expect(aside).toEqual({ unsent: null, edit: null, kept: [episode()] });
    expect(reduce(aside, { type: 'restored' }, has).unsent).toEqual(episode());
    // An episode with nothing in it is not worth setting aside.
    expect(reduce({ ...none, unsent: episode(text()) }, { type: 'opened' }, has)).toEqual(none);
  });

  it('empties the unsent buffer only when the server confirms (AC-16)', () => {
    let state = reduce(none, { type: 'typed', unsent: episode() }, has);
    for (const event of [{ type: 'edit-typed', edit: edit('x') }, { type: 'discarded', which: 'kept' }, { type: 'discarded', which: 'edit' }] as const) {
      state = reduce(state, event, has);
      expect(state.unsent).toEqual(episode());
    }
    expect(reduce(state, { type: 'confirmed' }, has).unsent).toBeNull();
  });
});

describe('the episode buffers in storage', () => {
  it('write under their own keys, beside the entries\' and never into them', () => {
    const store = memory();
    const episodes = createBuffers(store, 'episode');
    const entries = createBuffers(store, 'entry');
    episodes.apply({ type: 'typed', unsent: episode() });
    episodes.apply({ type: 'edit-typed', edit: edit('Edited') });
    expect([...store.map.keys()].sort()).toEqual(['imnstr:episode:edit', 'imnstr:episode:unsent']);
    expect(entries.read()).toEqual(EMPTY);
    entries.apply({ type: 'typed', unsent: { key: KEY, id: null, lang: 'en', title: '', doc: docFromText('An entry') } });
    expect(episodes.read().unsent).toEqual(episode());
    expect(entries.read().unsent?.doc).toEqual(docFromText('An entry'));
  });

  it('carry the three buffers through a whole edit over an unsent episode, and a reopened page finds them', () => {
    const store = memory();
    const buffers = createBuffers(store, 'episode');
    buffers.apply({ type: 'typed', unsent: episode() });
    buffers.apply({ type: 'edit-started' });
    buffers.apply({ type: 'edit-typed', edit: edit('Edited') });
    expect(createBuffers(store, 'episode').apply({ type: 'opened' }).snapshot).toMatchObject({ edit: edit('Edited'), kept: [episode()] });
    buffers.apply({ type: 'edit-confirmed' });
    expect(buffers.read()).toEqual({ unsent: episode(), edit: null, kept: [] });
    buffers.apply({ type: 'confirmed' });
    expect(store.map.has('imnstr:episode:unsent')).toBe(false);
  });

  it('read damaged storage as empty: a third tag, no link row, a bad language, a missing key', () => {
    const store = memory();
    const good = episode({ key: '6ba7b810-9dad-41d1-80b4-00c04fd430c8' });
    store.map.set('imnstr:episode:unsent', JSON.stringify({ ...episode(), tags: ['a', 'b', 'c'] }));
    store.map.set('imnstr:episode:edit', JSON.stringify({ ...edit('x'), links: [] }));
    store.map.set('imnstr:episode:kept', JSON.stringify([{ ...episode(), lang: 'de' }, { ...episode(), links: [{ label: 'x' }] }, { name: 'no key' }, good]));
    expect(createBuffers(store, 'episode').read()).toEqual({ unsent: null, edit: null, kept: [good] });
  });

  it('do not read an entry\'s stored text as an episode\'s, or the other way round', () => {
    const store = memory();
    store.map.set('imnstr:episode:unsent', JSON.stringify({ key: KEY, id: null, lang: 'en', title: '', doc: docFromText('An entry') }));
    store.map.set('imnstr:entry:unsent', JSON.stringify(episode()));
    expect(createBuffers(store, 'episode').read().unsent).toBeNull();
    expect(createBuffers(store, 'entry').read().unsent).toBeNull();
  });

  it('store the fields, the key, the row and the language, and no count, time or description (W7)', () => {
    const store = memory();
    createBuffers(store, 'episode').apply({ type: 'typed', unsent: episode() });
    const stored = JSON.parse(store.map.get('imnstr:episode:unsent') as string) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(['date', 'description', 'id', 'key', 'lang', 'links', 'name', 'tags']);
  });

  it('keep no date the person did not choose, so text kept overnight is never pinned to yesterday', () => {
    const store = memory();
    createBuffers(store, 'episode').apply({ type: 'typed', unsent: episode() });
    expect(createBuffers(store, 'episode').read().unsent?.date).toBe('');
  });

  it('say so when the browser refuses a write, and still answer with the state', () => {
    const store = memory();
    store.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    const result = createBuffers(store, 'episode').apply({ type: 'typed', unsent: episode() });
    expect(result.stored).toBe(false);
    expect(result.snapshot.unsent).toEqual(episode());
  });
});

// The buffer state machine (plan B6, PD-12): new, editing, kept, confirmed and discarded, as a pure
// module with the storage handed in. What the tests pin is the plan's promise that nothing is lost:
// a buffer is emptied only by the server's confirmation or by the person's Discard, and what is set
// aside while something else happens always comes back.
import { describe, expect, it } from 'vitest';
import { EMPTY, createBuffers, phaseOf, reduce, type EditBuffer, type Snapshot, type StorageLike, type Unsent } from '../../admin/buffers.ts';
import { docFromText } from '../../shared/doc.ts';

const KEY = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const unsent = (text: string, extra: Partial<Unsent> = {}): Unsent => ({ key: KEY, id: null, lang: 'en', title: '', doc: docFromText(text), ...extra });
const other = unsent('Another text.', { key: '6ba7b810-9dad-41d1-80b4-00c04fd430c8' });
const edit = (text: string, id = 'a000000001'): EditBuffer => ({ id, title: '', doc: docFromText(text) });

/** The storage a test hands in: a Map, and a record of what was written in what order. */
function memory(): StorageLike & { map: Map<string, string>; writes: string[] } {
  const map = new Map<string, string>();
  const writes: string[] = [];
  return {
    map,
    writes,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      writes.push(key);
      map.set(key, value);
    },
    removeItem: (key) => {
      writes.push(key);
      map.delete(key);
    },
  };
}

describe('the reducer', () => {
  it('keeps what is typed, and drops a composition with nothing in it and no row', () => {
    const typed = reduce(EMPTY, { type: 'typed', unsent: unsent('Hello') });
    expect(typed.unsent?.doc).toEqual(docFromText('Hello'));
    expect(reduce(typed, { type: 'typed', unsent: unsent('') }).unsent).toBeNull();
    expect(reduce(typed, { type: 'typed', unsent: null }).unsent).toBeNull();
    // A title alone is something; a row on the server is something, even with no text left.
    expect(reduce(EMPTY, { type: 'typed', unsent: unsent('', { title: 'A title' }) }).unsent).not.toBeNull();
    expect(reduce(EMPTY, { type: 'typed', unsent: unsent('', { id: 'a000000001' }) }).unsent).not.toBeNull();
  });

  it('empties the unsent buffer only when the server confirms (AC-16)', () => {
    let state: Snapshot = reduce(EMPTY, { type: 'typed', unsent: unsent('Hello') });
    // Nothing that happens while the text waits for the server empties it: not an edit, not an opening, not the other buffers' events.
    for (const event of [{ type: 'edit-typed', edit: edit('x') }, { type: 'discarded', which: 'kept' }, { type: 'discarded', which: 'edit' }] as const) {
      state = reduce(state, event);
      expect(state.unsent?.doc).toEqual(docFromText('Hello'));
    }
    expect(reduce(state, { type: 'confirmed' }).unsent).toBeNull();
  });

  it('keeps the row an unsent text became, so a reopened page carries on with it (PD-11)', () => {
    const saved = reduce(EMPTY, { type: 'typed', unsent: unsent('Hello', { id: 'a000000001' }) });
    expect(saved.unsent?.id).toBe('a000000001');
    expect(saved.unsent?.key).toBe(KEY);
  });

  describe('a page that opens with unsent text (J3.3)', () => {
    it('sets it aside, so the empty editor can be typed in without writing over it', () => {
      const state = reduce({ ...EMPTY, unsent: unsent('From earlier') }, { type: 'opened' });
      expect(state.unsent).toBeNull();
      expect(state.kept).toEqual([unsent('From earlier')]);
      expect(phaseOf(state)).toBe('kept');
    });

    it('sets nothing aside when there is nothing but a key', () => {
      expect(reduce({ ...EMPTY, unsent: unsent('') }, { type: 'opened' })).toEqual(EMPTY);
      expect(reduce(EMPTY, { type: 'opened' })).toEqual(EMPTY);
    });

    it('puts it back, or swaps it with what has been typed since, so neither is lost', () => {
      const aside = reduce({ ...EMPTY, unsent: unsent('From earlier') }, { type: 'opened' });
      const back = reduce(aside, { type: 'restored' });
      expect(back.unsent).toEqual(unsent('From earlier'));
      expect(back.kept).toEqual([]);

      const typedSince = reduce(aside, { type: 'typed', unsent: other });
      const swapped = reduce(typedSince, { type: 'restored' });
      expect(swapped.unsent).toEqual(unsent('From earlier'));
      expect(swapped.kept).toEqual([other]);
      // And again: they trade back.
      expect(reduce(swapped, { type: 'restored' }).unsent).toEqual(other);
    });

    it('does nothing when asked to put back and nothing is set aside', () => {
      expect(reduce(EMPTY, { type: 'restored' })).toEqual(EMPTY);
    });
  });

  describe('Edit over unsent text (AC-43, J2.6a)', () => {
    const writing = reduce(EMPTY, { type: 'typed', unsent: unsent('A new entry, not sent') });

    it('keeps the unsent text when an entry is opened, and offers it back when the edit is saved', () => {
      const editing = reduce(writing, { type: 'edit-started' });
      expect(editing.unsent).toBeNull();
      expect(editing.kept).toEqual([unsent('A new entry, not sent')]);
      const changed = reduce(editing, { type: 'edit-typed', edit: edit('Fixed') });
      expect(phaseOf(changed)).toBe('editing');
      const saved = reduce(changed, { type: 'edit-confirmed' });
      expect(saved.edit).toBeNull();
      expect(saved.unsent).toEqual(unsent('A new entry, not sent'));
      expect(saved.kept).toEqual([]);
      expect(phaseOf(saved)).toBe('new');
    });

    it('offers it back when the edit is cancelled, too, and drops only the edit', () => {
      const cancelled = reduce(reduce(reduce(writing, { type: 'edit-started' }), { type: 'edit-typed', edit: edit('Fixed') }), { type: 'edit-cancelled' });
      expect(cancelled.edit).toBeNull();
      expect(cancelled.unsent).toEqual(unsent('A new entry, not sent'));
    });

    it('sets aside nothing when there was nothing unsent, and brings back nothing', () => {
      const editing = reduce(EMPTY, { type: 'edit-started' });
      expect(editing).toEqual(EMPTY);
      expect(reduce(editing, { type: 'edit-confirmed' })).toEqual(EMPTY);
    });

    it('keeps two texts set aside when the person edits twice before choosing, and brings them back last first', () => {
      const first = reduce(writing, { type: 'edit-started' });
      const second = reduce(reduce(first, { type: 'typed', unsent: other }), { type: 'edit-started' });
      expect(second.kept).toEqual([unsent('A new entry, not sent'), other]);
      const done = reduce(second, { type: 'edit-confirmed' });
      expect(done.unsent).toEqual(other);
      expect(done.kept).toEqual([unsent('A new entry, not sent')]);
    });

    it('leaves what is set aside where it is when the editor already holds something at the end of the edit', () => {
      const editing = reduce(writing, { type: 'edit-started' });
      const typedDuring = { ...editing, unsent: other };
      const done = reduce(typedDuring, { type: 'edit-confirmed' });
      expect(done.unsent).toEqual(other);
      expect(done.kept).toEqual([unsent('A new entry, not sent')]);
    });
  });

  describe('Discard', () => {
    const full: Snapshot = { unsent: unsent('One'), edit: edit('Two'), kept: [unsent('Three'), unsent('Four')] };

    it('empties exactly the buffer it names', () => {
      expect(reduce(full, { type: 'discarded', which: 'unsent' })).toEqual({ ...full, unsent: null });
      expect(reduce(full, { type: 'discarded', which: 'edit' })).toEqual({ ...full, edit: null });
      // Kept text is a stack: Discard drops the one that was offered, the last.
      expect(reduce(full, { type: 'discarded', which: 'kept' })).toEqual({ ...full, kept: [unsent('Three')] });
    });
  });

  it('never changes the snapshot it is given', () => {
    const frozen: Snapshot = Object.freeze({ unsent: unsent('One'), edit: null, kept: Object.freeze([unsent('Two')]) as Unsent[] });
    for (const event of [
      { type: 'typed', unsent: other },
      { type: 'opened' },
      { type: 'edit-started' },
      { type: 'edit-confirmed' },
      { type: 'restored' },
      { type: 'confirmed' },
      { type: 'discarded', which: 'kept' },
    ] as const) {
      expect(() => reduce(frozen, event)).not.toThrow();
    }
    expect(frozen.kept).toHaveLength(1);
  });
});

describe('the buffers in storage', () => {
  it('writes each buffer under its own key, by kind, so B7 can add episodes beside entries', () => {
    const store = memory();
    const entries = createBuffers(store, 'entry');
    const episodes = createBuffers(store, 'episode');
    entries.apply({ type: 'typed', unsent: unsent('An entry') });
    expect([...store.map.keys()]).toEqual(['imnstr:entry:unsent']);
    expect(episodes.read()).toEqual(EMPTY);
    expect(entries.read().unsent?.doc).toEqual(docFromText('An entry'));
  });

  it('writes on every change and clears only on the confirmation', () => {
    const store = memory();
    const buffers = createBuffers(store, 'entry');
    expect(buffers.apply({ type: 'typed', unsent: unsent('H') }).stored).toBe(true);
    buffers.apply({ type: 'typed', unsent: unsent('He') });
    expect(JSON.parse(store.map.get('imnstr:entry:unsent') as string).doc).toEqual(docFromText('He'));
    // A failed send is not a confirmation: nothing is emptied.
    expect(buffers.read().unsent).not.toBeNull();
    buffers.apply({ type: 'confirmed' });
    expect(store.map.has('imnstr:entry:unsent')).toBe(false);
  });

  it('carries the three buffers through a whole edit over unsent text, as the page does', () => {
    const store = memory();
    const buffers = createBuffers(store, 'entry');
    buffers.apply({ type: 'typed', unsent: unsent('Unsent') });
    buffers.apply({ type: 'edit-started' });
    expect(buffers.read()).toMatchObject({ unsent: null, kept: [unsent('Unsent')] });
    buffers.apply({ type: 'edit-typed', edit: edit('Edited') });
    expect(buffers.read().edit).toEqual(edit('Edited'));
    // A page that opens now finds the edit, and the kept text, and neither is dropped.
    const reopened = createBuffers(store, 'entry');
    expect(reopened.apply({ type: 'opened' }).snapshot).toMatchObject({ edit: edit('Edited'), kept: [unsent('Unsent')] });
    buffers.apply({ type: 'edit-confirmed' });
    expect(buffers.read()).toEqual({ unsent: unsent('Unsent'), edit: null, kept: [] });
  });

  it('writes what is set aside before it empties the buffer it came from', () => {
    const store = memory();
    const buffers = createBuffers(store, 'entry');
    buffers.apply({ type: 'typed', unsent: unsent('Unsent') });
    store.writes.length = 0;
    buffers.apply({ type: 'opened' });
    expect(store.writes.indexOf('imnstr:entry:kept')).toBeLessThan(store.writes.indexOf('imnstr:entry:unsent'));
  });

  it('says so when the browser refuses a write, and still answers with the state, so the page never claims a text is kept when it is not', () => {
    const store = memory();
    store.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    const result = createBuffers(store, 'entry').apply({ type: 'typed', unsent: unsent('Hello') });
    expect(result.stored).toBe(false);
    expect(result.snapshot.unsent?.doc).toEqual(docFromText('Hello'));
  });

  it('reads damaged storage as empty, never as an error', () => {
    const store = memory();
    store.map.set('imnstr:entry:unsent', '{not json');
    store.map.set('imnstr:entry:edit', JSON.stringify({ id: 1, title: 'x', doc: {} }));
    store.map.set('imnstr:entry:kept', JSON.stringify([{ key: KEY, id: null, lang: 'de', title: '', doc: docFromText('x') }, unsent('Fine')]));
    expect(createBuffers(store, 'entry').read()).toEqual({ unsent: null, edit: null, kept: [unsent('Fine')] });
  });

  it('reads a body that is no longer a valid document as damaged, not as text', () => {
    const store = memory();
    store.map.set('imnstr:entry:unsent', JSON.stringify({ ...unsent('x'), doc: { type: 'doc', content: [{ type: 'heading' }] } }));
    expect(createBuffers(store, 'entry').read().unsent).toBeNull();
  });

  it('reads a storage that throws as empty', () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(createBuffers(throwing, 'entry').read()).toEqual(EMPTY);
  });

  it('stores no count, no time and no description of the text (W7)', () => {
    const store = memory();
    createBuffers(store, 'entry').apply({ type: 'typed', unsent: unsent('Some words here') });
    const stored = JSON.parse(store.map.get('imnstr:entry:unsent') as string) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(['doc', 'id', 'key', 'lang', 'title']);
  });
});

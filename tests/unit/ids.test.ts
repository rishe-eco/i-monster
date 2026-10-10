import { describe, expect, it } from 'vitest';
import { ID_LENGTH, isId, newId } from '../../lib/ids.ts';

describe('ids', () => {
  it('are 10 lowercase Crockford base32 characters', () => {
    for (let i = 0; i < 200; i++) {
      const id = newId();
      expect(id).toHaveLength(ID_LENGTH);
      expect(id).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{10}$/);
      expect(isId(id)).toBe(true);
    }
  });

  it('never use the letters Crockford drops (i, l, o, u)', () => {
    const seen = new Set(Array.from({ length: 500 }, newId).join(''));
    for (const letter of 'ilou') expect(seen.has(letter)).toBe(false);
  });

  it('are random, not a counter: 1000 are all different and show no order', () => {
    const ids = Array.from({ length: 1000 }, newId);
    expect(new Set(ids).size).toBe(1000);
    expect(ids).not.toEqual([...ids].sort());
  });

  it('use all 32 characters', () => {
    const seen = new Set(Array.from({ length: 2000 }, newId).join(''));
    expect(seen.size).toBe(32);
  });

  it('are recognised by isId, and nothing else is', () => {
    expect(isId('0123456789')).toBe(true);
    for (const bad of ['', 'abc', 'ABCDEFGHJK', '0123456789a', 'ilou012345', '0123 56789', '/log/abcd']) {
      expect(isId(bad)).toBe(false);
    }
  });
});

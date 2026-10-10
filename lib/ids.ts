// Ids for entries and episodes (PD-6, D-2): 10 characters of lowercase
// Crockford base32, which is 50 random bits. Random, so a URL carries no count
// and a gap shows nothing about what was unpublished.
import { randomBytes } from 'node:crypto';

// Crockford drops i, l, o and u so an id survives being read aloud or retyped.
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
export const ID_LENGTH = 10;

const ID_PATTERN = /^[0-9abcdefghjkmnpqrstvwxyz]{10}$/;

export function newId(): string {
  const bytes = randomBytes(ID_LENGTH);
  let id = '';
  for (const byte of bytes) {
    // 32 divides 256, so masking to five bits keeps every character equally likely.
    id += ALPHABET[byte & 31];
  }
  return id;
}

export function isId(value: string): boolean {
  return ID_PATTERN.test(value);
}

// A passkey's name, as one rule (house rule 4). The server decides with it
// (routes/admin-api.ts); the admin asks it before the ceremony (admin/passkey.ts),
// because the server only sees the name after the passkey exists on the device.
import { limits } from './limits.ts';

export type NameRefusal = 'NAME_REQUIRED' | 'REQUEST_INVALID';

/** Trimmed, one line, 1 to `limits.passkeyNameMax` characters. Otherwise the code to refuse with. */
export function cleanPasskeyName(value: unknown): { name: string } | { refusal: NameRefusal } {
  if (typeof value !== 'string') return { refusal: 'NAME_REQUIRED' };
  const name = value.replace(/\s+/g, ' ').trim();
  if (name === '') return { refusal: 'NAME_REQUIRED' };
  if (name.length > limits.passkeyNameMax || /\p{Cc}/u.test(name)) return { refusal: 'REQUEST_INVALID' };
  return { name };
}

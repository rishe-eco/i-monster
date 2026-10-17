// The one place the admin reaches the browser's storage, and only for the text buffers (plan B6, PD-12).
// Nothing else is kept here: not the session, not the CSRF token, not a setting (AC-10). The house-rules
// test pins that: this file is the single place `localStorage` may be named.
import type { StorageLike } from './buffers.ts';

/**
 * `localStorage`, or a store that holds nothing when the browser won't give it (a private window,
 * blocked site data). Every call is wrapped: the accessor itself can throw, and so can a write
 * once the quota is full. A write that fails is reported by the buffers, so the page never says
 * a text is kept when it isn't.
 */
export function browserStorage(): StorageLike {
  return {
    getItem(key) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      window.localStorage.setItem(key, value);
    },
    removeItem(key) {
      window.localStorage.removeItem(key);
    },
  };
}

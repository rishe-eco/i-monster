// The admin's words are keyed by the API's codes (house rule 3, plan B4b), so the
// two lists must agree: a code the server can send has a message, and the admin
// has no message for a refusal the server never makes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copy, refusals } from '../../admin/copy.ts';
import { nameProblem } from '../../admin/passkey.ts';
import { limits } from '../../lib/limits.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const CLIENT_CODES = ['NETWORK', 'UNEXPECTED', 'CANCELLED', 'ALREADY_REGISTERED', 'UNSUPPORTED'];

/** The codes `routes/admin-api.ts` can refuse with: the keys of its STATUS table. */
function serverCodes(): string[] {
  const source = readFileSync(join(ROOT, 'routes', 'admin-api.ts'), 'utf8');
  const table = /const STATUS = \{([\s\S]*?)\} as const/.exec(source)?.[1] ?? '';
  return [...table.matchAll(/^\s+([A-Z_]+):\s*\d{3},/gm)].map((m) => m[1] as string);
}

describe('the admin copy', () => {
  it('finds the server codes, and finds some', () => {
    expect(serverCodes()).toEqual(expect.arrayContaining(['CODE_REFUSED', 'SIGNIN_FAILED', 'LAST_PASSKEY', 'REAUTH_REQUIRED']));
  });

  it('has a message for every code the server refuses with, and for no other server code', () => {
    const messages = Object.keys(refusals).filter((code) => !CLIENT_CODES.includes(code));
    expect(messages.sort()).toEqual(serverCodes().sort());
    for (const message of Object.values(refusals)) expect(message.length).toBeGreaterThan(10);
  });

  it('has one message for CODE_REFUSED, naming both ways to recover (AC-20, AC-21, F2)', () => {
    expect(refusals.CODE_REFUSED).toContain('Make a new code from a signed-in device');
    expect(refusals.CODE_REFUSED).toContain('issue a setup token on the server');
  });

  it('has one generic message for a failed sign-in, which says nothing about why (AC-11)', () => {
    expect(refusals.SIGNIN_FAILED).toBe("Sign-in didn't work. Try again.");
    expect(refusals.SIGNIN_FAILED).not.toMatch(/passkey|unknown|wrong|invalid|expired/i);
  });

  it('says what an already-registered authenticator means, as the plan asks (PD-17)', () => {
    expect(refusals.ALREADY_REGISTERED).toBe('This device already has a passkey for this site.');
  });

  it('states the code\'s life in minutes from the limits, not as a number written twice (house rule 4)', () => {
    expect(copy.passkeys.enrolPanel.lede).toContain(`${limits.enrolmentCodeMs / 60_000} minutes`);
    expect(copy.setup.tokenHint).toContain(`${limits.setupTokenMs / 60_000} minutes`);
    expect(refusals.REQUEST_INVALID).toContain(String(limits.passkeyNameMax));
  });

  it('shows no count and no countdown (house rule 1)', () => {
    const everything = JSON.stringify([refusals, copy, copy.setup.button('phone'), copy.passkeys.added('10 Oct 2026')]);
    expect(everything).not.toMatch(/\b\d+ (seconds?|tries|attempts|passkeys?|devices?)\b/i);
    // "You left something here" is the plate's own wording for text found again; what is forbidden is a count of what is left.
    expect(everything).not.toMatch(/\b\d+\s+\w+\s+left\b|\bremaining\b/i);
  });
});

describe('nameProblem: the name rule asked before a passkey exists', () => {
  it('refuses an empty or blank name', () => {
    expect(nameProblem('')).toBe('NAME_REQUIRED');
    expect(nameProblem('   \n\t ')).toBe('NAME_REQUIRED');
  });

  it('refuses a name over the limit, counted after collapsing white space, and one with a control character', () => {
    expect(nameProblem('x'.repeat(limits.passkeyNameMax))).toBeNull();
    expect(nameProblem('x'.repeat(limits.passkeyNameMax + 1))).toBe('REQUEST_INVALID');
    expect(nameProblem(`  ${'x'.repeat(limits.passkeyNameMax)}  `)).toBeNull();
    expect(nameProblem('a\u0007b')).toBe('REQUEST_INVALID');
  });

  it('accepts ordinary names in either script', () => {
    for (const name of ['phone', 'new phone', 'old laptop', 'گوشی من', "Foad's key"]) expect(nameProblem(name)).toBeNull();
  });
});

describe('the episode copy (plan B7)', () => {
  it('words the https refusal as the plate does, with the fix from the person\'s own text', () => {
    expect(copy.episode.notHttps('https://youtu.be/abc123')).toBe('This link needs to start with https://, like https://youtu.be/abc123. Everything else you typed is still here.');
    // With nothing to build a fix from, the plate's own example stands in.
    expect(copy.episode.notHttps(null)).toBe('This link needs to start with https://, like https://youtu.be/abc123. Everything else you typed is still here.');
  });

  it('names the date it returns to, and says the episode keeps its place (plate 12)', () => {
    expect(copy.episode.republished('3 Oct 2026')).toEqual({ head: 'Published, at 3 Oct 2026.', body: "It's back in its place on the podcast page." });
    expect(copy.episode.savedLive).toEqual({ head: 'Saved.', body: 'The episode keeps its date and its place.' });
    expect(copy.episode.lastLink).toBe('A published episode keeps at least one link. Add the right one, then remove this.');
  });

  it('gives the signed-out and offline failures in episode words (plate 12, F-16)', () => {
    expect(copy.episode.failure.signedOut).toBe('You were signed out. Sign in to finish. Your episode stays right here.');
    expect(copy.episode.failure.network.text).toBe('The connection dropped. Everything you typed is kept on this phone.');
  });

  it('says the two refusals whose shared message is about a passkey in the episode\'s terms, and has a message for each new code', () => {
    expect(refusals.NAME_REQUIRED).toContain('passkey');
    expect(copy.episode.failure.refusals.NAME_REQUIRED).toBe('Give the episode a name before publishing.');
    expect(copy.episode.failure.refusals.REQUEST_INVALID).not.toContain(String(limits.passkeyNameMax));
    for (const code of ['DESCRIPTION_REQUIRED', 'TAGS_ONE_OR_TWO', 'LINK_REQUIRED', 'LINK_NOT_HTTPS', 'LAST_LINK'] as const) {
      expect(refusals[code].length, code).toBeGreaterThan(10);
    }
  });

  it('shows no count anywhere in the section or the form (house rule 1)', () => {
    const everything = JSON.stringify([copy.podcast, copy.episode, copy.episode.removeNamed('YouTube'), copy.podcast.editing('Why a monster?')]);
    expect(everything).not.toMatch(/\b\d+\s+(episodes?|links?|tags?|drafts?)\b|saving…|\bsaved \d+/i);
    expect(copy.episode.failure.network.notKept).not.toMatch(/\d/);
  });
});

import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../lib/env.ts';

describe('loadEnv', () => {
  it('has defaults for everything', () => {
    expect(loadEnv({})).toEqual({
      port: 4100,
      dbPath: '.tmp/dev.db',
      siteTz: 'Asia/Tehran',
      e2eClock: false,
      prelaunch: false,
      nodeEnv: 'development',
      origin: 'http://localhost:4100',
      rpId: 'localhost',
      contact: {},
    });
  });

  it('reads each variable', () => {
    const env = loadEnv({
      PORT: '4110',
      DB_PATH: '.tmp/e2e.db',
      SITE_TZ: 'UTC',
      E2E_CLOCK: '1',
      PRELAUNCH: '1',
      NODE_ENV: 'test',
      ORIGIN: 'https://example.org',
    });
    expect(env).toEqual({
      port: 4110,
      dbPath: '.tmp/e2e.db',
      siteTz: 'UTC',
      e2eClock: true,
      prelaunch: true,
      nodeEnv: 'test',
      origin: 'https://example.org',
      rpId: 'example.org',
      contact: {},
    });
  });

  it('switches a flag on only for the exact string 1', () => {
    for (const value of ['0', 'false', 'true', '', ' ']) {
      expect(loadEnv({ PRELAUNCH: value, E2E_CLOCK: value }).prelaunch).toBe(false);
      expect(loadEnv({ PRELAUNCH: value, E2E_CLOCK: value }).e2eClock).toBe(false);
    }
  });

  it('refuses to boot with E2E_CLOCK=1 in production', () => {
    expect(() => loadEnv({ E2E_CLOCK: '1', NODE_ENV: 'production' })).toThrow(/E2E_CLOCK/);
  });

  it('allows E2E_CLOCK=1 outside production, and production without it', () => {
    expect(() => loadEnv({ E2E_CLOCK: '1', NODE_ENV: 'test' })).not.toThrow();
    expect(() => loadEnv({ E2E_CLOCK: '1' })).not.toThrow();
    expect(() => loadEnv({ NODE_ENV: 'production' })).not.toThrow();
  });

  it('refuses a port that is not a port', () => {
    for (const PORT of ['abc', '0', '70000', '-1', '4100.5']) {
      expect(() => loadEnv({ PORT })).toThrow(/PORT/);
    }
  });

  it('refuses a timezone the runtime does not know', () => {
    expect(() => loadEnv({ SITE_TZ: 'Mars/Olympus' })).toThrow(/SITE_TZ/);
  });

  describe('the origin and the relying-party id', () => {
    it('follow the port in development', () => {
      expect(loadEnv({ PORT: '4110' })).toMatchObject({ origin: 'http://localhost:4110', rpId: 'localhost' });
    });

    it('default to https://imnstr.com in production, so the server needs no new .env line', () => {
      expect(loadEnv({ NODE_ENV: 'production' })).toMatchObject({ origin: 'https://imnstr.com', rpId: 'imnstr.com' });
    });

    it('take the hostname, without a port, as the rp id', () => {
      expect(loadEnv({ ORIGIN: 'http://localhost:9000' })).toMatchObject({ origin: 'http://localhost:9000', rpId: 'localhost' });
    });

    it('refuse an origin that is not a bare origin', () => {
      for (const ORIGIN of ['imnstr.com', 'https://imnstr.com/', 'https://imnstr.com/admin', 'ftp://imnstr.com', 'https://imnstr.com:443']) {
        expect(() => loadEnv({ ORIGIN })).toThrow(/ORIGIN/);
      }
    });

    it('refuse plain http in production', () => {
      expect(() => loadEnv({ NODE_ENV: 'production', ORIGIN: 'http://imnstr.com' })).toThrow(/https/);
    });
  });

  // The invented values below are the only ones the repository ever holds (CT-3); the real ones are on the server.
  describe('the contact links (CT-3)', () => {
    const silent = () => undefined;

    it('are absent when the variables are unset or empty, without a warning', () => {
      const warnings: string[] = [];
      expect(loadEnv({}, (m) => warnings.push(m)).contact).toEqual({});
      expect(loadEnv({ CONTACT_EMAIL: '', CONTACT_TELEGRAM: '  ', CONTACT_INSTAGRAM: '' }, (m) => warnings.push(m)).contact).toEqual({});
      expect(warnings).toEqual([]);
    });

    it('read an address and two handles, and strip a leading @ from a handle', () => {
      expect(loadEnv({ CONTACT_EMAIL: 'someone@example.com', CONTACT_TELEGRAM: 'example_channel', CONTACT_INSTAGRAM: '@example.name' }, silent).contact).toEqual({
        email: 'someone@example.com',
        telegram: 'example_channel',
        instagram: 'example.name',
      });
    });

    it('trim the values', () => {
      expect(loadEnv({ CONTACT_EMAIL: ' someone@example.com \n', CONTACT_TELEGRAM: ' @example ' }, silent).contact).toEqual({ email: 'someone@example.com', telegram: 'example' });
    });

    it('drop an invalid value with one warning that names the variable and never the value', () => {
      const warnings: string[] = [];
      const bad = { CONTACT_EMAIL: 'not an address@secret-host', CONTACT_TELEGRAM: 'a/b?c', CONTACT_INSTAGRAM: 'x'.repeat(65) };
      expect(loadEnv(bad, (m) => warnings.push(m)).contact).toEqual({});
      expect(warnings).toHaveLength(3);
      expect(warnings[0]).toContain('CONTACT_EMAIL');
      expect(warnings[1]).toContain('CONTACT_TELEGRAM');
      expect(warnings[2]).toContain('CONTACT_INSTAGRAM');
      for (const message of warnings) {
        for (const value of Object.values(bad)) expect(message).not.toContain(value);
        expect(message).not.toContain('secret-host');
      }
    });

    it('keep the valid ones when another is invalid', () => {
      expect(loadEnv({ CONTACT_EMAIL: 'nope', CONTACT_TELEGRAM: 'example_channel' }, silent).contact).toEqual({ telegram: 'example_channel' });
    });

    it('refuse an address with a display name, a quote, a comma or no top-level domain', () => {
      for (const CONTACT_EMAIL of ['A <a@example.com>', '"a"@example.com', 'a@example.com, b@example.com', 'a@localhost', 'a@@example.com', '@example.com', 'mailto:a@example.com']) {
        expect(loadEnv({ CONTACT_EMAIL }, silent).contact, CONTACT_EMAIL).toEqual({});
      }
    });
  });
});

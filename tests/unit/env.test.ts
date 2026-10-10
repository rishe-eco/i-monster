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
    });
    expect(env).toEqual({
      port: 4110,
      dbPath: '.tmp/e2e.db',
      siteTz: 'UTC',
      e2eClock: true,
      prelaunch: true,
      nodeEnv: 'test',
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
});

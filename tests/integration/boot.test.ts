// The real entry point refuses to start with the test clock in production. The
// unit test of loadEnv proves the rule; this proves server.ts actually applies it.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');

function boot(env: Record<string, string>) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: '4119', DB_PATH: join(ROOT, '.tmp', 'boot-test.db'), ...env },
    encoding: 'utf8',
    timeout: 15_000,
  });
}

describe('server.ts', () => {
  it('exits with an error when E2E_CLOCK=1 and NODE_ENV=production', () => {
    const result = boot({ E2E_CLOCK: '1', NODE_ENV: 'production' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('E2E_CLOCK=1 is refused when NODE_ENV=production');
  });

  it('exits with an error on a port that is not a port', () => {
    const result = boot({ PORT: 'abc' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('PORT must be');
  });
});

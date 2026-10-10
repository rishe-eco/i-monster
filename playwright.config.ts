import { defineConfig } from '@playwright/test';

// The e2e server's port and database come from the lane's environment, so two
// lanes never share either. The clock route is on for every e2e run.
const port = Number(process.env.PORT ?? 4100);
const dbPath = process.env.DB_PATH ?? '.tmp/e2e.db';

// A phone width: every page must fit it with no sideways scroll (spec §4.6).
const phone = { width: 360, height: 800 };

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    // There is no Chrome on the build machine, and no Playwright Chromium: Edge.
    channel: 'msedge',
    viewport: phone,
  },
  // Both colour schemes are projects; both languages are looped inside each spec.
  projects: [
    { name: 'light', use: { colorScheme: 'light' } },
    { name: 'dark', use: { colorScheme: 'dark' } },
  ],
  webServer: {
    command: 'npx tsx server.ts',
    url: `http://localhost:${port}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: String(port),
      DB_PATH: dbPath,
      E2E_CLOCK: '1',
      NODE_ENV: 'test',
    },
  },
});

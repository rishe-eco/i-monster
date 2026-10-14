import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    // Each test file that needs a database makes its own temporary SQLite file.
    environment: 'node',
    // Builds the admin bundle when it is missing or older than its sources.
    globalSetup: ['tests/globalSetup.ts'],
  },
});

const { defineConfig } = require('@playwright/test');

// Use a different port from dev (3420) to avoid conflicts
const TEST_API_PORT = 3421;

module.exports = defineConfig({
  testDir: './test/e2e',
  timeout: 30000,
  retries: 1, // UI tests with pointer events can be flaky in headless
  workers: 1, // Sequential — tests share server state

  use: {
    baseURL: `http://localhost:${TEST_API_PORT}`,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    // Mobile portrait viewport — this is how users view the app
    viewport: { width: 390, height: 844 },
  },

  webServer: {
    command: 'node test/setup/start-test-server.js',
    port: TEST_API_PORT,
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'test',
      PORT: String(TEST_API_PORT),
      JWT_SECRET: 'test-secret-key-for-e2e',
      CLIENT_URL: `http://localhost:${TEST_API_PORT}`,
    },
    timeout: 15000,
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});

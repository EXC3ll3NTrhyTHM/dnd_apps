const { test, expect } = require('@playwright/test');

test.describe('Smoke Tests', () => {
  test('API health check returns ok', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.status).toBe('ok');
  });
});

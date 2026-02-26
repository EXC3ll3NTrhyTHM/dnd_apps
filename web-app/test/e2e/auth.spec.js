const { test, expect } = require('@playwright/test');
const { getTestAuthHeaders } = require('../helpers/auth');


test.describe('Authentication', () => {
  test('test-login endpoint returns a valid JWT', async ({ request }) => {
    const response = await request.post(`/api/auth/test-login`, {
      data: { userId: 'test_user_001', username: 'testhero', characterName: 'TestHero' },
    });
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.token).toBeTruthy();
    expect(data.user.id).toBe('test_user_001');
    expect(data.user.username).toBe('testhero');
  });

  test('test-login requires userId and username', async ({ request }) => {
    const response = await request.post(`/api/auth/test-login`, {
      data: {},
    });
    expect(response.status()).toBe(400);
  });

  test('/api/auth/me returns user data with wallet and XP', async ({ request }) => {
    const headers = await getTestAuthHeaders({ request });

    const response = await request.get(`/api/auth/me`, { headers });
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.user.id).toBe('test_user_001');
    expect(data.wallet).toBeTruthy();
    expect(data.wallet.balance).toBe(500);
  });

  test('unauthenticated request to /api/auth/me returns 401', async ({ request }) => {
    const response = await request.get(`/api/auth/me`);
    expect(response.status()).toBe(401);
  });
});

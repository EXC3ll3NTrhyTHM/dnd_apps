const { test, expect } = require('@playwright/test');
const { getTestAuthHeaders } = require('../helpers/auth');

test.describe('Shop', () => {
  test('can view shop catalog with categories', async ({ request }) => {
    const headers = await getTestAuthHeaders({ request });

    const response = await request.get('/api/shop/catalog', { headers });
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.categories).toBeTruthy();
    expect(Object.keys(data.categories).length).toBeGreaterThan(0);
    expect(data.currency_name).toBe('Gold');
  });

  test('can purchase an item and balance decreases', async ({ request }) => {
    const headers = await getTestAuthHeaders({ request });

    // Check initial balance
    const meResponse = await request.get('/api/auth/me', { headers });
    const { wallet: initialWallet } = await meResponse.json();

    // Buy a basic worm (5G — cheapest item)
    const buyResponse = await request.post('/api/shop/buy', {
      headers,
      data: { item_id: 'basic_worm' },
    });
    expect(buyResponse.ok()).toBeTruthy();

    const buyData = await buyResponse.json();
    expect(buyData.success).toBe(true);
    expect(buyData.balance).toBe(initialWallet.balance - 5);
  });

  test('can check inventory after purchase', async ({ request }) => {
    const headers = await getTestAuthHeaders({ request });

    const response = await request.get('/api/inventory', { headers });
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.items).toBeTruthy();
  });
});

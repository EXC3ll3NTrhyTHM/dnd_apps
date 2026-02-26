/**
 * Test authentication helper.
 *
 * Calls the dev-only /api/auth/test-login endpoint and sets the JWT
 * in localStorage so the React app picks it up (same as real Discord OAuth flow).
 *
 * Uses relative URLs — Playwright's request fixture resolves them against baseURL.
 */

/**
 * Login as a test user via the test-login bypass.
 * Must be called after page.goto() so localStorage is available for the correct origin.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} opts
 * @returns {Promise<string>} JWT token
 */
async function loginAsTestUser(page, {
  userId = 'test_user_001',
  username = 'testhero',
  characterName = 'TestHero',
} = {}) {
  const response = await page.request.post('/api/auth/test-login', {
    data: { userId, username, characterName },
  });

  if (!response.ok()) {
    throw new Error(`Test login failed: ${response.status()} ${await response.text()}`);
  }

  const { token } = await response.json();

  await page.evaluate((t) => {
    localStorage.setItem('dh_token', t);
  }, token);

  return token;
}

/**
 * Get auth headers for direct API requests (no browser needed).
 */
async function getTestAuthHeaders({
  userId = 'test_user_001',
  username = 'testhero',
  characterName = 'TestHero',
  request,
} = {}) {
  const response = await request.post('/api/auth/test-login', {
    data: { userId, username, characterName },
  });
  const { token } = await response.json();
  return { Authorization: `Bearer ${token}` };
}

module.exports = { loginAsTestUser, getTestAuthHeaders };

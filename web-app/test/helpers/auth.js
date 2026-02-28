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

/**
 * Login and navigate to a specific location.
 * Handles the scene-view → chat-view transition if the location has a scene.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} locationId - e.g. 'dragons_hollow', 'the_arena'
 * @param {object} opts - login options
 */
async function loginAndNavigate(page, locationId, opts = {}) {
  // Visit the app root so localStorage is available for this origin
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  // Set the token in localStorage
  const token = await loginAsTestUser(page, opts);

  // Reload so the React app re-mounts and picks up the token from localStorage.
  // Use 'load' instead of 'networkidle' — the app uses WebSockets and polling
  // which prevent networkidle from ever resolving.
  await page.reload({ waitUntil: 'load' });
  // Wait until auth completes and we land on the map
  await page.waitForSelector('.map-page, .map-container', { timeout: 15000 });

  // App uses HashRouter — navigate by changing the hash
  await page.evaluate((loc) => {
    window.location.hash = `/location/${loc}`;
  }, locationId);

  // Locations with scenes render in scene view first — click a gathering spot or NPC to enter chat
  // (the_arena doesn't have a scene, it renders Arena directly)
  try {
    const scene = page.locator('.location-scene');
    await scene.waitFor({ timeout: 5000 });
    // Click the gathering spot via JS to bypass overlay issues
    await page.evaluate(() => {
      const spot = document.querySelector('.scene-gathering-spot');
      if (spot) { spot.click(); return; }
      // Fallback: click any NPC sprite
      const npc = document.querySelector('.npc-sprite');
      if (npc) { npc.click(); return; }
    });
  } catch {
    // No scene view — already in chat/arena (e.g., the_arena)
  }

  // Wait for the main content to load
  await page.waitForSelector('[data-testid="chat-header"], .arena, .chat-header', {
    timeout: 15000,
  });

  return token;
}

module.exports = { loginAsTestUser, getTestAuthHeaders, loginAndNavigate };

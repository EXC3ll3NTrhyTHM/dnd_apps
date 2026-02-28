const { test, expect } = require('@playwright/test');
const { loginAsTestUser } = require('../helpers/auth');
const { BugReporter } = require('../helpers/bug-reporter');

test.describe('Arena Audio Memory Cleanup', () => {
  let bug;

  test.beforeEach(async ({ page }, testInfo) => {
    bug = new BugReporter(page, testInfo);
    bug.startTracking();
  });

  /**
   * Navigate to the arena by setting the hash directly.
   * The arena doesn't have a scene view — it renders the Arena component directly.
   */
  async function enterArena(page) {
    await page.evaluate(() => {
      window.location.hash = '/location/the_arena';
    });
    await page.waitForSelector('.arena', { timeout: 15000 });
  }

  /**
   * Leave the arena by navigating to the map.
   */
  async function leaveArena(page) {
    await page.evaluate(() => {
      window.location.hash = '/map';
    });
    await page.waitForSelector('.map-page', { timeout: 10000 });
  }

  test('arena audio buffers are cleared when leaving the arena', async ({ page }) => {
    test.setTimeout(60000);
    try {
      // Track all audio fetches to arena sound files
      await page.addInitScript(() => {
        window.__arenaAudioFetches = [];
        const origFetch = window.fetch;
        window.fetch = function (url, ...args) {
          if (typeof url === 'string' && url.includes('/sounds/arena/')) {
            window.__arenaAudioFetches.push({ url, timestamp: Date.now() });
          }
          return origFetch.call(this, url, ...args);
        };
      });

      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await loginAsTestUser(page);
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('.map-page', { timeout: 15000 });

      // Enter the arena
      await enterArena(page);

      // Trigger a user interaction to kick off audio preload
      await page.click('.arena', { force: true });

      // Wait for arena sounds to preload (useArenaSounds preloads on mount)
      await page.waitForTimeout(5000);

      // Check that arena sounds were fetched
      const firstVisitFetches = await page.evaluate(() =>
        window.__arenaAudioFetches.filter(
          (f) => f.url.includes('/sounds/arena/sfx/') || f.url.includes('/sounds/arena/emotes/')
        ).length
      );

      expect(
        firstVisitFetches,
        'Arena SFX should have been fetched on first visit'
      ).toBeGreaterThan(0);

      // Leave to map — this should trigger clearArenaBuffers + clearDiceBuffers
      await leaveArena(page);
      await page.waitForTimeout(1000);

      // Clear the fetch tracker so we can isolate second-visit fetches
      await page.evaluate(() => { window.__arenaAudioFetches = []; });

      // Re-enter the arena
      await enterArena(page);

      // Trigger interaction again to re-preload
      await page.click('.arena', { force: true });
      await page.waitForTimeout(5000);

      const secondVisitFetches = await page.evaluate(() =>
        window.__arenaAudioFetches.filter(
          (f) => f.url.includes('/sounds/arena/sfx/') || f.url.includes('/sounds/arena/emotes/')
        ).length
      );

      // If the cache was cleared, arena sounds must be re-fetched
      expect(
        secondVisitFetches,
        `Arena SFX should be re-fetched on second visit (proving buffers were cleared). ` +
          `First visit: ${firstVisitFetches} fetches, second visit: ${secondVisitFetches} fetches`
      ).toBeGreaterThan(0);
    } catch (e) {
      await bug.report({
        title: 'Arena audio buffers not freed when leaving',
        steps:
          'Enter The Arena, wait for SFX preload, leave to map, re-enter. ' +
          'On re-entry, arena sounds should be re-fetched (proving cache was cleared).',
        expected:
          'Arena audio buffers cleared on exit; re-entering re-fetches sounds',
        actual: e.message,
        priority: 'high',
      });
      throw e;
    }
  });

  test('dice audio buffers are cleared when leaving the arena', async ({ page }) => {
    test.setTimeout(60000);
    try {
      // Track fetches for dice collision sounds
      await page.addInitScript(() => {
        window.__diceAudioFetches = [];
        const origFetch = window.fetch;
        window.fetch = function (url, ...args) {
          if (typeof url === 'string' && (url.includes('dicehit') || url.includes('surface_felt'))) {
            window.__diceAudioFetches.push({ url, timestamp: Date.now() });
          }
          return origFetch.call(this, url, ...args);
        };
      });

      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await loginAsTestUser(page);
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('.map-page', { timeout: 15000 });

      // Enter the arena — dice sounds preload on first user interaction
      await enterArena(page);

      // Trigger a user interaction to kick off dice sound preload
      // (initOnInteraction in useUiSounds.js calls preloadDiceSounds on first pointerdown)
      await page.click('.arena', { force: true });
      await page.waitForTimeout(5000);

      const firstVisitDiceFetches = await page.evaluate(() =>
        window.__diceAudioFetches.length
      );

      expect(
        firstVisitDiceFetches,
        'Dice collision sounds should have been fetched on first visit'
      ).toBeGreaterThan(0);

      // Leave arena — clearDiceBuffers should be called
      await leaveArena(page);
      await page.waitForTimeout(1000);

      // Clear tracker
      await page.evaluate(() => { window.__diceAudioFetches = []; });

      // Re-enter arena
      await enterArena(page);

      // Trigger interaction again to re-preload
      await page.click('.arena', { force: true });
      await page.waitForTimeout(5000);

      const secondVisitDiceFetches = await page.evaluate(() =>
        window.__diceAudioFetches.length
      );

      expect(
        secondVisitDiceFetches,
        `Dice sounds should be re-fetched on second visit (proving buffers were cleared). ` +
          `First visit: ${firstVisitDiceFetches} fetches, second visit: ${secondVisitDiceFetches} fetches`
      ).toBeGreaterThan(0);
    } catch (e) {
      await bug.report({
        title: 'Dice audio buffers not freed when leaving arena',
        steps:
          'Enter The Arena, interact to trigger dice sound preload, leave to map, ' +
          're-enter. On re-entry, dice sounds should be re-fetched.',
        expected:
          'Dice audio buffers cleared on arena exit; re-entering re-fetches sounds',
        actual: e.message,
        priority: 'high',
      });
      throw e;
    }
  });
});

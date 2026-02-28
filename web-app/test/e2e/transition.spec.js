const { test, expect } = require('@playwright/test');
const { loginAsTestUser } = require('../helpers/auth');
const { BugReporter } = require('../helpers/bug-reporter');

test.describe('Location Transition', () => {
  let bug;

  test.beforeEach(async ({ page }, testInfo) => {
    bug = new BugReporter(page, testInfo);
    bug.startTracking();
  });

  /**
   * Navigate to the map, select a location marker, and click Enter.
   * Uses data-testid="map-marker-{locationId}" for precise targeting.
   */
  async function triggerTransition(page, locationId = 'dragons_hollow') {
    // Login and land on the map
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await loginAsTestUser(page);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.map-page', { timeout: 15000 });

    // Wait for map markers to render
    await page.waitForTimeout(500);

    // Click the specific map marker by data-testid
    await page.evaluate((locId) => {
      const marker = document.querySelector(`[data-testid="map-marker-${locId}"]`);
      if (marker) marker.click();
    }, locationId);

    // Wait for the popup to appear
    await page.waitForSelector('[data-testid="map-popup-enter"]', { timeout: 5000 });

    // Click "Enter" to trigger the transition
    await page.evaluate(() => {
      document.querySelector('[data-testid="map-popup-enter"]')?.click();
    });

    // Wait for the transition overlay to appear
    await page.waitForSelector('.location-transition', { timeout: 5000 });
  }

  test('transition overlay appears when entering a location', async ({ page }) => {
    try {
      await triggerTransition(page, 'dragons_hollow');

      // Verify the transition overlay is visible
      const overlay = page.locator('.location-transition');
      await expect(overlay).toBeVisible();

      // Verify location name is shown
      const name = page.locator('.transition-name');
      await expect(name).toBeVisible();

      // Verify the overlay goes through its phases and eventually completes
      // (navigates to the location)
      await page.waitForSelector('[data-testid="chat-header"], .arena, .chat-header, .location-scene', {
        timeout: 10000,
      });
    } catch (e) {
      await bug.report({
        title: 'Location transition overlay does not appear',
        steps: 'Navigate to map, click Dragons Hollow marker, click Enter',
        expected: 'Transition overlay appears with location name and particles',
        actual: e.message,
        priority: 'normal',
      });
      throw e;
    }
  });

  test('transition sounds play when entering a location', async ({ page }) => {
    try {
      // Track Web Audio API buffer playback — this is what the transition
      // sounds should use (not HTML5 Audio which Edge/iOS block).
      await page.addInitScript(() => {
        window.__transitionAudio = {
          webAudioStarts: [],
          webAudioStops: [],
          fetchedUrls: [],
          decodeCount: 0,
        };

        // Track fetch() calls for audio files
        const origFetch = window.fetch;
        window.fetch = function (url, ...args) {
          if (typeof url === 'string' && (url.includes('.mp3') || url.includes('.wav') || url.includes('.ogg'))) {
            window.__transitionAudio.fetchedUrls.push({ url, timestamp: Date.now() });
          }
          return origFetch.call(this, url, ...args);
        };

        // Track AudioContext.decodeAudioData
        const OrigAC = window.AudioContext || window.webkitAudioContext;
        if (OrigAC) {
          const origDecode = OrigAC.prototype.decodeAudioData;
          OrigAC.prototype.decodeAudioData = function (...args) {
            window.__transitionAudio.decodeCount++;
            return origDecode.apply(this, args);
          };

          // Track createBufferSource → start and stop
          const origCreate = OrigAC.prototype.createBufferSource;
          OrigAC.prototype.createBufferSource = function () {
            const src = origCreate.call(this);
            const origStart = src.start.bind(src);
            const origStop = src.stop.bind(src);
            src.start = function (...startArgs) {
              window.__transitionAudio.webAudioStarts.push({
                state: src.context?.state,
                timestamp: Date.now(),
              });
              return origStart(...startArgs);
            };
            src.stop = function (...stopArgs) {
              window.__transitionAudio.webAudioStops.push({
                timestamp: Date.now(),
              });
              return origStop(...stopArgs);
            };
            return src;
          };
        }
      });

      await triggerTransition(page, 'dragons_hollow');

      // Wait for transition sounds to load and play.
      // Dragon's Hollow has: transition_whistle.mp3 + transition_roar.mp3
      await page.waitForTimeout(3000);

      // Collect data
      const audio = await page.evaluate(() => window.__transitionAudio);

      // Check that transition sound files were fetched
      const transitionFetches = audio.fetchedUrls.filter(
        (f) => f.url.includes('transition') || f.url.includes('dragons_hollow')
      );

      expect(
        transitionFetches.length,
        `Expected transition sound files to be fetched via Web Audio API.\n` +
          `All fetched audio URLs: ${audio.fetchedUrls.map((f) => f.url).join(', ')}\n` +
          `If no transition URLs appear, the sound useEffect may not be running.`
      ).toBeGreaterThan(0);

      // Check that AudioBuffers were decoded
      expect(
        audio.decodeCount,
        `Transition sounds fetched but decodeAudioData was never called.\n` +
          `This means the audio data couldn't be decoded.`
      ).toBeGreaterThan(0);

      // Check that createBufferSource().start() was called (actual playback)
      expect(
        audio.webAudioStarts.length,
        `Audio decoded but no BufferSource.start() calls — sounds were not played.\n` +
          `Web Audio starts: ${audio.webAudioStarts.length}\n` +
          `Decode count: ${audio.decodeCount}`
      ).toBeGreaterThan(0);

      // Verify sounds are NOT stopped early (they should play to completion)
      // The transition overlay unmounts after ~3.4s but sounds should keep playing.
      const stopsBeforeEnd = audio.webAudioStops.filter((s) => {
        // Any stop that happened within the transition window is premature
        const firstStart = audio.webAudioStarts[0]?.timestamp;
        return firstStart && s.timestamp - firstStart < 3500;
      });
      expect(
        stopsBeforeEnd.length,
        `Transition sounds were stopped prematurely (source.stop() called before ` +
          `sounds finished). Sounds should play to completion even after the overlay unmounts.`
      ).toBe(0);
    } catch (e) {
      await bug.report({
        title: 'Transition sounds not playing when entering location',
        steps:
          'Navigate to map, click Dragons Hollow marker, click Enter. ' +
          'Transition overlay appears but no sound plays.',
        expected:
          'Location transition sounds play via Web Audio API during the overlay',
        actual: e.message,
        priority: 'high',
      });
      throw e;
    }
  });

  test('transition sounds do not play when audio is muted', async ({ page }) => {
    try {
      // Track actual playback (BufferSource.start), not just fetches.
      // Preloading/caching buffers when muted is fine — playing them is not.
      await page.addInitScript(() => {
        window.__transitionAudio = { webAudioStarts: [] };

        const OrigAC = window.AudioContext || window.webkitAudioContext;
        if (OrigAC) {
          const origCreate = OrigAC.prototype.createBufferSource;
          OrigAC.prototype.createBufferSource = function () {
            const src = origCreate.call(this);
            const origStart = src.start.bind(src);
            src.start = function (...args) {
              window.__transitionAudio.webAudioStarts.push({
                timestamp: Date.now(),
              });
              return origStart(...args);
            };
            return src;
          };
        }
      });

      // Login and land on map
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await loginAsTestUser(page);

      // Set audio muted in localStorage before reload
      await page.evaluate(() => {
        localStorage.setItem('audio_muted', 'true');
      });

      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('.map-page', { timeout: 15000 });

      // Wait for map markers to render
      await page.waitForTimeout(500);

      // Record start count — other audio systems may use createBufferSource
      const startsBefore = await page.evaluate(
        () => window.__transitionAudio.webAudioStarts.length
      );

      // Click the Dragon's Hollow marker
      await page.evaluate(() => {
        document.querySelector('[data-testid="map-marker-dragons_hollow"]')?.click();
      });
      await page.waitForSelector('[data-testid="map-popup-enter"]', { timeout: 5000 });
      await page.evaluate(() => {
        document.querySelector('[data-testid="map-popup-enter"]')?.click();
      });

      // Wait for transition
      try {
        await page.waitForSelector('.location-transition', { timeout: 5000 });
        await page.waitForTimeout(3000);
      } catch {
        // Transition may complete quickly
      }

      const startsAfter = await page.evaluate(
        () => window.__transitionAudio.webAudioStarts.length
      );
      const newStarts = startsAfter - startsBefore;

      expect(
        newStarts,
        `Expected no Web Audio playback when muted, but ${newStarts} BufferSource.start() calls happened during transition`
      ).toBe(0);
    } catch (e) {
      await bug.report({
        title: 'Transition sounds play even when audio is muted',
        steps: 'Mute audio in settings, enter a location, observe transition',
        expected: 'No transition sounds play when muted',
        actual: e.message,
        priority: 'normal',
      });
      throw e;
    }
  });
});

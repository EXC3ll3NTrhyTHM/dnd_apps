const { test, expect } = require('@playwright/test');
const { loginAsTestUser } = require('../helpers/auth');
const { BugReporter } = require('../helpers/bug-reporter');

test.describe('Scene Audio Lifecycle', () => {
  let bug;

  test.beforeEach(async ({ page }, testInfo) => {
    bug = new BugReporter(page, testInfo);
    bug.startTracking();
  });

  /**
   * Install Web Audio API tracking hooks via addInitScript so they
   * survive page navigations and reloads.
   */
  async function installAudioTracking(page) {
    await page.addInitScript(() => {
      window.__sceneAudio = {
        activeSources: 0,
        totalStarts: 0,
        totalStops: 0,
        startLog: [],
        stopLog: [],
      };

      const OrigAC = window.AudioContext || window.webkitAudioContext;
      if (!OrigAC) return;

      const origCreate = OrigAC.prototype.createBufferSource;
      OrigAC.prototype.createBufferSource = function () {
        const src = origCreate.call(this);
        const origStart = src.start.bind(src);
        const origStop = src.stop.bind(src);

        src.start = function (...args) {
          window.__sceneAudio.activeSources++;
          window.__sceneAudio.totalStarts++;
          window.__sceneAudio.startLog.push({
            timestamp: Date.now(),
            ctxState: src.context?.state,
          });
          // Track when source naturally ends (not stopped early)
          src.addEventListener('ended', () => {
            window.__sceneAudio.activeSources = Math.max(0, window.__sceneAudio.activeSources - 1);
          });
          return origStart(...args);
        };

        src.stop = function (...args) {
          window.__sceneAudio.activeSources = Math.max(0, window.__sceneAudio.activeSources - 1);
          window.__sceneAudio.totalStops++;
          window.__sceneAudio.stopLog.push({ timestamp: Date.now() });
          return origStop(...args);
        };

        return src;
      };
    });
  }

  /**
   * Navigate to the map, select a location marker, click Enter,
   * wait for the transition to complete and the location to load.
   */
  async function enterLocation(page, locationId) {
    await page.waitForSelector('.map-page', { timeout: 15000 });
    await page.waitForTimeout(500);

    await page.evaluate((locId) => {
      document.querySelector(`[data-testid="map-marker-${locId}"]`)?.click();
    }, locationId);

    await page.waitForSelector('[data-testid="map-popup-enter"]', { timeout: 5000 });

    await page.evaluate(() => {
      document.querySelector('[data-testid="map-popup-enter"]')?.click();
    });

    // Wait for location to fully load (transition completes → location page appears)
    await page.waitForSelector('.location-scene, .location-chat, .arena', {
      timeout: 15000,
    });
  }

  /**
   * Navigate back to the map from a location.
   */
  async function leaveToMap(page) {
    // Use the back button in scene or chat view
    await page.evaluate(() => {
      // Scene view back buttons have .scene-back-btn, chat has .chat-back-btn
      const sceneBack = document.querySelector('.scene-back-btn');
      const chatBack = document.querySelector('.chat-back-btn');
      if (sceneBack) sceneBack.click();
      else if (chatBack) chatBack.click();
    });

    await page.waitForSelector('.map-page', { timeout: 10000 });
  }

  test('scene audio stops when leaving a location', async ({ page }) => {
    try {
      await installAudioTracking(page);

      // Login and navigate to map
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await loginAsTestUser(page);
      await page.reload({ waitUntil: 'load' });

      // Enter Dragon's Hollow (has scene audio: tavern music + ambient)
      await enterLocation(page, 'dragons_hollow');

      // Wait for scene audio to start playing
      await page.waitForFunction(
        () => window.__sceneAudio && window.__sceneAudio.totalStarts > 0,
        { timeout: 10000 }
      );

      const audioBeforeLeave = await page.evaluate(() => ({
        activeSources: window.__sceneAudio.activeSources,
        totalStarts: window.__sceneAudio.totalStarts,
      }));

      expect(
        audioBeforeLeave.totalStarts,
        'Scene audio should have started playing inside the location'
      ).toBeGreaterThan(0);

      // Leave to map
      await leaveToMap(page);

      // Wait for fade-out to complete (stopAll uses 300ms fade + 50ms buffer)
      await page.waitForTimeout(1000);

      const audioAfterLeave = await page.evaluate(() => ({
        activeSources: window.__sceneAudio.activeSources,
        totalStops: window.__sceneAudio.totalStops,
      }));

      expect(
        audioAfterLeave.activeSources,
        `Expected 0 active audio sources after leaving location, ` +
          `but ${audioAfterLeave.activeSources} are still playing. ` +
          `Total stops: ${audioAfterLeave.totalStops}. ` +
          `Scene audio was not properly cleaned up on unmount.`
      ).toBe(0);
    } catch (e) {
      await bug.report({
        title: 'Scene audio continues playing after leaving location',
        steps:
          'Enter Dragon\'s Hollow, wait for scene audio to play, ' +
          'navigate back to the map',
        expected: 'All scene audio stops when leaving the location',
        actual: e.message,
        priority: 'high',
      });
      throw e;
    }
  });

  test('scene audio from first location stops when entering second location', async ({ page }) => {
    try {
      await installAudioTracking(page);

      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await loginAsTestUser(page);
      await page.reload({ waitUntil: 'load' });

      // Enter first location
      await enterLocation(page, 'dragons_hollow');

      // Wait for scene audio to start
      await page.waitForFunction(
        () => window.__sceneAudio && window.__sceneAudio.totalStarts > 0,
        { timeout: 10000 }
      );

      const firstLocationStarts = await page.evaluate(
        () => window.__sceneAudio.totalStarts
      );

      // Leave to map
      await leaveToMap(page);
      await page.waitForTimeout(1000);

      // Record stop count after leaving first location
      const stopsAfterFirst = await page.evaluate(
        () => window.__sceneAudio.totalStops
      );

      // Enter second location (the_dojo has a gong sound + scene audio)
      await enterLocation(page, 'the_dojo');

      // Wait for second location's audio to start OR timeout
      await page.waitForTimeout(5000);

      const finalState = await page.evaluate(() => ({
        activeSources: window.__sceneAudio.activeSources,
        totalStarts: window.__sceneAudio.totalStarts,
        totalStops: window.__sceneAudio.totalStops,
      }));

      // After leaving the first location, no sources from it should still be active.
      // The Dojo may have started its own sources, but the total active count should
      // not exceed what the second location needs (it has at most 2 scene tracks).
      // The key check: are more sources running than a single location should produce?
      // First location's looping sources must have been stopped.
      const activeAfterLeave = await page.evaluate(
        () => window.__sceneAudio.activeSources
      );

      // At most the second location's sources should be active (dojo has 0 scene audio
      // in some configs). The first location's looping sources must not persist.
      // A reasonable upper bound: no more sources active than started in the second location.
      const secondLocationStarts = finalState.totalStarts - firstLocationStarts;
      expect(
        activeAfterLeave,
        `Expected at most ${secondLocationStarts} active sources (from second location) ` +
          `but found ${activeAfterLeave}. First location started ${firstLocationStarts} ` +
          `sources — some may still be playing underneath. ` +
          `Total: ${finalState.totalStarts} starts, ${finalState.totalStops} stops.`
      ).toBeLessThanOrEqual(Math.max(secondLocationStarts, 2));
    } catch (e) {
      await bug.report({
        title: 'Previous location audio keeps playing in new location',
        steps:
          'Enter Dragon\'s Hollow, wait for audio, leave to map, ' +
          'enter The Dojo. First location\'s audio still audible.',
        expected:
          'Only the current location\'s audio plays; previous audio is fully stopped',
        actual: e.message,
        priority: 'high',
      });
      throw e;
    }
  });

  test('scene audio is silent when muted', async ({ page }) => {
    try {
      // Track gain node values at the time of source.start()
      await page.addInitScript(() => {
        window.__sceneAudio = { gainValues: [] };

        const OrigAC = window.AudioContext || window.webkitAudioContext;
        if (!OrigAC) return;

        // Track gain values when connecting sources
        const origCreateGain = OrigAC.prototype.createGain;
        OrigAC.prototype.createGain = function () {
          const gain = origCreateGain.call(this);
          // Snapshot the gain value shortly after creation (after it's been set)
          setTimeout(() => {
            window.__sceneAudio.gainValues.push(gain.gain.value);
          }, 100);
          return gain;
        };
      });

      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await loginAsTestUser(page);

      // Set muted before entering location
      await page.evaluate(() => {
        localStorage.setItem('audio_muted', 'true');
      });

      await page.reload({ waitUntil: 'load' });

      await enterLocation(page, 'dragons_hollow');

      // Wait for audio system to initialize
      await page.waitForTimeout(5000);

      const result = await page.evaluate(() => window.__sceneAudio);

      // All gain values should be 0 (muted)
      const nonZeroGains = result.gainValues.filter(v => v > 0);

      expect(
        nonZeroGains.length,
        `Expected all gain nodes to be 0 (muted), but found ` +
          `${nonZeroGains.length} with non-zero values: ${nonZeroGains.join(', ')}. ` +
          `Audio is audible despite being muted.`
      ).toBe(0);
    } catch (e) {
      await bug.report({
        title: 'Scene audio audible when muted',
        steps: 'Mute audio, enter Dragon\'s Hollow, observe audio playback',
        expected: 'All audio gain nodes should be 0 when muted',
        actual: e.message,
        priority: 'normal',
      });
      throw e;
    }
  });

  test('cottage plays all transition sounds including creek', async ({ page }) => {
    try {
      // Track fetched audio URLs and BufferSource.start() calls
      await page.addInitScript(() => {
        window.__cottageAudio = { fetchedUrls: [], startedBuffers: [] };

        const origFetch = window.fetch;
        window.fetch = function (url, ...args) {
          if (typeof url === 'string' && (url.includes('.mp3') || url.includes('.wav'))) {
            window.__cottageAudio.fetchedUrls.push(url);
          }
          return origFetch.call(this, url, ...args);
        };

        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          const origDecode = AC.prototype.decodeAudioData;
          AC.prototype.decodeAudioData = function (buf, ...args) {
            return origDecode.apply(this, [buf, ...args]);
          };

          const origCreate = AC.prototype.createBufferSource;
          AC.prototype.createBufferSource = function () {
            const src = origCreate.call(this);
            const origStart = src.start.bind(src);
            src.start = function (...a) {
              window.__cottageAudio.startedBuffers.push({
                duration: src.buffer?.duration,
                loop: src.loop,
                timestamp: Date.now(),
              });
              return origStart(...a);
            };
            return src;
          };
        }
      });

      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await loginAsTestUser(page);
      await page.reload({ waitUntil: 'load' });

      await enterLocation(page, 'the_cottage');

      // Wait for transition sounds + scene audio to fully load
      await page.waitForTimeout(6000);

      const audio = await page.evaluate(() => window.__cottageAudio);

      // Check transition sounds were fetched
      const fetchedCreek = audio.fetchedUrls.some((u) => u.includes('creek'));
      const fetchedSparkle = audio.fetchedUrls.some((u) => u.includes('sparkle'));
      const fetchedBirds = audio.fetchedUrls.some((u) => u.includes('birds'));

      // Check scene audio was fetched
      const fetchedCottageAmbient = audio.fetchedUrls.some((u) =>
        u.includes('cottage-ambient')
      );
      const fetchedFireplace = audio.fetchedUrls.some((u) => u.includes('fireplace'));

      expect(
        fetchedCreek,
        `creek.mp3 was not fetched. Fetched URLs: ${audio.fetchedUrls.join(', ')}`
      ).toBe(true);

      expect(
        fetchedSparkle,
        `sparkle.mp3 was not fetched. Fetched URLs: ${audio.fetchedUrls.join(', ')}`
      ).toBe(true);

      expect(
        fetchedBirds,
        `birds.mp3 was not fetched. Fetched URLs: ${audio.fetchedUrls.join(', ')}`
      ).toBe(true);

      expect(
        fetchedCottageAmbient,
        `cottage-ambient.mp3 was not fetched. Fetched URLs: ${audio.fetchedUrls.join(', ')}`
      ).toBe(true);

      expect(
        fetchedFireplace,
        `fireplace.mp3 was not fetched. Fetched URLs: ${audio.fetchedUrls.join(', ')}`
      ).toBe(true);

      // Check that scene audio (looping) is actually playing
      const loopingSources = audio.startedBuffers.filter((s) => s.loop);
      expect(
        loopingSources.length,
        `Expected at least 2 looping sources (cottage music + fireplace ambient) ` +
          `but found ${loopingSources.length}. ` +
          `All started buffers: ${JSON.stringify(audio.startedBuffers)}`
      ).toBeGreaterThanOrEqual(2);

      // Check that transition sounds (one-shot, non-looping) played
      const oneShotSources = audio.startedBuffers.filter((s) => !s.loop);
      expect(
        oneShotSources.length,
        `Expected at least 3 one-shot transition sounds (sparkle, birds, creek) ` +
          `but found ${oneShotSources.length}. ` +
          `All started buffers: ${JSON.stringify(audio.startedBuffers)}`
      ).toBeGreaterThanOrEqual(3);
    } catch (e) {
      await bug.report({
        title: 'Cottage audio incomplete — missing transition or scene sounds',
        steps: 'Enter The Cottage from the map, listen for transition sounds and scene music',
        expected:
          'Transition plays sparkle + birds + creek; scene plays cottage-ambient + fireplace',
        actual: e.message,
        priority: 'high',
      });
      throw e;
    }
  });

  test('audio buffer cache is cleared when leaving a location', async ({ page }) => {
    test.setTimeout(60000);
    try {
      // Track ALL audio fetches from the start
      await page.addInitScript(() => {
        window.__audioFetches = [];
        const origFetch = window.fetch;
        window.fetch = function (url, ...args) {
          if (typeof url === 'string' && url.includes('.mp3')) {
            window.__audioFetches.push({ url, timestamp: Date.now() });
          }
          return origFetch.call(this, url, ...args);
        };
      });

      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await loginAsTestUser(page);
      await page.reload({ waitUntil: 'load' });

      // Enter Dragon's Hollow (has tavern-music + tavern-ambient scene audio)
      await enterLocation(page, 'dragons_hollow');
      await page.waitForTimeout(4000);

      // Record how many fetches happened for the first visit
      const firstVisitFetches = await page.evaluate(() =>
        window.__audioFetches.filter(
          (f) => f.url.includes('tavern-music') || f.url.includes('tavern-ambient')
        ).length
      );

      expect(
        firstVisitFetches,
        'Scene audio files should have been fetched on first visit'
      ).toBeGreaterThan(0);

      // Leave to map — this should trigger clearBufferCache via SceneAudio cleanup
      await leaveToMap(page);
      await page.waitForTimeout(1000);

      // Clear the fetch tracker so we can isolate second-visit fetches
      await page.evaluate(() => { window.__audioFetches = []; });

      // Re-enter Dragon's Hollow
      await enterLocation(page, 'dragons_hollow');
      await page.waitForTimeout(4000);

      const secondVisitFetches = await page.evaluate(() =>
        window.__audioFetches.filter(
          (f) => f.url.includes('tavern-music') || f.url.includes('tavern-ambient')
        )
      );

      // If the cache was cleared, these files must be re-fetched
      const refetchedMusic = secondVisitFetches.some((f) => f.url.includes('tavern-music'));
      const refetchedAmbient = secondVisitFetches.some((f) => f.url.includes('tavern-ambient'));

      expect(
        refetchedMusic,
        `tavern-music.mp3 was NOT re-fetched on second visit — buffer cache ` +
          `was not cleared when leaving. Second visit fetches: ` +
          `${secondVisitFetches.map((f) => f.url).join(', ') || '(none)'}`
      ).toBe(true);

      expect(
        refetchedAmbient,
        `tavern-ambient.mp3 was NOT re-fetched on second visit — buffer cache ` +
          `was not cleared when leaving. Second visit fetches: ` +
          `${secondVisitFetches.map((f) => f.url).join(', ') || '(none)'}`
      ).toBe(true);
    } catch (e) {
      await bug.report({
        title: 'Audio buffers not freed when leaving location',
        steps:
          'Enter Dragon\'s Hollow, leave to map, re-enter Dragon\'s Hollow. ' +
          'On re-entry, audio should be re-fetched (proving cache was cleared).',
        expected:
          'Buffer cache is cleared on location exit; re-entering requires re-fetch',
        actual: e.message,
        priority: 'high',
      });
      throw e;
    }
  });
});

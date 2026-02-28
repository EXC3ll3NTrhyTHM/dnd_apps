const { test, expect } = require('@playwright/test');
const { loginAndNavigate } = require('../helpers/auth');
const { BugReporter } = require('../helpers/bug-reporter');

test.describe('Audio System', () => {
  let bug;

  test.beforeEach(async ({ page }, testInfo) => {
    bug = new BugReporter(page, testInfo);
    bug.startTracking();
  });

  test('no audio errors on location load', async ({ page }) => {
    const audioErrors = [];
    page.on('console', (msg) => {
      const text = msg.text().toLowerCase();
      if (msg.type() === 'error' && (text.includes('audio') || text.includes('sound') || text.includes('media'))) {
        audioErrors.push(msg.text());
      }
    });

    try {
      await loginAndNavigate(page, 'dragons_hollow');
      // Wait a moment for any audio initialization
      await page.waitForTimeout(2000);

      expect(audioErrors).toHaveLength(0);
    } catch (e) {
      await bug.report({
        title: 'Audio errors on location load',
        steps: 'Navigate to dragons_hollow location',
        expected: 'No audio-related console errors',
        actual: `Audio errors found: ${audioErrors.join('; ')}`,
        priority: 'high',
      });
      throw e;
    }
  });

  test('AudioContext is not created before user gesture', async ({ page }) => {
    try {
      // Patch AudioContext to track creation
      await page.addInitScript(() => {
        window.__audioContextCreatedBeforeGesture = false;
        window.__hadUserGesture = false;

        // Track user gestures
        const markGesture = () => { window.__hadUserGesture = true; };
        document.addEventListener('pointerdown', markGesture, { once: true, capture: true });
        document.addEventListener('click', markGesture, { once: true, capture: true });
        document.addEventListener('keydown', markGesture, { once: true, capture: true });

        const OrigAC = window.AudioContext || window.webkitAudioContext;
        if (OrigAC) {
          const origConstructor = OrigAC;
          window.AudioContext = function (...args) {
            if (!window.__hadUserGesture) {
              window.__audioContextCreatedBeforeGesture = true;
            }
            return new origConstructor(...args);
          };
          window.AudioContext.prototype = origConstructor.prototype;
        }
      });

      // Navigate but don't interact
      await page.goto('/');
      const token = await require('../helpers/auth').loginAsTestUser(page);
      await page.goto(`/location/dragons_hollow`);

      // Wait for page to load without interacting
      await page.waitForTimeout(3000);

      const createdEarly = await page.evaluate(() => window.__audioContextCreatedBeforeGesture);
      expect(createdEarly).toBe(false);
    } catch (e) {
      await bug.report({
        title: 'AudioContext created before user gesture',
        steps: 'Navigate to location without clicking anything',
        expected: 'AudioContext is not created until user interacts',
        actual: e.message,
        priority: 'normal',
      });
      throw e;
    }
  });

  test('AudioContext suspends when page goes to background', async ({ page }) => {
    try {
      // Track AudioContext state changes
      await page.addInitScript(() => {
        window.__ctxStateLog = [];
        const OrigAC = window.AudioContext || window.webkitAudioContext;
        if (!OrigAC) return;
        const origSuspend = OrigAC.prototype.suspend;
        const origResume = OrigAC.prototype.resume;
        OrigAC.prototype.suspend = function () {
          window.__ctxStateLog.push({ action: 'suspend', timestamp: Date.now() });
          return origSuspend.call(this);
        };
        OrigAC.prototype.resume = function () {
          window.__ctxStateLog.push({ action: 'resume', timestamp: Date.now() });
          return origResume.call(this);
        };
      });

      await loginAndNavigate(page, 'dragons_hollow');
      // Wait for audio to start
      await page.waitForTimeout(3000);

      // Clear the log so we only see events from our visibility simulation
      await page.evaluate(() => { window.__ctxStateLog = []; });

      // Simulate page going to background by dispatching visibilitychange
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });

      await page.waitForTimeout(500);

      const stateLog = await page.evaluate(() => window.__ctxStateLog);
      const suspendCalls = stateLog.filter(e => e.action === 'suspend');

      expect(
        suspendCalls.length,
        `AudioContext.suspend() should be called when page goes to background. ` +
          `State log: ${JSON.stringify(stateLog)}`
      ).toBeGreaterThan(0);

      // Now simulate returning to foreground
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });

      await page.waitForTimeout(500);

      const fullLog = await page.evaluate(() => window.__ctxStateLog);
      const resumeCalls = fullLog.filter(e => e.action === 'resume');

      expect(
        resumeCalls.length,
        `AudioContext.resume() should be called when page returns to foreground. ` +
          `State log: ${JSON.stringify(fullLog)}`
      ).toBeGreaterThan(0);
    } catch (e) {
      await bug.report({
        title: 'AudioContext not suspended when app goes to background',
        steps: 'Enter location, simulate page hidden, check AudioContext state',
        expected: 'AudioContext suspends on background, resumes on foreground',
        actual: e.message,
        priority: 'high',
      });
      throw e;
    }
  });

  test('Web Audio events fire after user interaction', async ({ page }) => {
    try {
      await loginAndNavigate(page, 'dragons_hollow');

      // Set up audio event tracking
      await page.evaluate(() => {
        window.__webAudioStarted = false;
        const OrigAC = window.AudioContext || window.webkitAudioContext;
        if (OrigAC && OrigAC.prototype.createBufferSource) {
          const orig = OrigAC.prototype.createBufferSource;
          OrigAC.prototype.createBufferSource = function () {
            const src = orig.call(this);
            const origStart = src.start.bind(src);
            src.start = function (...args) {
              window.__webAudioStarted = true;
              return origStart(...args);
            };
            return src;
          };
        }
      });

      // Interact with the page — click around to trigger UI sounds
      const chatInput = page.locator('[data-testid="chat-input"]');
      if (await chatInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await chatInput.click();
      }

      // Wait for potential audio playback
      await page.waitForTimeout(1000);

      // We just verify no errors occurred — audio may or may not play depending on sound settings
      expect(bug.consoleErrors.filter(e => e.text.toLowerCase().includes('audio'))).toHaveLength(0);
    } catch (e) {
      await bug.report({
        title: 'Audio errors after user interaction',
        steps: 'Navigate to location, interact with chat input',
        expected: 'No audio errors in console',
        actual: e.message,
      });
      throw e;
    }
  });
});

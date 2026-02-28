/**
 * Bug Reporter — captures test failures as structured JSON for AI fix pipeline.
 *
 * Usage inside a test:
 *   const bug = new BugReporter(page, testInfo);
 *   bug.startTracking();
 *   // ... test steps ...
 *   // On failure (in afterEach or catch):
 *   await bug.report({ title, steps, expected, actual });
 */

const fs = require('fs');
const path = require('path');

const BUGS_DIR = path.resolve(__dirname, '..', 'bugs');
const SCREENSHOTS_DIR = path.join(BUGS_DIR, 'screenshots');

// Map keywords → real source files
const FILE_MAP = {
  dice: ['client/src/components/DiceOverlay.jsx', 'client/src/components/DicePanel.jsx'],
  arena: ['client/src/pages/Arena.jsx'],
  battle: ['client/src/pages/Arena.jsx'],
  combat: ['client/src/pages/Arena.jsx'],
  audio: ['client/src/hooks/useUiSounds.js', 'client/src/hooks/useArenaSounds.js', 'client/src/lib/sceneAudioEngine.js'],
  sound: ['client/src/hooks/useUiSounds.js', 'client/src/hooks/useArenaSounds.js', 'client/src/lib/sceneAudioEngine.js'],
  chat: ['client/src/pages/LocationChat.jsx'],
  message: ['client/src/pages/LocationChat.jsx'],
  keyboard: ['client/src/components/CustomKeyboard.jsx', 'client/src/components/ChatInputCustom.jsx'],
  input: ['client/src/components/CustomKeyboard.jsx', 'client/src/components/ChatInputCustom.jsx'],
  mention: ['client/src/components/MentionPopup.jsx'],
  reaction: ['client/src/components/EmojiReactionBar.jsx'],
  shop: ['server/routes/shop.js', 'server/lib/economy.js'],
  inventory: ['server/routes/shop.js', 'server/lib/economy.js'],
  fishing: ['client/src/components/FishingOverlay.jsx', 'server/lib/fishing.js'],
  profile: ['client/src/pages/Profile.jsx'],
  auth: ['server/routes/auth.js', 'test/helpers/auth.js'],
  scene: ['client/src/lib/sceneAudioEngine.js', 'client/src/pages/scenes/SceneAudio.jsx'],
  level: ['client/src/components/LevelUpOverlay.jsx', 'server/lib/xp.js'],
  xp: ['server/lib/xp.js'],
  encounter: ['server/lib/encounters.js', 'server/routes/encounters.js'],
  summon: ['client/src/components/SummonEffect.jsx'],
  location: ['client/src/pages/LocationChat.jsx', 'server/routes/locations.js'],
  transition: ['client/src/components/LocationTransition.jsx', 'client/src/pages/Map.jsx'],
};

class BugReporter {
  constructor(page, testInfo) {
    this.page = page;
    this.testInfo = testInfo;
    this.consoleErrors = [];
    this.networkErrors = [];
    this.audioEvents = [];
    this._tracking = false;
  }

  startTracking() {
    if (this._tracking) return;
    this._tracking = true;

    // Console errors
    this.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        this.consoleErrors.push({
          text: msg.text(),
          location: msg.location(),
          timestamp: Date.now(),
        });
      }
    });

    // Uncaught exceptions
    this.page.on('pageerror', (err) => {
      this.consoleErrors.push({
        text: `UNCAUGHT: ${err.message}`,
        stack: err.stack,
        timestamp: Date.now(),
      });
    });

    // Network failures
    this.page.on('requestfailed', (req) => {
      this.networkErrors.push({
        url: req.url(),
        method: req.method(),
        failure: req.failure()?.errorText || 'unknown',
        timestamp: Date.now(),
      });
    });

    // Patch audio tracking (both HTMLAudioElement and Web Audio API)
    this.page.addInitScript(() => {
      window.__audioEvents = [];

      // Track HTMLAudioElement.play (scene audio)
      const origPlay = HTMLAudioElement.prototype.play;
      HTMLAudioElement.prototype.play = function () {
        window.__audioEvents.push({
          type: 'html-audio-play',
          src: this.src,
          timestamp: Date.now(),
        });
        return origPlay.call(this);
      };

      // Track Web Audio API (UI/arena/dice sounds)
      const OrigAudioContext = window.AudioContext || window.webkitAudioContext;
      if (OrigAudioContext) {
        const origCreateBufferSource = OrigAudioContext.prototype.createBufferSource;
        OrigAudioContext.prototype.createBufferSource = function () {
          const source = origCreateBufferSource.call(this);
          const origStart = source.start.bind(source);
          source.start = function (...args) {
            window.__audioEvents.push({
              type: 'web-audio-buffer-start',
              state: source.context.state,
              timestamp: Date.now(),
            });
            return origStart(...args);
          };
          return source;
        };
      }
    });
  }

  /**
   * Infer which source files are likely involved based on keywords in the title/steps.
   */
  inferSuspectedFiles(title, steps) {
    const text = `${title} ${steps}`.toLowerCase();
    const files = new Set();
    for (const [keyword, paths] of Object.entries(FILE_MAP)) {
      if (text.includes(keyword)) {
        paths.forEach((p) => files.add(p));
      }
    }
    return [...files];
  }

  /**
   * Generate and save a structured bug report.
   */
  async report({ title, steps, expected, actual, priority = 'normal' }) {
    // Take screenshot
    let screenshotFile = null;
    try {
      const slug = title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 50);
      screenshotFile = `${slug}-${Date.now()}.png`;
      fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
      await this.page.screenshot({
        path: path.join(SCREENSHOTS_DIR, screenshotFile),
        fullPage: true,
      });
    } catch {
      screenshotFile = null;
    }

    // Collect audio events from page
    let audioEvents = [];
    try {
      audioEvents = await this.page.evaluate(() => window.__audioEvents || []);
    } catch {
      // page may have navigated away
    }

    // Get page URL
    let pageUrl = '';
    try {
      pageUrl = this.page.url();
    } catch {
      // ignore
    }

    const suspectedFiles = this.inferSuspectedFiles(title, steps);

    const bugReport = {
      id: `bug-${Date.now()}`,
      title,
      priority,
      testFile: this.testInfo?.titlePath?.[0] || 'unknown',
      testName: this.testInfo?.title || 'unknown',
      timestamp: new Date().toISOString(),
      pageUrl,
      failure: {
        steps,
        expected,
        actual,
      },
      diagnostics: {
        consoleErrors: this.consoleErrors,
        networkErrors: this.networkErrors,
        audioEvents,
        screenshot: screenshotFile,
      },
      suspectedFiles,
      forAgent: {
        task: [
          `Fix bug: ${title}`,
          '',
          `## Steps to reproduce`,
          steps,
          '',
          `## Expected`,
          expected,
          '',
          `## Actual`,
          actual,
          '',
          suspectedFiles.length
            ? `## Suspected files\n${suspectedFiles.map((f) => `- ${f}`).join('\n')}`
            : '',
          '',
          this.consoleErrors.length
            ? `## Console errors\n${this.consoleErrors.map((e) => `- ${e.text}`).join('\n')}`
            : '',
          '',
          `## Test file: ${this.testInfo?.titlePath?.[0] || 'unknown'}`,
          `Re-run with: npx playwright test --grep "${this.testInfo?.title || title}"`,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    };

    // Write bug report
    fs.mkdirSync(BUGS_DIR, { recursive: true });
    const filename = `${bugReport.id}.json`;
    fs.writeFileSync(path.join(BUGS_DIR, filename), JSON.stringify(bugReport, null, 2));

    return bugReport;
  }
}

module.exports = { BugReporter };

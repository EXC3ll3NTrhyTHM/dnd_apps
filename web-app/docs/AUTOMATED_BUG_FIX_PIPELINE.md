# Automated Bug Detection → AI Fix Pipeline

*Playwright tests detect bugs, generate structured reports, and AI resolves them automatically.*

---

## Overview

```
┌─────────────────────────────────────────────────────┐
│  1. PLAYWRIGHT + CUSTOM REPORTER                    │
│     Reliable automation + detailed failure logs     │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│  2. BUG REPORTER                                    │
│     Generates structured JSON with context          │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│  3. AI FIX SCRIPT                                   │
│     Feeds bugs to Claude Code → verifies fix        │
└─────────────────────────────────────────────────────┘
```

---

## Test Structure

```
test/
├── e2e/
│   ├── auth.spec.js      ← API auth tests
│   ├── shop.spec.js      ← API shop tests
│   ├── smoke.spec.js     ← Health check
│   ├── chat.spec.js      ← Location chat UI tests
│   ├── arena.spec.js     ← Arena combat UI tests
│   ├── keyboard.spec.js  ← Custom keyboard tests
│   ├── audio.spec.js     ← Audio system tests
│   └── dice.spec.js      ← Dice system + memory tests
├── bugs/                 ← Bug reports (generated on test failure)
│   └── fixed/            ← Archive of resolved bugs
├── logs/                 ← Scheduled run logs
├── fixtures/             ← Test data (players, monsters, etc.)
├── helpers/
│   ├── auth.js           ← Auth token + loginAndNavigate() helper
│   └── bug-reporter.js   ← Structured JSON bug report generator
├── setup/                ← Test server startup
└── screenshots/          ← Failure screenshots
scripts/
├── fix-bugs.js           ← AI auto-fix pipeline (feeds bugs to Claude)
└── run-tests-scheduled.js ← Scheduled runner (build + test + log)
```

---

## Implementation

### Step 1: UI Auth Helper (login via UI)

```js
// test/helpers/ui-auth.js
async function loginAsTestUser(page) {
  await page.goto('/');
  // Your login flow
  await page.fill('[data-testid="username"]', 'testhero');
  await page.click('[data-testid="login-btn"]');
  await page.waitForURL(/\/(map|home)/);
}

module.exports = { loginAsTestUser };
```

### Step 2: Bug Reporter (Enhanced)

Every test uses this reporter to capture comprehensive diagnostics for AI:

```js
// test/helpers/bug-reporter.js
const fs = require('fs');
const path = require('path');

class BugReporter {
  constructor(testInfo) {
    this.testInfo = testInfo;
    this.consoleLogs = [];
    this.memorySnapshots = [];
    this.networkRequests = [];
    this.audioEvents = [];
    this.domSnapshots = [];
    this.startTime = Date.now();
  }

  attachToPage(page) {
    // Capture ALL console output
    page.on('console', msg => {
      this.consoleLogs.push({
        type: msg.type(),
        text: msg.text(),
        location: msg.location(),
        timestamp: Date.now()
      });
    });

    // Capture errors
    page.on('pageerror', error => {
      this.consoleLogs.push({
        type: 'pageerror',
        text: error.message,
        stack: error.stack,
        timestamp: Date.now()
      });
    });

    // Capture failed network requests
    page.on('requestfailed', request => {
      this.networkRequests.push({
        url: request.url(),
        method: request.method(),
        failure: request.failure()?.errorText,
        timestamp: Date.now()
      });
    });

    // Inject audio tracking
    page.addInitScript(() => {
      window.__audioEvents = [];
      window.__audioErrors = [];
      
      const originalPlay = HTMLAudioElement.prototype.play;
      HTMLAudioElement.prototype.play = function() {
        const event = {
          src: this.src,
          time: Date.now(),
          paused: this.paused,
          readyState: this.readyState,
          error: this.error?.message
        };
        window.__audioEvents.push(event);
        
        return originalPlay.call(this).catch(err => {
          window.__audioErrors.push({
            src: this.src,
            error: err.message,
            time: Date.now()
          });
          throw err;
        });
      };
    });
  }

  async captureMemory(page) {
    const memory = await page.evaluate(() => ({
      jsHeap: performance.memory?.usedJSHeapSize,
      totalHeap: performance.memory?.totalJSHeapSize,
      heapLimit: performance.memory?.jsHeapSizeLimit,
      // DOM metrics
      domNodes: document.getElementsByTagName('*').length,
      // Canvas/WebGL (for dice)
      canvasCount: document.querySelectorAll('canvas').length,
      // Audio elements
      audioElements: document.querySelectorAll('audio').length,
      // Images loaded
      imageCount: document.querySelectorAll('img').length
    }));
    
    this.memorySnapshots.push({ 
      ...memory, 
      timestamp: Date.now(),
      label: `snapshot-${this.memorySnapshots.length + 1}`
    });
    return memory;
  }

  async captureAudioState(page) {
    const audioState = await page.evaluate(() => ({
      events: window.__audioEvents || [],
      errors: window.__audioErrors || [],
      currentlyPlaying: Array.from(document.querySelectorAll('audio'))
        .filter(a => !a.paused)
        .map(a => ({ src: a.src, currentTime: a.currentTime }))
    }));
    this.audioEvents = audioState;
    return audioState;
  }

  async captureDOMSnapshot(page, selector = 'body') {
    const snapshot = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return {
        html: el?.innerHTML?.substring(0, 5000), // First 5k chars
        classes: el?.className,
        childCount: el?.children?.length
      };
    }, selector);
    
    this.domSnapshots.push({
      selector,
      snapshot,
      timestamp: Date.now()
    });
    return snapshot;
  }

  async generateReport(failure, page) {
    // Final memory capture
    await this.captureMemory(page);
    await this.captureAudioState(page);
    
    // Take screenshot
    const screenshotPath = `bugs/screenshots/bug-${Date.now()}.png`;
    const screenshotDir = path.join(__dirname, '../../bugs/screenshots');
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: path.join(__dirname, '../..', screenshotPath), fullPage: true });

    // Calculate memory delta if we have snapshots
    let memoryDelta = null;
    if (this.memorySnapshots.length >= 2) {
      const first = this.memorySnapshots[0];
      const last = this.memorySnapshots[this.memorySnapshots.length - 1];
      memoryDelta = {
        jsHeapGrowth: last.jsHeap - first.jsHeap,
        domNodeGrowth: last.domNodes - first.domNodes,
        canvasGrowth: last.canvasCount - first.canvasCount,
        timeElapsed: last.timestamp - first.timestamp
      };
    }

    const report = {
      id: `bug-${Date.now()}`,
      test: this.testInfo.title,
      file: this.testInfo.file,
      timestamp: new Date().toISOString(),
      duration: Date.now() - this.startTime,
      
      failure: {
        message: failure.message,
        stack: failure.stack
      },
      
      evidence: {
        // All console logs (not just errors - context matters)
        consoleLogs: this.consoleLogs,
        consoleErrors: this.consoleLogs.filter(l => 
          l.type === 'error' || l.type === 'pageerror'
        ),
        
        // Memory analysis
        memorySnapshots: this.memorySnapshots,
        memoryDelta,
        
        // Network failures
        networkFailures: this.networkRequests,
        
        // Audio state (critical for iOS bugs)
        audioEvents: this.audioEvents,
        
        // DOM snapshots
        domSnapshots: this.domSnapshots,
        
        // Final state
        url: page.url(),
        screenshot: screenshotPath
      },
      
      codeContext: {
        suspectedFiles: this.inferSuspectedFiles(failure),
        category: this.inferCategory(failure)
      },
      
      // Pre-formatted task for AI agent
      forAgent: {
        task: this.generateAgentTask(failure),
        priority: this.inferPriority(failure),
        hints: this.generateHints(failure)
      }
    };

    const bugDir = path.join(__dirname, '../../bugs');
    if (!fs.existsSync(bugDir)) fs.mkdirSync(bugDir, { recursive: true });
    
    const filePath = path.join(bugDir, `${report.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
    
    console.log(`\n🐛 Bug report saved: ${filePath}`);
    return report;
  }

  generateAgentTask(failure) {
    const errors = this.consoleLogs
      .filter(l => l.type === 'error' || l.type === 'pageerror')
      .map(l => l.text)
      .join('\n');
    
    const audioIssues = this.audioEvents?.errors?.length > 0
      ? `\nAudio errors: ${this.audioEvents.errors.map(e => e.error).join(', ')}`
      : '';
    
    const memoryIssue = this.memorySnapshots.length >= 2 &&
      (this.memorySnapshots[this.memorySnapshots.length - 1].jsHeap - this.memorySnapshots[0].jsHeap) > 10 * 1024 * 1024
      ? '\nPossible memory leak detected (>10MB growth)'
      : '';

    return `Fix the bug in test "${this.testInfo.title}".

Error: ${failure.message}

Console errors:
${errors || '(none)'}
${audioIssues}${memoryIssue}

Steps:
1. Read the suspected files listed in codeContext
2. Check the console logs for clues
3. Fix the issue
4. Re-run: npx playwright test --grep "${this.testInfo.title}"
5. Verify fix resolves the issue`;
  }

  generateHints(failure) {
    const hints = [];
    
    if (failure.message.includes('audio') || this.audioEvents?.errors?.length > 0) {
      hints.push('iOS requires user interaction before audio.play() - check if gesture handler exists');
      hints.push('Check visibility API handling for tab switches');
    }
    
    if (failure.message.includes('mention') || failure.message.includes('@')) {
      hints.push('iPhone keyboard may not trigger input events correctly');
      hints.push('Check if insertText or inputType events are handled');
    }
    
    if (failure.message.includes('memory') || failure.message.includes('heap')) {
      hints.push('Check for event listener cleanup in useEffect returns');
      hints.push('Verify WebGL textures are disposed (dice-box)');
    }
    
    if (failure.message.includes('gif') || failure.message.includes('image')) {
      hints.push('Check if blob URLs are being revoked after use');
      hints.push('Verify image onload handlers clean up');
    }
    
    return hints;
  }

  inferSuspectedFiles(failure) {
    const files = [];
    const msg = failure.message.toLowerCase();
    
    if (msg.includes('dice')) files.push('client/src/components/DiceOverlay.jsx');
    if (msg.includes('arena') || msg.includes('battle') || msg.includes('combat')) files.push('client/src/pages/Arena.jsx');
    if (msg.includes('audio') || msg.includes('music') || msg.includes('sound')) files.push('client/src/hooks/useAudio.js', 'client/src/components/AudioManager.jsx');
    if (msg.includes('chat') || msg.includes('message')) files.push('client/src/components/Chat.jsx', 'client/src/pages/Location.jsx');
    if (msg.includes('keyboard') || msg.includes('input')) files.push('client/src/components/CustomKeyboard.jsx');
    if (msg.includes('mention') || msg.includes('@')) files.push('client/src/components/MentionAutocomplete.jsx');
    if (msg.includes('gif')) files.push('client/src/components/GifPicker.jsx');
    if (msg.includes('reaction')) files.push('client/src/components/MessageReactions.jsx');
    if (msg.includes('emote')) files.push('client/src/components/EmotePicker.jsx');
    
    return files.length > 0 ? files : ['(unable to infer - check stack trace)'];
  }

  inferCategory(failure) {
    const msg = failure.message.toLowerCase();
    if (msg.includes('audio') || msg.includes('music')) return 'audio';
    if (msg.includes('dice')) return 'dice';
    if (msg.includes('memory') || msg.includes('heap')) return 'performance';
    if (msg.includes('chat') || msg.includes('message')) return 'chat';
    if (msg.includes('keyboard') || msg.includes('input')) return 'input';
    return 'general';
  }

  inferPriority(failure) {
    const msg = failure.message.toLowerCase();
    if (msg.includes('crash') || msg.includes('fatal')) return 'critical';
    if (msg.includes('memory') || msg.includes('audio')) return 'high';
    if (msg.includes('ui') || msg.includes('display')) return 'medium';
    return 'normal';
  }
}

module.exports = { BugReporter };
```

### Using the Reporter (Required Pattern)

**Every test MUST follow this pattern:**

```js
test('example test', async ({ page }, testInfo) => {
  // 1. Create reporter
  const reporter = new BugReporter(testInfo);
  reporter.attachToPage(page);

  // 2. Capture initial memory baseline
  await reporter.captureMemory(page);

  // 3. Do your test actions...
  await page.goto('/somewhere');
  await page.click('[data-testid="something"]');

  // 4. Capture memory at key points
  await reporter.captureMemory(page);

  // 5. Wrap assertions in try/catch to generate report on failure
  try {
    await expect(something).toBeVisible();
  } catch (error) {
    await reporter.generateReport(error, page);
    throw error;
  }
});
```

### Step 2.5: Instrumentation (Add Logs to Your Code)

The BugReporter captures logs, but your code needs to actually *emit* them. Add this debug logger and sprinkle it throughout key components:

```js
// client/src/utils/debug.js

const DEBUG = process.env.NODE_ENV !== 'production' || localStorage.getItem('debug') === 'true';

const COLORS = {
  audio: '#ff6b6b',
  dice: '#4ecdc4', 
  chat: '#45b7d1',
  keyboard: '#96ceb4',
  network: '#ffeaa7',
  memory: '#dfe6e9',
  state: '#a29bfe'
};

function createLogger(namespace) {
  const color = COLORS[namespace] || '#888';
  
  return {
    log: (...args) => {
      if (!DEBUG) return;
      console.log(`%c[${namespace.toUpperCase()}]`, `color: ${color}; font-weight: bold`, ...args);
    },
    
    warn: (...args) => {
      console.warn(`[${namespace.toUpperCase()}]`, ...args);
    },
    
    error: (...args) => {
      console.error(`[${namespace.toUpperCase()}]`, ...args);
    },
    
    // For state changes - always useful for debugging
    state: (label, value) => {
      if (!DEBUG) return;
      console.log(`%c[${namespace.toUpperCase()}] ${label}:`, `color: ${color}`, value);
    },
    
    // Timing helper
    time: (label) => {
      if (!DEBUG) return { end: () => {} };
      const start = performance.now();
      return {
        end: () => {
          const duration = (performance.now() - start).toFixed(2);
          console.log(`%c[${namespace.toUpperCase()}] ${label}: ${duration}ms`, `color: ${color}`);
        }
      };
    }
  };
}

export const audioLog = createLogger('audio');
export const diceLog = createLogger('dice');
export const chatLog = createLogger('chat');
export const keyboardLog = createLogger('keyboard');
export const networkLog = createLogger('network');
export const memoryLog = createLogger('memory');
export const stateLog = createLogger('state');

export default createLogger;
```

---

#### Audio Instrumentation

```jsx
// In your audio hook/component
import { audioLog } from '../utils/debug';

function useAudio() {
  const playAudio = useCallback((src, options = {}) => {
    audioLog.log('play requested', { src, options });
    
    const audio = new Audio(src);
    
    audio.addEventListener('canplay', () => {
      audioLog.log('canplay', { src, readyState: audio.readyState });
    });
    
    audio.addEventListener('play', () => {
      audioLog.log('playing', { src, currentTime: audio.currentTime });
    });
    
    audio.addEventListener('error', (e) => {
      audioLog.error('playback failed', { 
        src, 
        error: audio.error?.message,
        code: audio.error?.code 
      });
    });
    
    audio.addEventListener('ended', () => {
      audioLog.log('ended', { src });
    });

    // iOS requires user gesture
    const playPromise = audio.play();
    
    if (playPromise) {
      playPromise
        .then(() => audioLog.log('play() resolved', { src }))
        .catch(err => {
          audioLog.error('play() rejected', { 
            src, 
            error: err.message,
            name: err.name  // 'NotAllowedError' = iOS gesture issue
          });
        });
    }
    
    return audio;
  }, []);

  // Visibility change handling
  useEffect(() => {
    const handleVisibility = () => {
      audioLog.log('visibility changed', { 
        hidden: document.hidden,
        state: document.visibilityState 
      });
      
      if (!document.hidden) {
        audioLog.log('attempting audio resume');
        // Resume logic...
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);
}
```

---

#### Dice Instrumentation

```jsx
// In DiceOverlay.jsx
import { diceLog, memoryLog } from '../utils/debug';

function DiceOverlay({ notation, onResult }) {
  const boxRef = useRef(null);

  useEffect(() => {
    diceLog.log('init', { notation });
    
    const timer = diceLog.time('dicebox-init');
    
    const box = new DiceBox('#dice-canvas', {
      // config...
    });
    
    box.init().then(() => {
      timer.end();
      diceLog.log('ready', { 
        textures: box.renderer?.info?.memory?.textures 
      });
    });
    
    boxRef.current = box;
    
    return () => {
      diceLog.log('cleanup starting');
      
      // Log memory before cleanup
      memoryLog.state('pre-cleanup textures', box.renderer?.info?.memory?.textures);
      
      box.clear();
      
      // Log memory after cleanup  
      setTimeout(() => {
        memoryLog.state('post-cleanup textures', box.renderer?.info?.memory?.textures);
      }, 100);
      
      diceLog.log('cleanup complete');
    };
  }, []);

  const roll = useCallback(async (notation) => {
    const timer = diceLog.time('roll');
    diceLog.log('roll started', { notation });
    
    try {
      const results = await boxRef.current.roll(notation);
      timer.end();
      
      diceLog.log('roll complete', { 
        notation,
        results,
        total: results.total 
      });
      
      return results;
    } catch (err) {
      diceLog.error('roll failed', { notation, error: err.message });
      throw err;
    }
  }, []);

  const onRollComplete = useCallback((results) => {
    diceLog.log('onRollComplete fired', { 
      results,
      hasTotal: results?.total !== undefined 
    });
    
    if (!results || results.total === undefined) {
      diceLog.error('invalid results object', { results });
    }
    
    onResult?.(results);
  }, [onResult]);
}
```

---

#### Chat Instrumentation

```jsx
// In Chat.jsx or messaging hook
import { chatLog } from '../utils/debug';

function useChat(channelId) {
  const sendMessage = useCallback(async (content, options = {}) => {
    chatLog.log('send', { 
      channelId, 
      contentLength: content.length,
      hasMedia: !!options.media,
      mediaType: options.media?.type 
    });

    try {
      const response = await api.post('/messages', { content, ...options });
      chatLog.log('sent successfully', { messageId: response.id });
      return response;
    } catch (err) {
      chatLog.error('send failed', { error: err.message, content: content.substring(0, 50) });
      throw err;
    }
  }, [channelId]);

  const handleGifSelect = useCallback((gif) => {
    chatLog.log('gif selected', { 
      url: gif.url,
      provider: gif.provider,
      size: gif.size 
    });
  }, []);

  const handleImageUpload = useCallback(async (file) => {
    chatLog.log('image upload started', { 
      name: file.name,
      size: file.size,
      type: file.type 
    });
    
    const timer = chatLog.time('image-upload');
    
    try {
      const result = await uploadImage(file);
      timer.end();
      chatLog.log('image upload complete', { url: result.url });
      return result;
    } catch (err) {
      chatLog.error('image upload failed', { error: err.message });
      throw err;
    }
  }, []);
}
```

---

#### Keyboard/Input Instrumentation

```jsx
// In CustomKeyboard.jsx or input component
import { keyboardLog } from '../utils/debug';

function CustomKeyboard({ inputRef, onInsert }) {
  const handleMentionTrigger = useCallback((char) => {
    keyboardLog.log('mention trigger', { char, cursorPos: inputRef.current?.selectionStart });
  }, []);

  const handleMentionSelect = useCallback((user) => {
    keyboardLog.log('mention selected', { 
      userId: user.id,
      username: user.username 
    });
    
    const input = inputRef.current;
    const before = input.value;
    
    // Insert mention
    onInsert(`@${user.username} `);
    
    const after = input.value;
    keyboardLog.log('mention inserted', { 
      before: before.substring(0, 30),
      after: after.substring(0, 30),
      success: after.includes(`@${user.username}`)
    });
  }, [onInsert]);

  const handleDiceInsert = useCallback((notation) => {
    keyboardLog.log('dice notation insert', { notation });
    onInsert(notation);
  }, [onInsert]);

  // Track input events (critical for iOS debugging)
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const handlers = {
      input: (e) => keyboardLog.log('input event', { 
        inputType: e.inputType,
        data: e.data,
        value: input.value.substring(0, 30)
      }),
      compositionstart: (e) => keyboardLog.log('composition start', { data: e.data }),
      compositionend: (e) => keyboardLog.log('composition end', { data: e.data }),
      beforeinput: (e) => keyboardLog.log('beforeinput', { inputType: e.inputType })
    };

    Object.entries(handlers).forEach(([event, handler]) => {
      input.addEventListener(event, handler);
    });

    return () => {
      Object.entries(handlers).forEach(([event, handler]) => {
        input.removeEventListener(event, handler);
      });
    };
  }, []);
}
```

---

#### Memory Instrumentation (Global)

```jsx
// In App.jsx or a top-level component
import { memoryLog } from '../utils/debug';

function useMemoryMonitor(intervalMs = 30000) {
  useEffect(() => {
    const logMemory = () => {
      if (!performance.memory) return;
      
      memoryLog.state('heap', {
        used: (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + 'MB',
        total: (performance.memory.totalJSHeapSize / 1024 / 1024).toFixed(2) + 'MB',
        limit: (performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2) + 'MB'
      });
      
      memoryLog.state('dom', {
        nodes: document.getElementsByTagName('*').length,
        canvases: document.querySelectorAll('canvas').length,
        images: document.querySelectorAll('img').length,
        audio: document.querySelectorAll('audio').length
      });
    };

    logMemory(); // Initial
    const interval = setInterval(logMemory, intervalMs);
    
    return () => clearInterval(interval);
  }, [intervalMs]);
}

// Use in App.jsx:
function App() {
  useMemoryMonitor(30000); // Log every 30s
  // ...
}
```

---

#### Enabling Debug Mode

```js
// Enable in browser console:
localStorage.setItem('debug', 'true');
location.reload();

// Or via URL param (add to your app init):
if (new URLSearchParams(location.search).has('debug')) {
  localStorage.setItem('debug', 'true');
}

// Disable:
localStorage.removeItem('debug');
```

---

### Step 3: UI Tests

#### Dice System Tests

```js
// test/e2e/dice.spec.js
const { test, expect } = require('@playwright/test');
const { BugReporter } = require('../helpers/bug-reporter');

test.describe('Dice System', () => {
  test('dice roll shows result banner', async ({ page }, testInfo) => {
    const reporter = new BugReporter(testInfo);
    reporter.attachToPage(page);

    await page.goto('/admin'); // or wherever dice preview is
    await reporter.captureMemory(page);

    // Select a colorset
    await page.selectOption('[data-testid="colorset-select"]', 'fire');
    
    // Roll dice
    await page.click('[data-testid="roll-dice-btn"]');
    
    // Wait for result
    const banner = page.locator('.dice-result-banner');
    
    try {
      await expect(banner).toBeVisible({ timeout: 10000 });
      await reporter.captureMemory(page);
    } catch (error) {
      await reporter.generateReport(error, page);
      throw error;
    }
  });

  test('dice memory does not leak after 10 rolls', async ({ page }, testInfo) => {
    const reporter = new BugReporter(testInfo);
    reporter.attachToPage(page);

    await page.goto('/admin');
    const initialMemory = await reporter.captureMemory(page);

    for (let i = 0; i < 10; i++) {
      await page.click('[data-testid="roll-dice-btn"]');
      await page.waitForSelector('.dice-result-banner', { timeout: 10000 });
      await page.waitForTimeout(3000); // Wait for cleanup
    }

    const finalMemory = await reporter.captureMemory(page);
    const memoryGrowth = finalMemory.jsHeap - initialMemory.jsHeap;
    
    // Allow 20MB growth max
    try {
      expect(memoryGrowth).toBeLessThan(20 * 1024 * 1024);
    } catch (error) {
      await reporter.generateReport(error, page);
      throw error;
    }
  });
});
```

#### Audio System Tests (iOS Focus)

iOS has strict audio policies (must be triggered by user interaction, no autoplay). These tests verify audio plays at the right moments.

```js
// test/e2e/audio.spec.js
const { test, expect } = require('@playwright/test');
const { BugReporter } = require('../helpers/bug-reporter');

test.describe('Audio System', () => {
  
  test.beforeEach(async ({ page }) => {
    // Expose audio event tracker
    await page.addInitScript(() => {
      window.__audioEvents = [];
      const originalPlay = HTMLAudioElement.prototype.play;
      HTMLAudioElement.prototype.play = function() {
        window.__audioEvents.push({
          src: this.src,
          time: Date.now(),
          paused: this.paused
        });
        return originalPlay.call(this);
      };
    });
  });

  test('ambient music plays on location enter (after interaction)', async ({ page }, testInfo) => {
    const reporter = new BugReporter(testInfo);
    reporter.attachToPage(page);

    await page.goto('/');
    // Simulate user interaction first (iOS requirement)
    await page.click('[data-testid="enter-app-btn"]');
    
    // Navigate to a location with ambient audio
    await page.click('[data-testid="location-tavern"]');
    
    // Check audio started
    const audioEvents = await page.evaluate(() => window.__audioEvents);
    
    try {
      expect(audioEvents.length).toBeGreaterThan(0);
      expect(audioEvents.some(e => e.src.includes('tavern') || e.src.includes('ambient'))).toBe(true);
    } catch (error) {
      await reporter.generateReport(error, page);
      throw error;
    }
  });

  test('dice roll sound plays on roll', async ({ page }, testInfo) => {
    const reporter = new BugReporter(testInfo);
    reporter.attachToPage(page);

    await page.goto('/admin');
    await page.click('[data-testid="roll-dice-btn"]');
    
    await page.waitForTimeout(2000); // Wait for roll animation
    
    const audioEvents = await page.evaluate(() => window.__audioEvents);
    
    try {
      expect(audioEvents.some(e => 
        e.src.includes('dice') || e.src.includes('roll')
      )).toBe(true);
    } catch (error) {
      await reporter.generateReport(error, page);
      throw error;
    }
  });

  test('battle music plays when combat starts', async ({ page }, testInfo) => {
    const reporter = new BugReporter(testInfo);
    reporter.attachToPage(page);

    await page.goto('/arena');
    
    // Clear previous events
    await page.evaluate(() => window.__audioEvents = []);
    
    await page.click('[data-testid="start-battle-btn"]');
    await page.waitForTimeout(1500);
    
    const audioEvents = await page.evaluate(() => window.__audioEvents);
    
    try {
      expect(audioEvents.some(e => 
        e.src.includes('battle') || e.src.includes('combat') || e.src.includes('arena')
      )).toBe(true);
    } catch (error) {
      await reporter.generateReport(error, page);
      throw error;
    }
  });

  test('audio does not play without user interaction (iOS policy)', async ({ page }, testInfo) => {
    const reporter = new BugReporter(testInfo);
    reporter.attachToPage(page);

    // Navigate directly without clicking
    await page.goto('/tavern');
    
    // Wait a moment
    await page.waitForTimeout(2000);
    
    const audioEvents = await page.evaluate(() => window.__audioEvents);
    
    // On iOS, audio should NOT play without interaction
    try {
      // This test passes if no audio played OR if audio attempted but failed
      // (which is expected iOS behavior)
      expect(audioEvents.filter(e => !e.paused).length).toBe(0);
    } catch (error) {
      await reporter.generateReport(error, page);
      throw error;
    }
  });

  test('audio resumes after tab switch (visibility change)', async ({ page, context }, testInfo) => {
    const reporter = new BugReporter(testInfo);
    reporter.attachToPage(page);

    await page.goto('/tavern');
    await page.click('[data-testid="enter-location-btn"]');
    await page.waitForTimeout(1000);
    
    // Simulate tab switch
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    
    await page.waitForTimeout(500);
    
    // Return to tab
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    
    const audioPlaying = await page.evaluate(() => {
      const audios = document.querySelectorAll('audio');
      return Array.from(audios).some(a => !a.paused);
    });
    
    try {
      expect(audioPlaying).toBe(true);
    } catch (error) {
      await reporter.generateReport(error, page);
      throw error;
    }
  });
});
```

#### Location Chat Tests

```js
// test/e2e/chat.spec.js
const { test, expect } = require('@playwright/test');
const { BugReporter } = require('../helpers/bug-reporter');

test.describe('Location Chat', () => {

  test('can send a text message', async ({ page }, testInfo) => {
    const reporter = new BugReporter(testInfo);
    reporter.attachToPage(page);

    await page.goto('/tavern');
    
    const input = page.locator('[data-testid="chat-input"]');
    await input.fill('Hello from the test!');
    await page.click('[data-testid="send-btn"]');
    
    // Verify message appears in chat
    const message = page.locator('.chat-message:has-text("Hello from the test!")');
    
    try {
      await expect(message).toBeVisible({ timeout: 5000 });
    } catch (error) {
      await reporter.generateReport(error, page);
      throw error;
    }
  });

  test('can send a GIF via picker', async ({ page }, testInfo) => {
    const reporter = new BugReporter(testInfo);
    reporter.attachToPage(page);

    await page.goto('/tavern');
    
    // Open media drawer
    await page.click('[data-testid="media-btn"]');
    
    // Click GIF tab
    await page.click('[data-testid="gif-tab"]');
    
    // Search for a GIF
    await page.fill('[data-testid="gif-search"]', 'thumbs up');
    await page.waitForSelector('[data-testid="gif-result"]', { timeout: 5000 });
    
    // Select first GIF
    await page.click('[data-testid="gif-result"]:first-child');
    
    // Verify GIF appears in chat
    const gifMessage = page.locator('.chat-message img[src*="gif"], .chat-message img[src*="giphy"]');
    
    try {
      await expect(gifMessage).toBeVisible({ timeout: 5000 });
    } catch (error) {
      await reporter.generateReport(error, page);
      throw error;
    }
  });

  test('can upload an image', async ({ page }, testInfo) => {
    const reporter = new BugReporter(testInfo);
    reporter.attachToPage(page);

    await page.goto('/tavern');
    
    // Open media drawer
    await page.click('[data-testid="media-btn"]');
    
    // Upload image
    const fileInput = page.locator('[data-testid="image-upload"]');
    await fileInput.setInputFiles('test/fixtures/test-image.png');
    
    // Wait for upload and message
    const imageMessage = page.locator('.chat-message img.user-upload');
    
    try {
      await expect(imageMessage).toBeVisible({ timeout: 10000 });
    } catch (error) {
      await reporter.generateReport(error, page);
      throw error;
    }
  });
});
```

#### Custom Keyboard Tests

```js
// test/e2e/keyboard.spec.js
const { test, expect } = require('@playwright/test');
const { BugReporter } = require('../helpers/bug-reporter');

test.describe('Custom Keyboard', () => {

  test('dice button inserts dice notation', async ({ page }, testInfo) => {
    const reporter = new BugReporter(testInfo);
    reporter.attachToPage(page);

    await page.goto('/tavern');
    
    // Focus chat input
    await page.click('[data-testid="chat-input"]');
    
    // Open custom keyboard
    await page.click('[data-testid="keyboard-toggle"]');
    
    // Click dice button
    await page.click('[data-testid="kb-dice-btn"]');
    
    // Select d20
    await page.click('[data-testid="dice-d20"]');
    
    const inputValue = await page.locator('[data-testid="chat-input"]').inputValue();
    
    try {
      expect(inputValue).toContain('1d20');
    } catch (error) {
      await reporter.generateReport(error, page);
      throw error;
    }
  });

  test('@mention autocomplete shows players', async ({ page }, testInfo) => {
    const reporter = new BugReporter(testInfo);
    reporter.attachToPage(page);

    await page.goto('/tavern');
    
    const input = page.locator('[data-testid="chat-input"]');
    await input.fill('@');
    
    // Autocomplete popup should appear
    const autocomplete = page.locator('[data-testid="mention-autocomplete"]');
    
    try {
      await expect(autocomplete).toBeVisible({ timeout: 3000 });
      
      // Should have at least one player option
      const options = page.locator('[data-testid="mention-option"]');
      await expect(options.first()).toBeVisible();
    } catch (error) {
      await reporter.generateReport(error, page);
      throw error;
    }
  });

  test('@mention inserts player tag (iPhone bug check)', async ({ page }, testInfo) => {
    const reporter = new BugReporter(testInfo);
    reporter.attachToPage(page);

    await page.goto('/tavern');
    
    const input = page.locator('[data-testid="chat-input"]');
    await input.fill('@');
    
    // Wait for autocomplete
    await page.waitForSelector('[data-testid="mention-option"]', { timeout: 3000 });
    
    // Click first mention option
    await page.click('[data-testid="mention-option"]:first-child');
    
    const inputValue = await input.inputValue();
    
    try {
      // Should have inserted the @mention
      expect(inputValue).toMatch(/@\w+/);
    } catch (error) {
      await reporter.generateReport(error, page);
      throw error;
    }
  });

  test('emote button opens emote picker', async ({ page }, testInfo) => {
    const reporter = new BugReporter(testInfo);
    reporter.attachToPage(page);

    await page.goto('/tavern');
    
    await page.click('[data-testid="chat-input"]');
    await page.click('[data-testid="keyboard-toggle"]');
    await page.click('[data-testid="kb-emote-btn"]');
    
    const emotePicker = page.locator('[data-testid="emote-picker"]');
    
    try {
      await expect(emotePicker).toBeVisible({ timeout: 3000 });
    } catch (error) {
      await reporter.generateReport(error, page);
      throw error;
    }
  });

  test('spell suggestions appear while typing', async ({ page }, testInfo) => {
    const reporter = new BugReporter(testInfo);
    reporter.attachToPage(page);

    await page.goto('/tavern');
    
    const input = page.locator('[data-testid="chat-input"]');
    await input.fill('I cast fireball');
    
    // Spell suggestion should appear
    const suggestion = page.locator('[data-testid="spell-suggestion"]');
    
    try {
      await expect(suggestion).toBeVisible({ timeout: 3000 });
      expect(await suggestion.textContent()).toContain('Fireball');
    } catch (error) {
      await reporter.generateReport(error, page);
      throw error;
    }
  });

  test('quick actions menu opens', async ({ page }, testInfo) => {
    const reporter = new BugReporter(testInfo);
    reporter.attachToPage(page);

    await page.goto('/tavern');
    
    await page.click('[data-testid="quick-actions-btn"]');
    
    const menu = page.locator('[data-testid="quick-actions-menu"]');
    
    try {
      await expect(menu).toBeVisible({ timeout: 2000 });
      
      // Verify expected options exist
      await expect(page.locator('[data-testid="qa-dice"]')).toBeVisible();
      await expect(page.locator('[data-testid="qa-emotes"]')).toBeVisible();
    } catch (error) {
      await reporter.generateReport(error, page);
      throw error;
    }
  });
});
```

#### Reactions Tests

```js
// test/e2e/reactions.spec.js
const { test, expect } = require('@playwright/test');
const { BugReporter } = require('../helpers/bug-reporter');

test.describe('Message Reactions', () => {

  test('can add reaction to message', async ({ page }, testInfo) => {
    const reporter = new BugReporter(testInfo);
    reporter.attachToPage(page);

    await page.goto('/tavern');
    
    // Find a message
    const message = page.locator('.chat-message').first();
    
    // Long press or right-click to open reaction menu
    await message.click({ button: 'right' });
    // Or: await message.dispatchEvent('contextmenu');
    
    const reactionMenu = page.locator('[data-testid="reaction-menu"]');
    
    try {
      await expect(reactionMenu).toBeVisible({ timeout: 2000 });
      
      // Click a reaction emoji
      await page.click('[data-testid="reaction-thumbsup"]');
      
      // Verify reaction appears on message
      const reaction = message.locator('.message-reaction:has-text("👍")');
      await expect(reaction).toBeVisible({ timeout: 2000 });
    } catch (error) {
      await reporter.generateReport(error, page);
      throw error;
    }
  });
});
```

### Step 4: AI Fix Script

```js
// scripts/fix-bugs.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const bugsDir = path.join(__dirname, '../test/bugs');

async function fixBugs() {
  if (!fs.existsSync(bugsDir)) {
    console.log('No bugs directory found.');
    return;
  }

  const bugFiles = fs.readdirSync(bugsDir).filter(f => f.endsWith('.json'));
  
  if (bugFiles.length === 0) {
    console.log('✨ No bugs to fix!');
    return;
  }

  for (const file of bugFiles) {
    const bug = JSON.parse(fs.readFileSync(path.join(bugsDir, file)));
    
    console.log(`\n🐛 Fixing: ${bug.test}`);
    console.log(`   Error: ${bug.failure.message}`);
    
    // Call Clawdbot/Claude to fix
    const task = bug.forAgent.task;
    
    try {
      execSync(`clawdbot run --task "${task.replace(/"/g, '\\"')}"`, {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..')
      });
      
      // Re-run the specific test
      execSync(`npx playwright test --grep "${bug.test}"`, {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..')
      });
      
      // If passed, archive the bug
      const fixedDir = path.join(bugsDir, 'fixed');
      if (!fs.existsSync(fixedDir)) fs.mkdirSync(fixedDir, { recursive: true });
      
      fs.renameSync(
        path.join(bugsDir, file),
        path.join(fixedDir, file)
      );
      console.log(`   ✅ Fixed!`);
      
    } catch (e) {
      console.log(`   ❌ Still failing`);
    }
  }
}

fixBugs();
```

---

## Bug Report Format (for AI Agents)

```json
{
  "id": "bug-dice-001",
  "severity": "high",
  "category": "dice-system",
  "summary": "Dice result banner fails to appear after roll",
  
  "reproduction": {
    "steps": [
      "Navigate to /arena",
      "Start battle with any monster",
      "Click attack (triggers dice roll)",
      "Observe: dice animate but result never shows"
    ],
    "frequency": "3/10 attempts",
    "environment": "iPhone Safari, low memory conditions"
  },
  
  "evidence": {
    "screenshot": "bugs/screenshots/dice-001.png",
    "video": "bugs/videos/dice-001.webm",
    "consoleLogs": [
      "[DiceBox] ROLL 1d20@15",
      "[DiceBox] clearDice: textures 41→0",
      "TypeError: Cannot read property 'total' of undefined"
    ],
    "memoryDelta": "+15MB during roll, not freed"
  },
  
  "codeContext": {
    "primaryFile": "client/src/components/DiceOverlay.jsx",
    "relatedFiles": [
      "client/src/pages/Arena.jsx:976-990"
    ],
    "suspectedFunction": "onRollComplete callback",
    "lastWorkingCommit": "abc123"
  },
  
  "suggestedInvestigation": [
    "Check if results object is undefined in onRollComplete",
    "Verify texture cleanup in clearDice doesn't race with result display",
    "Check memory pressure handling on mobile"
  ]
}
```

---

## Optional: AI Explorer (Browser-Use)

For exploratory testing, you can use an AI agent to click through the app:

```python
# explore_bugs.py
from browser_use import Agent, Browser
from langchain_anthropic import ChatAnthropic

agent = Agent(
    task="""
    You are a QA tester for a D&D web app. Your goal is to find bugs.
    
    1. Go to the Arena at https://yourapp.com/arena
    2. Start a battle
    3. Try rolling dice with different colorsets
    4. Try rolling multiple times rapidly
    5. Try on advantage/disadvantage rolls
    6. Look for: dice not appearing, wrong results, UI glitches, freezes
    
    For each bug found, report:
    - Exact steps to reproduce
    - What you expected vs what happened
    - Any error messages visible
    - Screenshot description
    """,
    llm=ChatAnthropic(model='claude-sonnet-4-6'),
    browser=Browser(),
)

results = await agent.run()
# Save structured bug reports
```

---

## Quick Setup Commands

```bash
# Create the new folders/files
mkdir -p test/bugs test/bugs/fixed scripts

# Install Playwright if not already
npm install -D @playwright/test

# Add data-testid attributes to your components for reliable selection
# Then run tests
npm run test:e2e

# After failures, run the fixer
node scripts/fix-bugs.js
```

---

## NPM Scripts to Add

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:headed": "playwright test --headed",
    "fix-bugs": "node scripts/fix-bugs.js"
  }
}
```

---

## Testing Priority

| Issue | Test Type | Tool |
|-------|-----------|------|
| Dice disappearing | UI test + video | Playwright |
| Advantage timing | Unit + E2E | Jest + Playwright |
| iPhone memory | Memory snapshots | Playwright + Safari Inspector |
| WebGL leaks | Memory tracking | `renderer.info.memory` |
| **iOS audio not playing** | Audio event tracking | Playwright + `play()` intercept |
| **Audio after tab switch** | Visibility API test | Playwright |
| **@mention on iPhone** | Keyboard input test | Playwright |
| **GIF sending** | Media picker E2E | Playwright |
| **Custom keyboard** | Input injection tests | Playwright |
| **Message reactions** | Touch/click events | Playwright |

---

## Notes

- Add `data-testid` attributes to key UI elements for reliable selection
- Screenshots on failure are already configured in `playwright.config.js`
- Consider adding video recording for flaky tests
- Memory tests may need longer timeouts on CI
- **iOS audio tests:** Use device emulation in Playwright config for realistic mobile behavior
- **Fixtures needed:** Add `test/fixtures/test-image.png` for image upload tests

### data-testid Attributes Needed

Add these to your components:

**Chat:**
- `chat-input`, `send-btn`, `media-btn`
- `gif-tab`, `gif-search`, `gif-result`
- `image-upload`
- `mention-autocomplete`, `mention-option`

**Keyboard:**
- `keyboard-toggle`, `kb-dice-btn`, `kb-emote-btn`
- `dice-d20`, `dice-d12`, etc.
- `emote-picker`, `spell-suggestion`
- `quick-actions-btn`, `quick-actions-menu`
- `qa-dice`, `qa-emotes`

**Reactions:**
- `reaction-menu`, `reaction-thumbsup`, etc.

**Audio/Location:**
- `enter-app-btn`, `enter-location-btn`
- `location-tavern`, `location-arena`, etc.
- `start-battle-btn`, `roll-dice-btn`

---

## Log Patterns (What AI Should Look For)

When the AI agent reads bug reports, here's what each log pattern means:

### Audio Issues
```
[AUDIO] play requested { src: '/sounds/tavern.mp3' }
[AUDIO] play() rejected { error: 'NotAllowedError' }   ← iOS gesture required
[AUDIO] play() rejected { error: 'AbortError' }        ← Interrupted by another play
[AUDIO] visibility changed { hidden: true }
[AUDIO] attempting audio resume                         ← Should see play after this
```

### Dice Issues
```
[DICE] init { notation: '1d20' }
[DICE] dicebox-init: 1250ms                            ← Slow init = problem
[DICE] roll started { notation: '1d20' }
[DICE] roll complete { total: 15 }                     ← Good
[DICE] onRollComplete fired { results: undefined }     ← BUG: results missing
[MEMORY] pre-cleanup textures: 45
[MEMORY] post-cleanup textures: 45                     ← BUG: textures not freed
```

### Chat/Input Issues
```
[KEYBOARD] mention trigger { char: '@', cursorPos: 5 }
[KEYBOARD] mention selected { username: 'Nalyd' }
[KEYBOARD] mention inserted { success: false }         ← BUG: didn't insert
[KEYBOARD] input event { inputType: 'insertText' }     ← Normal
[KEYBOARD] input event { inputType: undefined }        ← iOS bug indicator
```

### Memory Issues
```
[MEMORY] heap { used: '45.2MB', limit: '512MB' }
[MEMORY] heap { used: '120.5MB', limit: '512MB' }      ← Growing = leak
[MEMORY] dom { nodes: 1500, canvases: 3 }
[MEMORY] dom { nodes: 8500, canvases: 15 }             ← Leak: not cleaning up
```

---

## Running Tests

### Quick Reference Commands

| Command | What it does |
|---------|-------------|
| `npm test` | Run all E2E tests (headless) |
| `npm run test:headed` | Run tests with visible browser |
| `npm run test:e2e:ui` | Open Playwright UI mode (interactive) |
| `npm run fix-bugs` | Feed bug reports to Claude Code for auto-fix |
| `npm run fix-bugs -- --dry-run` | Preview what Claude would fix (no changes) |
| `npm run test:full` | Build + test + log results to file |
| `npm run test:nightly` | Build + test + auto-fix + log results |

### After a Coding Session

When you're done making changes, run the full suite to catch regressions:

```bash
npm run test:full
```

This will:
1. Build the client (`npm run build`)
2. Run all E2E tests
3. Save results to `test/logs/run-<timestamp>.log`

If tests fail and you want Claude to try fixing them:

```bash
npm run test:nightly
```

This adds the `--auto-fix` flag, which will read any bug reports in `test/bugs/` and invoke `claude -p` to attempt fixes automatically.

### Review Results

```bash
# See the latest run log
cat test/logs/run-*.log

# See bug report summaries
cat test/logs/summary-*.json

# Check unfixed bugs
ls test/bugs/

# Check fixed bugs
ls test/bugs/fixed/
```

---

## Scheduling Automatic Test Runs

### Option 1: Windows Task Scheduler (Nightly Runs)

Set up a task to run tests every night (or any schedule):

1. Open **Task Scheduler** (`taskschd.msc`)
2. Click **Create Basic Task**
3. Set trigger: **Daily** at your preferred time (e.g. 11:00 PM)
4. Action: **Start a program**
   - Program: `C:\Program Files\nodejs\node.exe`
   - Arguments: `scripts/run-tests-scheduled.js --auto-fix --notify`
   - Start in: `C:\Users\corpo\npc-bot\web-app`
5. Finish

Or via command line (run once in an elevated terminal):

```powershell
schtasks /create /tn "NPC Bot Nightly Tests" /tr "cmd /c cd /d C:\Users\corpo\npc-bot\web-app && node scripts/run-tests-scheduled.js --auto-fix --notify" /sc daily /st 23:00
```

To remove the scheduled task later:
```powershell
schtasks /delete /tn "NPC Bot Nightly Tests" /f
```

### Option 2: Git Post-Merge Hook (After Big Changes)

A git hook is already installed at `.git/hooks/post-merge`. It automatically runs tests after `git pull` or `git merge` **if any web-app files changed**.

- Tests run in the background so `git pull` doesn't hang
- Results are logged to `web-app/test/logs/`
- To skip tests on a specific pull:

```bash
GIT_SKIP_TESTS=1 git pull
```

### Option 3: Manual One-Liner (End of Session)

Just run this before closing up for the night:

```bash
cd web-app && npm run test:nightly
```

### Option 4: Watch Mode During Development

For continuous testing while you code, use Playwright's built-in UI mode:

```bash
npm run test:e2e:ui
```

This opens an interactive browser that re-runs tests as you make changes.

---

## Debug Logging

The app uses a namespace-based debug logger. Logs are **hidden by default** and only visible when explicitly enabled — they don't clutter the console during normal use.

### Enable Logs

Open the browser console and run:

```js
// Enable specific namespaces
localStorage.setItem('debug', 'audio,dice');
location.reload();

// Enable all namespaces
localStorage.setItem('debug', '*');
location.reload();
```

### Available Namespaces

| Namespace | Color | What it logs |
|-----------|-------|-------------|
| `audio` | Pink | AudioContext creation, UI sound playback |
| `dice` | Purple | Dice preload, collision sounds, buffer stats |
| `chat` | Blue | Message send/receive, chat state |
| `keyboard` | Green | Key events, input mode changes |
| `ws` | Orange-Red | WebSocket connect/disconnect/messages |
| `arena` | Red | Combat state, encounter events |
| `scene` | Cyan | Scene audio loading, buffer cache |
| `network` | Orange | API calls, request failures |
| `memory` | Brown | Heap snapshots, DOM node counts |
| `state` | Gray | React state transitions |

### Disable Logs

```js
localStorage.removeItem('debug');
location.reload();
```

### During E2E Tests

The BugReporter automatically captures all console output (including debug logs). To enable debug logging during test runs, add to your test:

```js
await page.evaluate(() => {
  localStorage.setItem('debug', '*');
});
await page.reload();
```

---

## Quick Reference: Adding Logs

When you see a bug without enough context, add logs:

| Component | What to log |
|-----------|-------------|
| Audio | `play()` calls, errors, visibility changes, src |
| Dice | Init time, roll start/complete, texture counts, cleanup |
| Chat | Send attempts, success/fail, media type, message ID |
| Keyboard | Input events, inputType, cursor position, composition |
| Mentions | Trigger char, selection, insert success |
| Memory | Heap size, DOM counts, canvas/audio element counts |

---

*Added 2026-02-26*

/**
 * Memory Tracker — lightweight singleton that collects memory-related metrics
 * from all subsystems (audio buffers, WebGL textures, component state sizes).
 *
 * iOS Safari has NO JavaScript heap measurement APIs, so we instrument what
 * we control: AudioBuffer sizes (channels * length * 4), WebGL texture counts,
 * array lengths, and PerformanceObserver long-task counts.
 *
 * Samples every 5s, keeps 60 samples (5 min history), computes a 0-100
 * "pressure score" from weighted signals.
 */

import { getBufferCacheStats } from './sceneAudioEngine';
import { getDiceBufferStats } from './diceAudio';
import { getArenaBufferStats } from '../hooks/useArenaSounds';
import { getUiBufferStats } from '../hooks/useUiSounds';

// ── State ──────────────────────────────────────────────────────────────

const SAMPLE_INTERVAL = 5000;
const MAX_HISTORY = 60;
const DOM_SAMPLE_EVERY = 6; // Count DOM nodes every 6th sample (30s)

let _interval = null;
let _sampleCount = 0;
const _history = [];
const _subscribers = new Set();
const _componentMetrics = {}; // key → { value, updatedAt }

// Long task tracking via PerformanceObserver
let _longTaskCount = 0;
let _longTaskObserver = null;
let _longTaskWindowStart = Date.now();

// Cached DOM node count (expensive to compute)
let _domNodeCount = 0;

// Registered probes (for lazily-loaded modules like DiceOverlay)
const _probes = {};

/**
 * Register a named probe function that returns stats.
 * Used by lazily-loaded modules to plug into the tracker.
 */
export function registerProbe(name, fn) {
  _probes[name] = fn;
}

// ── Component metric reporting ─────────────────────────────────────────

/**
 * Report a component-level metric (e.g. message array length).
 * Call from useEffect in components.
 */
export function reportMetric(key, value) {
  _componentMetrics[key] = { value, updatedAt: Date.now() };
}

// ── Sampling ───────────────────────────────────────────────────────────

function computeAudioBytes() {
  let total = 0;
  try { total += getBufferCacheStats().bytes; } catch {}
  try { total += getDiceBufferStats().bytes; } catch {}
  try { total += getArenaBufferStats().bytes; } catch {}
  try { total += getUiBufferStats().bytes; } catch {}
  return total;
}

function getAudioBreakdown() {
  const scene = safeCall(getBufferCacheStats, { count: 0, bytes: 0 });
  const dice = safeCall(getDiceBufferStats, { count: 0, bytes: 0 });
  const arena = safeCall(getArenaBufferStats, { count: 0, bytes: 0 });
  const ui = safeCall(getUiBufferStats, { count: 0, bytes: 0 });
  return { scene, dice, arena, ui };
}

function safeCall(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

function takeSample() {
  _sampleCount++;

  // DOM node count (expensive — sample less often)
  if (_sampleCount % DOM_SAMPLE_EVERY === 0) {
    _domNodeCount = document.querySelectorAll('*').length;
  }

  const audioBreakdown = getAudioBreakdown();
  const totalAudioBytes = audioBreakdown.scene.bytes + audioBreakdown.dice.bytes
    + audioBreakdown.arena.bytes + audioBreakdown.ui.bytes;
  const totalAudioMB = totalAudioBytes / (1024 * 1024);

  const webgl = _probes.webgl
    ? safeCall(_probes.webgl, { textures: 0, geometries: 0, totalCreated: 0, totalDisposed: 0, rolls: 0, contextLost: 0, fatalError: false })
    : { textures: 0, geometries: 0, totalCreated: 0, totalDisposed: 0, rolls: 0, contextLost: 0, fatalError: false };

  // Long tasks per minute
  const elapsed = (Date.now() - _longTaskWindowStart) / 60000;
  const longTasksPerMin = elapsed > 0 ? _longTaskCount / elapsed : 0;

  // Chrome-only heap info
  let chromeHeapMB = null;
  if (performance.memory) {
    chromeHeapMB = performance.memory.usedJSHeapSize / (1024 * 1024);
  }

  // Gather component metrics
  const components = {};
  const staleThreshold = Date.now() - 30000; // 30s staleness
  for (const [key, entry] of Object.entries(_componentMetrics)) {
    if (entry.updatedAt < staleThreshold) {
      delete _componentMetrics[key];
      continue;
    }
    components[key] = entry.value;
  }

  // Pressure score (0-100)
  const messageCount = (components['chat.messages'] || 0);
  const pressure = Math.min(100, Math.round(
    (Math.min(totalAudioMB / 40, 1)) * 30
    + (Math.min(webgl.textures / 60, 1)) * 20
    + (Math.min(messageCount / 500, 1)) * 15
    + (Math.min(_domNodeCount / 3000, 1)) * 15
    + (Math.min(longTasksPerMin / 10, 1)) * 20
  ));

  const snapshot = {
    ts: Date.now(),
    pressure,
    audio: { totalMB: totalAudioMB, ...audioBreakdown },
    webgl,
    domNodes: _domNodeCount,
    longTasksPerMin: Math.round(longTasksPerMin * 10) / 10,
    chromeHeapMB: chromeHeapMB ? Math.round(chromeHeapMB * 10) / 10 : null,
    components,
  };

  _history.push(snapshot);
  if (_history.length > MAX_HISTORY) _history.shift();

  // Notify subscribers
  _subscribers.forEach(cb => {
    try { cb(snapshot); } catch {}
  });
}

// ── Public API ─────────────────────────────────────────────────────────

export function start() {
  if (_interval) return;

  // Start long task observer
  if (!_longTaskObserver && typeof PerformanceObserver !== 'undefined') {
    try {
      _longTaskObserver = new PerformanceObserver((list) => {
        _longTaskCount += list.getEntries().length;
      });
      _longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch {}
  }

  // Take initial sample immediately
  _domNodeCount = document.querySelectorAll('*').length;
  takeSample();

  _interval = setInterval(() => {
    if (document.hidden) return; // Pause when tab hidden
    takeSample();
  }, SAMPLE_INTERVAL);
}

export function stop() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
  if (_longTaskObserver) {
    _longTaskObserver.disconnect();
    _longTaskObserver = null;
  }
}

export function subscribe(callback) {
  _subscribers.add(callback);
  return () => _subscribers.delete(callback);
}

export function getSnapshot() {
  if (_history.length === 0) return null;
  return _history[_history.length - 1];
}

export function getHistory() {
  return _history;
}

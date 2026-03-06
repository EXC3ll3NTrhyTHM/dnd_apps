/**
 * SceneAudioEngine - Web Audio API engine for background music & ambient loops.
 *
 * Replaces HTML5 Audio (new Audio()) which breaks on iOS Safari when
 * switching tracks — each new Audio element needs a fresh user gesture.
 * Web Audio API only needs one gesture to unlock the AudioContext, then
 * all subsequent plays work automatically.
 *
 * Plain JS singleton (like diceAudio.js) — survives React mount/unmount.
 */
import { ensureContext } from '../hooks/useUiSounds';
import { createLogger } from '../utils/debug';

const log = createLogger('audio');

// URL → AudioBuffer cache (persists across config changes, capped to limit memory)
const _bufferCache = new Map();
const BUFFER_CACHE_MAX = 10;

// Currently active playback entries
let _activeEntries = [];
let _muted = false;
let _suspended = false;
// Generation counter — incremented on every playSceneConfig/stopAll call.
// After the async buffer load, we check if the generation has changed;
// if so, another call has superseded us and we bail out.
let _generation = 0;

/**
 * Fetch and decode an audio file. Returns cached buffer if available.
 */
export async function loadBuffer(url) {
  if (_bufferCache.has(url)) { log('buffer cache hit', url); return _bufferCache.get(url); }
  const ctx = ensureContext();
  if (!ctx) { log('no AudioContext, skipping load', url); return null; }
  try {
    log('loading buffer', url);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const arrayBuf = await resp.arrayBuffer();
    // Guard against huge files that would crash mobile devices when decoded
    // (a 5MB MP3 ≈ 100MB decoded AudioBuffer — safe; 30MB+ will crash iOS)
    const MAX_BYTES = 8 * 1024 * 1024; // 8MB compressed
    if (arrayBuf.byteLength > MAX_BYTES) {
      console.warn('[SceneAudioEngine] Skipping oversized audio', url,
        `(${(arrayBuf.byteLength / 1024 / 1024).toFixed(1)}MB > ${MAX_BYTES / 1024 / 1024}MB limit)`);
      return null;
    }
    const decoded = await ctx.decodeAudioData(arrayBuf);
    _bufferCache.set(url, decoded);
    // Evict oldest entries when cache exceeds cap
    if (_bufferCache.size > BUFFER_CACHE_MAX) {
      const it = _bufferCache.keys();
      while (_bufferCache.size > BUFFER_CACHE_MAX) {
        _bufferCache.delete(it.next().value);
      }
    }
    return decoded;
  } catch (err) {
    console.warn('[SceneAudioEngine] Failed to load', url, err);
    return null;
  }
}

/**
 * Preload URLs into the buffer cache without playing.
 */
export function preloadBuffers(urls) {
  urls.forEach(url => loadBuffer(url));
}

/**
 * Play a looping track (music or ambient loop).
 */
function startLooping(buffer, volume) {
  const ctx = ensureContext();
  if (!ctx || !buffer) return null;

  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  gain.gain.value = _muted ? 0 : volume;
  source.buffer = buffer;
  source.loop = true;
  source.connect(gain).connect(ctx.destination);
  source.start(0);

  return { source, gain, volume, type: 'looping' };
}

/**
 * Play an irregular ambient sound (play once, random pause, repeat).
 */
function startIrregular(buffer, volume, irregularPause) {
  const ctx = ensureContext();
  if (!ctx || !buffer) return null;

  let active = true;
  let currentSource = null;
  let timer = null;
  const gainNode = ctx.createGain();
  gainNode.gain.value = _muted ? 0 : volume;
  gainNode.connect(ctx.destination);

  function playOnce() {
    if (!active || _suspended) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gainNode);
    currentSource = source;

    source.onended = () => {
      if (!active) return;
      const [min, max] = irregularPause;
      const delay = (min + Math.random() * (max - min)) * 1000;
      timer = setTimeout(() => {
        if (!_suspended && !_muted) {
          playOnce();
        }
      }, delay);
    };

    source.start(0);
  }

  // Start after a random initial delay
  const [min, max] = irregularPause;
  timer = setTimeout(playOnce, (min + Math.random() * (max - min)) * 1000);

  return {
    type: 'irregular',
    volume,
    gain: gainNode,
    stop() {
      active = false;
      clearTimeout(timer);
      if (currentSource) { try { currentSource.stop(); } catch {} }
    },
    resume() {
      if (!active || _muted) return;
      // Restart the cycle
      clearTimeout(timer);
      playOnce();
    },
  };
}

/**
 * Fade out a gain node over the given duration.
 */
function fadeOutGain(gainNode, durationSec = 0.4) {
  const ctx = ensureContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  gainNode.gain.setValueAtTime(gainNode.gain.value, now);
  gainNode.gain.linearRampToValueAtTime(0, now + durationSec);
}

/**
 * Internal helper — fade out and stop all active entries.
 * Does NOT touch _generation so it's safe to call from unmount
 * without invalidating a sibling SceneAudio's in-flight playSceneConfig.
 */
function _stopEntries(fadeMs = 400) {
  const fadeSec = fadeMs / 1000;
  _activeEntries.forEach(entry => {
    if (entry.type === 'irregular') {
      entry.gain.gain.setValueAtTime(entry.gain.gain.value, ensureContext().currentTime);
      entry.gain.gain.linearRampToValueAtTime(0, ensureContext().currentTime + fadeSec);
      setTimeout(() => entry.stop(), fadeMs + 50);
    } else if (entry.type === 'looping') {
      fadeOutGain(entry.gain, fadeSec);
      setTimeout(() => { try { entry.source.stop(); } catch {} }, fadeMs + 50);
    }
  });
  _activeEntries = [];
}

/**
 * Stop all active scene audio with optional fade-out.
 */
export function stopAll(fadeMs = 400) {
  console.warn('[SceneAudio] stopAll called', { active: _activeEntries.length, fadeMs, gen: _generation, stack: new Error().stack?.split('\n').slice(1, 4).map(s => s.trim()).join(' <- ') });
  log('stopAll', { active: _activeEntries.length, fadeMs });
  _generation++; // Invalidate any in-flight playSceneConfig calls
  _stopEntries(fadeMs);
}

/**
 * Stop all active scene audio WITHOUT incrementing generation.
 * Used by SceneAudio unmount — stops the audio but doesn't invalidate
 * a sibling SceneAudio's in-flight playSceneConfig (e.g. arena unmounts
 * while dojo's SceneAudio is loading buffers).
 */
export function stopPlayback(fadeMs = 400) {
  console.warn('[SceneAudio] stopPlayback called (soft)', { active: _activeEntries.length, fadeMs, gen: _generation });
  log('stopPlayback', { active: _activeEntries.length, fadeMs });
  _stopEntries(fadeMs);
}

/**
 * Set the muted state. Adjusts all active gain nodes without stopping playback.
 */
export function setSceneMuted(muted) {
  _muted = muted;
  _activeEntries.forEach(entry => {
    if (entry.gain) {
      entry.gain.gain.value = muted ? 0 : entry.volume;
    }
  });
}

/**
 * Suspend all scene audio (tab hidden / window blur).
 */
export function suspendScene() {
  _suspended = true;
  const ctx = ensureContext();
  if (ctx) ctx.suspend().catch(() => {});
}

/**
 * Resume all scene audio (tab visible / window focus).
 */
export function resumeScene() {
  if (!_suspended) return;
  _suspended = false;
  const ctx = ensureContext();
  if (ctx) ctx.resume().catch(() => {});
}

/**
 * Play a scene audio config. Stops any currently active audio first (with crossfade).
 *
 * Config shape:
 *   { music?: { src, volume }, ambient?: [{ src, volume, irregular?, irregularPause? }] }
 *
 * Returns a cleanup function.
 */
export async function playSceneConfig(config, { muted = false } = {}) {
  const src = config?.music?.src || config?.ambient?.[0]?.src || 'none';
  console.warn('[SceneAudio] playSceneConfig called', { src, muted, gen: _generation, ctxState: ensureContext()?.state });
  log('playSceneConfig', { music: config?.music?.src, ambient: config?.ambient?.length, muted });
  _muted = muted;

  // Ensure the AudioContext is running — it may have been suspended by the
  // global background audio handler. Without this, sources start but produce
  // no audible output because the context is paused.
  const ctx = ensureContext();
  if (ctx && ctx.state === 'suspended') {
    console.warn('[SceneAudio] Resuming suspended AudioContext');
    ctx.resume().catch(() => {});
  }

  // Stop previous audio with a short crossfade.
  // stopAll increments _generation, which also invalidates any earlier
  // in-flight playSceneConfig that hasn't finished loading buffers yet.
  stopAll(500);

  if (!config) return () => {};

  // Capture the generation at call time so we can detect if another
  // playSceneConfig or stopAll ran while we were loading buffers.
  const myGeneration = _generation;
  console.warn('[SceneAudio] Loading buffers...', { myGeneration, tasks: config.music?.src || config.ambient?.map(a => a.src) });

  // Collect all URLs to load
  const loadTasks = [];
  if (config.music) {
    loadTasks.push({ key: 'music', src: config.music.src, volume: config.music.volume ?? 0.3 });
  }
  if (config.ambient) {
    config.ambient.forEach((amb, i) => {
      loadTasks.push({
        key: `ambient_${i}`,
        src: amb.src,
        volume: amb.volume ?? 0.5,
        irregular: amb.irregular ?? false,
        irregularPause: amb.irregularPause ?? [8, 20],
      });
    });
  }

  if (loadTasks.length === 0) return () => {};

  // Load all buffers in parallel
  const buffers = await Promise.all(loadTasks.map(t => loadBuffer(t.src)));
  console.warn('[SceneAudio] Buffers loaded', {
    myGeneration, currentGen: _generation,
    stale: _generation !== myGeneration,
    results: loadTasks.map((t, i) => ({ src: t.src, loaded: !!buffers[i], sizeMB: buffers[i] ? (buffers[i].length * buffers[i].numberOfChannels * 4 / 1024 / 1024).toFixed(1) : 0 })),
  });

  // After the async gap: if another playSceneConfig or stopAll was called
  // while we were loading, this call is stale — don't start any sources.
  if (_generation !== myGeneration) {
    console.warn('[SceneAudio] STALE — bailing out!', { myGeneration, current: _generation });
    log('playSceneConfig stale after buffer load, bailing', { myGeneration, current: _generation });
    return () => {};
  }

  const newEntries = [];

  loadTasks.forEach((task, i) => {
    const buffer = buffers[i];
    if (!buffer) { console.warn('[SceneAudio] Skipping null buffer for', task.src); return; }

    if (task.irregular) {
      const entry = startIrregular(buffer, task.volume, task.irregularPause);
      if (entry) newEntries.push(entry);
    } else {
      const entry = startLooping(buffer, task.volume);
      if (entry) newEntries.push(entry);
    }
  });

  console.warn('[SceneAudio] Started', newEntries.length, 'sources, muted:', _muted);
  _activeEntries = newEntries;

  // Return cleanup function
  return () => stopAll(300);
}

/**
 * Clear the audio buffer cache to free memory.
 * Called when leaving a location so decoded AudioBuffers (which can be
 * 20-100MB each in uncompressed PCM) don't linger on memory-constrained
 * devices like iPhones. Buffers are re-loaded via preloadAudio during
 * the next location's transition, so there's no cold-start penalty.
 *
 * @param {string[]} [keepUrls] - URLs to keep in cache (e.g. currently playing)
 */
export function clearBufferCache(keepUrls = []) {
  console.warn('[SceneAudio] clearBufferCache called', { cacheSize: _bufferCache.size, keepUrls, stack: new Error().stack?.split('\n').slice(1, 4).map(s => s.trim()).join(' <- ') });
  const keepSet = new Set(keepUrls);
  let cleared = 0;
  for (const url of [..._bufferCache.keys()]) {
    if (!keepSet.has(url)) {
      _bufferCache.delete(url);
      cleared++;
    }
  }
  log('clearBufferCache', { cleared, kept: keepSet.size, remaining: _bufferCache.size });
}

/**
 * Get stats about the audio buffer cache for memory monitoring.
 */
export function getBufferCacheStats() {
  let totalBytes = 0;
  _bufferCache.forEach((buf) => {
    totalBytes += buf.numberOfChannels * buf.length * 4;
  });
  return { count: _bufferCache.size, bytes: totalBytes };
}

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

// URL → AudioBuffer cache (persists across config changes)
const _bufferCache = new Map();

// Currently active playback entries
let _activeEntries = [];
let _muted = false;
let _suspended = false;

/**
 * Fetch and decode an audio file. Returns cached buffer if available.
 */
async function loadBuffer(url) {
  if (_bufferCache.has(url)) return _bufferCache.get(url);
  const ctx = ensureContext();
  if (!ctx) return null;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const arrayBuf = await resp.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuf);
    _bufferCache.set(url, decoded);
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
 * Stop all active scene audio with optional fade-out.
 */
export function stopAll(fadeMs = 400) {
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
  _muted = muted;

  // Stop previous audio with a short crossfade
  stopAll(500);

  if (!config) return () => {};

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

  const newEntries = [];

  loadTasks.forEach((task, i) => {
    const buffer = buffers[i];
    if (!buffer) return;

    if (task.irregular) {
      const entry = startIrregular(buffer, task.volume, task.irregularPause);
      if (entry) newEntries.push(entry);
    } else {
      const entry = startLooping(buffer, task.volume);
      if (entry) newEntries.push(entry);
    }
  });

  _activeEntries = newEntries;

  // Return cleanup function
  return () => stopAll(300);
}

import { useRef, useCallback } from 'react';
import { useAudioMuted } from './useAudioSettings';
import { preloadDiceSounds } from '../lib/diceAudio';
import { createLogger } from '../utils/debug';

const log = createLogger('audio');

const UI_SOUNDS = {
  messageSent: '/sounds/ui/message-sent.wav',
  npcResponse: '/sounds/ui/npc-response.wav',
  buttonTap: '/sounds/ui/button-tap.wav',
  navTap: '/sounds/ui/nav-tap.wav',
  purchase: '/sounds/ui/purchase.wav',
  mapMarker: '/sounds/ui/map-marker.wav',
  menuOpen: '/sounds/ui/menu-open.wav',
  menuClose: '/sounds/ui/menu-close.wav',
};

const VOLUMES = {
  messageSent: 0.4,
  npcResponse: 0.35,
  buttonTap: 0.3,
  navTap: 0.3,
  purchase: 0.5,
  mapMarker: 0.35,
  menuOpen: 0.3,
  menuClose: 0.25,
};

// Web Audio API — pre-decoded buffers for instant playback
let _ctx = null;
const _buffers = {};
let _backgroundSuspended = false; // true when suspended due to page hidden/blur

export function ensureContext() {
  if (!_ctx) {
    log('creating AudioContext');
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Don't auto-resume if the page is hidden — audio should stay suspended in background
  if (_ctx.state === 'suspended' && !document.hidden && !_backgroundSuspended) {
    log('resuming suspended context');
    _ctx.resume();
  }
  return _ctx;
}

// ── Global background audio suspension ──────────────────────────────────
// Single handler that suspends the shared AudioContext when the app goes
// to background (homescreen, tab switch, app switcher). This catches ALL
// audio (scene, arena, dice, UI) since they all share the same context.
function _onGlobalVisibility() {
  if (!_ctx) return;
  if (document.hidden) {
    _backgroundSuspended = true;
    _ctx.suspend().catch(() => {});
    log('global suspend (page hidden)');
  } else {
    _backgroundSuspended = false;
    _ctx.resume().catch(() => {});
    log('global resume (page visible)');
  }
}

function _onGlobalBlur() {
  if (!_ctx) return;
  _backgroundSuspended = true;
  _ctx.suspend().catch(() => {});
  log('global suspend (window blur)');
}

function _onGlobalFocus() {
  if (!_ctx || document.hidden) return;
  _backgroundSuspended = false;
  _ctx.resume().catch(() => {});
  log('global resume (window focus)');
}

document.addEventListener('visibilitychange', _onGlobalVisibility);
window.addEventListener('blur', _onGlobalBlur);
window.addEventListener('focus', _onGlobalFocus);

function preloadAll() {
  const ctx = ensureContext();
  for (const [key, src] of Object.entries(UI_SOUNDS)) {
    if (_buffers[key]) continue;
    fetch(src)
      .then(r => r.arrayBuffer())
      .then(buf => ctx.decodeAudioData(buf))
      .then(decoded => { _buffers[key] = decoded; })
      .catch(() => { });
  }
}

// Start preloading on first user interaction (AudioContext requires gesture)
let _preloaded = false;
function initOnInteraction() {
  if (_preloaded) return;
  _preloaded = true;
  preloadAll();
  preloadDiceSounds(); // Start loading dice sounds immediately
  // Also unlock HTML5 Audio (new Audio()) for libraries like dice-box-threejs.
  // iOS Safari requires a user gesture to start any audio; playing a silent
  // data-URI buffer "unlocks" the HTML5 Audio path for the rest of the session.
  try {
    const a = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=');
    a.volume = 0;
    a.play().then(() => a.pause()).catch(() => { });
  } catch { }
  window.removeEventListener('pointerdown', initOnInteraction);
  window.removeEventListener('touchstart', initOnInteraction);
}
window.addEventListener('pointerdown', initOnInteraction, { once: true });
window.addEventListener('touchstart', initOnInteraction, { once: true });

/**
 * Explicitly unlock all audio systems (AudioContext + HTML5 Audio).
 * Called from the iOS audio consent overlay on the user's intentional tap.
 */
export function unlockAllAudio() {
  ensureContext();
  initOnInteraction();
}

/**
 * Close the current AudioContext and create a fresh one.
 * Used to reset iOS audio session routing after speech recognition.
 * UI sound buffers are cleared so they re-decode against the new context.
 */
export function resetContext() {
  if (_ctx) {
    _ctx.close().catch(() => {});
    _ctx = null;
  }
  // Clear decoded buffers — they belong to the old context
  for (const key of Object.keys(_buffers)) delete _buffers[key];
  _preloaded = false;
  // Re-create context and preload
  ensureContext();
  preloadAll();
}

/**
 * Get stats about UI sound buffers for memory monitoring.
 */
export function getUiBufferStats() {
  let totalBytes = 0;
  let count = 0;
  for (const buf of Object.values(_buffers)) {
    if (buf) {
      totalBytes += buf.numberOfChannels * buf.length * 4;
      count++;
    }
  }
  return { count, bytes: totalBytes };
}

export function useUiSounds() {
  const muted = useAudioMuted();
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const play = useCallback((key) => {
    if (mutedRef.current) return;
    if (!_ctx || !_buffers[key]) return;
    if (_ctx.state === 'suspended') _ctx.resume();
    const src = _ctx.createBufferSource();
    const gain = _ctx.createGain();
    gain.gain.value = VOLUMES[key] ?? 0.3;
    src.buffer = _buffers[key];
    src.connect(gain).connect(_ctx.destination);
    src.start(0);
  }, []);

  return play;
}

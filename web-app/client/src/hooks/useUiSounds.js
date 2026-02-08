import { useRef, useCallback } from 'react';
import { useAudioMuted } from './useAudioSettings';

const UI_SOUNDS = {
  messageSent:  '/sounds/ui/message-sent.wav',
  npcResponse:  '/sounds/ui/npc-response.wav',
  buttonTap:    '/sounds/ui/button-tap.wav',
  navTap:       '/sounds/ui/nav-tap.wav',
  purchase:     '/sounds/ui/purchase.wav',
  mapMarker:    '/sounds/ui/map-marker.wav',
  menuOpen:     '/sounds/ui/menu-open.wav',
  menuClose:    '/sounds/ui/menu-close.wav',
};

const VOLUMES = {
  messageSent:  0.4,
  npcResponse:  0.35,
  buttonTap:    0.3,
  navTap:       0.3,
  purchase:     0.5,
  mapMarker:    0.35,
  menuOpen:     0.3,
  menuClose:    0.25,
};

// Web Audio API — pre-decoded buffers for instant playback
let _ctx = null;
const _buffers = {};

function ensureContext() {
  if (!_ctx) {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

function preloadAll() {
  const ctx = ensureContext();
  for (const [key, src] of Object.entries(UI_SOUNDS)) {
    if (_buffers[key]) continue;
    fetch(src)
      .then(r => r.arrayBuffer())
      .then(buf => ctx.decodeAudioData(buf))
      .then(decoded => { _buffers[key] = decoded; })
      .catch(() => {});
  }
}

// Start preloading on first user interaction (AudioContext requires gesture)
let _preloaded = false;
function initOnInteraction() {
  if (_preloaded) return;
  _preloaded = true;
  preloadAll();
  window.removeEventListener('pointerdown', initOnInteraction);
  window.removeEventListener('touchstart', initOnInteraction);
}
window.addEventListener('pointerdown', initOnInteraction, { once: true });
window.addEventListener('touchstart', initOnInteraction, { once: true });

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

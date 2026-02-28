/**
 * Web Audio API dice collision sounds.
 *
 * Bypasses @3d-dice/dice-box-threejs's broken HTML5 Audio (new Audio())
 * which hangs on iOS Safari. Instead we preload the same MP3 assets as
 * decoded AudioBuffers and play them through the shared AudioContext
 * from useUiSounds.js — which IS properly unlocked on iOS via user gesture.
 *
 * This is a plain JS singleton (not a React hook) so it survives
 * DiceOverlay mount/unmount cycles.
 */
import { ensureContext } from '../hooks/useUiSounds';
import { getAudioMuted } from '../hooks/useAudioSettings';
import { createLogger } from '../utils/debug';

const log = createLogger('dice');

const ASSET_BASE = '/assets/dice-box-threejs/';
const DICE_HIT_COUNT = 15;   // dicehit_plastic1..15.mp3
const SURFACE_HIT_COUNT = 7; // surface_felt1..7.mp3

const _diceBuffers = [];
const _surfaceBuffers = [];
let _loaded = false;
let _loading = false;
let _lastSoundTime = 0;
let _lastSoundStep = 0;
const SOUND_COOLDOWN_MS = 50;

async function loadBuffer(ctx, url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const arrayBuf = await resp.arrayBuffer();
    return await ctx.decodeAudioData(arrayBuf);
  } catch (err) {
    console.warn(`[DiceAudio] Failed to load ${url}:`, err);
    return null;
  }
}

/**
 * Preload plastic die hits + felt surface hits as AudioBuffers.
 * Safe to call multiple times — only loads once.
 */
export async function preloadDiceSounds() {
  if (_loaded || _loading) return;
  _loading = true;
  log('starting preload');

  const ctx = ensureContext();
  if (!ctx) {
    log('no AudioContext available!');
    _loading = false;
    return;
  }

  const promises = [];
  // Load fewer sounds to prevent memory exhaustion on iOS
  for (let i = 1; i <= DICE_HIT_COUNT; i++) {
    promises.push(loadBuffer(ctx, `${ASSET_BASE}dicehit/dicehit_plastic${i}.mp3`));
  }
  for (let i = 1; i <= SURFACE_HIT_COUNT; i++) {
    promises.push(loadBuffer(ctx, `${ASSET_BASE}sounds/surfaces/surface_felt${i}.mp3`));
  }

  const results = await Promise.all(promises);

  results.slice(0, DICE_HIT_COUNT).forEach(b => { if (b) _diceBuffers.push(b); });
  results.slice(DICE_HIT_COUNT).forEach(b => { if (b) _surfaceBuffers.push(b); });

  _loaded = _diceBuffers.length > 0;
  _loading = false;
  console.log(`[DiceAudio] Preload complete. Dice: ${_diceBuffers.length}, Surfaces: ${_surfaceBuffers.length}`);
}

function playBuffer(buffer, volume) {
  const ctx = ensureContext();
  if (!ctx || !buffer) return;

  if (ctx.state === 'suspended') {
    ctx.resume().catch(e => console.warn('[DiceAudio] Verify resume failed:', e));
  }

  try {
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = volume * 1.5;
    src.buffer = buffer;
    src.connect(gain).connect(ctx.destination);
    src.start(0);
  } catch (e) {
    console.warn('[DiceAudio] Play error:', e);
  }
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Get stats about dice audio buffers for memory monitoring.
 */
export function getDiceBufferStats() {
  let totalBytes = 0;
  [..._diceBuffers, ..._surfaceBuffers].forEach(buf => {
    totalBytes += buf.numberOfChannels * buf.length * 4;
  });
  return { count: _diceBuffers.length + _surfaceBuffers.length, bytes: totalBytes };
}

/**
 * Clear all dice audio buffers to free memory.
 * Called when leaving the arena.
 */
export function clearDiceBuffers() {
  const count = _diceBuffers.length + _surfaceBuffers.length;
  _diceBuffers.length = 0;
  _surfaceBuffers.length = 0;
  _loaded = false;
  _loading = false;
  return count;
}

/**
 * Collision handler matching the library's eventCollide({ body, target }) signature.
 * Assign to box.eventCollide after initialize() but before roll().
 */
export function handleDiceCollide({ body: e, target: t }) {
  if (getAudioMuted()) return;
  if (!_loaded) {
    // console.log('[DiceAudio] Collide skipped: not loaded'); // Spammy
    return;
  }
  if (!e) return;

  const now = Date.now();

  // Debounce: skip same physics step or too soon after last sound
  if (e.world && _lastSoundStep === e.world.stepnumber) return;
  if (now - _lastSoundTime < SOUND_COOLDOWN_MS) return;

  const isDice = e.mass > 0;

  if (isDice) {
    // Die-to-die or die-to-wall collision
    const velocity = e.velocity.length();
    if (velocity < 250) return;
    const vol = Math.min(0.15 + (velocity - 250) / 2000, 1.0);
    playBuffer(randomFrom(_diceBuffers), vol);
  } else {
    // Die hitting the table surface
    const velocity = t.velocity.length();
    if (velocity < 250) return;
    const vol = Math.min(0.15 + (velocity - 250) / 2500, 0.8);
    playBuffer(randomFrom(_surfaceBuffers), vol);
  }

  _lastSoundTime = now;
  if (e.world) _lastSoundStep = e.world.stepnumber;
}

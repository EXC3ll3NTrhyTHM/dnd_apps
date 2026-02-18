/**
 * Patches @3d-dice/dice-box-threejs:
 * 1. Fix dice spawning at container edges (0.9 → 0.3)
 * 2. Disable antialiasing — causes blank canvas on iOS Safari (Three.js #9814, #25736)
 *
 * Run automatically via postinstall, or manually: node scripts/patch-dice-box.js
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(
  __dirname,
  '..',
  'node_modules',
  '@3d-dice',
  'dice-box-threejs',
  'dist',
  'dice-box-threejs.es.js'
);

if (!fs.existsSync(filePath)) {
  console.log('[patch-dice-box] dice-box-threejs not installed yet, skipping.');
  process.exit(0);
}

let src = fs.readFileSync(filePath, 'utf8');
let changed = false;

// --- Patch 1: Spawn positions (0.9 → 0.3) ---
const spawnOrig = `x: this.display.containerWidth * (f.x > 0 ? -1 : 1) * 0.9,
          y: this.display.containerHeight * (f.y > 0 ? -1 : 1) * 0.9,`;
const spawnFixed = `x: this.display.containerWidth * (f.x > 0 ? -1 : 1) * 0.3,
          y: this.display.containerHeight * (f.y > 0 ? -1 : 1) * 0.3,`;

if (src.includes(spawnFixed)) {
  console.log('[patch-dice-box] Spawn positions already patched.');
} else if (src.includes(spawnOrig)) {
  src = src.replace(spawnOrig, spawnFixed);
  changed = true;
  console.log('[patch-dice-box] Patched dice spawn positions (0.9 -> 0.3).');
} else {
  console.warn('[patch-dice-box] Could not find spawn position code.');
}

// --- Patch 2: Disable antialiasing (blank canvas on iOS Safari) ---
const aaOrig = 'this.renderer = new xo({ antialias: !0, alpha: !0 })';
const aaFixed = 'this.renderer = new xo({ antialias: !1, alpha: !0 })';

if (src.includes(aaFixed)) {
  console.log('[patch-dice-box] Antialiasing already patched.');
} else if (src.includes(aaOrig)) {
  src = src.replace(aaOrig, aaFixed);
  changed = true;
  console.log('[patch-dice-box] Disabled antialiasing (iOS Safari fix).');
} else {
  console.warn('[patch-dice-box] Could not find antialias code.');
}

// --- Patch 3: Make sound loading non-fatal (iOS audio can fail intermittently) ---
const soundOrig = `this.sounds && await this.loadSounds().catch((e) => {
      throw new Error("Unable to load sounds");
    })`;
const soundFixed = `this.sounds && await this.loadSounds().catch((e) => {
      console.warn("Unable to load sounds, continuing without audio"), this.sounds = !1
    })`;

if (src.includes(soundFixed)) {
  console.log('[patch-dice-box] Sound loading already patched.');
} else if (src.includes(soundOrig)) {
  src = src.replace(soundOrig, soundFixed);
  changed = true;
  console.log('[patch-dice-box] Made sound loading non-fatal.');
} else {
  console.warn('[patch-dice-box] Could not find sound loading code.');
}

// --- Patch 4: Add timeout to loadAudio (iOS hangs forever on new Audio()) ---
const audioOrig = `loadAudio(e) {
    return new Promise((t, n) => {
      let i = new Audio();
      i.oncanplaythrough = () => t(i), i.crossOrigin = "anonymous", i.src = e, i.onerror = (s) => n(s);
    }).catch((t) => {
      console.error("Unable to load audio");
    });
  }`;
const audioFixed = `loadAudio(e) {
    return new Promise((t, n) => {
      let i = new Audio(), tm = setTimeout(() => n(new Error("Audio load timeout")), 1500);
      i.oncanplaythrough = () => { clearTimeout(tm); t(i); }, i.crossOrigin = "anonymous", i.src = e, i.onerror = (s) => { clearTimeout(tm); n(s); };
    }).catch((t) => {
      console.warn("Unable to load audio:", e);
    });
  }`;

// Also match previous patch version (3000ms timeout) so we can update it
const audioOldPatch = audioFixed.replace('1500', '3000');

if (src.includes(audioFixed)) {
  console.log('[patch-dice-box] loadAudio timeout already patched.');
} else if (src.includes(audioOldPatch)) {
  src = src.replace(audioOldPatch, audioFixed);
  changed = true;
  console.log('[patch-dice-box] Updated loadAudio timeout (3s -> 1.5s).');
} else if (src.includes(audioOrig)) {
  src = src.replace(audioOrig, audioFixed);
  changed = true;
  console.log('[patch-dice-box] Added 1.5s timeout to loadAudio.');
} else {
  console.warn('[patch-dice-box] Could not find loadAudio code.');
}

if (changed) {
  fs.writeFileSync(filePath, src, 'utf8');
  console.log('[patch-dice-box] Patches applied.');
} else {
  console.log('[patch-dice-box] No changes needed.');
}

// Clear Vite's dependency pre-bundle cache so it picks up the patched file
const viteCacheDir = path.join(__dirname, '..', 'client', 'node_modules', '.vite', 'deps');
if (fs.existsSync(viteCacheDir)) {
  fs.rmSync(viteCacheDir, { recursive: true });
  console.log('[patch-dice-box] Cleared Vite dependency cache.');
}

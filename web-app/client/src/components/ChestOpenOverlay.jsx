/**
 * ChestOpenOverlay — Tap-to-open treasure chest with 3D model
 *
 * Phase state machine: tapping → opening → revealing → summary
 * Three.js scene loads chest.glb, animates lid via Bone.001 armature.
 * Memory: full cleanup on unmount (BluntSmokeOverlay pattern).
 * Lazy-loaded: only fetched when a chest is earned.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { getAudioMuted } from '../hooks/useAudioSettings';
import { ensureContext } from '../hooks/useUiSounds';
import '../styles/chest.css';

const RARITY_COLORS = {
  common:    0x8B7355,
  uncommon:  0x2ecc71,
  rare:      0x3498db,
  epic:      0x9b59b6,
  legendary: 0xf39c12,
};

const RARITY_LABELS = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

const TAP_COUNT = 6; // 5 rarity taps + 1 open tap

// Audio pitch per tap index (ascending) — only 5 rarity taps use these
const TAP_PITCHES = [300, 400, 520, 660, 840];

function generateParticles(count) {
  const particles = [];
  // Fast upward sparks (small, bright)
  const sparkCount = Math.floor(count * 0.6);
  for (let i = 0; i < sparkCount; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.4; // bias upward
    const dist = 80 + Math.random() * 120;
    particles.push({
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
      delay: Math.random() * 0.2,
      kind: 'spark',
    });
  }
  // Larger slower glowing orbs
  for (let i = sparkCount; i < count; i++) {
    const angle = (Math.PI * 2 * i) / (count - sparkCount) + (Math.random() - 0.5) * 0.5;
    const dist = 40 + Math.random() * 70;
    particles.push({
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist - 30,
      delay: Math.random() * 0.35,
      kind: 'orb',
    });
  }
  return particles;
}

// ── Sound helpers ──

function playTapSound(tapIndex) {
  if (getAudioMuted()) return;
  try {
    const ctx = ensureContext();
    if (!ctx) return;
    const base = TAP_PITCHES[tapIndex] || 400;
    const triplet = [base, base * 1.25, base * 1.5];
    const t = ctx.currentTime;
    triplet.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const start = t + i * 0.06;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.6, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.15);
      osc.start(start);
      osc.stop(start + 0.2);
    });
  } catch { /* silent */ }
}

function playUpgradeSound() {
  if (getAudioMuted()) return;
  try {
    const ctx = ensureContext();
    if (!ctx) return;
    const notes = [440, 554, 660];
    const t = ctx.currentTime;
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const start = t + i * 0.06;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.6, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  } catch { /* silent */ }
}

// Preloaded audio buffers for chest open sounds
let _preloadedBuffers = null;

async function preloadOpenSounds() {
  if (_preloadedBuffers) return;
  _preloadedBuffers = {};
  try {
    const ctx = ensureContext();
    if (!ctx) return;
    // Load each independently so one failure doesn't kill both
    await Promise.all([
      fetch('/sounds/arena/sfx/crowd-cheer.mp3')
        .then(r => r.arrayBuffer()).then(ab => ctx.decodeAudioData(ab))
        .then(buf => { _preloadedBuffers.cheer = buf; })
        .catch(() => {}),
    ]);
  } catch { /* silent */ }
}

function playOpenSound() {
  if (getAudioMuted()) return;
  try {
    const ctx = ensureContext();
    if (!ctx || !_preloadedBuffers) return;
    // Play crowd cheer
    if (_preloadedBuffers.cheer) {
      const cheerSrc = ctx.createBufferSource();
      cheerSrc.buffer = _preloadedBuffers.cheer;
      const cheerGain = ctx.createGain();
      cheerGain.gain.value = 1.0;
      cheerSrc.connect(cheerGain);
      cheerGain.connect(ctx.destination);
      cheerSrc.start(0);
    }
    // Synthesized chest creak/unlatch — two layered noise bursts
    const t = ctx.currentTime;
    // Layer 1: woody creak (low bandpass)
    const creakLen = 0.6;
    const creakBuf = ctx.createBuffer(1, ctx.sampleRate * creakLen, ctx.sampleRate);
    const creakData = creakBuf.getChannelData(0);
    for (let i = 0; i < creakData.length; i++) {
      creakData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.25));
    }
    const creakSrc = ctx.createBufferSource();
    creakSrc.buffer = creakBuf;
    const creakFilter = ctx.createBiquadFilter();
    creakFilter.type = 'lowpass';
    creakFilter.frequency.value = 800;
    creakFilter.Q.value = 1;
    const creakGain = ctx.createGain();
    creakGain.gain.setValueAtTime(1.0, t);
    creakGain.gain.exponentialRampToValueAtTime(0.001, t + creakLen);
    creakSrc.connect(creakFilter);
    creakFilter.connect(creakGain);
    creakGain.connect(ctx.destination);
    creakSrc.start(t);
    creakSrc.stop(t + creakLen);
    // Layer 2: metallic latch click (high bandpass, short)
    const clickLen = 0.15;
    const clickBuf = ctx.createBuffer(1, ctx.sampleRate * clickLen, ctx.sampleRate);
    const clickData = clickBuf.getChannelData(0);
    for (let i = 0; i < clickData.length; i++) {
      clickData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.03));
    }
    const clickSrc = ctx.createBufferSource();
    clickSrc.buffer = clickBuf;
    const clickFilter = ctx.createBiquadFilter();
    clickFilter.type = 'bandpass';
    clickFilter.frequency.value = 3000;
    clickFilter.Q.value = 2;
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.8, t);
    clickGain.gain.exponentialRampToValueAtTime(0.001, t + clickLen);
    clickSrc.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(ctx.destination);
    clickSrc.start(t);
    clickSrc.stop(t + clickLen);
  } catch { /* silent */ }
}

function playRevealChime() {
  if (getAudioMuted()) return;
  try {
    const ctx = ensureContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.5, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.start(t);
    osc.stop(t + 0.5);
  } catch { /* silent */ }
}

export default function ChestOpenOverlay({ chestId, rarity, gold, items, tapSequence, onClaim, onDismiss }) {
  const [phase, setPhase] = useState('tapping'); // tapping | opening | revealing | summary
  const [tapIndex, setTapIndex] = useState(0);
  const [currentRarity, setCurrentRarity] = useState(tapSequence?.[0] || 'common');
  const [showFlash, setShowFlash] = useState(false);
  const [burstActive, setBurstActive] = useState(false);
  const [revealIndex, setRevealIndex] = useState(0);
  const [claiming, setClaiming] = useState(false);
  const [exiting, setExiting] = useState(false);

  const canvasRef = useRef(null);
  const sceneRef = useRef(null); // for lid animation access
  const timersRef = useRef([]);

  // All reveal items: gold first, then items
  const revealItems = [
    { type: 'gold', icon: '\uD83D\uDCB0', name: `${gold} Gold`, amount: gold },
    ...items.map(it => ({ type: 'item', icon: it.icon || '\uD83C\uDF81', name: it.name, itemType: it.type })),
  ];

  const particles = useRef(generateParticles(24)).current;

  // Preload open sounds during tapping phase
  useEffect(() => { preloadOpenSounds(); }, []);

  // ── Three.js scene ──
  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return;

    const width = window.innerWidth;
    const height = window.innerHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 1.2, 4);
    camera.lookAt(0, 0.5, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    // Lighting — blast the chest with light so it's clearly visible
    const ambient = new THREE.AmbientLight(0xffffff, 4.0);
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 5.0);
    dirLight.position.set(1, 3, 4);
    scene.add(dirLight);

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 3.0);
    dirLight2.position.set(-1, 2, 2);
    scene.add(dirLight2);

    const mainLight = new THREE.PointLight(RARITY_COLORS.common, 4.0, 20);
    mainLight.position.set(0, 2, 3);
    scene.add(mainLight);

    const fillLight = new THREE.PointLight(0xffffff, 3.0, 20);
    fillLight.position.set(-2, 1, 2);
    scene.add(fillLight);

    const rimLight = new THREE.PointLight(0xffffff, 2.0, 15);
    rimLight.position.set(2, 0, -2);
    scene.add(rimLight);

    // Rarity-colored glow backdrop — visible soft halo behind the chest
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 128;
    glowCanvas.height = 128;
    const glowCtx = glowCanvas.getContext('2d');
    const gradient = glowCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.5)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    glowCtx.fillStyle = gradient;
    glowCtx.fillRect(0, 0, 128, 128);
    const glowTexture = new THREE.CanvasTexture(glowCanvas);

    const backGlowMat = new THREE.SpriteMaterial({
      map: glowTexture,
      color: RARITY_COLORS.common,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const backGlow = new THREE.Sprite(backGlowMat);
    backGlow.scale.set(5, 5, 1);
    backGlow.position.set(0, 0.3, -1.2);
    scene.add(backGlow);

    // Interior glow light — starts off, ramps up when lid opens
    const interiorLight = new THREE.PointLight(RARITY_COLORS[rarity] || 0xffffff, 0, 5);
    interiorLight.position.set(0, 0.3, 0);
    scene.add(interiorLight);

    let chestModel = null;
    let lidBone = null;
    let lidRestQuat = null; // bone's rest quaternion
    let mixer = null;
    let spinTween = { active: false, startY: 0, targetY: 0, progress: 0 };
    let lidTween = { active: false, startQuat: null, targetQuat: null, progress: 0 };

    const loader = new GLTFLoader();
    loader.load('/assets/chest/chest.glb', (gltf) => {
      chestModel = gltf.scene;
      chestModel.scale.set(0.65, 0.65, 0.65);
      chestModel.position.set(0, 0, 0);
      scene.add(chestModel);

      // Find lid pivot node (Bone.001) — it's a plain Object3D parent of Chest_Top, not a skinned bone.
      // Hierarchy: Armature → Bone → Bone.001 → Chest_Top
      // Bone.001 rest quat: [x=0.7071, y=0, z=0, w=0.7071] (90° around X)
      // Chest_Top has a counter-rotation so it appears upright at rest.
      chestModel.traverse((node) => {
        if (node.name === 'Bone.001' || node.name === 'Bone001') {
          lidBone = node;
          lidRestQuat = node.quaternion.clone();
        }
      });

      if (gltf.animations && gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(chestModel);
      }
    });

    // ── Sparkle particles ──
    const sparkCount = 30;
    const sparkGeo = new THREE.BufferGeometry();
    const sparkPositions = new Float32Array(sparkCount * 3);
    const sparkVelocities = [];
    for (let i = 0; i < sparkCount; i++) {
      sparkPositions[i * 3] = (Math.random() - 0.5) * 0.5;
      sparkPositions[i * 3 + 1] = 0.3 + Math.random() * 1.2;
      sparkPositions[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
      sparkVelocities.push(0.2 + Math.random() * 0.3);
    }
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
    const sparkMat = new THREE.PointsMaterial({
      color: RARITY_COLORS[rarity] || 0xffffff,
      size: 0.05,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0,
    });
    const sparkles = new THREE.Points(sparkGeo, sparkMat);
    sparkles.visible = false;
    scene.add(sparkles);

    // Glow activation state
    const glowState = { active: false, startTime: 0 };
    // Deferred open: waits for last spin to finish before opening lid
    const pendingOpen = { waiting: false, callback: null };

    sceneRef.current = {
      mainLight,
      get chestModel() { return chestModel; },
      get lidBone() { return lidBone; },
      spinTween,
      lidTween,
      triggerSpin() {
        const currentY = chestModel ? chestModel.rotation.y : 0;
        spinTween.active = true;
        spinTween.startY = currentY;
        // Always target a multiple of 2π so it lands front-facing
        spinTween.targetY = (Math.floor(currentY / (Math.PI * 2)) + 1) * (Math.PI * 2);
        // Ensure at least a half rotation for visual satisfaction
        if (spinTween.targetY - currentY < Math.PI) {
          spinTween.targetY += Math.PI * 2;
        }
        spinTween.progress = 0;
      },
      openLid() {
        if (!lidBone || !lidRestQuat) return;
        // Hinge the lid open by rotating around the bone's local X axis (~-120°).
        const hingeQuat = new THREE.Quaternion();
        hingeQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -120 * (Math.PI / 180));
        const targetQuat = lidRestQuat.clone().multiply(hingeQuat);
        lidTween.active = true;
        lidTween.startQuat = lidRestQuat.clone();
        lidTween.targetQuat = targetQuat;
        lidTween.progress = 0;
      },
      updateLightColor(color) {
        mainLight.color.setHex(color);
        mainLight.intensity = 2;
        backGlowMat.color.setHex(color);
      },
      escalateJiggle(tapNum) {
        jiggleIntensity = 1 + tapNum * 0.6;
      },
      activateGlow() {
        sparkles.visible = true;
        glowState.active = true;
        glowState.startTime = elapsed;
      },
      showOnlyBacklight() {
        // Hide chest, sparkles, and all lights except the backlight glow sprite
        if (chestModel) chestModel.visible = false;
        sparkles.visible = false;
        glowState.active = false;
        mainLight.intensity = 0;
        ambient.intensity = 0;
        dirLight.intensity = 0;
        dirLight2.intensity = 0;
        fillLight.intensity = 0;
        rimLight.intensity = 0;
        interiorLight.intensity = 0;
      },
      deferOpen(callback) {
        if (spinTween.active && chestModel) {
          // Retarget spin to land at the next full rotation (default position)
          const currentY = chestModel.rotation.y;
          spinTween.targetY = Math.ceil(currentY / (Math.PI * 2)) * Math.PI * 2;
          if (spinTween.targetY <= currentY) spinTween.targetY += Math.PI * 2;
          pendingOpen.waiting = true;
          pendingOpen.callback = callback;
        } else {
          callback();
        }
      },
    };

    // ── Bloom post-processing ──
    const rtParams = { format: THREE.RGBAFormat, type: THREE.HalfFloatType };
    const renderTarget = new THREE.WebGLRenderTarget(width, height, rtParams);
    const composer = new EffectComposer(renderer, renderTarget);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.8,  // strength
      0.5,  // radius
      0.3   // threshold
    );
    composer.addPass(bloomPass);

    // Animation loop
    let frameId;
    const clock = new THREE.Clock();
    let elapsed = 0;
    let jiggleIntensity = 1; // escalates with taps

    function animate() {
      frameId = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.1);
      elapsed += dt;

      if (mixer) mixer.update(dt);

      // Idle jiggle — something trying to escape (stop once opened)
      if (chestModel && !spinTween.active && !glowState.active) {
        const jFreq = 8; // fast rattling
        const jAmp = 0.015 * jiggleIntensity;
        // Intermittent bursts: jiggle for ~0.4s every ~1.5s
        const cycle = elapsed % 1.5;
        const jiggling = cycle < 0.4;
        if (jiggling) {
          chestModel.rotation.z = Math.sin(elapsed * jFreq * Math.PI * 2) * jAmp;
          chestModel.rotation.x = Math.cos(elapsed * jFreq * 1.3 * Math.PI * 2) * jAmp * 0.5;
          chestModel.position.y = Math.sin(elapsed * jFreq * 0.7 * Math.PI * 2) * 0.01 * jiggleIntensity;
        } else {
          chestModel.rotation.z *= 0.9; // dampen back to rest
          chestModel.rotation.x *= 0.9;
          chestModel.position.y *= 0.9;
        }
      }

      // Spin tween (on tap)
      if (spinTween.active && chestModel) {
        spinTween.progress = Math.min(spinTween.progress + dt * 2.5, 1);
        const ease = 1 - Math.pow(1 - spinTween.progress, 3);
        chestModel.rotation.y = spinTween.startY + (spinTween.targetY - spinTween.startY) * ease;
        if (spinTween.progress >= 1) {
          spinTween.active = false;
          if (pendingOpen.waiting) {
            pendingOpen.waiting = false;
            pendingOpen.callback();
            pendingOpen.callback = null;
          }
        }
      }

      // Lid open tween — quaternion slerp with overshoot bounce
      if (lidTween.active && lidBone && lidTween.startQuat && lidTween.targetQuat) {
        lidTween.progress = Math.min(lidTween.progress + dt / 1.2, 1); // ~1.2s duration
        // Ease-out with slight overshoot bounce
        const t = lidTween.progress;
        const ease = t < 0.7
          ? 1 - Math.pow(1 - t / 0.7, 3)                  // ease-out to overshoot
          : 1.0 + 0.08 * Math.sin((t - 0.7) / 0.3 * Math.PI); // slight bounce back
        lidBone.quaternion.slerpQuaternions(lidTween.startQuat, lidTween.targetQuat, Math.min(ease, 1.08));
        if (lidTween.progress >= 1) lidTween.active = false;
      }

      // ── Inner glow animation ──
      if (glowState.active) {
        const glowElapsed = elapsed - glowState.startTime;
        const rampT = Math.min(glowElapsed / 0.3, 1); // 0→1 over 0.3s

        // Ramp interior light
        interiorLight.intensity = rampT * 8;

        // Ramp sparkle opacity
        sparkMat.opacity = rampT * 0.8;

        // Animate sparkle positions upward
        const pos = sparkGeo.attributes.position;
        for (let i = 0; i < sparkCount; i++) {
          let y = pos.getY(i) + sparkVelocities[i] * dt;
          if (y > 1.85) {
            y = 0.4 + Math.random() * 0.2;
            pos.setX(i, (Math.random() - 0.5) * 0.3);
            pos.setZ(i, (Math.random() - 0.5) * 0.3);
          }
          pos.setY(i, y);
        }
        pos.needsUpdate = true;
      }

      composer.render();
    }
    animate();

    // Cleanup on unmount
    return () => {
      cancelAnimationFrame(frameId);
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => {
              if (m.map) m.map.dispose();
              m.dispose();
            });
          } else {
            if (obj.material.map) obj.material.map.dispose();
            obj.material.dispose();
          }
        }
      });
      sparkGeo.dispose();
      sparkMat.dispose();
      glowTexture.dispose();
      backGlowMat.dispose();
      composer.dispose();
      renderTarget.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout);
    };
  }, []);

  // ── Tap handler ──
  const handleTap = useCallback(() => {
    if (phase === 'tapping') {
      const nextIndex = tapIndex + 1;

      if (nextIndex < TAP_COUNT) {
        // Taps 1-5: rarity taps with spin
        const prevRarity = tapSequence[tapIndex];
        const nextRarity = tapSequence[Math.min(nextIndex, tapSequence.length - 1)];

        playTapSound(tapIndex);


        // Trigger chest spin + escalate jiggle
        if (sceneRef.current) {
          sceneRef.current.triggerSpin();
          sceneRef.current.updateLightColor(RARITY_COLORS[nextRarity] || RARITY_COLORS.common);
          sceneRef.current.escalateJiggle(nextIndex);
        }

        // Rarity upgrade sound
        if (nextRarity !== prevRarity) {
          const t = setTimeout(() => playUpgradeSound(), 100);
          timersRef.current.push(t);
        }

        setCurrentRarity(nextRarity);
        setTapIndex(nextIndex);
      } else {
        // Tap 6: open the chest — defer until last spin finishes
        setTapIndex(nextIndex);
        const doOpen = () => {
          setPhase('opening');
          playOpenSound();
          setShowFlash(true);
          setBurstActive(true);
          if (sceneRef.current) {
            sceneRef.current.openLid();
            sceneRef.current.activateGlow();
          }
          const t2 = setTimeout(() => setShowFlash(false), 600);
          const t3 = setTimeout(() => {
            if (sceneRef.current) sceneRef.current.showOnlyBacklight();
            setPhase('revealing');
            setRevealIndex(0);
            playRevealChime();
          }, 2500);
          timersRef.current.push(t2, t3);
        };
        if (sceneRef.current) {
          sceneRef.current.deferOpen(doOpen);
        } else {
          doOpen();
        }
      }
    } else if (phase === 'revealing') {
      const nextReveal = revealIndex + 1;
      if (nextReveal < revealItems.length) {
        setRevealIndex(nextReveal);
        playRevealChime();
      } else {
        setPhase('summary');
      }
    }
  }, [phase, tapIndex, tapSequence, revealIndex, revealItems.length]);

  // ── Claim handler ──
  const handleClaim = useCallback(async () => {
    if (claiming) return;
    setClaiming(true);
    try {
      await onClaim(chestId);
    } catch (err) {
      console.error('[Chest] Claim failed:', err);
    }
    // Always dismiss after claim attempt
    setExiting(true);
    const t = setTimeout(() => onDismiss(), 600);
    timersRef.current.push(t);
  }, [chestId, claiming, onClaim, onDismiss]);

  const showRays = currentRarity === 'epic' || currentRarity === 'legendary';

  return (
    <div
      className={`chest-overlay${exiting ? ' chest-exiting' : ''}`}
      onClick={phase === 'tapping' || phase === 'revealing' ? handleTap : undefined}
    >
      {/* Three.js canvas */}
      {(phase === 'tapping' || phase === 'opening' || phase === 'revealing') && (
        <div className="chest-canvas" ref={canvasRef} />
      )}

      {/* Rarity glow */}
      {(phase === 'tapping' || phase === 'opening' || phase === 'revealing') && (
        <div className={`chest-glow chest-glow-${currentRarity}`} />
      )}

      {/* God rays */}
      {showRays && (
        <div className={`chest-rays ${phase === 'tapping' || phase === 'opening' ? 'active' : ''} chest-rays-${currentRarity}`} />
      )}

      {/* Screen flash */}
      <div className={`chest-flash${showFlash ? ' active' : ''}`} />

      {/* Burst particles */}
      {burstActive && particles.map((p, i) => (
        <div
          key={i}
          className={`chest-particle burst ${p.kind === 'orb' ? 'chest-particle-orb' : ''} chest-particle-${rarity}`}
          style={{
            '--p-x': `${p.x}px`,
            '--p-y': `${p.y}px`,
            '--p-delay': `${p.delay}s`,
          }}
        />
      ))}

      {/* Rarity label */}
      {phase === 'tapping' && (
        <div className={`chest-rarity-label chest-rarity-${currentRarity}`}>
          {RARITY_LABELS[currentRarity]}
        </div>
      )}

      {/* Tap prompt + dots */}
      {phase === 'tapping' && (
        <div className="chest-tap-prompt">
          {tapIndex >= TAP_COUNT - 1 ? 'Tap to Open' : 'Tap to Reveal'}
          {tapIndex < TAP_COUNT - 1 && (
            <div className="chest-tap-dots">
              {Array.from({ length: TAP_COUNT - 1 }, (_, i) => (
                <div key={i} className={`chest-tap-dot${i < tapIndex ? ' filled' : ''}`} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Reveal phase */}
      {phase === 'revealing' && (
        <div className="chest-reveal" key={revealIndex}>
          <div className="chest-reveal-card">
            {revealItems[revealIndex].type === 'gold' ? (
              <>
                <div className="chest-reveal-icon">{'\uD83D\uDCB0'}</div>
                <div className="chest-reveal-gold-amount">{revealItems[revealIndex].amount}</div>
                <div className="chest-reveal-gold-label">Gold</div>
              </>
            ) : (
              <>
                <div className="chest-reveal-icon">{revealItems[revealIndex].icon}</div>
                <div className="chest-reveal-name">{revealItems[revealIndex].name}</div>
                <div className="chest-reveal-type">{revealItems[revealIndex].itemType}</div>
              </>
            )}
          </div>
          <div className="chest-reveal-tap-hint">Tap to continue</div>
        </div>
      )}

      {/* Summary phase */}
      {phase === 'summary' && (
        <div className="chest-summary">
          <div className="chest-summary-title">{RARITY_LABELS[rarity]} Chest</div>
          <div className="chest-summary-grid">
            <div className="chest-summary-item">
              <div className="chest-summary-item-icon">{'\uD83D\uDCB0'}</div>
              <div className="chest-summary-item-name">{gold} Gold</div>
            </div>
            {items.map((item, i) => (
              <div key={i} className="chest-summary-item">
                <div className="chest-summary-item-icon">{item.icon || '\uD83C\uDF81'}</div>
                <div className="chest-summary-item-name">{item.name}</div>
              </div>
            ))}
          </div>
          <button
            className="chest-claim-btn"
            onClick={handleClaim}
            disabled={claiming}
          >
            {claiming ? 'Claiming...' : 'Claim'}
          </button>
        </div>
      )}
    </div>
  );
}

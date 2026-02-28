import { useState, useEffect, useRef } from 'react';
import { getAudioMuted } from '../hooks/useAudioSettings';
import { ensureContext } from '../hooks/useUiSounds';
import { loadBuffer, preloadBuffers } from '../lib/sceneAudioEngine';
import '../styles/location-transition.css';

// Location-specific themes for the ink wash
const LOCATION_THEMES = {
  the_dojo: {
    inkColor: '#0c0a07',
    accentColor: '#c4a035',
    particles: 'embers',
    subtitle: 'Training Grounds of the Four Elements',
    bgImage: '/images/dojo_gate.webp',
    characterImage: '/images/kumo_gate.webp',
    characterPosition: 'right', // which side the character sits on
    sound: '/sounds/dojo/gong.mp3',
    preloadAudio: [
      '/sounds/dojo/shakuhachi.mp3',
      '/sounds/dojo/wind-chimes.mp3',
    ],
  },
  dragons_hollow: {
    inkColor: '#0c0a07',
    accentColor: '#d4760a',
    particles: 'sparks',
    subtitle: 'Where Tales Are Told Over Ale',
    bgImage: '/images/scenes/dragons_hallow_exterior.webp',
    sounds: [
      { src: '/sounds/dragons_hollow/transition_whistle.mp3', volume: 0.3 },
      { src: '/sounds/dragons_hollow/transition_roar.mp3', volume: 0.3 },
    ],
    preloadAudio: [
      '/sounds/dragons_hollow/tavern-music.mp3',
      '/sounds/dragons_hollow/tavern-ambient.mp3',
    ],
  },
  the_barracks: {
    inkColor: '#0a0c10',
    accentColor: '#8899aa',
    particles: 'sparks',
    subtitle: 'Stronghold of the Shield',
    bgImage: '/images/scenes/door_to_barracks.webp',
    characterImage: '/images/scenes/threx_forthog_barracks_guard.webp',
    characterPosition: 'right',
    characterScale: 1.5,
    characterOffsetY: 200,
    sound: '/sounds/barracks/horn-of-gondor.mp3',
    soundVolume: 0.15,
    preloadAudio: [
      '/sounds/barracks/rohan-suite.mp3',
      '/sounds/barracks/campfire.mp3',
    ],
  },
  the_veil: {
    inkColor: '#08070a',
    accentColor: '#7b68ee',
    particles: 'wisps',
    subtitle: 'Where Shadows Keep Secrets',
    bgImage: '/images/scenes/veil_exterior.webp',
    sounds: [
      { src: '/sounds/veil/transition.mp3', volume: 0.6 },
      { src: '/sounds/veil/stone-slide-2.mp3', volume: 0.4, delay: 1400 },
    ],
    preloadAudio: [
      '/sounds/veil/veil-ambient.mp3',
    ],
  },
  the_collective: {
    inkColor: '#0c0a07',
    accentColor: '#c0a070',
    particles: 'dust',
    subtitle: 'Heart of Okhan',
    bgImage: '/images/scenes/collective_exterior.webp',
    sounds: [
      { src: '/sounds/collective/footsteps.mp3', volume: 0.3 },
      { src: '/sounds/collective/door-opening.mp3', volume: 0.3, delay: 2000 },
    ],
    preloadAudio: [
      '/sounds/collective/throne-room-v2.mp3',
      '/sounds/collective/quill-writing.mp3',
    ],
  },
  the_arena: {
    inkColor: '#0c0507',
    accentColor: '#ef4444',
    particles: 'confetti',
    subtitle: 'Prove Your Worth',
    bgImage: '/images/scenes/arena_exterior.webp',
    sound: '/sounds/arena/crowd_roar.mp3?v=3',
    soundVolume: 0.3,
    soundFadeIn: 600,
    soundFadeOut: 800,
  },
  the_cottage: {
    inkColor: '#0a0c07',
    accentColor: '#7aab5e',
    particles: 'dust',
    subtitle: 'A Cozy Woodland Retreat',
    bgImage: '/images/scenes/cottage_exterior.webp',
    sounds: [
      { src: '/sounds/cottage/sparkle.mp3', volume: 0.3 },
      { src: '/sounds/cottage/birds.mp3', volume: 0.35 },
      { src: '/sounds/cottage/creek.mp3', volume: 0.2 },
    ],
    preloadAudio: [
      '/sounds/cottage/cottage-ambient.mp3',
      '/sounds/cottage/fireplace.mp3',
    ],
  },
};

const DEFAULT_THEME = {
  inkColor: '#0c0a07',
  accentColor: '#c4a035',
  particles: 'dust',
  subtitle: '',
  bgImage: null,
  characterImage: null,
  characterPosition: 'right',
  sound: null,
};

/**
 * Get all audio URLs that should be preloaded for a location's transition.
 * Call this from the Map when user taps a marker so buffers are ready
 * before they click Enter.
 */
export function getTransitionSoundUrls(locationId) {
  const theme = LOCATION_THEMES[locationId];
  if (!theme) return [];
  const urls = [];
  if (theme.sounds) theme.sounds.forEach(s => urls.push(s.src));
  else if (theme.sound) urls.push(theme.sound);
  return urls;
}

export default function LocationTransition({ locationId, locationName, onComplete }) {
  const [phase, setPhase] = useState('darken'); // darken -> reveal -> fade-out
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const particlesRef = useRef([]);
  const skippedRef = useRef(false);
  const timersRef = useRef([]);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const theme = LOCATION_THEMES[locationId] || DEFAULT_THEME;

  // Preload scene audio into Web Audio API buffer cache during transition
  // so playback starts instantly when SceneAudio mounts
  useEffect(() => {
    if (!theme.preloadAudio || theme.preloadAudio.length === 0) return;
    preloadBuffers(theme.preloadAudio);
  }, [theme.preloadAudio]);

  // Collect all transition sound URLs for this location
  const soundEntries = (() => {
    const entries = [];
    if (theme.sounds) {
      theme.sounds.forEach(s => entries.push({ src: s.src, volume: s.volume ?? 0.3, delay: s.delay ?? 0 }));
    } else if (theme.sound) {
      entries.push({ src: theme.sound, volume: theme.soundVolume ?? 0.3, delay: 0 });
    }
    return entries;
  })();

  // Preload transition sounds into the buffer cache immediately on mount.
  // loadBuffer() caches, so the play effect below gets instant cache hits.
  useEffect(() => {
    if (soundEntries.length === 0) return;
    soundEntries.forEach(({ src }) => loadBuffer(src));
  }, []);

  // Play transition sound(s) via Web Audio API once buffers are ready.
  // Uses the shared AudioContext from useUiSounds (already unlocked by user gesture)
  // instead of new Audio() which Edge and iOS block.
  const soundPlayedRef = useRef(false);
  const sourceNodesRef = useRef([]);
  useEffect(() => {
    if (getAudioMuted()) return;
    if (soundPlayedRef.current) return;
    if (soundEntries.length === 0) return;
    soundPlayedRef.current = true;

    const fadeIn = theme.soundFadeIn || 0;
    const fadeOut = theme.soundFadeOut || 0;
    let cancelled = false;

    async function playEntry({ src, volume, delay }) {
      const ctx = ensureContext();
      if (!ctx || cancelled) return;

      try {
        const buffer = await loadBuffer(src);
        if (!buffer || cancelled) return;

        if (delay > 0) {
          await new Promise(r => {
            const t = setTimeout(r, delay);
            timersRef.current.push(t);
          });
        }
        if (cancelled) return;

        const source = ctx.createBufferSource();
        const gainNode = ctx.createGain();
        source.buffer = buffer;

        // Fade in: start at 0 and ramp to target volume
        if (fadeIn > 0) {
          gainNode.gain.setValueAtTime(0, ctx.currentTime);
          gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + fadeIn / 1000);
        } else {
          gainNode.gain.value = volume;
        }

        source.connect(gainNode).connect(ctx.destination);
        source.start(0);
        sourceNodesRef.current.push({ source, gainNode });

        // Fade out before clip ends
        if (fadeOut > 0 && buffer.duration > 0) {
          const fadeOutStart = Math.max(0, buffer.duration - fadeOut / 1000);
          const t = setTimeout(() => {
            if (cancelled) return;
            gainNode.gain.setValueAtTime(gainNode.gain.value, ctx.currentTime);
            gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeOut / 1000);
          }, fadeOutStart * 1000);
          timersRef.current.push(t);
        }
      } catch {
        // Buffer load/decode failed — skip silently
      }
    }

    soundEntries.forEach(entry => playEntry(entry));

    return () => {
      cancelled = true;
      // Reset the guard so a StrictMode remount can play sounds
      soundPlayedRef.current = false;
      // Don't stop sources — let transition sounds play to completion
      // even after the overlay unmounts. They're one-shot, not looping.
      sourceNodesRef.current = [];
    };
  }, [theme.sound, theme.sounds]);

  // Tap to skip transition
  const handleSkip = (e) => {
    e.stopPropagation();
    if (skippedRef.current) return;
    skippedRef.current = true;
    timersRef.current.forEach(clearTimeout);
    setPhase('fade-out');
    setTimeout(() => onCompleteRef.current(), 300);
  };

  // Phase timing — runs once on mount (ref keeps onComplete stable)
  useEffect(() => {
    const timers = [];

    // Phase 1: Already black on mount
    // Phase 2: Reveal - scene + text appear (500ms - 3100ms)
    timers.push(setTimeout(() => setPhase('reveal'), 500));
    // Phase 3: Fade to black (3100ms - 3500ms)
    timers.push(setTimeout(() => setPhase('fade-out'), 3100));
    // Navigate while still covered by black screen
    timers.push(setTimeout(() => onCompleteRef.current(), 3400));

    timersRef.current = timers;
    return () => timers.forEach(clearTimeout);
  }, []);

  // Particle canvas animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    function resize() {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.scale(dpr, dpr);
    }
    resize();

    // Initialize particles
    const w = window.innerWidth;
    const h = window.innerHeight;
    const CONFETTI_COLORS = [
      '#ef4444', '#f97316', '#eab308', '#22c55e',
      '#3b82f6', '#8b5cf6', '#ec4899', '#ffffff',
    ];
    const count = theme.particles === 'confetti' ? 60
      : theme.particles === 'embers' ? 40
      : theme.particles === 'sparks' ? 35 : 25;

    particlesRef.current = Array.from({ length: count }, () => {
      if (theme.particles === 'confetti') {
        return {
          x: Math.random() * w,
          y: Math.random() * -h,  // start above screen, staggered
          width: Math.random() * 10 + 8,
          height: Math.random() * 6 + 4,
          speedY: Math.random() * 2 + 1.5,
          wobbleSpeed: Math.random() * 0.06 + 0.03,
          wobbleAmp: Math.random() * 40 + 20,
          rotation: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 0.12,
          flipPhase: Math.random() * Math.PI * 2,
          flipSpeed: Math.random() * 0.08 + 0.04,
          life: Math.random() * Math.PI * 2,
          color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
          opacity: Math.random() * 0.3 + 0.7,
        };
      }
      if (theme.particles === 'sparks') {
        // Sparks: fast arcing particles from random strike points
        const originX = Math.random() * w;
        const originY = h * 0.3 + Math.random() * h * 0.5;
        return {
          x: originX,
          y: originY,
          size: Math.random() * 2 + 0.5,
          speedX: (Math.random() - 0.5) * 2.5,
          speedY: -(Math.random() * 2 + 1),
          gravity: 0.04,
          opacity: Math.random() * 0.9 + 0.1,
          life: Math.random(),
          decay: Math.random() * 0.008 + 0.004,
        };
      }
      return {
        x: Math.random() * w,
        y: Math.random() * h + h * 0.2,
        size: Math.random() * 3 + 1,
        speedX: (Math.random() - 0.5) * 0.5,
        speedY: -(Math.random() * 1.5 + 0.5),
        opacity: Math.random() * 0.8 + 0.2,
        life: Math.random(),
        decay: Math.random() * 0.003 + 0.001,
      };
    });

    function getParticleColor(opacity) {
      const accent = theme.accentColor;
      // Parse hex color
      const r = parseInt(accent.slice(1, 3), 16);
      const g = parseInt(accent.slice(3, 5), 16);
      const b = parseInt(accent.slice(5, 7), 16);

      if (theme.particles === 'embers') {
        return `rgba(${r + 40}, ${g - 20}, ${Math.max(0, b - 30)}, ${opacity})`;
      }
      if (theme.particles === 'sparks') {
        // Bright metallic white-blue sparks
        return `rgba(${Math.min(255, r + 80)}, ${Math.min(255, g + 60)}, ${Math.min(255, b + 40)}, ${opacity})`;
      }
      if (theme.particles === 'wisps') {
        return `rgba(${r}, ${g}, ${b}, ${opacity * 0.6})`;
      }
      return `rgba(${r}, ${g}, ${b}, ${opacity * 0.4})`;
    }

    function animate() {
      ctx.clearRect(0, 0, w, h);

      for (const p of particlesRef.current) {
        if (theme.particles === 'confetti') {
          // Confetti: flutter down with wobble and tumble
          p.life += p.wobbleSpeed;
          p.x += Math.sin(p.life) * p.wobbleAmp * 0.02;
          p.y += p.speedY;
          p.rotation += p.rotSpeed;
          p.flipPhase += p.flipSpeed;

          // Respawn above when fallen below
          if (p.y > h + 20) {
            p.y = -10;
            p.x = Math.random() * w;
          }
        } else if (theme.particles === 'sparks') {
          // Sparks: gravity-affected arcing motion
          p.x += p.speedX;
          p.speedY += p.gravity;
          p.y += p.speedY;
          p.life += p.decay;
          p.opacity = Math.max(0, p.opacity - p.decay * 1.5);

          if (p.y > h + 10 || p.opacity <= 0) {
            // Respawn from a new strike point
            p.x = Math.random() * w;
            p.y = h * 0.3 + Math.random() * h * 0.5;
            p.speedX = (Math.random() - 0.5) * 2.5;
            p.speedY = -(Math.random() * 2 + 1);
            p.opacity = Math.random() * 0.9 + 0.1;
            p.life = Math.random();
          }
        } else {
          p.x += p.speedX + Math.sin(p.life * 3) * 0.3;
          p.y += p.speedY;
          p.life += p.decay;
          p.opacity = Math.max(0, p.opacity - p.decay * 0.5);

          if (p.y < -10 || p.opacity <= 0) {
            p.y = h + 10;
            p.x = Math.random() * w;
            p.opacity = Math.random() * 0.8 + 0.2;
            p.life = Math.random();
          }
        }

        if (theme.particles === 'confetti') {
          // Flat rectangular confetti pieces with 3D tumble
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          // Simulate 3D flip by scaling width with sin
          const scaleX = Math.cos(p.flipPhase);
          ctx.scale(scaleX, 1);
          ctx.globalAlpha = p.opacity;
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);
          ctx.restore();
          continue;
        }

        ctx.beginPath();
        if (theme.particles === 'sparks') {
          // Sharp bright spark with a short trail
          const trail = p.size * 4;
          const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, trail);
          gradient.addColorStop(0, getParticleColor(p.opacity));
          gradient.addColorStop(0.3, getParticleColor(p.opacity * 0.6));
          gradient.addColorStop(1, getParticleColor(0));
          ctx.fillStyle = gradient;
          ctx.arc(p.x, p.y, trail, 0, Math.PI * 2);
        } else if (theme.particles === 'embers') {
          // Glowing ember dots
          const glow = p.size * 3;
          const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glow);
          gradient.addColorStop(0, getParticleColor(p.opacity));
          gradient.addColorStop(1, getParticleColor(0));
          ctx.fillStyle = gradient;
          ctx.arc(p.x, p.y, glow, 0, Math.PI * 2);
        } else if (theme.particles === 'wisps') {
          // Elongated wisp shapes
          ctx.ellipse(p.x, p.y, p.size * 2, p.size * 0.5, p.life * 2, 0, Math.PI * 2);
          ctx.fillStyle = getParticleColor(p.opacity);
        } else {
          // Simple dust motes
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fillStyle = getParticleColor(p.opacity);
        }
        ctx.fill();
      }

      animFrameRef.current = requestAnimationFrame(animate);
    }

    animate();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [theme]);

  return (
    <div
      className={`location-transition phase-${phase}`}
      style={{
        '--ink-color': theme.inkColor,
        '--accent-color': theme.accentColor,
      }}
      onClick={handleSkip}
    >
      {/* Background scene image (revealed as ink clears) */}
      {theme.bgImage && (
        <div
          className="transition-bg"
          style={{ backgroundImage: `url(${theme.bgImage})` }}
        />
      )}

      {/* Dark overlay for fade transitions */}
      <div className="transition-overlay" />

      {/* Vignette removed per feedback */}

      {/* Character layer - in front of bg, behind text */}
      {theme.characterImage && (
        <div
          className={`transition-character char-${theme.characterPosition}`}
          style={{
            ...(theme.characterOffsetY ? { bottom: `-${theme.characterOffsetY}px` } : {}),
          }}
        >
          <img
            src={theme.characterImage}
            alt=""
            draggable={false}
            style={{
              ...(theme.characterScale ? {
                transform: `scale(${theme.characterScale})`,
                transformOrigin: 'bottom center',
              } : {}),
            }}
          />
        </div>
      )}

      {/* Particle canvas */}
      <canvas ref={canvasRef} className="particle-canvas" />

      {/* Location name reveal */}
      <div className="transition-content">
        <div className="transition-accent-line" />
        <h1 className="transition-name">{locationName}</h1>
        {theme.subtitle && (
          <p className="transition-subtitle">{theme.subtitle}</p>
        )}
        <div className="transition-accent-line" />
      </div>
    </div>
  );
}

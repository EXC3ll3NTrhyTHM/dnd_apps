import { useState, useEffect, useRef } from 'react';
import { getAudioMuted } from '../hooks/useAudioSettings';
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
  },
  dragons_hollow: {
    inkColor: '#0c0a07',
    accentColor: '#d4760a',
    particles: 'sparks',
    subtitle: 'Where Tales Are Told Over Ale',
    bgImage: null,
    sound: null,
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
  },
  the_collective: {
    inkColor: '#0c0a07',
    accentColor: '#c0a070',
    particles: 'dust',
    subtitle: 'Heart of Okhan',
    bgImage: null,
    sound: null,
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

export default function LocationTransition({ locationId, locationName, onComplete }) {
  const [phase, setPhase] = useState('darken'); // darken -> reveal -> fade-out
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const particlesRef = useRef([]);
  const skippedRef = useRef(false);
  const timersRef = useRef([]);

  const theme = LOCATION_THEMES[locationId] || DEFAULT_THEME;

  // Play location-specific sound effect(s)
  useEffect(() => {
    if (getAudioMuted()) return;

    // Build list: support both single `sound` and layered `sounds` array
    const entries = [];
    if (theme.sounds) {
      theme.sounds.forEach(s => entries.push({ src: s.src, volume: s.volume ?? 0.3, delay: s.delay ?? 0 }));
    } else if (theme.sound) {
      entries.push({ src: theme.sound, volume: theme.soundVolume ?? 0.3 });
    }
    if (entries.length === 0) return;

    entries.forEach(({ src, volume, delay }) => {
      const audio = new Audio();
      audio.volume = volume;

      audio.addEventListener('canplaythrough', () => {
        if (delay > 0) {
          const t = setTimeout(() => audio.play().catch(() => {}), delay);
          timersRef.current.push(t);
        } else {
          audio.play().catch(() => {});
        }
      }, { once: true });

      audio.addEventListener('error', (e) => {
        console.warn('Transition sound failed to load:', src, e);
      });

      audio.src = src;
      audio.load();
    });

    // No cleanup - let one-shot sounds ring out naturally after transition unmounts
  }, [theme.sound, theme.sounds]);

  // Tap to skip transition
  const handleSkip = (e) => {
    e.stopPropagation();
    if (skippedRef.current) return;
    skippedRef.current = true;
    timersRef.current.forEach(clearTimeout);
    setPhase('fade-out');
    setTimeout(() => onComplete(), 300);
  };

  // Phase timing
  useEffect(() => {
    const timers = [];

    // Phase 1: Already black on mount
    // Phase 2: Reveal - scene + text appear (500ms - 3100ms)
    timers.push(setTimeout(() => setPhase('reveal'), 500));
    // Phase 3: Fade to black (3100ms - 3500ms)
    timers.push(setTimeout(() => setPhase('fade-out'), 3100));
    // Navigate while still covered by black screen
    timers.push(setTimeout(() => onComplete(), 3400));

    timersRef.current = timers;
    return () => timers.forEach(clearTimeout);
  }, [onComplete]);

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
    const count = theme.particles === 'embers' ? 40 : theme.particles === 'sparks' ? 35 : 25;

    particlesRef.current = Array.from({ length: count }, () => {
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
        if (theme.particles === 'sparks') {
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

import { useEffect, useRef } from 'react';
import { getAudioMuted } from '../hooks/useAudioSettings';
import '../styles/dm-award.css';

const PARTICLE_COUNT = 15;
const DURATION = 2500;

/**
 * Screen-edge shimmer + floating loot particles for DM gold/XP awards.
 * pointer-events: none throughout — no interaction needed.
 * Auto-dismisses after 2.5s.
 */
export default function DmAwardEffect({ type, amount, onDone }) {
  const doneRef = useRef(false);

  // Auto-dismiss after duration
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!doneRef.current) {
        doneRef.current = true;
        onDone();
      }
    }, DURATION);
    return () => clearTimeout(timer);
  }, [onDone]);

  // Sound effect
  useEffect(() => {
    if (getAudioMuted()) return;

    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();

      const t = ctx.currentTime + 0.05;

      if (type === 'gold') {
        // Coin clink: 2 quick metallic pings
        [0, 0.1].forEach((delay, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'square';
          osc.frequency.value = i === 0 ? 2400 : 3200;
          osc.connect(gain);
          gain.connect(ctx.destination);
          const s = t + delay;
          gain.gain.setValueAtTime(0, s);
          gain.gain.linearRampToValueAtTime(0.1, s + 0.005);
          gain.gain.exponentialRampToValueAtTime(0.001, s + 0.15);
          osc.start(s);
          osc.stop(s + 0.2);
        });
      } else {
        // Crystal chime: short bright tone
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 1200;
        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.12, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
        osc.start(t);
        osc.stop(t + 0.7);

        // Overtone
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.value = 1800;
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        gain2.gain.setValueAtTime(0, t);
        gain2.gain.linearRampToValueAtTime(0.06, t + 0.02);
        gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc2.start(t);
        osc2.stop(t + 0.5);
      }

      setTimeout(() => ctx.close().catch(() => {}), 2000);
    } catch {
      // Web Audio not available
    }
  }, [type]);

  // Build particles with random spread and stagger
  const particles = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
    const spread = (Math.random() - 0.5) * 200;
    const delay = Math.random() * 0.4;
    return (
      <div
        key={i}
        className="dm-award-particle"
        style={{
          '--p-x': `${spread}px`,
          '--p-delay': `${delay}s`,
        }}
      />
    );
  });

  const label = type === 'gold' ? 'Gold' : 'XP';
  const sign = amount >= 0 ? '+' : '';
  const text = `${sign}${amount} ${label}`;

  return (
    <div className={`dm-award-overlay dm-award-${type}`}>
      <div className="dm-award-shimmer" />
      <div className="dm-award-particles">{particles}</div>
      <div className="dm-award-text">{text}</div>
    </div>
  );
}

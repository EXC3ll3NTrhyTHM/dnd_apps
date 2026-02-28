import { useEffect, useRef } from 'react';
import { getAudioMuted } from '../hooks/useAudioSettings';
import { ensureContext } from '../hooks/useUiSounds';
import '../styles/dm-award.css';

const PARTICLE_COUNT = 15;
const DURATION = 2500;

function playGoldSound(ctx, t) {
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
}

function playXpSound(ctx, t) {
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

/**
 * Screen-edge shimmer + floating loot particles for DM gold/XP awards.
 * pointer-events: none throughout — no interaction needed.
 * Auto-dismisses after 2.5s.
 *
 * Single-type: <DmAwardEffect type="gold" amount={10} onDone={...} />
 * Combined:    <DmAwardEffect gold={10} xp={50} onDone={...} />
 */
export default function DmAwardEffect({ type, amount, gold, xp, onDone }) {
  const combined = gold > 0 && xp > 0;
  const effectType = combined ? 'combined' : type;
  const doneRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!doneRef.current) {
        doneRef.current = true;
        onDone();
      }
    }, DURATION);
    return () => clearTimeout(timer);
  }, [onDone]);

  useEffect(() => {
    if (getAudioMuted()) return;

    try {
      const ctx = ensureContext();
      if (!ctx) return;

      const t = ctx.currentTime + 0.05;

      if (combined) {
        playGoldSound(ctx, t);
        playXpSound(ctx, t);
      } else if (effectType === 'gold') {
        playGoldSound(ctx, t);
      } else {
        playXpSound(ctx, t);
      }

    } catch {
      // Web Audio not available
    }
  }, [effectType, combined]);

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

  let textContent;
  if (combined) {
    textContent = (
      <>
        <div className="dm-award-line-xp">+{xp} XP</div>
        <div className="dm-award-line-gold">+{gold} Gold</div>
      </>
    );
  } else {
    const label = effectType === 'gold' ? 'Gold' : 'XP';
    const sign = amount >= 0 ? '+' : '';
    textContent = `${sign}${amount} ${label}`;
  }

  return (
    <div className={`dm-award-overlay dm-award-${effectType}`}>
      <div className="dm-award-shimmer" />
      <div className="dm-award-particles">{particles}</div>
      <div className="dm-award-text">{textContent}</div>
    </div>
  );
}

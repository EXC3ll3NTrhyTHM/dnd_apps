import { useEffect, useState, useRef } from 'react';
import { getAudioMuted } from '../hooks/useAudioSettings';
import { ensureContext } from '../hooks/useUiSounds';
import '../styles/level-up.css';

/**
 * Full-screen level-up celebration overlay.
 * Dark fantasy aesthetic with golden rays, ember particles, ascending chime.
 * Auto-dismisses after 4.5s, tap to dismiss early.
 */
export default function LevelUpOverlay({ level, onDismiss }) {
  const [exiting, setExiting] = useState(false);
  const dismissed = useRef(false);

  const dismiss = () => {
    if (dismissed.current) return;
    dismissed.current = true;
    setExiting(true);
    setTimeout(onDismiss, 800);
  };

  // Auto-dismiss: start fade-out at 3.7s, dismiss at 4.5s
  useEffect(() => {
    const fadeTimer = setTimeout(() => setExiting(true), 3700);
    const dismissTimer = setTimeout(() => {
      if (!dismissed.current) {
        dismissed.current = true;
        onDismiss();
      }
    }, 4500);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(dismissTimer);
    };
  }, [onDismiss]);

  // Play ascending chime via Web Audio API
  useEffect(() => {
    if (getAudioMuted()) return;

    try {
      const ctx = ensureContext();
      if (!ctx) return;

      // Ascending arpeggio: 4 quick notes
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      const startTime = ctx.currentTime + 0.05;

      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(ctx.destination);

        const noteStart = startTime + i * 0.12;
        gain.gain.setValueAtTime(0, noteStart);
        gain.gain.linearRampToValueAtTime(0.15, noteStart + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.5);

        osc.start(noteStart);
        osc.stop(noteStart + 0.6);
      });

      // Shimmer overtone
      const shimmer = ctx.createOscillator();
      const shimmerGain = ctx.createGain();
      shimmer.type = 'triangle';
      shimmer.frequency.value = 2093;
      shimmer.connect(shimmerGain);
      shimmerGain.connect(ctx.destination);
      const shimmerStart = startTime + 0.4;
      shimmerGain.gain.setValueAtTime(0, shimmerStart);
      shimmerGain.gain.linearRampToValueAtTime(0.06, shimmerStart + 0.05);
      shimmerGain.gain.exponentialRampToValueAtTime(0.001, shimmerStart + 1.2);
      shimmer.start(shimmerStart);
      shimmer.stop(shimmerStart + 1.3);

    } catch {
      // Web Audio not available — silent fallback
    }
  }, []);

  return (
    <div
      className={`level-up-overlay${exiting ? ' level-up-exiting' : ''}`}
      onClick={dismiss}
    >
      <div className="level-up-backdrop" />
      <div className="level-up-rays" />

      {/* Ember particles */}
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="level-up-ember" />
      ))}

      <div className="level-up-content">
        <div className="level-up-label">Level Up</div>
        <div className="level-up-number">{level}</div>
        <div className="level-up-rule" />
        <div className="level-up-subtitle">A new threshold of power</div>
      </div>
    </div>
  );
}

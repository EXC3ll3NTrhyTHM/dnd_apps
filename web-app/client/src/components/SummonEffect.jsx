import { useState, useEffect, useRef } from 'react';
import { getAudioMuted } from '../hooks/useAudioSettings';
import NpcPortrait from './NpcPortrait';
import '../styles/summon.css';

/**
 * Full-screen summoning animation for Marcel DM.
 * Phases: glow (replay M) → sigil (arcane circle) → reveal (portrait) → transition
 *
 * For DMs: after reveal, enters 'pick' phase showing a player list instead of transitioning out.
 */
export default function SummonEffect({ onComplete, onPickPlayer, gesturePoints = [], isDM = false, dmPlayers = [], unread = {} }) {
  const [phase, setPhase] = useState('glow');
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const skippedRef = useRef(false);
  const timersRef = useRef([]);
  const onCompleteRef = useRef(onComplete);
  const particlesRef = useRef([]);
  onCompleteRef.current = onComplete;

  // Play sparkle sound + haptic feedback
  useEffect(() => {
    if (!getAudioMuted()) {
      const audio = new Audio('/sounds/cottage/sparkle.mp3');
      audio.volume = 0.4;
      audio.play().catch(() => {});
    }
    if (navigator.vibrate) {
      navigator.vibrate([50, 80, 50, 80, 200]);
    }
  }, []);

  // Phase timing
  useEffect(() => {
    const t = [];
    t.push(setTimeout(() => setPhase('sigil'), 600));
    t.push(setTimeout(() => setPhase('reveal'), 1800));

    if (isDM) {
      // DM flow: after reveal, show the player picker
      t.push(setTimeout(() => setPhase('pick'), 3000));
    } else {
      // Player flow: transition out and navigate
      t.push(setTimeout(() => {
        setPhase('transition');
        if (navigator.vibrate) navigator.vibrate(100);
      }, 3000));
      t.push(setTimeout(() => onCompleteRef.current(), 3500));
    }

    timersRef.current = t;
    return () => t.forEach(clearTimeout);
  }, [isDM]);

  // Tap to skip (only for non-DM, or during pre-pick phases)
  const handleSkip = (e) => {
    e.stopPropagation();
    if (skippedRef.current) return;
    if (phase === 'pick') return; // don't skip the picker
    skippedRef.current = true;
    timersRef.current.forEach(clearTimeout);

    if (isDM) {
      setPhase('pick');
    } else {
      setPhase('transition');
      setTimeout(() => onCompleteRef.current(), 300);
    }
  };

  // DM selects a player
  const handleSelectPlayer = (userId) => {
    if (navigator.vibrate) navigator.vibrate(50);
    setPhase('transition');
    setTimeout(() => {
      if (onPickPlayer) onPickPlayer(userId);
    }, 400);
  };

  // DM dismisses picker — fade out to map (no black flash)
  const handleDismiss = () => {
    setPhase('dismiss');
    setTimeout(() => onCompleteRef.current('dismiss'), 400);
  };

  // Canvas: replay M path in glow phase, then particles
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(dpr, dpr);

    particlesRef.current = Array.from({ length: 30 }, () => ({
      angle: Math.random() * Math.PI * 2,
      radius: 60 + Math.random() * 80,
      speed: (Math.random() - 0.5) * 0.02,
      size: Math.random() * 2.5 + 1,
      opacity: Math.random() * 0.6 + 0.3,
      drift: Math.random() * 0.01,
    }));

    let replayIdx = 0;
    const replayPoints = gesturePoints.length > 0 ? gesturePoints : [];
    const replaySpeed = replayPoints.length > 0 ? Math.max(1, Math.floor(replayPoints.length / 30)) : 1;

    function animate() {
      ctx.clearRect(0, 0, w, h);

      // Phase: glow — replay M drawing
      if (replayPoints.length > 0 && replayIdx < replayPoints.length) {
        replayIdx = Math.min(replayIdx + replaySpeed, replayPoints.length);
        ctx.save();
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = '#a855f7';
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.moveTo(replayPoints[0].x, replayPoints[0].y);
        for (let i = 1; i < replayIdx; i++) {
          ctx.lineTo(replayPoints[i].x, replayPoints[i].y);
        }
        ctx.stroke();
        ctx.restore();
      }

      // Particles
      const cx = w / 2;
      const cy = h / 2;
      for (const p of particlesRef.current) {
        p.angle += p.speed;
        p.opacity += p.drift;
        if (p.opacity > 0.9) p.drift = -Math.abs(p.drift);
        if (p.opacity < 0.2) p.drift = Math.abs(p.drift);

        const px = cx + Math.cos(p.angle) * p.radius;
        const py = cy + Math.sin(p.angle) * p.radius;

        ctx.beginPath();
        const grad = ctx.createRadialGradient(px, py, 0, px, py, p.size * 3);
        grad.addColorStop(0, `rgba(168, 85, 247, ${p.opacity})`);
        grad.addColorStop(1, `rgba(168, 85, 247, 0)`);
        ctx.fillStyle = grad;
        ctx.arc(px, py, p.size * 3, 0, Math.PI * 2);
        ctx.fill();
      }

      animFrameRef.current = requestAnimationFrame(animate);
    }
    animate();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [gesturePoints]);

  return (
    <div className={`summon-effect phase-${phase}`} onClick={handleSkip}>
      {/* Dark overlay */}
      <div className="summon-overlay" />

      {/* Canvas for M replay + particles */}
      <canvas ref={canvasRef} className="summon-canvas" />

      {/* Arcane circle (sigil phase) */}
      <div className="summon-sigil">
        <div className="summon-circle" />
        <div className="summon-circle summon-circle-inner" />
        <div className="summon-runes">
          {['M', '\u2666', '\u2726', '\u2605', '\u2736', '\u2666'].map((r, i) => (
            <div
              key={i}
              className="summon-rune"
              style={{ '--rune-index': i, '--rune-total': 6 }}
            >
              {r}
            </div>
          ))}
        </div>
      </div>

      {/* Marcel portrait (reveal phase) */}
      <div className="summon-portrait">
        <div className="summon-portrait-glow" />
        <NpcPortrait npcId="marcel" size={96} />
      </div>

      {/* DM Player Picker (pick phase) */}
      {isDM && (
        <div className="summon-dm-picker" onClick={(e) => e.stopPropagation()}>
          <div className="summon-dm-picker-header">
            <NpcPortrait npcId="marcel" size={48} />
            <div className="summon-dm-picker-title">Marcel's Channels</div>
          </div>
          <div className="summon-dm-picker-list">
            {dmPlayers.map(p => (
              <button
                key={p.userId}
                className="summon-dm-picker-row"
                onClick={() => handleSelectPlayer(p.userId)}
              >
                {p.avatar ? (
                  <img src={p.avatar} alt="" className="summon-dm-picker-avatar" />
                ) : (
                  <div className="summon-dm-picker-avatar summon-dm-picker-avatar-empty" />
                )}
                <span className="summon-dm-picker-name">
                  {p.characterName || p.displayName || p.userId}
                </span>
                {unread[`marcel_dm_${p.userId}`] && (
                  <span className="summon-dm-picker-unread" />
                )}
              </button>
            ))}
            {dmPlayers.length === 0 && (
              <div className="summon-dm-picker-empty">No player channels yet</div>
            )}
          </div>
          <button className="summon-dm-picker-dismiss" onClick={handleDismiss}>
            Dismiss
          </button>
        </div>
      )}

      {/* Flash (transition phase) */}
      <div className="summon-flash" />
    </div>
  );
}

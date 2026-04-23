import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../hooks/useApi';
import LevelUpOverlay from './LevelUpOverlay';
import '../styles/fishing.css';

const RARITY_COLORS = {
  junk: '#6b5b45',
  common: '#a0a0a0',
  uncommon: '#4ade80',
  rare: '#60a5fa',
  epic: '#a855f7',
  legendary: '#f59e0b',
};

const RARITY_LABELS = {
  junk: 'Junk',
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

const BAIT_IDS = ['basic_worm', 'enchanted_grub', 'abyssal_lure'];
const BAIT_ICONS = {
  basic_worm: '\ud83e\udeb1',
  enchanted_grub: '\u2728',
  abyssal_lure: '\ud83c\udf0a',
};

function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch {}
}

export default function FishingOverlay({ onClose }) {
  const [phase, setPhase] = useState('idle'); // idle|casting|waiting|bite|reeling|result|missed
  const [inventory, setInventory] = useState([]);
  const [selectedBait, setSelectedBait] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);

  // Cast state
  const [castToken, setCastToken] = useState(null);
  const [fishData, setFishData] = useState(null);
  const [baitRemaining, setBaitRemaining] = useState(0);

  // Reel state
  const [reelProgress, setReelProgress] = useState(0);
  const [reelTimer, setReelTimer] = useState(100);
  const reelRef = useRef({ progress: 0, interval: null, taps: 0 });
  const reelTimerRef = useRef(null);

  // Result state
  const [catchResult, setCatchResult] = useState(null);
  const [achievements, setAchievements] = useState([]);
  const [sellLoading, setSellLoading] = useState(false);
  const [resultReady, setResultReady] = useState(false);
  const [levelUp, setLevelUp] = useState(null);

  // Guards against double-firing handleCatchSuccess during rapid taps
  const confirmingRef = useRef(false);

  // Bite timer
  const [biteTimer, setBiteTimer] = useState(100);
  const biteTimerRef = useRef(null);
  const biteWindowRef = useRef(null);
  const biteCountdownRef = useRef(null);

  // Load inventory on mount
  useEffect(() => {
    loadInventory();
    return () => {
      clearTimeout(biteTimerRef.current);
      clearTimeout(biteWindowRef.current);
      clearInterval(biteCountdownRef.current);
      clearInterval(reelTimerRef.current);
      if (reelRef.current.interval) clearInterval(reelRef.current.interval);
    };
  }, []);

  async function loadInventory() {
    try {
      setLoading(true);
      const [invData, lbData] = await Promise.all([
        api('/api/inventory'),
        api('/api/fishing/leaderboard').catch(() => ({ leaderboard: [] })),
      ]);
      const items = invData.inventory?.items || invData.items || [];
      setInventory(items);
      setLeaderboard(lbData.leaderboard || []);

      // Auto-select first bait found
      const firstBait = items.find(i => BAIT_IDS.includes(i.item_id) && i.quantity > 0);
      if (firstBait) setSelectedBait(firstBait.item_id);
    } catch (err) {
      setError('Failed to load inventory');
    } finally {
      setLoading(false);
    }
  }

  const baitItems = inventory.filter(i => BAIT_IDS.includes(i.item_id) && i.quantity > 0);
  const hasBait = baitItems.length > 0;

  // ---- CAST ----
  const handleCast = useCallback(async () => {
    if (!selectedBait) return;
    setPhase('casting');
    setError(null);

    try {
      const data = await api('/api/fishing/cast', {
        method: 'POST',
        body: JSON.stringify({ baitId: selectedBait }),
      });

      setCastToken(data.castToken);
      setFishData(data.fish);
      setBaitRemaining(data.baitRemaining);

      // Update local inventory count
      setInventory(prev => prev.map(i =>
        i.item_id === selectedBait
          ? { ...i, quantity: data.baitRemaining }
          : i
      ));

      // Cast animation → waiting
      setTimeout(() => {
        setPhase('waiting');

        // Bite delay from server
        biteTimerRef.current = setTimeout(() => {
          setPhase('bite');
          vibrate([50, 50, 50]); // double pulse

          // Start visual countdown tied to biteWindow
          const bw = data.fish.biteWindow;
          const tick = 30; // update every 30ms for smooth drain
          const drain = (100 / bw) * tick;
          setBiteTimer(100);
          biteCountdownRef.current = setInterval(() => {
            setBiteTimer(prev => Math.max(0, prev - drain));
          }, tick);

          // Bite window timer
          biteWindowRef.current = setTimeout(() => {
            clearInterval(biteCountdownRef.current);
            // Missed!
            handleMiss(data.castToken);
          }, bw);
        }, data.biteDelay);
      }, 1000);
    } catch (err) {
      setError(err.message || 'Cast failed');
      setPhase('idle');
    }
  }, [selectedBait]);

  // ---- BITE TAP ----
  const handleBiteTap = useCallback(() => {
    if (phase !== 'bite') return;
    clearTimeout(biteWindowRef.current);
    clearInterval(biteCountdownRef.current);
    vibrate(30);

    // Start reeling phase
    setPhase('reeling');
    const r = reelRef.current;
    r.progress = 0;
    r.taps = 0;
    setReelProgress(0);

    // Decay interval
    const decayRate = (fishData?.reelDifficulty || 1) * 1.5;
    r.interval = setInterval(() => {
      r.progress = Math.max(0, r.progress - decayRate);
      setReelProgress(r.progress);
    }, 200);

    // Reel time limit — harder fish = less time
    // diff 1 = 12s, diff 2 = 10s, diff 3 = 8s, diff 4 = 7s, diff 5 = 6s
    const diff = fishData?.reelDifficulty || 1;
    const reelTimeMs = Math.max(6000, 14000 - diff * 2000);
    const tick = 50;
    const drain = (100 / reelTimeMs) * tick;
    let reelTimeLeft = 100;
    setReelTimer(100);
    reelTimerRef.current = setInterval(() => {
      // Guard: if catch already confirmed, do nothing
      if (confirmingRef.current) {
        clearInterval(reelTimerRef.current);
        return;
      }
      reelTimeLeft = Math.max(0, reelTimeLeft - drain);
      setReelTimer(reelTimeLeft);
      if (reelTimeLeft <= 0) {
        // Time's up — fish escapes
        clearInterval(reelTimerRef.current);
        clearInterval(r.interval);
        r.interval = null;
        handleMiss();
      }
    }, tick);
  }, [phase, fishData]);

  // ---- REEL TAP ----
  const handleReelTap = useCallback(() => {
    if (phase !== 'reeling' || !fishData || confirmingRef.current) return;
    vibrate(15);

    const r = reelRef.current;
    const tapValue = 100 / fishData.reelTaps;
    r.progress = Math.min(100, r.progress + tapValue);
    r.taps += 1;
    setReelProgress(r.progress);

    if (r.progress >= 100) {
      // Success! Lock immediately so further taps are ignored
      confirmingRef.current = true;
      clearInterval(r.interval);
      clearInterval(reelTimerRef.current);
      r.interval = null;
      vibrate([100, 50, 200]); // long celebration
      handleCatchSuccess();
    }
  }, [phase, fishData]);

  // ---- MISS ----
  async function handleMiss(token) {
    const t = token || castToken;
    setPhase('missed');
    clearTimeout(biteTimerRef.current);
    clearTimeout(biteWindowRef.current);
    clearInterval(biteCountdownRef.current);
    clearInterval(reelTimerRef.current);
    if (reelRef.current.interval) {
      clearInterval(reelRef.current.interval);
      reelRef.current.interval = null;
    }

    try {
      await api('/api/fishing/confirm', {
        method: 'POST',
        body: JSON.stringify({ castToken: t, success: false }),
      });
    } catch {}
  }

  // ---- CATCH SUCCESS ----
  async function handleCatchSuccess() {
    try {
      const data = await api('/api/fishing/confirm', {
        method: 'POST',
        body: JSON.stringify({ castToken, success: true }),
      });

      setCatchResult(data.fish);
      setAchievements(data.newAchievements || []);
      if (data.levelUp) setLevelUp(data.levelUp.newLevel);
      setPhase('reveal');

      // Auto-transition to interactive result after reveal plays
      setTimeout(() => setPhase('result'), 3200);
    } catch (err) {
      setError(err.message || 'Confirm failed');
      setPhase('idle');
    }
  }

  // ---- SELL FISH ----
  async function handleSell() {
    if (!catchResult || sellLoading) return;
    setSellLoading(true);

    try {
      const data = await api('/api/fishing/sell', {
        method: 'POST',
        body: JSON.stringify({ fishId: catchResult.id }),
      });

      setAchievements(prev => [...prev, ...(data.newAchievements || [])]);
      setCatchResult(prev => ({
        ...prev,
        sold: true,
        goldAwarded: data.goldAwarded,
        balance: data.balance,
      }));
    } catch (err) {
      setError(err.message || 'Sell failed');
    } finally {
      setSellLoading(false);
    }
  }

  // ---- CAST AGAIN ----
  function handleCastAgain() {
    confirmingRef.current = false;
    setCastToken(null);
    setFishData(null);
    setCatchResult(null);
    setAchievements([]);
    setLevelUp(null);
    setError(null);
    setPhase('idle');
    loadInventory();
  }

  // Screen tap handler (delegates based on phase)
  const handleScreenTap = useCallback((e) => {
    if (e.target.closest('.fishing-btn') || e.target.closest('.fishing-bait-option') || e.target.closest('.fishing-close')) return;
    if (phase === 'bite') handleBiteTap();
    if (phase === 'reeling') handleReelTap();
  }, [phase, handleBiteTap, handleReelTap]);

  const canClose = ['idle', 'result', 'missed'].includes(phase);

  return (
    <div
      className={`fishing-overlay fishing-phase-${phase}`}
      onClick={handleScreenTap}
      style={{ touchAction: 'manipulation', WebkitUserSelect: 'none', userSelect: 'none' }}
    >
      {/* Close button */}
      {canClose && (
        <button className="fishing-close" onClick={onClose}>&times;</button>
      )}

      {/* Water background layers */}
      <div className="fishing-bg">
        <div className="fishing-sky" />
        <div className="fishing-water" />
        <div className="fishing-shimmer" />
      </div>

      {/* ---- IDLE PHASE ---- */}
      {phase === 'idle' && (
        <div className="fishing-idle">
          <h2 className="fishing-title">{'\ud83c\udfa3'} Fishing Hole</h2>

          {loading && <p className="fishing-status">Loading...</p>}
          {error && <p className="fishing-error">{error}</p>}

          {!loading && !hasBait && (
            <div className="fishing-no-bait">
              <p>No bait!</p>
              <p className="fishing-no-bait-hint">Visit the shop to stock up.</p>
            </div>
          )}

          {!loading && hasBait && (
            <>
              <div className="fishing-bait-selector">
                <p className="fishing-label">Select Bait</p>
                <div className="fishing-bait-list">
                  {baitItems.map(item => (
                    <button
                      key={item.item_id}
                      className={`fishing-bait-option ${selectedBait === item.item_id ? 'selected' : ''}`}
                      onClick={() => setSelectedBait(item.item_id)}
                    >
                      <span className="fishing-bait-icon">{BAIT_ICONS[item.item_id] || '\ud83e\udeb1'}</span>
                      <span className="fishing-bait-name">{item.name}</span>
                      <span className="fishing-bait-qty">x{item.quantity}</span>
                    </button>
                  ))}
                </div>
              </div>

              <button
                className="fishing-btn fishing-btn-cast"
                onClick={handleCast}
                disabled={!selectedBait}
              >
                Cast Line
              </button>
            </>
          )}

          {/* Biggest Catch Leaderboard */}
          {!loading && leaderboard.length > 0 && (
            <div className="fishing-leaderboard">
              <p className="fishing-label">{'\ud83c\udfc6'} Biggest Catches</p>
              <div className="fishing-lb-list">
                {leaderboard.map((entry, i) => (
                  <div key={i} className={`fishing-lb-entry ${i === 0 ? 'fishing-lb-first' : ''}`}>
                    <span className="fishing-lb-rank">#{i + 1}</span>
                    <span className="fishing-lb-icon">{entry.icon}</span>
                    <div className="fishing-lb-info">
                      <span className="fishing-lb-user">{entry.username}</span>
                      <span className={`fishing-lb-fish rarity-text-${entry.rarity}`}>{entry.fish}</span>
                    </div>
                    <span className="fishing-lb-weight">{entry.weight} lbs</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- CASTING PHASE ---- */}
      {phase === 'casting' && (
        <div className="fishing-casting">
          <div className="fishing-cast-line" />
          <p className="fishing-status">Casting...</p>
        </div>
      )}

      {/* ---- WAITING PHASE ---- */}
      {phase === 'waiting' && (
        <div className="fishing-waiting">
          <div className="fishing-bobber bobber-float" />
          <p className="fishing-status fishing-watch-text">Watch the bobber...</p>
        </div>
      )}

      {/* ---- BITE PHASE ---- */}
      {phase === 'bite' && (
        <div className="fishing-bite">
          <div className="fishing-bobber bobber-dip" />
          <div className="fishing-splash" />
          <p className="fishing-tap-now">TAP NOW!</p>
          <div className="fishing-bite-timer">
            <div
              className="fishing-bite-timer-fill"
              style={{ width: `${biteTimer}%` }}
            />
          </div>
          <p className="fishing-hint-fullscreen">Tap anywhere!</p>
        </div>
      )}

      {/* ---- REELING PHASE ---- */}
      {phase === 'reeling' && (
        <div className="fishing-reeling">
          <p className={`fishing-reel-label ${reelTimer < 30 ? 'reel-hurry' : ''}`}>
            {reelTimer < 15 ? "IT'S GETTING AWAY!" : reelTimer < 30 ? 'HURRY!' : 'Reel it in! Tap rapidly!'}
          </p>
          <div className="fishing-tension-bar">
            <div
              className="fishing-tension-fill"
              style={{ width: `${reelProgress}%` }}
            />
          </div>
          <p className="fishing-reel-pct">{Math.floor(reelProgress)}%</p>
          <div className="fishing-reel-timer">
            <div
              className="fishing-reel-timer-fill"
              style={{ width: `${reelTimer}%` }}
            />
          </div>
          <p className="fishing-hint-fullscreen">Tap anywhere!</p>
        </div>
      )}

      {/* ---- REVEAL PHASE (unskippable cinematic) ---- */}
      {phase === 'reveal' && catchResult && (
        <div className="fishing-reveal">
          {/* Light burst behind fish */}
          <div className={`reveal-burst rarity-burst-${catchResult.rarity}`} />

          {/* Staggered elements */}
          <div className="reveal-fish-icon reveal-stagger-1">
            <span className={`reveal-fish-emoji rarity-${catchResult.rarity}`}>{catchResult.icon}</span>
          </div>

          <div
            className="reveal-rarity reveal-stagger-2"
            style={{ color: RARITY_COLORS[catchResult.rarity] }}
          >
            {RARITY_LABELS[catchResult.rarity]}
          </div>

          <h3 className="reveal-name reveal-stagger-3">{catchResult.name}</h3>

          <p className="reveal-weight reveal-stagger-4">{catchResult.weight} lbs</p>

          <div className="reveal-rewards reveal-stagger-5">
            <span className="fishing-xp-badge">+{catchResult.xp} XP</span>
            <span className="fishing-gold-badge">{catchResult.goldValue}G</span>
          </div>
        </div>
      )}

      {/* ---- RESULT PHASE (interactive) ---- */}
      {phase === 'result' && catchResult && (
        <div className="fishing-result">
          <div className={`fishing-fish-icon rarity-${catchResult.rarity}`}>
            {catchResult.icon}
          </div>
          <div
            className="fishing-rarity-badge"
            style={{ color: RARITY_COLORS[catchResult.rarity] }}
          >
            {RARITY_LABELS[catchResult.rarity]}
          </div>
          <h3 className="fishing-fish-name">{catchResult.name}</h3>
          <p className="fishing-fish-weight">{catchResult.weight} lbs</p>

          <div className="fishing-rewards">
            <span className="fishing-xp-badge">+{catchResult.xp} XP</span>
            <span className="fishing-gold-badge">Worth {catchResult.goldValue}G</span>
          </div>

          {catchResult.sold ? (
            <div className="fishing-sold-msg">
              Sold for <strong>{catchResult.goldAwarded}G</strong>!
            </div>
          ) : (
            <div className="fishing-result-actions">
              <button
                className="fishing-btn fishing-btn-sell"
                onClick={handleSell}
                disabled={sellLoading}
              >
                {sellLoading ? 'Selling...' : `Sell (${catchResult.goldValue}G)`}
              </button>
              <button className="fishing-btn fishing-btn-keep" onClick={handleCastAgain}>
                Keep
              </button>
            </div>
          )}

          <button className="fishing-btn fishing-btn-again" onClick={handleCastAgain}>
            Cast Again
          </button>

          {/* Achievement toasts */}
          {achievements.length > 0 && (
            <div className="fishing-achievements">
              {achievements.map((a, i) => (
                <div key={i} className="fishing-achievement-toast">
                  <span>{a.icon}</span> <strong>{a.name}</strong>
                  {a.xp > 0 && <span className="fishing-ach-xp">+{a.xp} XP</span>}
                  {a.gold > 0 && <span className="fishing-ach-gold">+{a.gold}G</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---- MISSED PHASE ---- */}
      {phase === 'missed' && (
        <div className="fishing-missed">
          <div className="fishing-missed-icon shake">{'\ud83d\udca8'}</div>
          <p className="fishing-missed-text">The fish got away!</p>
          <button className="fishing-btn fishing-btn-again" onClick={handleCastAgain}>
            Try Again
          </button>
        </div>
      )}

      {/* ---- LEVEL UP OVERLAY ---- */}
      {levelUp && (
        <LevelUpOverlay
          key={levelUp}
          level={levelUp}
          onDismiss={() => setLevelUp(null)}
        />
      )}
    </div>
  );
}

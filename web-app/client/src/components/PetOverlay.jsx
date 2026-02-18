import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../hooks/useApi';
import AchievementToast from './AchievementToast';
import '../styles/pet.css';

function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch {}
}

export default function PetOverlay({ onClose, readOnly = false, userId = null }) {
  const [pet, setPet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [feedCooldown, setFeedCooldown] = useState(0);
  const [playCooldown, setPlayCooldown] = useState(0);
  const [leveledUp, setLeveledUp] = useState(false);
  const [naming, setNaming] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [achievementQueue, setAchievementQueue] = useState([]);
  const [actionFeedback, setActionFeedback] = useState(null); // 'fed' | 'played'
  const confirmingRef = useRef(false);
  const feedbackTimerRef = useRef(null);

  const dismissAchievement = useCallback(() => {
    setAchievementQueue(prev => prev.slice(1));
  }, []);

  // Load pet data
  useEffect(() => {
    loadPet();
  }, []);

  // Cooldown tick-down
  useEffect(() => {
    if (feedCooldown <= 0 && playCooldown <= 0) return;
    const interval = setInterval(() => {
      setFeedCooldown(c => Math.max(0, c - 1));
      setPlayCooldown(c => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [feedCooldown > 0, playCooldown > 0]);

  // Client-side hunger/happiness drift (update every 60s)
  useEffect(() => {
    if (!pet) return;
    const interval = setInterval(() => {
      setPet(prev => {
        if (!prev) return prev;
        const now = Date.now();
        const hungerElapsed = (now - new Date(prev.lastFed).getTime()) / 60000;
        const happyElapsed = (now - new Date(prev.lastPlayed).getTime()) / 60000;
        return {
          ...prev,
          hunger: Math.min(100, Math.floor((hungerElapsed / 300) * 100)),
          happiness: Math.max(0, 100 - Math.floor((happyElapsed / 300) * 100)),
        };
      });
    }, 60000);
    return () => clearInterval(interval);
  }, [pet?.lastFed, pet?.lastPlayed]);

  async function loadPet() {
    try {
      const endpoint = userId ? `/api/pets/user/${userId}` : '/api/pets/me';
      const data = await api(endpoint);
      setPet(data.pet);
      if (data.pet?.petName) setNameInput(data.pet.petName);
    } catch (err) {
      setError('Failed to load pet');
    } finally {
      setLoading(false);
    }
  }

  async function handleFeed() {
    if (confirmingRef.current || feedCooldown > 0) return;
    confirmingRef.current = true;

    try {
      const body = userId ? { targetUserId: userId } : {};
      const data = await api('/api/pets/feed', { method: 'POST', body: JSON.stringify(body) });
      setPet(data.pet);
      vibrate([50, 30, 50]);
      showFeedback('fed');

      if (data.leveledUp) setLeveledUp(true);
      if (data.newAchievements?.length > 0) {
        setAchievementQueue(prev => [...prev, ...data.newAchievements]);
      }
    } catch (err) {
      if (err.status === 429) {
        const body = await err.json?.().catch(() => ({}));
        setFeedCooldown(body.retryAfter || 60);
      }
    } finally {
      confirmingRef.current = false;
    }
  }

  async function handlePlay() {
    if (confirmingRef.current || playCooldown > 0) return;
    confirmingRef.current = true;

    try {
      const body = userId ? { targetUserId: userId } : {};
      const data = await api('/api/pets/play', { method: 'POST', body: JSON.stringify(body) });
      setPet(data.pet);
      vibrate([30, 20, 30, 20, 30]);
      showFeedback('played');

      if (data.leveledUp) setLeveledUp(true);
      if (data.newAchievements?.length > 0) {
        setAchievementQueue(prev => [...prev, ...data.newAchievements]);
      }
    } catch (err) {
      if (err.status === 429) {
        const body = await err.json?.().catch(() => ({}));
        setPlayCooldown(body.retryAfter || 60);
      }
    } finally {
      confirmingRef.current = false;
    }
  }

  async function handleRename() {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed.length > 20 || nameSaving) return;

    setNameSaving(true);
    try {
      const data = await api('/api/pets/name', {
        method: 'POST',
        body: JSON.stringify({ name: trimmed }),
      });
      setPet(data.pet);
      setNaming(false);
    } catch {
      setError('Failed to rename');
    } finally {
      setNameSaving(false);
    }
  }

  function showFeedback(type) {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    setActionFeedback(type);
    feedbackTimerRef.current = setTimeout(() => setActionFeedback(null), 1500);
  }

  function getHungerLabel(hunger) {
    if (hunger <= 20) return 'Full';
    if (hunger <= 50) return 'Peckish';
    if (hunger <= 80) return 'Hungry';
    return 'Starving';
  }

  function getHappinessLabel(happiness) {
    if (happiness >= 80) return 'Joyful';
    if (happiness >= 50) return 'Content';
    if (happiness >= 20) return 'Bored';
    return 'Sad';
  }

  function getHungerColor(hunger) {
    if (hunger <= 30) return 'var(--color-success, #4ade80)';
    if (hunger <= 60) return 'var(--color-gold, #d4a843)';
    return 'var(--color-danger, #e74c3c)';
  }

  function getHappinessColor(happiness) {
    if (happiness >= 70) return 'var(--color-success, #4ade80)';
    if (happiness >= 40) return 'var(--color-gold, #d4a843)';
    return 'var(--color-danger, #e74c3c)';
  }

  // Loading state
  if (loading) {
    return (
      <div className="pet-overlay">
        <div className="pet-overlay-content">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  // No pet
  if (!pet) {
    return (
      <div className="pet-overlay">
        <div className="pet-overlay-content">
          <button className="pet-close-btn" onClick={onClose}>X</button>
          <p className="pet-no-pet">
            {readOnly ? 'This player does not have a pet yet.' : 'You do not have a pet yet.'}
          </p>
        </div>
      </div>
    );
  }

  const spriteFile = `/images/sprites/pets/pet_${pet.petType}_${pet.stage}.webp`;

  return (
    <div className="pet-overlay">
      <div className="pet-overlay-content">
        <button className="pet-close-btn" onClick={onClose}>X</button>

        {/* Level up flash */}
        {leveledUp && (
          <div className="pet-level-up" onClick={() => setLeveledUp(false)}>
            <span className="pet-level-up-text">Level Up!</span>
            <span className="pet-level-up-level">Lv. {pet.level}</span>
            {pet.stageName && <span className="pet-level-up-stage">{pet.stageName}</span>}
          </div>
        )}

        {/* Action feedback */}
        {actionFeedback && (
          <div className={`pet-feedback pet-feedback-${actionFeedback}`}>
            {actionFeedback === 'fed' ? 'Yum!' : 'Fun!'}
          </div>
        )}

        {/* Pet sprite */}
        <div className="pet-sprite-container">
          <img
            className="pet-sprite-large"
            src={spriteFile}
            alt={pet.petName || pet.typeName}
            onError={(e) => {
              e.target.style.display = 'none';
              e.target.nextSibling.style.display = 'flex';
            }}
          />
          <div className="pet-sprite-emoji-fallback" style={{ display: 'none' }}>
            {pet.typeIcon}
          </div>
        </div>

        {/* Pet info */}
        <div className="pet-info">
          {naming ? (
            <div className="pet-name-edit">
              <input
                className="pet-name-input"
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={20}
                placeholder="Name your pet..."
                autoFocus
              />
              <div className="pet-name-actions">
                <button className="pet-btn pet-btn-small" onClick={handleRename} disabled={nameSaving}>
                  {nameSaving ? '...' : 'Save'}
                </button>
                <button className="pet-btn pet-btn-small pet-btn-muted" onClick={() => setNaming(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <h2 className="pet-name" onClick={() => !readOnly && setNaming(true)}>
              {pet.petName || 'Unnamed'}
              {!readOnly && <span className="pet-name-edit-icon">&#9998;</span>}
            </h2>
          )}
          <p className="pet-type-label">
            Lv. {pet.level} {pet.stageName || pet.typeName}
          </p>
          {pet.username && (
            <p className="pet-owner-label">Owner: {pet.username}</p>
          )}
        </div>

        {/* Stat bars */}
        <div className="pet-stats">
          <div className="pet-stat-row">
            <span className="pet-stat-label">Hunger</span>
            <div className="pet-stat-bar">
              <div
                className="pet-stat-fill"
                style={{
                  width: `${100 - pet.hunger}%`,
                  backgroundColor: getHungerColor(pet.hunger),
                }}
              />
            </div>
            <span className="pet-stat-value">{getHungerLabel(pet.hunger)}</span>
          </div>

          <div className="pet-stat-row">
            <span className="pet-stat-label">Mood</span>
            <div className="pet-stat-bar">
              <div
                className="pet-stat-fill"
                style={{
                  width: `${pet.happiness}%`,
                  backgroundColor: getHappinessColor(pet.happiness),
                }}
              />
            </div>
            <span className="pet-stat-value">{getHappinessLabel(pet.happiness)}</span>
          </div>

          {pet.level < 10 && (
            <div className="pet-stat-row">
              <span className="pet-stat-label">XP</span>
              <div className="pet-stat-bar">
                <div
                  className="pet-stat-fill pet-stat-xp"
                  style={{ width: `${pet.xp}%` }}
                />
              </div>
              <span className="pet-stat-value">{pet.xp} / 100</span>
            </div>
          )}
          {pet.level >= 10 && (
            <div className="pet-stat-row">
              <span className="pet-stat-label">XP</span>
              <span className="pet-stat-value pet-stat-max">MAX LEVEL</span>
            </div>
          )}
        </div>

        {/* Action buttons (owner only) */}
        {!readOnly && (
          <div className="pet-actions">
            <button
              className="pet-btn pet-btn-feed"
              onClick={handleFeed}
              disabled={feedCooldown > 0}
            >
              {feedCooldown > 0 ? `Feed (${feedCooldown}s)` : 'Feed'}
            </button>
            <button
              className="pet-btn pet-btn-play"
              onClick={handlePlay}
              disabled={playCooldown > 0}
            >
              {playCooldown > 0 ? `Play (${playCooldown}s)` : 'Play'}
            </button>
          </div>
        )}

        {error && <p className="pet-error">{error}</p>}
      </div>

      {/* Achievement toast */}
      {achievementQueue.length > 0 && (
        <AchievementToast
          achievement={achievementQueue[0]}
          onDismiss={dismissAchievement}
        />
      )}
    </div>
  );
}

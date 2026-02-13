import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import CharacterSheet from '../components/CharacterSheet';
import AchievementToast from '../components/AchievementToast';
import '../styles/profile.css';

const ADMIN_IDS = ['424061511833747467'];

export default function PlayerProfile() {
  const { playerId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isDM = ADMIN_IDS.includes(user?.id || '');
  const [player, setPlayer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [achievementsExpanded, setAchievementsExpanded] = useState(false);
  const [achievementQueue, setAchievementQueue] = useState([]);

  const dismissAchievement = useCallback(() => {
    setAchievementQueue(prev => prev.slice(1));
  }, []);

  useEffect(() => {
    api(`/api/players/${playerId}`)
      .then(data => {
        setPlayer(data);
        if (data.viewerAchievements?.length > 0) {
          setAchievementQueue(prev => [...prev, ...data.viewerAchievements]);
        }
      })
      .catch(err => setError(err.status === 404 ? 'Player not found.' : 'Failed to load player profile.'))
      .finally(() => setLoading(false));
  }, [playerId]);

  if (loading) {
    return (
      <div className="page">
        <div className="page-loading"><div className="loading-spinner" /></div>
      </div>
    );
  }

  if (error || !player) {
    return (
      <div className="page">
        <button className="player-profile-back" onClick={() => navigate(-1)}>
          &larr; Back
        </button>
        <p className="empty-state">{error || 'Player not found.'}</p>
      </div>
    );
  }

  const xpPercent = player.xpForNext > 0
    ? Math.min(100, (player.xpInLevel / player.xpForNext) * 100)
    : 100;

  return (
    <div className="page profile-page">
      <button className="player-profile-back" onClick={() => navigate(-1)}>
        &larr; Back
      </button>

      {/* Player card */}
      <div className="profile-card">
        <img
          src={player.avatar}
          alt={player.characterName}
          className="profile-avatar"
          style={player.online ? { borderColor: '#4ade80', boxShadow: '0 0 12px rgba(74, 222, 128, 0.3)' } : undefined}
        />
        <div className="profile-info">
          <h2 className="profile-name">{player.characterName}</h2>
          <span className={`player-profile-status ${player.online ? 'player-status-online' : 'player-status-offline'}`}>
            {player.online ? 'Online' : 'Offline'}
            {player.lastLocationName && ` \u2022 ${player.lastLocationName}`}
          </span>
        </div>
      </div>

      {/* XP Card */}
      <div className="xp-card">
        <div className="xp-level-badge">
          <span className="xp-level-number">{player.level}</span>
          <span className="xp-level-label">Level</span>
        </div>
        <div className="xp-details">
          <div className="xp-progress-bar-container">
            <div
              className="xp-progress-bar-fill"
              style={{ width: `${xpPercent}%` }}
            />
          </div>
          <span className="xp-progress-text">
            {player.xpForNext > 0
              ? `${player.xpInLevel.toLocaleString()} / ${player.xpForNext.toLocaleString()} XP`
              : 'MAX LEVEL'}
          </span>
          <span className="xp-total">Total: {player.totalXp.toLocaleString()} XP</span>
        </div>
      </div>

      {/* Character Sheet */}
      <CharacterSheet userId={playerId} editable={isDM} />

      {/* Gold */}
      <div className="stats-grid" style={{ gridTemplateColumns: '1fr' }}>
        <div className="stat-card">
          <span className="stat-icon">{'\uD83E\uDE99'}</span>
          <span className="stat-value">{player.gold}G</span>
          <span className="stat-label">Gold</span>
        </div>
      </div>

      {/* Achievements */}
      {player.achievements && (
        <section className="profile-section">
          <div className="achievements-header" onClick={() => setAchievementsExpanded(!achievementsExpanded)}>
            <h2 className="section-title">
              Achievements
              {player.achievementStats && (
                <span className="achievements-count">{player.achievementStats.unlocked} / {player.achievementStats.total}</span>
              )}
            </h2>
            <span className="achievements-chevron">{achievementsExpanded ? '\u25B2' : '\u25BC'}</span>
          </div>
          {!achievementsExpanded && (
            <div className="achievements-preview">
              {player.achievements.filter(a => a.unlockedAt).length > 0 ? (
                player.achievements.filter(a => a.unlockedAt).map(ach => (
                  <span key={ach.id} className="achievements-preview-icon" title={ach.name}>{ach.icon}</span>
                ))
              ) : (
                <span className="achievements-preview-empty">No achievements yet</span>
              )}
            </div>
          )}
          {achievementsExpanded && (
            <div className="achievements-grid">
              {[...player.achievements].sort((a, b) => {
                if (a.unlockedAt && b.unlockedAt) return b.unlockedAt.localeCompare(a.unlockedAt);
                if (a.unlockedAt) return -1;
                if (b.unlockedAt) return 1;
                return 0;
              }).map(ach => (
                <div
                  key={ach.id}
                  className={`achievement-card ${ach.unlockedAt ? 'achievement-card-unlocked' : 'achievement-card-locked'}`}
                >
                  <span className="achievement-card-icon">{ach.icon}</span>
                  <div className="achievement-card-info">
                    <div className="achievement-card-name">{ach.name}</div>
                    <div className="achievement-card-desc">{ach.description}</div>
                    {ach.unlockedAt && (ach.xp > 0 || ach.gold > 0) && (
                      <div className="achievement-card-rewards">
                        {ach.xp > 0 && <span className="achievement-reward-xp">+{ach.xp} XP</span>}
                        {ach.gold > 0 && <span className="achievement-reward-gold">+{ach.gold}G</span>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Inventory */}
      <section className="profile-section">
        <h2 className="section-title">Inventory</h2>
        {player.inventory.items.length > 0 ? (
          <div className="inventory-list">
            {player.inventory.items.map((item, i) => (
              <div key={i} className="inventory-item">
                <span className="inventory-item-name">{item.name}</span>
                <span className="inventory-item-qty">x{item.quantity}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">No items yet.</p>
        )}

        {player.inventory.badges.length > 0 && (
          <div className="badges-section">
            <h3>Badges</h3>
            <div className="badges-list">
              {player.inventory.badges.map((badge, i) => (
                <span key={i} className="badge">{badge}</span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Action buttons */}
      <div className="player-profile-actions">
        {player.lastLocation && player.locationAccessible && (
          <button
            className="btn btn-primary"
            onClick={() => navigate(`/location/${player.lastLocation}`)}
          >
            Go to Location
          </button>
        )}
      </div>

      {achievementQueue.length > 0 && (
        <AchievementToast
          key={achievementQueue[0].id}
          achievement={achievementQueue[0]}
          onDismiss={dismissAchievement}
        />
      )}
    </div>
  );
}

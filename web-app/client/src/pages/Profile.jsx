import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { useAudioMuted, setAudioMuted } from '../hooks/useAudioSettings';
import { usePushNotifications } from '../hooks/usePushNotifications';
import GoldBadge from '../components/GoldBadge';
import PlayersList from '../components/PlayersList';
import CharacterSheet from '../components/CharacterSheet';
import '../styles/profile.css';
import '../styles/leaderboard.css';

const RANK_DECORATIONS = ['👑', '🥈', '🥉'];
const ADMIN_IDS = ['424061511833747467'];

export default function Profile() {
  const { user, wallet, xpInfo, refreshXp, logout } = useAuth();
  const isAdmin = ADMIN_IDS.includes(user?.id || '');
  const audioMuted = useAudioMuted();
  const push = usePushNotifications();
  const [inventory, setInventory] = useState(null);
  const [leaderboard, setLeaderboard] = useState(null);
  const [achievements, setAchievements] = useState(null);
  const [achievementStats, setAchievementStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('profile');
  const [mutedChannels, setMutedChannels] = useState([]);
  const [locations, setLocations] = useState([]);
  const [muteExpanded, setMuteExpanded] = useState(false);
  const [achievementsExpanded, setAchievementsExpanded] = useState(false);
  const [aliases, setAliases] = useState([]);
  const [activeAlias, setActiveAlias] = useState(null);
  const [aliasSwitching, setAliasSwitching] = useState(false);
  const [sheetRefreshKey, setSheetRefreshKey] = useState(0);
  const [ownedDice, setOwnedDice] = useState(['default']);
  const [equippedDice, setEquippedDice] = useState('default');
  const [diceEquipping, setDiceEquipping] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [invData, lbData, achData] = await Promise.all([
        api('/api/inventory'),
        api('/api/leaderboard'),
        api('/api/achievements/me'),
        refreshXp()
      ]);
      setInventory(invData);
      setLeaderboard(lbData.leaderboard);
      setAchievements(achData.achievements);
      setAchievementStats(achData.stats);
    } catch (err) {
      console.error('Failed to load profile data:', err);
    } finally {
      setLoading(false);
    }

    // Load notification settings
    try {
      const settings = await api('/api/notifications/settings');
      setMutedChannels(settings.mutedChannels || []);
    } catch { /* ignore */ }

    // Load character aliases
    try {
      const aliasData = await api('/api/character-sheet/aliases');
      setAliases(aliasData.aliases || []);
      setActiveAlias(aliasData.active || null);
    } catch { /* ignore */ }

    // Load owned dice sets
    try {
      const diceData = await api('/api/dice/owned');
      setOwnedDice(diceData.owned || ['default']);
      setEquippedDice(diceData.equipped || 'default');
    } catch { /* ignore */ }
  }

  async function loadLocationsForMute() {
    if (locations.length > 0) return;
    try {
      const data = await api('/api/chat/locations');
      setLocations(data.locations || []);
    } catch { /* ignore */ }
  }

  async function toggleMuteChannel(channelId) {
    const isMuted = mutedChannels.includes(channelId);
    try {
      const endpoint = isMuted ? '/api/notifications/unmute-channel' : '/api/notifications/mute-channel';
      const result = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({ channelId })
      });
      setMutedChannels(result.mutedChannels);
    } catch { /* ignore */ }
  }

  async function switchCharacter(targetUserId) {
    setAliasSwitching(true);
    try {
      const result = await api('/api/character-sheet/switch', {
        method: 'POST',
        body: JSON.stringify({ targetUserId })
      });
      setActiveAlias(result.active || null);
      setSheetRefreshKey(k => k + 1);
    } catch (err) {
      console.error('Failed to switch character:', err);
    } finally {
      setAliasSwitching(false);
    }
  }

  async function equipDice(colorset) {
    if (diceEquipping) return;
    setDiceEquipping(colorset);
    try {
      await api('/api/dice/equip', {
        method: 'POST',
        body: JSON.stringify({ colorset })
      });
      setEquippedDice(colorset);
    } catch (err) {
      console.error('Failed to equip dice:', err);
    } finally {
      setDiceEquipping(null);
    }
  }

  // Color preview map for dice sets
  const DICE_COLORS = {
    default: { bg: '#e7e5e4', border: '#a8a29e', label: 'Default' },
    fire: { bg: '#f97316', border: '#ea580c', label: 'Ember' },
    ice: { bg: '#38bdf8', border: '#0ea5e9', label: 'Frostbite' },
    poison: { bg: '#4ade80', border: '#22c55e', label: 'Venom' },
    bronze: { bg: '#d97706', border: '#b45309', label: 'Bronze' },
    gold: { bg: '#fbbf24', border: '#f59e0b', label: 'Golden' },
    breebaby: { bg: '#f0abfc', border: '#e879f9', label: 'Breebaby' },
    glitterparty: { bg: '#c084fc', border: '#a855f7', label: 'Glitter Party' },
    swrpg: { bg: '#1e1e2e', border: '#ef4444', label: 'Obsidian' },
  };

  if (!user) return null;

  return (
    <div className="page profile-page">
      <div className="page-header">
        <h1 className="page-title">Profile</h1>
      </div>

      {/* Player card */}
      <div className="profile-card">
        <img
          src={user.avatar}
          alt={user.characterName || user.global_name || user.username}
          className="profile-avatar"
        />
        <div className="profile-info">
          <h2 className="profile-name">{user.characterName || user.global_name || user.username}</h2>
          {user.characterName && (
            <p className="profile-username">{user.global_name || user.username}</p>
          )}
        </div>
      </div>

      {/* XP & Level */}
      {xpInfo && (
        <div className="xp-card">
          <div className="xp-level-badge">
            <span className="xp-level-number">{xpInfo.level}</span>
            <span className="xp-level-label">Level</span>
          </div>
          <div className="xp-details">
            <div className="xp-progress-bar-container">
              <div
                className="xp-progress-bar-fill"
                style={{ width: xpInfo.xp_for_next > 0 ? `${Math.min(100, (xpInfo.xp_in_level / xpInfo.xp_for_next) * 100)}%` : '100%' }}
              />
            </div>
            <span className="xp-progress-text">
              {xpInfo.xp_for_next > 0
                ? `${xpInfo.xp_in_level.toLocaleString()} / ${xpInfo.xp_for_next.toLocaleString()} XP`
                : 'MAX LEVEL'}
            </span>
            <span className="xp-total">Total: {xpInfo.total_xp.toLocaleString()} XP</span>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="profile-tabs">
        <button
          className={`profile-tab ${activeTab === 'profile' ? 'profile-tab-active' : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          Profile
        </button>
        <button
          className={`profile-tab ${activeTab === 'players' ? 'profile-tab-active' : ''}`}
          onClick={() => setActiveTab('players')}
        >
          Players
        </button>
      </div>

      {activeTab === 'players' ? (
        <PlayersList />
      ) : (
      <>

      {/* Character Sheet */}
      <CharacterSheet userId={user.id} editable={true} refreshKey={sheetRefreshKey} />

      {/* Gold stats */}
      {wallet && (
        <div className="stats-grid">
          <div className="stat-card">
            <span className="stat-icon">🪙</span>
            <span className="stat-value">{wallet.balance}G</span>
            <span className="stat-label">Balance</span>
          </div>
          <div className="stat-card">
            <span className="stat-icon">📈</span>
            <span className="stat-value">{wallet.lifetime_earned}G</span>
            <span className="stat-label">Earned</span>
          </div>
          <div className="stat-card">
            <span className="stat-icon">💸</span>
            <span className="stat-value">{wallet.lifetime_spent}G</span>
            <span className="stat-label">Spent</span>
          </div>
        </div>
      )}

      {/* Achievements */}
      {achievements && (
        <section className="profile-section">
          <div className="achievements-header" onClick={() => setAchievementsExpanded(!achievementsExpanded)}>
            <h2 className="section-title">
              Achievements
              {achievementStats && (
                <span className="achievements-count">{achievementStats.unlocked} / {achievementStats.total}</span>
              )}
            </h2>
            <span className="achievements-chevron">{achievementsExpanded ? '\u25B2' : '\u25BC'}</span>
          </div>
          {!achievementsExpanded && (
            <div className="achievements-preview">
              {achievements.filter(a => a.unlockedAt).length > 0 ? (
                achievements.filter(a => a.unlockedAt).map(ach => (
                  <span key={ach.id} className="achievements-preview-icon" title={ach.name}>{ach.icon}</span>
                ))
              ) : (
                <span className="achievements-preview-empty">No achievements yet</span>
              )}
            </div>
          )}
          {achievementsExpanded && (
            <div className="achievements-grid">
              {[...achievements].sort((a, b) => {
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
        {loading ? (
          <div className="page-loading"><div className="loading-spinner" /></div>
        ) : inventory ? (
          <>
            {inventory.items.length > 0 ? (
              <div className="inventory-list">
                {inventory.items.map((item, i) => (
                  <div key={i} className="inventory-item">
                    <span className="inventory-item-name">{item.name}</span>
                    <span className="inventory-item-qty">x{item.quantity}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">Your bags are empty. Visit the shop!</p>
            )}

            {inventory.badges.length > 0 && (
              <div className="badges-section">
                <h3>Badges</h3>
                <div className="badges-list">
                  {inventory.badges.map((badge, i) => (
                    <span key={i} className="badge">{badge}</span>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="empty-state">Failed to load inventory.</p>
        )}
      </section>

      {/* Dice Sets */}
      {ownedDice.length > 1 && (
        <section className="profile-section">
          <h2 className="section-title">Dice Sets</h2>
          <div className="dice-sets-grid">
            {ownedDice.map(cs => {
              const info = DICE_COLORS[cs] || { bg: '#78716c', border: '#57534e', label: cs };
              const isEquipped = cs === equippedDice;
              return (
                <button
                  key={cs}
                  className={`dice-set-item ${isEquipped ? 'dice-set-item-equipped' : ''}`}
                  onClick={() => !isEquipped && equipDice(cs)}
                  disabled={diceEquipping === cs}
                >
                  <div
                    className="dice-set-swatch"
                    style={{
                      background: info.bg,
                      borderColor: info.border,
                      boxShadow: isEquipped ? `0 0 12px ${info.bg}80` : 'none',
                    }}
                  />
                  <span className="dice-set-label">{info.label}</span>
                  {isEquipped && <span className="dice-set-badge">Equipped</span>}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Leaderboard */}
      <section className="profile-section">
        <h2 className="section-title">Leaderboard</h2>
        {leaderboard ? (
          <div className="leaderboard-list leaderboard-compact">
            {leaderboard.map((entry) => (
              <div
                key={entry.user_id}
                className={`leaderboard-row ${entry.user_id === user?.id ? 'leaderboard-row-me' : ''} ${entry.rank <= 3 ? 'leaderboard-row-top' : ''}`}
              >
                <span className="lb-rank">
                  {entry.rank <= 3 ? RANK_DECORATIONS[entry.rank - 1] : `#${entry.rank}`}
                </span>
                <span className="lb-name">{entry.username}</span>
                <span className="lb-xp">
                  <span className="lb-level">Lv{entry.level}</span>
                  {entry.total_xp.toLocaleString()} XP
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">Leaderboard unavailable.</p>
        )}
      </section>

      {/* Settings */}
      <section className="profile-section">
        <h2 className="section-title">Settings</h2>
        <div className="settings-list">
          <label className="settings-row">
            <span className="settings-label">Mute All Audio</span>
            <input
              type="checkbox"
              className="settings-toggle"
              checked={audioMuted}
              onChange={(e) => setAudioMuted(e.target.checked)}
            />
          </label>

          {aliases.length > 0 && (
            <div className="settings-row">
              <span className="settings-label">Active Character</span>
              <select
                className="settings-select"
                value={activeAlias || ''}
                disabled={aliasSwitching}
                onChange={(e) => switchCharacter(e.target.value || null)}
              >
                <option value="">None</option>
                {aliases.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          )}

          <label className="settings-row">
            <span className="settings-label">
              Push Notifications
              {push.permission === 'denied' && (
                <span className="settings-hint"> (blocked in browser)</span>
              )}
              {!push.supported && push.permission !== 'denied' && (
                <span className="settings-hint"> (not available)</span>
              )}
            </span>
            <input
              type="checkbox"
              className="settings-toggle"
              checked={push.isEnabled}
              disabled={push.loading || push.permission === 'denied' || !push.supported}
              onChange={() => push.isEnabled ? push.disable() : push.enable()}
            />
          </label>

          <div className="settings-row settings-row-expandable" onClick={() => { setMuteExpanded(!muteExpanded); if (!muteExpanded) loadLocationsForMute(); }}>
            <span className="settings-label">Muted Channels</span>
            <span className="settings-chevron">{muteExpanded ? '\u25B2' : '\u25BC'}</span>
          </div>
          {muteExpanded && (
            <div className="settings-mute-list">
              {locations.length === 0 && (
                <p className="empty-state" style={{ padding: '8px 16px', margin: 0, fontSize: '0.8rem' }}>Loading...</p>
              )}
              {locations.map(loc => (
                <label key={loc.id} className="settings-mute-item">
                  <span className="settings-label">{loc.name}</span>
                  <input
                    type="checkbox"
                    className="settings-toggle"
                    checked={mutedChannels.includes(loc.id)}
                    onChange={() => toggleMuteChannel(loc.id)}
                  />
                </label>
              ))}
            </div>
          )}
        </div>
      </section>

      </>
      )}

      {/* Admin link + Logout */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {isAdmin && (
          <Link to="/admin" className="btn btn-outline" style={{ textAlign: 'center', textDecoration: 'none' }}>
            DM Controls
          </Link>
        )}
        <button className="btn btn-outline btn-logout" onClick={logout}>
          Log Out
        </button>
      </div>
    </div>
  );
}

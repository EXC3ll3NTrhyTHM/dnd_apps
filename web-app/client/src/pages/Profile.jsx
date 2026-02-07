import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { useAudioMuted, setAudioMuted } from '../hooks/useAudioSettings';
import GoldBadge from '../components/GoldBadge';
import '../styles/profile.css';
import '../styles/leaderboard.css';

const RANK_DECORATIONS = ['👑', '🥈', '🥉'];

export default function Profile() {
  const { user, wallet, logout } = useAuth();
  const audioMuted = useAudioMuted();
  const [inventory, setInventory] = useState(null);
  const [leaderboard, setLeaderboard] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [invData, lbData] = await Promise.all([
        api('/api/inventory'),
        api('/api/leaderboard')
      ]);
      setInventory(invData);
      setLeaderboard(lbData.leaderboard);
    } catch (err) {
      console.error('Failed to load profile data:', err);
    } finally {
      setLoading(false);
    }
  }

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
          alt={user.username}
          className="profile-avatar"
        />
        <div className="profile-info">
          <h2 className="profile-name">{user.global_name || user.username}</h2>
          <p className="profile-username">@{user.username}</p>
        </div>
      </div>

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
                <span className="lb-gold">
                  <span className="gold-icon">🪙</span>
                  {entry.balance}G
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
        </div>
      </section>

      {/* Admin link + Logout */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Link to="/admin" className="btn btn-outline" style={{ textAlign: 'center', textDecoration: 'none' }}>
          DM Controls
        </Link>
        <button className="btn btn-outline btn-logout" onClick={logout}>
          Log Out
        </button>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { api } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import '../styles/leaderboard.css';

const RANK_DECORATIONS = ['👑', '🥈', '🥉'];

export default function Leaderboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLeaderboard();
  }, []);

  async function loadLeaderboard() {
    try {
      const result = await api('/api/leaderboard');
      setData(result);
    } catch (err) {
      console.error('Failed to load leaderboard:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="page-loading">
        <div className="loading-spinner" />
        <p>Tallying experience points...</p>
      </div>
    );
  }

  if (!data) {
    return <div className="page-error">Leaderboard unavailable.</div>;
  }

  return (
    <div className="page leaderboard-page">
      <div className="page-header">
        <h1 className="page-title">🏆 Leaderboard</h1>
        <p className="page-subtitle">Who's earned the most experience?</p>
      </div>

      <div className="leaderboard-list">
        {data.leaderboard.map((entry) => (
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
    </div>
  );
}

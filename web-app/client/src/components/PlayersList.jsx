import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../hooks/useApi';

function relativeTime(isoString) {
  if (!isoString) return 'Never';
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function PlayersList() {
  const [players, setPlayers] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api('/api/players')
      .then(data => setPlayers(data.players))
      .catch(err => console.error('Failed to load players:', err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="page-loading"><div className="loading-spinner" /></div>;
  }

  if (!players || players.length === 0) {
    return <p className="empty-state">No players found.</p>;
  }

  return (
    <div className="players-list">
      {players.map(player => (
        <div
          key={player.id}
          className="player-card"
          onClick={() => navigate('/player/' + player.id)}
          style={{ cursor: 'pointer' }}
        >
          <div className={`player-avatar-wrapper ${player.online ? 'player-avatar-online' : ''}`}>
            <img
              src={player.avatar}
              alt={player.characterName}
              className="player-avatar"
            />
          </div>
          <div className="player-info">
            <div className="player-name-row">
              <span className="player-name">{player.characterName}</span>
              <span className="player-level">Lv{player.level}</span>
            </div>
            <div className={player.online ? 'player-status-online' : 'player-status-offline'}>
              {player.online
                ? `Online${player.lastLocationName ? ' at ' + player.lastLocationName : ''}`
                : player.lastSeen
                  ? `${relativeTime(player.lastSeen)}${player.lastLocationName ? ' at ' + player.lastLocationName : ''}`
                  : 'Never seen'
              }
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

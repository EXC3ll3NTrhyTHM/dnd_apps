import { useState } from 'react';
import '../styles/presence-strip.css';

/**
 * Snapchat-style overlapping avatar circles showing who's in a location.
 * Tap to expand and see names.
 */
export default function PresenceStrip({ users, currentUserId, maxVisible = 5 }) {
  const [expanded, setExpanded] = useState(false);

  if (!users || users.length === 0) return null;

  // Filter out current user
  const others = users.filter(u => u.id !== currentUserId);
  if (others.length === 0) return null;

  const visible = expanded ? others : others.slice(0, maxVisible);
  const overflow = others.length - maxVisible;

  return (
    <div className="presence-strip" onClick={() => setExpanded(!expanded)}>
      <div className="presence-avatars">
        {visible.map((user, index) => (
          <div
            key={user.id}
            className="presence-avatar"
            style={{ zIndex: others.length - index }}
            title={user.username}
          >
            <img
              src={user.avatar || '/images/default-avatar.png'}
              alt={user.username}
              onError={(e) => { e.target.src = '/images/default-avatar.png'; }}
            />
            {expanded && (
              <span className="presence-name">{user.username}</span>
            )}
          </div>
        ))}
        {!expanded && overflow > 0 && (
          <div className="presence-overflow">
            +{overflow}
          </div>
        )}
      </div>
      {others.length > 0 && (
        <span className="presence-label">
          {others.length} {others.length === 1 ? 'adventurer' : 'adventurers'} here
        </span>
      )}
    </div>
  );
}

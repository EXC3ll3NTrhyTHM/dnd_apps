import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../hooks/useApi';

export default function ArenaEmoteGrid({ onSelect, onClose }) {
  const [emotes, setEmotes] = useState(null);
  const backdropRef = useRef(null);

  useEffect(() => {
    api('/api/emotes/catalog')
      .then(data => setEmotes(data.emotes || []))
      .catch(() => setEmotes([]));
  }, []);

  const handleBackdropClick = useCallback((e) => {
    if (e.target === backdropRef.current) onClose();
  }, [onClose]);

  return (
    <div
      ref={backdropRef}
      className="arena-emote-grid-overlay"
      onClick={handleBackdropClick}
    >
      <div className="arena-emote-grid">
        {!emotes ? (
          <div className="arena-emote-loading">Loading...</div>
        ) : emotes.map(emote => (
          <button
            key={emote.id}
            className="arena-emote-cell"
            onClick={() => onSelect(emote.id)}
          >
            <img
              src={`/images/emotes/${emote.image}`}
              alt={emote.name}
              draggable={false}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

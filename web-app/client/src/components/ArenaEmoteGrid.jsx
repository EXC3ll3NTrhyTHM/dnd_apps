import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../hooks/useApi';

export default function ArenaEmoteGrid({ onSelect, onClose, favorites = [], onToggleFavorite }) {
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

  const maxed = favorites.length >= 4;

  return (
    <div
      ref={backdropRef}
      className="arena-emote-grid-overlay"
      onClick={handleBackdropClick}
    >
      <div className="arena-emote-grid">
        {!emotes ? (
          <div className="arena-emote-loading">Loading...</div>
        ) : emotes.map(emote => {
          const isFav = favorites.includes(emote.id);
          return (
            <div key={emote.id} className="arena-emote-cell-wrapper">
              <button
                className="arena-emote-cell"
                onClick={() => onSelect(emote.id)}
              >
                <img
                  src={`/images/emotes/${emote.image}`}
                  alt={emote.name}
                  draggable={false}
                />
              </button>
              {onToggleFavorite && (
                <button
                  className={`arena-emote-fav-btn${isFav ? ' arena-emote-fav-active' : ''}${!isFav && maxed ? ' arena-emote-fav-disabled' : ''}`}
                  onClick={(e) => { e.stopPropagation(); onToggleFavorite(emote.id); }}
                  disabled={!isFav && maxed}
                >
                  {isFav ? '\u2605' : '\u2606'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

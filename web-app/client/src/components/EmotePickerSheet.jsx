import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../hooks/useApi';
import '../styles/emotes.css';

export default function EmotePickerSheet({ onSelect, onClose }) {
  const [catalog, setCatalog] = useState(null);
  const [activeCategory, setActiveCategory] = useState(null);
  const backdropRef = useRef(null);

  useEffect(() => {
    api('/api/emotes/catalog')
      .then(data => {
        setCatalog(data);
        if (data.categories?.length) setActiveCategory(data.categories[0].id);
      })
      .catch(() => setCatalog({ categories: [], emotes: [] }));
  }, []);

  const handleBackdropClick = useCallback((e) => {
    if (e.target === backdropRef.current) onClose();
  }, [onClose]);

  const filteredEmotes = catalog?.emotes?.filter(
    e => !activeCategory || e.category === activeCategory
  ) || [];

  return (
    <div
      ref={backdropRef}
      className="emote-picker-backdrop"
      onClick={handleBackdropClick}
    >
      <div className="emote-picker-sheet">
        <div className="emote-picker-header">
          <span>Emotes</span>
          <button className="emote-picker-close" onClick={onClose}>&times;</button>
        </div>

        {/* Category tabs */}
        {catalog?.categories?.length > 0 && (
          <div className="emote-picker-tabs">
            {catalog.categories.map(cat => (
              <button
                key={cat.id}
                className={`emote-picker-tab${activeCategory === cat.id ? ' active' : ''}`}
                onClick={() => setActiveCategory(cat.id)}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}

        {/* Emote grid */}
        <div className="emote-picker-grid">
          {!catalog ? (
            <div className="emote-picker-loading">Loading emotes...</div>
          ) : filteredEmotes.length === 0 ? (
            <div className="emote-picker-loading">No emotes yet</div>
          ) : filteredEmotes.map(emote => (
            <button
              key={emote.id}
              className="emote-picker-cell"
              onClick={() => onSelect(emote.id)}
              title={emote.name}
            >
              <img
                src={`/images/emotes/${emote.image}`}
                alt={emote.name}
                draggable={false}
              />
              <span className="emote-picker-label">{emote.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

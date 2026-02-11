import { useState, useEffect, useRef, useCallback } from 'react';
import { EMOJI_CATEGORIES } from '../data/emojiData';

/**
 * Bottom-sheet overlay with the full emoji grid for adding reactions.
 * Reuses EMOJI_CATEGORIES from the custom keyboard's emojiData.
 */
export default function EmojiPickerSheet({ messageId, onSelect, onClose }) {
  const [activeCategory, setActiveCategory] = useState(EMOJI_CATEGORIES[0].id);
  const gridRef = useRef(null);
  const headerRefs = useRef({});

  // IntersectionObserver to track which category is visible while scrolling
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveCategory(entry.target.dataset.categoryId);
          }
        }
      },
      {
        root: grid,
        rootMargin: '-8px 0px -80% 0px',
        threshold: 0,
      }
    );

    // Observe all category header elements
    for (const id of Object.keys(headerRefs.current)) {
      if (headerRefs.current[id]) {
        observer.observe(headerRefs.current[id]);
      }
    }

    return () => observer.disconnect();
  }, []);

  const scrollToCategory = useCallback((categoryId) => {
    const el = headerRefs.current[categoryId];
    if (el && gridRef.current) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const handleEmojiClick = useCallback((emoji) => {
    onSelect(messageId, emoji);
  }, [messageId, onSelect]);

  return (
    <>
      <div className="emoji-sheet-overlay" onClick={onClose} />
      <div className="emoji-sheet">
        {/* Header */}
        <div className="emoji-sheet-header">
          <span className="emoji-sheet-title">Add Reaction</span>
          <button className="emoji-sheet-close" onClick={onClose}>&times;</button>
        </div>

        {/* Category tabs */}
        <div className="emoji-sheet-tabs">
          {EMOJI_CATEGORIES.map(cat => (
            <button
              key={cat.id}
              className={`emoji-sheet-tab${activeCategory === cat.id ? ' emoji-sheet-tab-active' : ''}`}
              onClick={() => scrollToCategory(cat.id)}
            >
              {cat.icon}
            </button>
          ))}
        </div>

        {/* Scrollable emoji grid */}
        <div className="emoji-sheet-grid" ref={gridRef}>
          {EMOJI_CATEGORIES.map(cat => (
            <div key={cat.id}>
              <div
                className="emoji-sheet-category-header"
                ref={(el) => { headerRefs.current[cat.id] = el; }}
                data-category-id={cat.id}
              >
                {cat.label}
              </div>
              <div className="emoji-sheet-cells">
                {cat.emojis.map(emoji => (
                  <button
                    key={emoji}
                    className="emoji-sheet-cell"
                    onClick={() => handleEmojiClick(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

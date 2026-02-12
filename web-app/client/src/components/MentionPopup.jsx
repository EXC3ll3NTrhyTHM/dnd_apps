import { useEffect, useRef } from 'react';
import NpcPortrait from './NpcPortrait';

/**
 * Dropdown popup showing filtered groups and NPCs for @mentions.
 * Groups appear first with a role icon, then individual NPCs with portraits.
 */
export default function MentionPopup({ items, activeIndex, onSelect }) {
  const activeRef = useRef(null);

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  if (!items || items.length === 0) return null;

  return (
    <div className="mention-popup">
      {items.map((item, i) => (
        <div
          key={item.type === 'group' ? `group-${item.id}` : item.id}
          ref={i === activeIndex ? activeRef : null}
          className={`mention-popup-item${i === activeIndex ? ' mention-popup-item-active' : ''}${item.type === 'group' ? ' mention-popup-group' : ''}`}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSelect(item);
          }}
        >
          {item.type === 'group' ? (
            <span className="mention-popup-group-icon">@</span>
          ) : item.type === 'player' ? (
            <img
              src={item.avatar}
              alt={item.displayName}
              className="mention-popup-player-avatar"
            />
          ) : (
            <NpcPortrait npcId={item.id} size={28} />
          )}
          <span className="mention-popup-name">{item.displayName}</span>
          {item.type === 'group' && (
            <span className="mention-popup-group-count">{item.members.length}</span>
          )}
        </div>
      ))}
    </div>
  );
}

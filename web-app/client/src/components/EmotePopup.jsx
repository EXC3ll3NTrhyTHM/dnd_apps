import { useCallback } from 'react';
import '../styles/emotes.css';

export default function EmotePopup({ emotes, onDismiss }) {
  const handleAnimationEnd = useCallback((key) => {
    onDismiss(key);
  }, [onDismiss]);

  if (!emotes || emotes.length === 0) return null;

  return (
    <div className="emote-popup-overlay">
      {emotes.map((emote) => (
        <div
          key={emote.key}
          className="emote-popup"
          style={{ left: `${emote.left}%` }}
          onAnimationEnd={() => handleAnimationEnd(emote.key)}
        >
          <img
            src={`/images/emotes/${emote.image}`}
            alt={emote.characterName}
            draggable={false}
          />
          <span className="emote-popup-name">{emote.characterName}</span>
        </div>
      ))}
    </div>
  );
}

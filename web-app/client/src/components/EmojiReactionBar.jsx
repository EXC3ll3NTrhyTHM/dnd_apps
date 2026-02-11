import { useEffect, useRef } from 'react';

const QUICK_EMOJIS = ['❤️', '😂', '👍', '🔥', '⚔️', '💀'];

/**
 * Floating quick-emoji bar that appears on long-press above a message.
 * 6 quick emojis + a "+" button to open the full picker.
 */
export default function EmojiReactionBar({ messageId, targetRect, onSelect, onOpenFullPicker, onClose }) {
  const barRef = useRef(null);

  // Position the bar above the target message
  useEffect(() => {
    if (!barRef.current || !targetRect) return;

    const bar = barRef.current;
    const barRect = bar.getBoundingClientRect();
    const padding = 8;

    // Center horizontally on the message, clamp to viewport
    let left = targetRect.left + targetRect.width / 2 - barRect.width / 2;
    left = Math.max(padding, Math.min(left, window.innerWidth - barRect.width - padding));

    // Place above the message
    let top = targetRect.top - barRect.height - 8;
    if (top < padding) {
      // If no room above, place below
      top = targetRect.bottom + 8;
    }

    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
    bar.style.visibility = 'visible';
  }, [targetRect]);

  // Haptic feedback on mount
  useEffect(() => {
    if (navigator.vibrate) navigator.vibrate(50);
  }, []);

  // Close on outside tap
  useEffect(() => {
    function handlePointerDown(e) {
      if (barRef.current && !barRef.current.contains(e.target)) {
        onClose();
      }
    }
    // Use setTimeout so the triggering long-press pointerup doesn't immediately close
    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', handlePointerDown, true);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [onClose]);

  return (
    <div ref={barRef} className="reaction-bar" style={{ visibility: 'hidden' }}>
      {QUICK_EMOJIS.map(emoji => (
        <button
          key={emoji}
          className="reaction-bar-emoji"
          onClick={() => onSelect(messageId, emoji)}
        >
          {emoji}
        </button>
      ))}
      <button
        className="reaction-bar-plus"
        onClick={() => onOpenFullPicker(messageId)}
      >
        +
      </button>
    </div>
  );
}

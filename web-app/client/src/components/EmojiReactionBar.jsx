import { useEffect, useRef } from 'react';

const QUICK_EMOJIS = ['❤️', '😂', '👍', '🔥', '⚔️', '💀'];

/**
 * Floating quick-emoji bar that appears on long-press above a message.
 * 6 quick emojis + a "+" button to open the full picker.
 */
export default function EmojiReactionBar({ messageId, targetRect, onSelect, onOpenFullPicker, onClose, canDelete, onDelete }) {
  const barRef = useRef(null);

  // Position the bar above the target message
  // Use offsetWidth/offsetHeight instead of getBoundingClientRect — the pop
  // animation starts at scale(0.7) and gBCR includes transforms, which would
  // make the bar appear ~30% narrower than it really is and break clamping.
  useEffect(() => {
    if (!barRef.current || !targetRect) return;

    const bar = barRef.current;
    const barW = bar.offsetWidth;
    const barH = bar.offsetHeight;
    const padding = 8;

    // Center horizontally on the message, clamp to viewport
    let left = targetRect.left + targetRect.width / 2 - barW / 2;
    left = Math.max(padding, Math.min(left, window.innerWidth - barW - padding));

    // Place above the message
    let top = targetRect.top - barH - 8;
    if (top < padding) {
      // If no room above, place below
      top = targetRect.bottom + 8;
    }

    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
    bar.style.visibility = 'visible';
  }, [targetRect, canDelete]);

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
      {canDelete && (
        <button
          className="reaction-bar-delete"
          onClick={() => { onClose(); onDelete(messageId); }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
          </svg>
        </button>
      )}
    </div>
  );
}

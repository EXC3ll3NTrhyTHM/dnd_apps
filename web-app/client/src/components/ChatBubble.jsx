import { useMemo, useRef, useCallback } from 'react';
import NpcPortrait from './NpcPortrait';

/**
 * Render message text with @NpcName mention highlights and *italic* formatting.
 * Uses a single regex pass so both patterns work together.
 */
function HighlightedText({ text, npcs }) {
  const parts = useMemo(() => {
    if (!text) return [text];

    // Build a combined regex with two alternatives:
    //   1) @NpcName mention (if npcs provided)
    //   2) *italic text*
    let mentionAlt = null;
    if (npcs?.length) {
      const names = npcs.map(n => n.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      mentionAlt = `(@(?:${names.join('|')}))`;
    }
    const italicAlt = '\\*([^*]+)\\*';
    const combined = mentionAlt ? `${mentionAlt}|${italicAlt}` : italicAlt;
    const pattern = new RegExp(combined, 'g');

    // Group indices: with mentions → [1]=mention, [2]=italic content
    //                without     → [1]=italic content
    const mentionIdx = mentionAlt ? 1 : -1;
    const italicIdx = mentionAlt ? 2 : 1;

    const result = [];
    let lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        result.push(text.slice(lastIndex, match.index));
      }
      if (mentionIdx > 0 && match[mentionIdx]) {
        result.push(<span key={match.index} className="mention-highlight-bubble">{match[mentionIdx]}</span>);
      } else if (match[italicIdx]) {
        result.push(<em key={match.index}>{match[italicIdx]}</em>);
      }
      lastIndex = pattern.lastIndex;
    }
    if (lastIndex < text.length) {
      result.push(text.slice(lastIndex));
    }
    return result;
  }, [text, npcs]);

  return <>{parts}</>;
}

/** Reaction pills row below message content */
function ReactionPills({ reactions, currentUserId, onReact, messageId }) {
  if (!reactions || Object.keys(reactions).length === 0) return null;

  return (
    <div className="chat-bubble-reactions">
      {Object.entries(reactions).map(([emoji, userIds]) => {
        const active = userIds.includes(currentUserId);
        return (
          <button
            key={emoji}
            className={`reaction-pill${active ? ' reaction-pill-active' : ''}`}
            onClick={(e) => { e.stopPropagation(); onReact(messageId, emoji); }}
          >
            <span className="reaction-pill-emoji">{emoji}</span>
            <span className="reaction-pill-count">{userIds.length}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Chat message bubble.
 * NPC variant shows portrait + name on the left.
 * Own player messages are right-aligned.
 * Other players' messages are left-aligned with a distinct accent.
 */
export default function ChatBubble({ message, npcs, currentUserId, onLongPress, onReact }) {
  const isPlayer = message.role === 'player';
  const isTyping = message.typing;
  const canInteract = !isTyping && !message._optimistic && message.id;

  // Long-press detection refs
  const timerRef = useRef(null);
  const startPos = useRef(null);
  const lastTapRef = useRef(0);
  const bubbleRef = useRef(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handlePointerDown = useCallback((e) => {
    if (!canInteract || !onLongPress) return;
    // Capture element now — e.currentTarget is nulled after the handler returns
    const el = e.currentTarget;
    startPos.current = { x: e.clientX, y: e.clientY };
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const rect = el.getBoundingClientRect();
      onLongPress(message.id, rect);
    }, 500);
  }, [canInteract, onLongPress, message.id]);

  const handlePointerMove = useCallback((e) => {
    if (!timerRef.current || !startPos.current) return;
    const dx = e.clientX - startPos.current.x;
    const dy = e.clientY - startPos.current.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      clearTimer();
    }
  }, [clearTimer]);

  const handlePointerUp = useCallback(() => {
    if (!timerRef.current) return; // long-press already fired
    clearTimer();

    // Double-tap detection — select message text
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      lastTapRef.current = 0;
      const textEl = bubbleRef.current?.querySelector('.chat-bubble-text');
      if (textEl) {
        // Temporarily enable text selection (bubble has user-select:none)
        textEl.style.webkitUserSelect = 'text';
        textEl.style.userSelect = 'text';

        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(textEl);
        sel.removeAllRanges();
        sel.addRange(range);

        // Remove override once the user clears the selection
        const onSelChange = () => {
          if (!sel.toString()) {
            textEl.style.webkitUserSelect = '';
            textEl.style.userSelect = '';
            document.removeEventListener('selectionchange', onSelChange);
          }
        };
        document.addEventListener('selectionchange', onSelChange);
      }
    } else {
      lastTapRef.current = now;
    }
  }, [clearTimer]);

  const handleContextMenu = useCallback((e) => {
    if (canInteract && onLongPress) {
      e.preventDefault();
    }
  }, [canInteract, onLongPress]);

  const interactionProps = canInteract && onLongPress ? {
    ref: bubbleRef,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: clearTimer,
    onContextMenu: handleContextMenu,
  } : {};

  const reactionPills = canInteract && onReact ? (
    <ReactionPills
      reactions={message.reactions}
      currentUserId={currentUserId}
      onReact={onReact}
      messageId={message.id}
    />
  ) : null;

  if (isPlayer) {
    const isOtherPlayer = message.userId && message.userId !== currentUserId;

    if (message.type === 'gif') {
      return (
        <div
          className={`chat-bubble ${isOtherPlayer ? 'chat-bubble-other-player' : 'chat-bubble-player'}`}
          {...interactionProps}
        >
          {message.playerAvatar && (
            <img
              src={message.playerAvatar}
              alt={message.playerName || 'Player'}
              className="chat-bubble-portrait chat-bubble-player-avatar"
            />
          )}
          <div className="chat-bubble-content">
            {message.playerName && (
              <span className={`chat-bubble-name ${isOtherPlayer ? 'chat-bubble-name-other' : 'chat-bubble-name-player'}`}>
                {message.playerName}
              </span>
            )}
            <img
              className="chat-bubble-gif"
              src={message.gifUrl}
              alt={message.text || 'GIF'}
              width={message.gifWidth || 220}
              height={message.gifHeight || 165}
              loading="lazy"
            />
            {reactionPills}
          </div>
        </div>
      );
    }

    return (
      <div
        className={`chat-bubble ${isOtherPlayer ? 'chat-bubble-other-player' : 'chat-bubble-player'}`}
        {...interactionProps}
      >
        {message.playerAvatar && (
          <img
            src={message.playerAvatar}
            alt={message.playerName || 'Player'}
            className="chat-bubble-portrait chat-bubble-player-avatar"
          />
        )}
        <div className="chat-bubble-content">
          {message.playerName && (
            <span className={`chat-bubble-name ${isOtherPlayer ? 'chat-bubble-name-other' : 'chat-bubble-name-player'}`}>
              {message.playerName}
            </span>
          )}
          <p className="chat-bubble-text">
            <HighlightedText text={message.text} npcs={npcs} />
          </p>
          {reactionPills}
        </div>
      </div>
    );
  }

  return (
    <div className="chat-bubble chat-bubble-npc" {...interactionProps}>
      <NpcPortrait
        npcId={message.npc}
        emotion={message.emotion || 'idle'}
        size={36}
        className="chat-bubble-portrait"
      />
      <div className="chat-bubble-content">
        <span className="chat-bubble-name">{message.npcDisplayName || message.npc}</span>
        {isTyping ? (
          <div className="chat-typing-indicator">
            <span /><span /><span />
          </div>
        ) : (
          <>
            <p className="chat-bubble-text">
              <HighlightedText text={message.text} npcs={npcs} />
            </p>
            {reactionPills}
          </>
        )}
      </div>
    </div>
  );
}

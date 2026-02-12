import { useMemo, useRef, useCallback, useState, useEffect } from 'react';
import NpcPortrait from './NpcPortrait';

/**
 * Render message text with @mention highlights and *italic* formatting.
 * Highlights both NPC and player @mentions.
 * Uses a single regex pass so both patterns work together.
 */
function HighlightedText({ text, npcs, players }) {
  const parts = useMemo(() => {
    if (!text) return [text];

    // Build a combined regex with two alternatives:
    //   1) @Name mention (NPCs + players, if provided)
    //   2) *italic text*
    let mentionAlt = null;
    const allNames = [
      ...(npcs || []).map(n => n.displayName),
      ...(players || []).map(p => p.characterName),
    ].filter(Boolean).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (allNames.length) {
      mentionAlt = `(@(?:${allNames.join('|')}))`;
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
  }, [text, npcs, players]);

  return <>{parts}</>;
}

/** Resolve a reaction userId to a display name */
function resolveReactorName(userId, npcs, players) {
  // NPC names are stored as plain strings like 'marcel', 'kai', etc.
  const npc = (npcs || []).find(n => n.id === userId || n.displayName === userId);
  if (npc) return npc.displayName || userId;
  const player = (players || []).find(p => p.id === userId);
  if (player) return player.characterName || userId;
  // Capitalize if it looks like an NPC id
  if (userId && !/^\d+$/.test(userId)) return userId.charAt(0).toUpperCase() + userId.slice(1);
  return userId;
}

/** Reaction pills row below message content — long-press to see who reacted */
function ReactionPills({ reactions, currentUserId, onReact, messageId, npcs, players }) {
  const [tooltip, setTooltip] = useState(null); // emoji key or null
  const longPressTimer = useRef(null);
  const didLongPress = useRef(false);

  // Dismiss tooltip on any scroll or tap elsewhere
  useEffect(() => {
    if (!tooltip) return;
    const dismiss = () => setTooltip(null);
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('scroll', dismiss, true);
    };
  }, [tooltip]);

  if (!reactions || Object.keys(reactions).length === 0) return null;

  const handlePillPointerDown = (e, emoji) => {
    didLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      longPressTimer.current = null;
      setTooltip(prev => prev === emoji ? null : emoji);
    }, 400);
  };

  const handlePillPointerUp = (e, emoji) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (!didLongPress.current) {
      // Normal tap — toggle reaction
      e.stopPropagation();
      setTooltip(null);
      onReact(messageId, emoji);
    }
  };

  const handlePillPointerCancel = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  return (
    <div className="chat-bubble-reactions">
      {Object.entries(reactions).map(([emoji, userIds]) => {
        const active = userIds.includes(currentUserId);
        const showTooltip = tooltip === emoji;
        return (
          <div key={emoji} className="reaction-pill-wrapper">
            <button
              className={`reaction-pill${active ? ' reaction-pill-active' : ''}`}
              onPointerDown={(e) => handlePillPointerDown(e, emoji)}
              onPointerUp={(e) => handlePillPointerUp(e, emoji)}
              onPointerCancel={handlePillPointerCancel}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="reaction-pill-emoji">{emoji}</span>
              <span className="reaction-pill-count">{userIds.length}</span>
            </button>
            {showTooltip && (
              <div className="reaction-tooltip" onClick={(e) => e.stopPropagation()}>
                {userIds.map((uid, i) => (
                  <span key={uid} className="reaction-tooltip-name">
                    {resolveReactorName(uid, npcs, players)}{i < userIds.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
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
export default function ChatBubble({ message, npcs, players, currentUserId, onLongPress, onReact }) {
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
      npcs={npcs}
      players={players}
    />
  ) : null;

  // Dice roll message — centered, special layout
  if (message.type === 'dice_roll') {
    return (
      <div className="chat-bubble chat-bubble-dice" {...interactionProps}>
        {message.playerAvatar && (
          <img
            src={message.playerAvatar}
            alt={message.playerName || 'Player'}
            className="chat-bubble-portrait chat-bubble-player-avatar"
          />
        )}
        <div className="chat-bubble-content">
          {message.playerName && (
            <span className="chat-bubble-name chat-bubble-name-dice">{message.playerName}</span>
          )}
          <div className="dice-roll-result">
            <span className="dice-roll-notation">{message.notation}</span>
            <div className="dice-roll-values">
              {message.rolls.map((val, i) => (
                <span
                  key={i}
                  className={`dice-value${message.kept && !message.kept.includes(i) ? ' dice-dropped' : ''}`}
                >
                  {val}
                </span>
              ))}
            </div>
            {message.modifier !== 0 && message.modifier != null && (
              <span className="dice-modifier">{message.modifier > 0 ? '+' : ''}{message.modifier}</span>
            )}
            <span className="dice-total">= {message.total}</span>
          </div>
          {reactionPills}
        </div>
      </div>
    );
  }

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

    if (message.type === 'image') {
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
              className="chat-bubble-image"
              src={message.imageUrl}
              alt={message.text || 'Image'}
              width={message.imageWidth || undefined}
              height={message.imageHeight || undefined}
              loading="lazy"
            />
            {message.text && (
              <p className="chat-bubble-text chat-bubble-caption">
                <HighlightedText text={message.text} npcs={npcs} players={players} />
              </p>
            )}
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
            <HighlightedText text={message.text} npcs={npcs} players={players} />
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
        ) : message.type === 'image' ? (
          <>
            <img
              className="chat-bubble-image"
              src={message.imageUrl}
              alt={message.text || 'Image'}
              width={message.imageWidth || undefined}
              height={message.imageHeight || undefined}
              loading="lazy"
            />
            {message.text && (
              <p className="chat-bubble-text chat-bubble-caption">
                <HighlightedText text={message.text} npcs={npcs} players={players} />
              </p>
            )}
            {reactionPills}
          </>
        ) : (
          <>
            <p className="chat-bubble-text">
              <HighlightedText text={message.text} npcs={npcs} players={players} />
            </p>
            {reactionPills}
          </>
        )}
      </div>
    </div>
  );
}

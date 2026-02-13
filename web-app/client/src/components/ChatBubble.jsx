import { useMemo, useRef, useCallback, useState, useEffect, Children, isValidElement, cloneElement } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import NpcPortrait from './NpcPortrait';

/**
 * Render message text with markdown support and @mention highlights.
 * Supports: **bold**, *italic*, `code`, ~~strikethrough~~, and @mentions.
 */
function HighlightedText({ text, npcs, players, groups }) {
  // Build mention pattern for highlighting
  const mentionPattern = useMemo(() => {
    const allNames = [
      ...(npcs || []).map(n => n.displayName),
      ...(players || []).map(p => p.characterName),
      ...Object.values(groups || {}).map(g => g.displayName),
    ].filter(Boolean).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (allNames.length) {
      return new RegExp(`(@(?:${allNames.join('|')}))`, 'g');
    }
    return null;
  }, [npcs, players, groups]);

  // Process a string to highlight @mentions
  const highlightMentions = useCallback((str) => {
    if (!mentionPattern || typeof str !== 'string') return str;
    
    const parts = [];
    let lastIndex = 0;
    let match;
    const pattern = new RegExp(mentionPattern.source, 'g');
    
    while ((match = pattern.exec(str)) !== null) {
      if (match.index > lastIndex) {
        parts.push(str.slice(lastIndex, match.index));
      }
      parts.push(
        <span key={`mention-${match.index}`} className="mention-highlight-bubble">
          {match[1]}
        </span>
      );
      lastIndex = pattern.lastIndex;
    }
    
    if (lastIndex < str.length) {
      parts.push(str.slice(lastIndex));
    }
    
    return parts.length > 1 ? parts : str;
  }, [mentionPattern]);

  // Recursively process children to highlight mentions in text nodes
  const processChildren = useCallback((children) => {
    return Children.map(children, (child, index) => {
      if (typeof child === 'string') {
        return highlightMentions(child);
      }
      if (isValidElement(child) && child.props.children) {
        return cloneElement(child, {
          ...child.props,
          key: child.key || index,
          children: processChildren(child.props.children)
        });
      }
      return child;
    });
  }, [highlightMentions]);

  // Custom components for ReactMarkdown
  const components = useMemo(() => ({
    // Don't wrap in <p> tags - just render children inline
    p: ({ children }) => <>{processChildren(children)}</>,
    // Standard markdown elements with mention processing
    strong: ({ children }) => <strong>{processChildren(children)}</strong>,
    em: ({ children }) => <em>{processChildren(children)}</em>,
    del: ({ children }) => <del>{processChildren(children)}</del>,
    code: ({ inline, children }) =>
      inline !== false ? (
        <code className="chat-inline-code">{children}</code>
      ) : (
        <pre className="chat-code-block"><code>{children}</code></pre>
      ),
    h1: ({ children }) => <span className="chat-heading chat-h1">{processChildren(children)}</span>,
    h2: ({ children }) => <span className="chat-heading chat-h2">{processChildren(children)}</span>,
    h3: ({ children }) => <span className="chat-heading chat-h3">{processChildren(children)}</span>,
    h4: ({ children }) => <span className="chat-heading chat-h4">{processChildren(children)}</span>,
  }), [processChildren]);

  if (!text) return null;

  // Split on newlines and render each line through ReactMarkdown,
  // joining with explicit <br /> elements so line breaks always display.
  const lines = text.split('\n');

  return lines.map((line, i) => (
    <span key={i}>
      {i > 0 && <br />}
      {line && (
        <ReactMarkdown
          components={components}
          allowedElements={['p', 'strong', 'em', 'del', 'code', 'pre', 'h1', 'h2', 'h3', 'h4']}
          unwrapDisallowed={true}
        >
          {line}
        </ReactMarkdown>
      )}
    </span>
  ));
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
export default function ChatBubble({ message, npcs, players, groups, currentUserId, onLongPress, onReact, onNameTap }) {
  const navigate = useNavigate();
  const isPlayer = message.role === 'player';
  const isTyping = message.typing;
  const canInteract = !isTyping && !message._optimistic && message.id;

  // Long-press detection refs
  const timerRef = useRef(null);
  const startPos = useRef(null);
  const lastTapRef = useRef(0);
  const bubbleRef = useRef(null);
  const [copyBtn, setCopyBtn] = useState(null); // { top, left } or null

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

    // Double-tap detection — select message text and show copy button
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

        // Position copy button above the text element
        const rect = textEl.getBoundingClientRect();
        const bubbleRect = bubbleRef.current.getBoundingClientRect();
        setCopyBtn({
          top: rect.top - bubbleRect.top - 36,
          left: rect.left - bubbleRect.left + rect.width / 2,
        });

        // Remove override + hide button once the user clears the selection
        const onSelChange = () => {
          if (!sel.toString()) {
            textEl.style.webkitUserSelect = '';
            textEl.style.userSelect = '';
            setCopyBtn(null);
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

  const handleCopy = useCallback(() => {
    const textEl = bubbleRef.current?.querySelector('.chat-bubble-text');
    if (textEl) {
      navigator.clipboard.writeText(textEl.innerText).catch(() => {});
    }
    window.getSelection()?.removeAllRanges();
    setCopyBtn(null);
  }, []);

  const interactionProps = canInteract && onLongPress ? {
    ref: bubbleRef,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: clearTimer,
    onContextMenu: handleContextMenu,
  } : {};

  const copyButton = copyBtn && (
    <button
      className="chat-copy-btn"
      style={{ top: copyBtn.top, left: copyBtn.left }}
      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); handleCopy(); }}
    >
      Copy
    </button>
  );

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

  const handleNameTap = useCallback((e, name) => {
    if (!onNameTap || !name) return;
    e.stopPropagation();
    onNameTap({ displayName: name });
  }, [onNameTap]);

  // Dice roll message — centered, special layout
  if (message.type === 'dice_roll') {
    return (
      <div className="chat-bubble chat-bubble-dice" {...interactionProps}>
        {message.playerAvatar && (
          <img
            src={message.playerAvatar}
            alt={message.playerName || 'Player'}
            className="chat-bubble-portrait chat-bubble-player-avatar"
            onClick={(e) => { if (message.userId) { e.stopPropagation(); navigate(`/player/${message.userId}`); } }}
            style={message.userId ? { cursor: 'pointer' } : undefined}
          />
        )}
        <div className="chat-bubble-content">
          {message.playerName && (
            <span
              className="chat-bubble-name chat-bubble-name-dice"
              {...(message.userId !== currentUserId && onNameTap ? { onClick: (e) => handleNameTap(e, message.playerName), style: { cursor: 'pointer' } } : {})}
            >
              {message.playerName}
            </span>
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

  // Encounter narration messages — combat results in chat
  if (message.type === 'encounter') {
    const subtypeClass = message.subtype === 'round_header' ? 'enc-round-header'
      : message.subtype === 'victory' ? 'enc-victory'
      : message.subtype === 'defeat' ? 'enc-defeat'
      : '';
    return (
      <div className={`chat-bubble-encounter ${subtypeClass}`}>
        <HighlightedText text={message.text} npcs={npcs} players={players} groups={groups} />
      </div>
    );
  }

  if (isPlayer) {
    const isOtherPlayer = message.userId && message.userId !== currentUserId;
    const nameProps = isOtherPlayer && onNameTap ? {
      onClick: (e) => handleNameTap(e, message.playerName),
      style: { cursor: 'pointer' },
    } : {};

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
              <span className={`chat-bubble-name ${isOtherPlayer ? 'chat-bubble-name-other' : 'chat-bubble-name-player'}`} {...nameProps}>
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
              <span className={`chat-bubble-name ${isOtherPlayer ? 'chat-bubble-name-other' : 'chat-bubble-name-player'}`} {...nameProps}>
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
                <HighlightedText text={message.text} npcs={npcs} players={players} groups={groups} />
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
            onClick={(e) => { if (message.userId) { e.stopPropagation(); navigate(`/player/${message.userId}`); } }}
            style={message.userId ? { cursor: 'pointer' } : undefined}
          />
        )}
        <div className="chat-bubble-content">
          {copyButton}
          {message.playerName && (
            <span className={`chat-bubble-name ${isOtherPlayer ? 'chat-bubble-name-other' : 'chat-bubble-name-player'}`} {...nameProps}>
              {message.playerName}
            </span>
          )}
          <p className="chat-bubble-text">
            <HighlightedText text={message.text} npcs={npcs} players={players} groups={groups} />
          </p>
          {reactionPills}
        </div>
      </div>
    );
  }

  return (
    <div className={`chat-bubble chat-bubble-npc${message.npc === 'marcel' ? ' chat-bubble-marcel' : ''}`} {...interactionProps}>
      <NpcPortrait
        npcId={message.npc}
        emotion={message.emotion || 'idle'}
        size={36}
        className="chat-bubble-portrait"
      />
      <div className="chat-bubble-content">
        {copyButton}
        <span
          className="chat-bubble-name"
          {...(onNameTap ? { onClick: (e) => handleNameTap(e, message.npcDisplayName || message.npc), style: { cursor: 'pointer' } } : {})}
        >
          {message.npcDisplayName || message.npc}
        </span>
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
                <HighlightedText text={message.text} npcs={npcs} players={players} groups={groups} />
              </p>
            )}
            {reactionPills}
          </>
        ) : (
          <>
            <p className="chat-bubble-text">
              <HighlightedText text={message.text} npcs={npcs} players={players} groups={groups} />
            </p>
            {reactionPills}
          </>
        )}
      </div>
    </div>
  );
}

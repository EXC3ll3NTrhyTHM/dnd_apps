import { useMemo } from 'react';
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

/**
 * Chat message bubble.
 * NPC variant shows portrait + name on the left.
 * Player variant is right-aligned.
 */
export default function ChatBubble({ message, npcs }) {
  const isPlayer = message.role === 'player';
  const isTyping = message.typing;

  if (isPlayer) {
    return (
      <div className="chat-bubble chat-bubble-player">
        <div className="chat-bubble-content">
          <p className="chat-bubble-text">
            <HighlightedText text={message.text} npcs={npcs} />
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-bubble chat-bubble-npc">
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
          <p className="chat-bubble-text">
            <HighlightedText text={message.text} npcs={npcs} />
          </p>
        )}
      </div>
    </div>
  );
}

import NpcPortrait from './NpcPortrait';

/**
 * Chat message bubble.
 * NPC variant shows portrait + name on the left.
 * Player variant is right-aligned.
 */
export default function ChatBubble({ message }) {
  const isPlayer = message.role === 'player';
  const isTyping = message.typing;

  if (isPlayer) {
    return (
      <div className="chat-bubble chat-bubble-player">
        <div className="chat-bubble-content">
          <p className="chat-bubble-text">{message.text}</p>
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
          <p className="chat-bubble-text">{message.text}</p>
        )}
      </div>
    </div>
  );
}

import { useState, useRef } from 'react';

/**
 * Chat text input with mode indicator and send button.
 */
export default function ChatInput({ onSend, selectedNpc, disabled }) {
  const [text, setText] = useState('');
  const inputRef = useRef(null);

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled) return;

    onSend(trimmed);
    setText('');
    inputRef.current?.focus();
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  const modeLabel = selectedNpc
    ? `Talking to ${selectedNpc}`
    : 'Talking to everyone';

  return (
    <form className="chat-input-form" onSubmit={handleSubmit}>
      <div className="chat-input-mode">{modeLabel}</div>
      <div className="chat-input-row">
        <input
          ref={inputRef}
          type="text"
          className="chat-input-field"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Say something..."
          disabled={disabled}
          maxLength={1000}
          autoComplete="off"
        />
        <button
          type="submit"
          className="chat-send-btn"
          disabled={!text.trim() || disabled}
          aria-label="Send message"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </form>
  );
}

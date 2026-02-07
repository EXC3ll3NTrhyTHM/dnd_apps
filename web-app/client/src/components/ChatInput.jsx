import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import MentionPopup from './MentionPopup';

/**
 * Get caret offset as a plain-text character index within a contentEditable.
 */
function getCaretOffset(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return 0;
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

/**
 * Restore caret to a plain-text character offset within a contentEditable.
 */
function setCaretOffset(el, offset) {
  const sel = window.getSelection();
  const range = document.createRange();
  let cur = 0;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (cur + node.length >= offset) {
      range.setStart(node, offset - cur);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    cur += node.length;
  }
  // Fallback: place at end
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Chat input using contentEditable for live formatting.
 * *text* renders italic (asterisks hidden), @NpcName renders as gold pills.
 * Supports @GroupName which expands to individual @mentions on selection.
 * The plain text (with asterisks) is what gets sent to the server.
 */
export default function ChatInput({ onSend, disabled, npcs = [], groups = {}, insertNpc, onInsertNpcDone }) {
  const [text, setText] = useState('');
  const [mentionQuery, setMentionQuery] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const editorRef = useRef(null);
  const composing = useRef(false);

  // Build formatted HTML from plain text
  const formatHtml = useCallback((plain) => {
    if (!plain) return '';
    let html = escapeHtml(plain);

    // @mentions → gold pill spans
    if (npcs.length) {
      const names = npcs.map(n => n.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      html = html.replace(
        new RegExp(`(@(?:${names.join('|')}))`, 'g'),
        '<span class="mention-highlight-inline">$1</span>'
      );
    }

    // *italic* → hide asterisks, italicize content
    html = html.replace(
      /\*([^*]+)\*/g,
      '<span class="italic-marker">*</span><em>$1</em><span class="italic-marker">*</span>'
    );

    return html;
  }, [npcs]);

  // Sync editor HTML when text changes programmatically (mention insert, clear)
  const syncEditor = useCallback((newText, cursorAt) => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = newText ? formatHtml(newText) : '';
    if (typeof cursorAt === 'number') {
      setCaretOffset(el, cursorAt);
    }
  }, [formatHtml]);

  // Programmatic mention insertion from parent (NPC bar / scene click)
  useEffect(() => {
    if (!insertNpc) return;

    const mention = `@${insertNpc.displayName} `;
    setText(prev => {
      if (prev.trimEnd().endsWith(mention.trim())) return prev;
      const base = prev.length && !prev.endsWith(' ') ? prev + ' ' : prev;
      const newText = base + mention;

      requestAnimationFrame(() => {
        syncEditor(newText, newText.length);
        editorRef.current?.focus();
      });

      return newText;
    });

    onInsertNpcDone?.();
  }, [insertNpc, onInsertNpcDone, syncEditor]);

  // Build combined items list: @Everyone + groups + individual NPCs
  const allItems = useMemo(() => {
    const items = [];

    // @Everyone — always available if there are 2+ NPCs
    if (npcs.length >= 2) {
      items.push({
        type: 'group',
        id: 'everyone',
        displayName: 'Everyone',
        members: npcs.map(n => n.displayName)
      });
    }

    // Location groups
    for (const [groupId, group] of Object.entries(groups)) {
      items.push({
        type: 'group',
        id: groupId,
        displayName: group.displayName,
        members: group.members || []
      });
    }

    // Individual NPCs
    for (const npc of npcs) {
      items.push({ type: 'npc', ...npc });
    }

    return items;
  }, [npcs, groups]);

  // Filtered items for popup
  const filteredItems = useMemo(() => {
    if (mentionQuery === null) return [];
    if (mentionQuery === '') return allItems;
    const q = mentionQuery.toLowerCase();
    return allItems.filter(item => item.displayName.toLowerCase().includes(q));
  }, [mentionQuery, allItems]);

  // Detect @mention query from cursor position
  function detectMention(plain, cursor) {
    const before = plain.slice(0, cursor);
    const atIdx = before.lastIndexOf('@');
    if (atIdx === -1 || (atIdx > 0 && before[atIdx - 1] !== ' ')) {
      setMentionQuery(null);
      return;
    }
    const filter = before.slice(atIdx + 1);
    if (filter.includes(' ')) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery(filter);
    setActiveIndex(0);
  }

  // Handle typing in the contentEditable
  function handleInput() {
    if (composing.current) return;
    const el = editorRef.current;
    const plain = el.textContent || '';
    setText(plain);

    // Only re-render HTML if text contains formatting chars
    if (plain.includes('*') || (npcs.length && plain.includes('@'))) {
      const offset = getCaretOffset(el);
      el.innerHTML = formatHtml(plain);
      setCaretOffset(el, offset);
    }

    detectMention(plain, getCaretOffset(el));
  }

  // Insert a mention from the popup
  const selectMention = useCallback((item) => {
    const el = editorRef.current;
    const plain = el.textContent || '';
    const cursor = getCaretOffset(el);
    const before = plain.slice(0, cursor);
    const atIdx = before.lastIndexOf('@');
    const after = plain.slice(cursor);

    let insertText;
    if (item.type === 'group') {
      // Expand group to individual @mentions
      insertText = item.members.map(name => `@${name}`).join(' ') + ' ';
    } else {
      insertText = `@${item.displayName} `;
    }

    const newText = plain.slice(0, atIdx) + insertText + after;
    const newCursor = atIdx + insertText.length;

    setText(newText);
    setMentionQuery(null);
    syncEditor(newText, newCursor);
    el.focus();
  }, [syncEditor]);

  function handleKeyDown(e) {
    if (mentionQuery !== null && filteredItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(i => (i + 1) % filteredItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(i => (i - 1 + filteredItems.length) % filteredItems.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectMention(filteredItems[activeIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleSubmit(e) {
    if (e) e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled) return;

    onSend(trimmed);
    setText('');
    setMentionQuery(null);
    const el = editorRef.current;
    if (el) {
      el.innerHTML = '';
      el.focus();
    }
  }

  // Strip formatting on paste
  function handlePaste(e) {
    e.preventDefault();
    const plain = (e.clipboardData.getData('text/plain') || '').slice(0, 1000);
    document.execCommand('insertText', false, plain);
  }

  const showPopup = mentionQuery !== null && filteredItems.length > 0;

  return (
    <form className="chat-input-form" onSubmit={handleSubmit}>
      <div className="chat-input-row">
        <div className="chat-input-wrapper">
          {!text && (
            <div className="chat-input-placeholder">Say something... (@ to mention)</div>
          )}
          <div
            ref={editorRef}
            className="chat-input-field"
            contentEditable={!disabled}
            role="textbox"
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { composing.current = false; handleInput(); }}
            suppressContentEditableWarning
          />
          {showPopup && (
            <MentionPopup
              items={filteredItems}
              activeIndex={activeIndex}
              onSelect={selectMention}
            />
          )}
        </div>
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

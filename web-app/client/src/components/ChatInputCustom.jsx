import { useState, useRef, useMemo, useCallback, useEffect, useLayoutEffect } from 'react';
import CustomKeyboard from './CustomKeyboard';
import MentionPopup from './MentionPopup';
import { prevGraphemeLength, nextGraphemeLength } from '../utils/grapheme';

/**
 * Walk text nodes inside `container` to find the DOM node + offset
 * corresponding to `targetOffset` characters of plain text.
 */
function findTextNodeAtOffset(container, targetOffset) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let accumulated = 0;
  let lastNode = null;
  let node;
  while ((node = walker.nextNode())) {
    lastNode = node;
    const len = node.textContent.length;
    if (accumulated + len >= targetOffset) {
      return { node, offset: targetOffset - accumulated };
    }
    accumulated += len;
  }
  if (lastNode) {
    return { node: lastNode, offset: lastNode.textContent.length };
  }
  return null;
}

/**
 * Chat input that uses the custom on-screen keyboard instead of the system keyboard.
 * The display area is a styled <div> (not an <input>), so tapping it never triggers
 * the native keyboard.
 *
 * Supports @mention popup (groups + NPCs), *italic* formatting in display,
 * cursor positioning (tap + drag + arrow keys), magnifier loupe during drag,
 * and the same onSend interface as ChatInput.
 */
export default function ChatInputCustom({
  onSend,
  disabled,
  npcs = [],
  groups = {},
  insertNpc,
  onInsertNpcDone,
  playSound,
  scrollContainerRef,
}) {
  const [text, setText] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const [kbOpen, setKbOpen] = useState(false);
  const [kbMode, setKbMode] = useState('keys');
  const [mentionQuery, setMentionQuery] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [showPasteBtn, setShowPasteBtn] = useState(false);
  const [listening, setListening] = useState(false);
  const [loupeInfo, setLoupeInfo] = useState(null);
  const [showHandle, setShowHandle] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);

  const displayRef = useRef(null);
  const contentRef = useRef(null);
  const cursorOverlayRef = useRef(null);
  const handleRef = useRef(null);
  const longPressTimer = useRef(null);
  const recognitionRef = useRef(null);
  const micBaseRef = useRef('');
  const micFinalRef = useRef('');
  const textRef = useRef(text);
  textRef.current = text;
  const cursorPosRef = useRef(cursorPos);
  cursorPosRef.current = cursorPos;
  const npcsRef = useRef(npcs);
  npcsRef.current = npcs;

  // Back button: close keyboard instead of navigating away
  const kbOpenRef = useRef(false);

  useEffect(() => {
    if (kbOpen && !kbOpenRef.current) {
      window.history.pushState({ customKb: true }, '');
      // Scroll chat to bottom so newest messages stay visible above keyboard
      const el = scrollContainerRef?.current;
      if (el) requestAnimationFrame(() => { el.scrollTop = 0; });
    } else if (!kbOpen && kbOpenRef.current) {
      if (window.history.state?.customKb) {
        window.history.back();
      }
    }
    kbOpenRef.current = kbOpen;
  }, [kbOpen, scrollContainerRef]);

  useEffect(() => {
    function onPopState() {
      if (kbOpenRef.current) {
        setKbOpen(false);
        setKbMode('keys');
        setMentionQuery(null);
        kbOpenRef.current = false;
      }
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Close keyboard when user swipes DOWN on the chat history
  // Uses touch events (reliable during mobile scroll) with a downward threshold.
  // Delays arming so layout-triggered scroll from keyboard open doesn't re-trigger.
  useEffect(() => {
    const el = scrollContainerRef?.current;
    if (!el || !kbOpen) return;
    let armed = false;
    const timer = setTimeout(() => { armed = true; }, 300);
    let startY = null;

    const onTouchStart = (e) => {
      startY = e.touches[0].clientY;
    };
    const onTouchMove = (e) => {
      if (!armed || startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 30) { // finger moved 30px downward
        setKbOpen(false);
        setKbMode('keys');
        setMentionQuery(null);
        setShowHandle(false);
        startY = null;
        // Scroll chat to bottom so newest messages are visible after keyboard closes
        requestAnimationFrame(() => { el.scrollTop = 0; }); // column-reverse: 0 = bottom
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      clearTimeout(timer);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, [kbOpen, scrollContainerRef]);

  // ── Overlay cursor positioning via layout measurement ──
  useLayoutEffect(() => {
    const overlay = cursorOverlayRef.current;
    const content = contentRef.current;
    const display = displayRef.current;
    if (!overlay || !content || !display || !kbOpen) return;

    let left, top, height;

    if (!text) {
      // Empty text — position cursor at start of content area
      const cs = getComputedStyle(display);
      left = parseFloat(cs.paddingLeft) || 0;
      top = parseFloat(cs.paddingTop) || 0;
      const lh = parseFloat(cs.lineHeight);
      height = isNaN(lh) ? parseFloat(cs.fontSize) * 1.4 : lh;
    } else {
      const pos = Math.min(cursorPos, text.length);
      const result = findTextNodeAtOffset(content, pos);
      if (!result) return;

      const range = document.createRange();
      range.setStart(result.node, result.offset);
      range.collapse(true);

      const rangeRect = range.getBoundingClientRect();
      const displayRect = display.getBoundingClientRect();

      left = rangeRect.left - displayRect.left + display.scrollLeft;
      top = rangeRect.top - displayRect.top + display.scrollTop;
      height = rangeRect.height;

      // Collapsed range might have zero height — use line height as fallback
      if (!height) {
        const cs = getComputedStyle(display);
        const lh = parseFloat(cs.lineHeight);
        height = isNaN(lh) ? parseFloat(cs.fontSize) * 1.4 : lh;
      }
    }

    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.height = `${height}px`;

    // Position handle in wrapper coordinates (outside display to avoid overflow clipping)
    const handleEl = handleRef.current;
    if (handleEl) {
      const displayRect = display.getBoundingClientRect();
      const wrapperRect = display.parentElement.getBoundingClientRect();
      const screenX = displayRect.left + left - display.scrollLeft;
      const screenBottom = displayRect.top + top - display.scrollTop + height;
      handleEl.style.left = `${screenX - wrapperRect.left}px`;
      handleEl.style.top = `${screenBottom - wrapperRect.top}px`;
    }
  }, [text, cursorPos, kbOpen, showHandle]);

  // Auto-scroll to keep cursor visible
  useEffect(() => {
    if (cursorOverlayRef.current && kbOpen) {
      cursorOverlayRef.current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [text, cursorPos, kbOpen]);

  // Programmatic mention insertion from parent (NPC bar / scene click)
  useEffect(() => {
    if (!insertNpc) return;
    const mention = `@${insertNpc.displayName} `;
    const prev = textRef.current;
    if (prev.trimEnd().endsWith(mention.trim())) {
      onInsertNpcDone?.();
      setKbOpen(true);
      return;
    }
    const base = prev.length && !prev.endsWith(' ') ? prev + ' ' : prev;
    const newText = base + mention;
    setText(newText);
    setCursorPos(newText.length);
    setKbOpen(true);
    onInsertNpcDone?.();
  }, [insertNpc, onInsertNpcDone]);

  // Build combined mention items: @Everyone + groups + individual NPCs
  const allItems = useMemo(() => {
    const items = [];
    if (npcs.length >= 2) {
      items.push({
        type: 'group',
        id: 'everyone',
        displayName: 'Everyone',
        members: npcs.map(n => n.displayName),
      });
    }
    for (const [groupId, group] of Object.entries(groups)) {
      items.push({
        type: 'group',
        id: groupId,
        displayName: group.displayName,
        members: group.members || [],
      });
    }
    for (const npc of npcs) {
      items.push({ type: 'npc', ...npc });
    }
    return items;
  }, [npcs, groups]);

  // Filtered items for the popup
  const filteredItems = useMemo(() => {
    if (mentionQuery === null) return [];
    if (mentionQuery === '') return allItems;
    const q = mentionQuery.toLowerCase();
    return allItems.filter(item => item.displayName.toLowerCase().includes(q));
  }, [mentionQuery, allItems]);

  // Detect @mention query from text before cursor
  const detectMention = useCallback((plain, pos) => {
    const beforeCursor = plain.slice(0, pos);
    const atIdx = beforeCursor.lastIndexOf('@');
    if (atIdx === -1 || (atIdx > 0 && beforeCursor[atIdx - 1] !== ' ')) {
      setMentionQuery(null);
      return;
    }
    const filter = beforeCursor.slice(atIdx + 1);
    if (filter.includes(' ')) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery(filter);
    setActiveIndex(0);
  }, []);

  // Re-detect mentions whenever text or cursor changes
  useEffect(() => {
    detectMention(text, Math.min(cursorPos, text.length));
  }, [text, cursorPos, detectMention]);

  // ── Speech-to-text ──
  const listeningRef = useRef(false);

  const stopListening = useCallback(() => {
    listeningRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const startRecognitionSession = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (e) => {
      const result = e.results[0];
      const transcript = result[0].transcript;
      const base = micBaseRef.current;
      const space = base && !base.endsWith(' ') ? ' ' : '';
      const newText = base + space + transcript;
      setText(newText);
      setCursorPos(newText.length);
    };

    recognition.onend = () => {
      micBaseRef.current = textRef.current;
      if (listeningRef.current) {
        try {
          const next = new SR();
          next.continuous = false;
          next.interimResults = true;
          next.lang = 'en-US';
          next.onresult = recognition.onresult;
          next.onend = recognition.onend;
          next.onerror = recognition.onerror;
          recognitionRef.current = next;
          next.start();
        } catch {
          listeningRef.current = false;
          setListening(false);
          recognitionRef.current = null;
        }
      } else {
        recognitionRef.current = null;
      }
    };

    recognition.onerror = (e) => {
      if (e.error === 'no-speech') return;
      listeningRef.current = false;
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, []);

  const toggleMic = useCallback(() => {
    if (listening) {
      stopListening();
      return;
    }
    listeningRef.current = true;
    micBaseRef.current = textRef.current;
    micFinalRef.current = '';
    setCursorPos(textRef.current.length);
    setListening(true);
    startRecognitionSession();
  }, [listening, stopListening, startRecognitionSession]);

  // Stop listening when keyboard closes
  useEffect(() => {
    if (!kbOpen && listening) stopListening();
  }, [kbOpen, listening, stopListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

  // Handle paste from clipboard — insert at cursor
  const handlePaste = useCallback(async () => {
    try {
      const clipText = await navigator.clipboard.readText();
      if (clipText) {
        const pos = cursorPosRef.current;
        setText(prev => prev.slice(0, pos) + clipText + prev.slice(pos));
        setCursorPos(pos + clipText.length);
      }
    } catch {}
  }, []);

  // ── Pointer events: tap to place cursor, drag to scrub, long-press paste ──
  const draggingRef = useRef(false);
  const dragStartRef = useRef(null);
  const lastTapRef = useRef(0);
  const DRAG_THRESHOLD = 5;
  const DOUBLE_TAP_MS = 350;

  const positionCursorFromPoint = useCallback((x, y) => {
    const content = contentRef.current;
    const display = displayRef.current;
    if (!content || !display) return;

    // Clamp coordinates to within the display element
    const rect = display.getBoundingClientRect();
    const cx = Math.max(rect.left + 1, Math.min(rect.right - 1, x));
    const cy = Math.max(rect.top + 1, Math.min(rect.bottom - 1, y));

    let node, offset;
    if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(cx, cy);
      if (range) { node = range.startContainer; offset = range.startOffset; }
    } else if (document.caretPositionFromPoint) {
      const cp = document.caretPositionFromPoint(cx, cy);
      if (cp) { node = cp.offsetNode; offset = cp.offset; }
    }

    if (node && content.contains(node)) {
      const preRange = document.createRange();
      preRange.selectNodeContents(content);
      preRange.setEnd(node, offset);
      const pos = preRange.toString().length;
      setCursorPos(Math.min(pos, textRef.current.length));
    }
  }, []);

  const handleWrapperPointerDown = useCallback((e) => {
    if (!kbOpenRef.current) {
      setKbOpen(true);
      return;
    }

    // Detect double-tap — let browser handle native text selection
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0;
      setShowHandle(false);
      // Don't position cursor — browser will select the word natively
      return;
    }
    lastTapRef.current = now;

    // Clear any existing browser selection on single tap
    window.getSelection()?.removeAllRanges();

    // Position cursor immediately at touch point and show grab handle
    positionCursorFromPoint(e.clientX, e.clientY);
    setShowHandle(true);
    draggingRef.current = false;
    dragStartRef.current = { x: e.clientX, y: e.clientY };

    // Start long-press timer (paste)
    longPressTimer.current = setTimeout(() => {
      if (!draggingRef.current) setShowPasteBtn(true);
    }, 500);
  }, [positionCursorFromPoint]);

  const handleWrapperPointerMove = useCallback((e) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    if (!draggingRef.current && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
      draggingRef.current = true;
      clearTimeout(longPressTimer.current);
      setShowPasteBtn(false);
    }
  }, []);

  const handleWrapperPointerUp = useCallback(() => {
    clearTimeout(longPressTimer.current);
    dragStartRef.current = null;
    draggingRef.current = false;
  }, []);

  // ── Cursor handle drag — grab the handle to scrub cursor position ──
  const handleDraggingRef = useRef(false);
  const handleOffsetRef = useRef({ dx: 0, dy: 0 });
  const charPositionsRef = useRef([]);

  const handleHandlePointerDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    handleDraggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);

    // Record offset between finger position and cursor's screen position
    const overlay = cursorOverlayRef.current;
    const display = displayRef.current;
    const content = contentRef.current;
    if (overlay && display) {
      const displayRect = display.getBoundingClientRect();
      const cursorLeft = parseFloat(overlay.style.left) || 0;
      const cursorTop = parseFloat(overlay.style.top) || 0;
      const cursorHeight = parseFloat(overlay.style.height) || 20;
      const cx = displayRect.left + cursorLeft - display.scrollLeft + 1;
      const cy = displayRect.top + cursorTop - display.scrollTop + cursorHeight / 2;
      handleOffsetRef.current = { dx: cx - e.clientX, dy: cy - e.clientY };
    } else {
      handleOffsetRef.current = { dx: 0, dy: 0 };
    }

    // Pre-compute every character boundary position for pixel-perfect dragging
    // (avoids caretRangeFromPoint which is imprecise on mobile during continuous drag)
    if (content && textRef.current) {
      const positions = [];
      const len = textRef.current.length;
      for (let i = 0; i <= len; i++) {
        const result = findTextNodeAtOffset(content, i);
        if (!result) break;
        const range = document.createRange();
        range.setStart(result.node, result.offset);
        range.collapse(true);
        const rect = range.getBoundingClientRect();
        positions.push({ i, x: rect.left, y: rect.top + rect.height / 2 });
      }
      charPositionsRef.current = positions;
    } else {
      charPositionsRef.current = [];
    }

    setLoupeInfo({ x: e.clientX, y: e.clientY });
  }, []);

  const handleHandlePointerMove = useCallback((e) => {
    if (!handleDraggingRef.current) return;
    e.preventDefault();

    const x = e.clientX + handleOffsetRef.current.dx;
    const y = e.clientY + handleOffsetRef.current.dy;
    const positions = charPositionsRef.current;

    if (positions.length > 0) {
      // Find the nearest character boundary to the adjusted finger position
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < positions.length; i++) {
        const p = positions[i];
        const dx = Math.abs(x - p.x);
        const dy = Math.abs(y - p.y);
        // For multi-line: heavily weight Y so we stay on the right line
        const dist = dy > 12 ? dy * 100 + dx : dx;
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      setCursorPos(positions[bestIdx].i);
    }

    setLoupeInfo({ x: e.clientX, y: e.clientY });
  }, []);

  const handleHandlePointerUp = useCallback(() => {
    handleDraggingRef.current = false;
    setLoupeInfo(null);
  }, []);

  const confirmPaste = useCallback(async () => {
    setShowPasteBtn(false);
    try {
      const clipText = await navigator.clipboard.readText();
      if (clipText) {
        const pos = cursorPosRef.current;
        setText(prev => prev.slice(0, pos) + clipText + prev.slice(pos));
        setCursorPos(pos + clipText.length);
      }
    } catch {}
  }, []);

  // Track native browser text selection inside display
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const onSelectionChange = () => {
      const sel = window.getSelection();
      const selected = sel && !sel.isCollapsed && content.contains(sel.anchorNode);
      setHasSelection(!!selected);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  // Listen for paste events (Ctrl+V / system paste) when keyboard is open
  useEffect(() => {
    if (!kbOpen) return;
    const onPaste = (e) => {
      const clipText = e.clipboardData?.getData('text/plain');
      if (clipText) {
        e.preventDefault();
        const pos = cursorPosRef.current;
        setText(prev => prev.slice(0, pos) + clipText + prev.slice(pos));
        setCursorPos(pos + clipText.length);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [kbOpen]);

  // Dismiss paste popup on any key press or outside tap
  useEffect(() => {
    if (!showPasteBtn) return;
    const dismiss = () => setShowPasteBtn(false);
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [showPasteBtn]);

  // Key handler — insert character at cursor position
  const handleKey = useCallback((char) => {
    setShowPasteBtn(false);
    setShowHandle(false);
    const pos = cursorPosRef.current;
    setText(prev => prev.slice(0, pos) + char + prev.slice(pos));
    setCursorPos(pos + char.length);
  }, []);

  // Backspace — delete character (or whole @mention) before cursor
  const handleBackspace = useCallback(() => {
    setShowHandle(false);
    const pos = cursorPosRef.current;
    if (pos === 0) return;

    const currentText = textRef.current;
    const beforeCursor = currentText.slice(0, pos);

    // If text is selected within the display, delete the selection
    const sel = window.getSelection();
    const content = contentRef.current;
    if (sel && !sel.isCollapsed && content && content.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      const preRange = document.createRange();
      preRange.selectNodeContents(content);
      preRange.setEnd(range.startContainer, range.startOffset);
      const startIdx = preRange.toString().length;
      const selLength = range.toString().length;
      sel.removeAllRanges();
      setText(prev => prev.slice(0, startIdx) + prev.slice(startIdx + selLength));
      setCursorPos(startIdx);
      return;
    }

    // If text before cursor ends with a complete @mention, delete the whole mention at once
    for (const npc of npcsRef.current) {
      const mention = `@${npc.displayName}`;
      if (beforeCursor.endsWith(mention)) {
        setText(prev => prev.slice(0, pos - mention.length) + prev.slice(pos));
        setCursorPos(pos - mention.length);
        return;
      }
    }

    const glen = prevGraphemeLength(currentText, pos);
    setText(prev => prev.slice(0, pos - glen) + prev.slice(pos));
    setCursorPos(pos - glen);
  }, []);

  // Arrow key handlers — grapheme-aware so emoji are skipped as whole characters
  const handleLeft = useCallback(() => {
    setCursorPos(prev => {
      const glen = prevGraphemeLength(textRef.current, prev);
      return Math.max(0, prev - glen);
    });
  }, []);

  const handleRight = useCallback(() => {
    setCursorPos(prev => {
      const glen = nextGraphemeLength(textRef.current, prev);
      return Math.min(textRef.current.length, prev + glen);
    });
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = textRef.current.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    setCursorPos(0);
    setMentionQuery(null);
    setKbOpen(false);
    setKbMode('keys');
  }, [disabled, onSend]);

  const handleClose = useCallback(() => {
    setKbOpen(false);
    setKbMode('keys');
    setMentionQuery(null);
  }, []);

  // Insert a mention from the popup (at cursor position)
  const selectMention = useCallback((item) => {
    const prev = textRef.current;
    const pos = cursorPosRef.current;
    const beforeCursor = prev.slice(0, pos);
    const afterCursor = prev.slice(pos);
    const atIdx = beforeCursor.lastIndexOf('@');
    const before = beforeCursor.slice(0, atIdx);
    let insertText;
    if (item.type === 'group') {
      insertText = item.members.map(name => `@${name}`).join(' ') + ' ';
    } else {
      insertText = `@${item.displayName} `;
    }
    setText(before + insertText + afterCursor);
    setCursorPos(before.length + insertText.length);
    setMentionQuery(null);
  }, []);

  // ── Display HTML — full text with formatting, NO cursor (cursor is an overlay) ──
  const displayHtml = useMemo(() => {
    if (!text) return '';

    let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // @mention highlighting
    if (npcs.length) {
      const names = npcs.map(n => n.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      html = html.replace(
        new RegExp(`(@(?:${names.join('|')}))`, 'g'),
        '<span class="mention-highlight-inline">$1</span>'
      );
    }

    // *italic*
    html = html.replace(
      /\*([^*]+)\*/g,
      '<span class="italic-marker">*</span><em>$1</em><span class="italic-marker">*</span>'
    );

    return html;
  }, [text, npcs]);

  const showPopup = mentionQuery !== null && filteredItems.length > 0;

  // Loupe text excerpt (shown during drag)
  const loupeExcerpt = useMemo(() => {
    if (!loupeInfo || !text) return null;
    const pos = Math.min(cursorPos, text.length);
    return {
      before: text.slice(Math.max(0, pos - 12), pos),
      after: text.slice(pos, Math.min(text.length, pos + 12)),
    };
  }, [loupeInfo, text, cursorPos]);

  return (
    <>
      {/* Magnifier loupe during drag */}
      {loupeInfo && loupeExcerpt && (
        <div
          className="cki-loupe"
          style={{
            left: `${loupeInfo.x}px`,
            top: `${Math.max(8, loupeInfo.y - 56)}px`,
          }}
        >
          <span>{loupeExcerpt.before}</span>
          <span className="cki-loupe-caret" />
          <span>{loupeExcerpt.after}</span>
        </div>
      )}

      {/* Input display bar */}
      <div className="cki-form">
        <div className="cki-row">
          <button
            type="button"
            className={`chat-mic-btn ${listening ? 'chat-mic-active' : ''}`}
            onPointerDown={(e) => { e.preventDefault(); toggleMic(); }}
            aria-label={listening ? 'Stop listening' : 'Voice input'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
          <div
            className="cki-wrapper"
            onPointerDown={handleWrapperPointerDown}
            onPointerMove={handleWrapperPointerMove}
            onPointerUp={handleWrapperPointerUp}
            onPointerCancel={handleWrapperPointerUp}
          >
            {!text && (
              <div className="chat-input-placeholder">Say something... (@ to mention)</div>
            )}
            {showPasteBtn && (
              <button
                type="button"
                className="cki-paste-popup"
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); confirmPaste(); }}
              >
                Paste
              </button>
            )}
            <div ref={displayRef} className="cki-display">
              <span ref={contentRef} dangerouslySetInnerHTML={{ __html: displayHtml }} />
              {kbOpen && !hasSelection && (
                <div ref={cursorOverlayRef} className={`cki-cursor-overlay${loupeInfo ? ' cki-cursor-dragging' : ''}`}>
                  <div className="cki-cursor-line" />
                </div>
              )}
            </div>
            {kbOpen && showHandle && !hasSelection && (
              <div
                ref={handleRef}
                className="cki-cursor-handle"
                onPointerDown={handleHandlePointerDown}
                onPointerMove={handleHandlePointerMove}
                onPointerUp={handleHandlePointerUp}
                onPointerCancel={handleHandlePointerUp}
              />
            )}
            {showPopup && (
              <MentionPopup
                items={filteredItems}
                activeIndex={activeIndex}
                onSelect={selectMention}
              />
            )}
          </div>
          <button
            type="button"
            className={`chat-emoji-btn${kbMode === 'emoji' ? ' chat-emoji-btn-active' : ''}`}
            aria-label={kbMode === 'emoji' ? 'Switch to keyboard' : 'Open emoji picker'}
            onPointerDown={(e) => {
              e.preventDefault();
              if (!kbOpen) {
                setKbOpen(true);
                setKbMode('emoji');
              } else {
                setKbMode(kbMode === 'emoji' ? 'keys' : 'emoji');
              }
            }}
          >
            {kbMode === 'emoji' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <line x1="6" y1="8" x2="6" y2="8" />
                <line x1="10" y1="8" x2="10" y2="8" />
                <line x1="14" y1="8" x2="14" y2="8" />
                <line x1="18" y1="8" x2="18" y2="8" />
                <line x1="6" y1="12" x2="6" y2="12" />
                <line x1="18" y1="12" x2="18" y2="12" />
                <line x1="8" y1="16" x2="16" y2="16" />
              </svg>
            ) : '😊'}
          </button>
          <button
            type="button"
            className="chat-send-btn"
            disabled={!text.trim() || disabled}
            aria-label="Send message"
            onPointerDown={(e) => { e.preventDefault(); handleSubmit(); }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Custom keyboard */}
      <CustomKeyboard
        open={kbOpen}
        onKey={handleKey}
        onBackspace={handleBackspace}
        onSubmit={handleSubmit}
        onClose={handleClose}
        onPaste={handlePaste}
        onLeft={handleLeft}
        onRight={handleRight}
        disabled={disabled}
        playSound={playSound}
        mode={kbMode}
        onModeChange={setKbMode}
      />
    </>
  );
}

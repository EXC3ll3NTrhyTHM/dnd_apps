import { useState, useRef, useMemo, useCallback, useEffect, useLayoutEffect } from 'react';
import CustomKeyboard from './CustomKeyboard';
import MentionPopup from './MentionPopup';
import { prevGraphemeLength, nextGraphemeLength } from '../utils/grapheme';
import { correctWord } from '../utils/spellcheck';
import { bumpNpcFreq } from '../lib/npcFreq';

/**
 * Apply autocorrect to the word before the cursor, preserving the original
 * casing pattern (lowercase, Capitalized, or ALL CAPS).
 */
function autocorrectAtCursor(text, pos, lastCorrection) {
  const before = text.slice(0, pos);
  const m = before.match(/(\S+)$/);
  if (!m) return null;
  const token = m[1];
  // Skip @mentions
  if (token.startsWith('@')) return null;
  // Separate leading/trailing punctuation from the alphabetic core
  const parts = token.match(/^([^a-zA-Z']*?)([a-zA-Z']+)([^a-zA-Z']*)$/);
  if (!parts) return null;
  const [, prefix, word, suffix] = parts;
  if (!word) return null;
  const tokenStart = pos - token.length;
  // Skip if the user reverted a correction at this exact position
  if (lastCorrection && lastCorrection.reverted && tokenStart === lastCorrection.start) return null;
  const corrected = correctWord(word);
  if (!corrected) return null;
  // Preserve case
  let fixed;
  if (word === word.toUpperCase() && word.length > 1) {
    fixed = corrected.toUpperCase();
  } else if (word[0] === word[0].toUpperCase() && word.length > 1) {
    fixed = corrected[0].toUpperCase() + corrected.slice(1);
  } else {
    fixed = corrected;
  }
  if (fixed === word) return null;
  return { wordStart: tokenStart, wordEnd: pos, fixed: prefix + fixed + suffix };
}

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
  onSendGif,
  onSendImage,
  disabled,
  npcs = [],
  npcEmotions = {},
  groups = {},
  players = [],
  insertNpc,
  onInsertNpcDone,
  playSound,
  scrollContainerRef,
  onDiceRoll,
  onUseItem,
  onOpenEmotes,
  locationId,
  isDM,
}) {
  const [text, setText] = useState(() => {
    if (!locationId) return '';
    return localStorage.getItem(`dh_draft_${locationId}`) || '';
  });
  const [cursorPos, setCursorPos] = useState(() => text.length);
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
  const bottomBarRef = useRef(null);
  const cursorOverlayRef = useRef(null);
  const handleRef = useRef(null);
  const longPressTimer = useRef(null);
  const recognitionRef = useRef(null);
  const micBaseRef = useRef('');
  const micFinalRef = useRef('');
  const [flashRange, setFlashRange] = useState(null);
  const flashTimer = useRef(null);
  const lastCorrectionRef = useRef(null);   // { start, end, reverted }

  const fileInputRef = useRef(null);
  const lastSwipeRef = useRef(null); // { pos, length } of last swipe-inserted word

  const textRef = useRef(text);
  textRef.current = text;
  const cursorPosRef = useRef(cursorPos);
  cursorPosRef.current = cursorPos;
  const npcsRef = useRef(npcs);
  npcsRef.current = npcs;
  const playersRef = useRef(players);
  playersRef.current = players;
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  // Persist draft to localStorage (debounced to avoid blocking on every keystroke)
  const draftTimerRef = useRef(null);
  useEffect(() => {
    if (!locationId) return;
    clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      if (text) {
        localStorage.setItem(`dh_draft_${locationId}`, text);
      } else {
        localStorage.removeItem(`dh_draft_${locationId}`);
      }
    }, 500);
    return () => clearTimeout(draftTimerRef.current);
  }, [text, locationId]);

  // Back button: close keyboard instead of navigating away
  const kbOpenRef = useRef(false);
  const kbModeRef = useRef('keys');
  kbModeRef.current = kbMode;

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

  // Drag-to-close keyboard: swipe down on chat messages when at bottom.
  // Uses TWO GPU-composited transforms for zero-layout-cost per frame:
  //  1. Bar: position:fixed + translateY (slides keyboard down)
  //  2. Chat: translateY (slides chat down in sync, revealing older messages)
  // When bar goes fixed, chat instantly fills the freed space (one reflow).
  // A counter-transform on the chat keeps content at the same screen position.
  // During drag, both transforms update together — pure GPU, no layout per frame.
  useEffect(() => {
    const el = scrollContainerRef?.current;
    const bar = bottomBarRef.current;
    if (!el || !bar || !kbOpen) return;
    let armed = false;
    const timer = setTimeout(() => { armed = true; }, 300);

    const state = { active: false, startY: 0, startH: 0, inputH: 0, activateY: 0, atBottom: false };

    const clearBarStyles = () => {
      bar.style.position = '';
      bar.style.top = '';
      bar.style.left = '';
      bar.style.width = '';
      bar.style.height = '';
      bar.style.zIndex = '';
      bar.style.willChange = '';
      bar.style.transform = '';
      bar.style.transition = '';
    };

    const clearElStyles = () => {
      el.style.willChange = '';
      el.style.transform = '';
      el.style.transition = '';
      el.style.overflow = '';
    };

    const onTouchStart = (e) => {
      state.atBottom = el.scrollTop <= 1;
      state.startY = e.touches[0].clientY;
      state.active = false;
    };

    const onTouchMove = (e) => {
      if (!armed || !state.atBottom) return;
      const dy = e.touches[0].clientY - state.startY;

      if (!state.active && dy > 4) {
        const rect = bar.getBoundingClientRect();
        state.startH = rect.height;
        // Measure input bar so we know where to stop the slide
        const formEl = bar.querySelector('.cki-form');
        state.inputH = formEl ? formEl.offsetHeight : 0;
        state.active = true;
        state.activateY = e.touches[0].clientY;

        // Lock scroll during drag — prevents internal scrollTop shifts that cause jitter
        el.style.overflow = 'hidden';

        // Pull bar out of flow — chat fills freed space (one reflow).
        bar.style.position = 'fixed';
        bar.style.top = `${rect.top}px`;
        bar.style.left = `${rect.left}px`;
        bar.style.width = `${rect.width}px`;
        bar.style.height = `${rect.height}px`;
        bar.style.zIndex = '100';
        bar.style.willChange = 'transform';

        // Counter-translate chat so content stays at same screen position.
        // Chat grew by ~startH, so shift it up by that amount.
        el.style.willChange = 'transform';
        el.style.transform = `translateY(${-state.startH}px)`;
      }

      if (state.active) {
        e.preventDefault();
        const offset = Math.max(0, e.touches[0].clientY - state.activateY);
        // Both GPU-composited: bar slides down, chat slides down in sync
        bar.style.transform = `translateY(${offset}px)`;
        el.style.transform = `translateY(${-state.startH + offset}px)`;
      }
    };

    const onTouchEnd = () => {
      if (!state.active) return;
      state.active = false;
      const match = bar.style.transform.match(/translateY\(([0-9.]+)px\)/);
      const currentY = match ? parseFloat(match[1]) : 0;
      const threshold = state.startH * 0.3;
      let cleaned = false;

      if (currentY >= threshold) {
        // Snap closed — slide keyboard off-screen but keep input bar visible.
        // Animate bar to translateY(startH - inputH): keyboard goes below
        // viewport, input bar stays at its final resting position.
        // When useEffect cleanup clears both bar + chat styles in the same
        // frame, the offsets cancel perfectly — zero visual jump.
        const slideTarget = state.startH - state.inputH;
        const remaining = Math.abs(slideTarget - currentY);
        const duration = Math.max(80, Math.min(300, remaining * 0.8));
        bar.style.transition = `transform ${duration}ms ease-out`;
        bar.style.transform = `translateY(${slideTarget}px)`;
        el.style.transition = `transform ${duration}ms ease-out`;
        el.style.transform = `translateY(${-state.inputH}px)`;

        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          // Don't clear bar or el styles — useEffect cleanup (triggered by
          // kbOpen change) clears both in the same frame so positions cancel.
          setKbOpen(false);
          setKbMode('keys');
          setMentionQuery(null);
          setShowHandle(false);
          requestAnimationFrame(() => { el.scrollTop = 0; });
          bar.removeEventListener('transitionend', cleanup);
        };
        bar.addEventListener('transitionend', cleanup, { once: true });
        setTimeout(cleanup, duration + 50);
      } else {
        // Snap back — animate both transforms
        const duration = Math.max(80, Math.min(200, currentY * 0.8));
        bar.style.transition = `transform ${duration}ms ease-out`;
        bar.style.transform = 'translateY(0)';
        el.style.transition = `transform ${duration}ms ease-out`;
        el.style.transform = `translateY(${-state.startH}px)`;

        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          // Clear both in same frame — offsets cancel, no visual jump
          clearBarStyles();
          clearElStyles();
          bar.removeEventListener('transitionend', cleanup);
        };
        bar.addEventListener('transitionend', cleanup, { once: true });
        setTimeout(cleanup, duration + 50);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      clearTimeout(timer);
      clearBarStyles();
      clearElStyles();
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
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

      // Collapsed range might have zero height (e.g. inside font-size:0 italic
      // markers) — probe nearby characters for a valid rect, then fall back to
      // the display's line-height.
      if (!height) {
        for (let d = 1; d <= 2; d++) {
          for (const probe of [pos - d, pos + d]) {
            if (probe < 0 || probe > text.length) continue;
            const r2 = findTextNodeAtOffset(content, probe);
            if (!r2) continue;
            const rng2 = document.createRange();
            rng2.setStart(r2.node, r2.offset);
            rng2.collapse(true);
            const rect2 = rng2.getBoundingClientRect();
            if (rect2.height > 0) {
              top = rect2.top - displayRect.top + display.scrollTop;
              height = rect2.height;
              break;
            }
          }
          if (height) break;
        }
        if (!height) {
          const cs = getComputedStyle(display);
          const lh = parseFloat(cs.lineHeight);
          height = isNaN(lh) ? parseFloat(cs.fontSize) * 1.4 : lh;
        }
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

  // Build combined mention items: @Everyone + groups + individual NPCs + players
  const allItems = useMemo(() => {
    const items = [];
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
    for (const player of players) {
      items.push({
        type: 'player',
        id: player.id,
        displayName: player.characterName,
        avatar: player.avatar,
      });
    }
    return items;
  }, [npcs, groups, players]);

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
    window.dispatchEvent(new CustomEvent('speech-recognition-change', { detail: false }));
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
      window.dispatchEvent(new CustomEvent('speech-recognition-change', { detail: false }));
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
    window.dispatchEvent(new CustomEvent('speech-recognition-change', { detail: true }));
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

    // If in extras, npcs, gifs, dice, or items mode, tapping input switches back to keys
    if (['extras', 'npcs', 'gifs', 'dice', 'items', 'monsters'].includes(kbModeRef.current)) {
      setKbMode('keys');
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

  // Key handler — insert character at cursor position (with autocorrect on space)
  const handleKey = useCallback((char) => {
    setShowPasteBtn(false);
    setShowHandle(false);
    lastSwipeRef.current = null; // clear swipe replace on manual edit
    const pos = cursorPosRef.current;

    // If user is editing inside a recently-corrected word, mark it as reverted
    const lc = lastCorrectionRef.current;
    if (lc && !lc.reverted && char !== ' ' && pos >= lc.start && pos <= lc.end) {
      lc.reverted = true;
    }

    // Autocorrect: when space is typed, check the word before the cursor
    if (char === ' ') {
      const ac = autocorrectAtCursor(textRef.current, pos, lastCorrectionRef.current);
      if (ac) {
        const { wordStart, wordEnd, fixed } = ac;
        setText(prev => prev.slice(0, wordStart) + fixed + ' ' + prev.slice(wordEnd));
        setCursorPos(wordStart + fixed.length + 1);
        lastCorrectionRef.current = { start: wordStart, end: wordStart + fixed.length, reverted: false };
        // Flash the corrected word
        clearTimeout(flashTimer.current);
        setFlashRange({ start: wordStart, end: wordStart + fixed.length });
        flashTimer.current = setTimeout(() => setFlashRange(null), 600);
        return;
      }
    }

    setText(prev => prev.slice(0, pos) + char + prev.slice(pos));
    setCursorPos(pos + char.length);
  }, []);

  // Backspace — delete character (or whole @mention) before cursor
  const handleBackspace = useCallback(() => {
    setShowHandle(false);
    const pos = cursorPosRef.current;
    if (pos === 0) return;

    // If user is backspacing inside a recently-corrected word, mark it as reverted
    const lc = lastCorrectionRef.current;
    if (lc && !lc.reverted && pos > lc.start && pos <= lc.end) {
      lc.reverted = true;
    }

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
    for (const player of playersRef.current) {
      const mention = `@${player.characterName}`;
      if (beforeCursor.endsWith(mention)) {
        setText(prev => prev.slice(0, pos - mention.length) + prev.slice(pos));
        setCursorPos(pos - mention.length);
        return;
      }
    }
    for (const group of Object.values(groupsRef.current)) {
      const mention = `@${group.displayName}`;
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

  // ── Swipe-to-type handlers ──
  const handleSwipeWord = useCallback((word) => {
    setShowPasteBtn(false);
    setShowHandle(false);
    const pos = cursorPosRef.current;
    const insert = word + ' ';
    setText(prev => prev.slice(0, pos) + insert + prev.slice(pos));
    const newPos = pos + insert.length;
    setCursorPos(newPos);
    lastSwipeRef.current = { pos, length: insert.length };
  }, []);

  const handleSwipeReplace = useCallback((newWord) => {
    const last = lastSwipeRef.current;
    if (!last) return;
    const replace = newWord + ' ';
    setText(prev => prev.slice(0, last.pos) + replace + prev.slice(last.pos + last.length));
    const newPos = last.pos + replace.length;
    setCursorPos(newPos);
    lastSwipeRef.current = { pos: last.pos, length: replace.length };
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
    lastCorrectionRef.current = null;
    lastSwipeRef.current = null;
    if (locationId) localStorage.removeItem(`dh_draft_${locationId}`);
  }, [disabled, onSend, locationId]);

  const handleGifSelect = useCallback((gif) => {
    setKbOpen(false);
    setKbMode('keys');
    onSendGif?.(gif);
  }, [onSendGif]);

  const handleDiceRoll = useCallback((notation) => {
    setKbOpen(false);
    setKbMode('keys');
    onDiceRoll?.(notation);
  }, [onDiceRoll]);

  const handleUseItem = useCallback(async (itemId) => {
    const result = await onUseItem?.(itemId);
    setKbOpen(false);
    setKbMode('keys');
    return result;
  }, [onUseItem]);

  const handleImagePick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) {
      setKbOpen(false);
      setKbMode('keys');
      onSendImage?.(file);
    }
    // Reset so the same file can be re-selected
    e.target.value = '';
  }, [onSendImage]);

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
      insertText = `@${item.displayName} `;
    } else {
      insertText = `@${item.displayName} `;
    }
    if (item.type === 'npc' || item.type === 'player') bumpNpcFreq(item.id, locationId);
    setText(before + insertText + afterCursor);
    setCursorPos(before.length + insertText.length);
    setMentionQuery(null);
  }, []);

  // Insert NPC @mention from the npcs panel (stays in npcs mode for multi-tagging)
  const handleNpcMention = useCallback((npc) => {
    bumpNpcFreq(npc.id, locationId);
    const mention = `@${npc.displayName} `;
    const prev = textRef.current;
    const pos = cursorPosRef.current;
    const base = pos === prev.length && prev.length && !prev.endsWith(' ')
      ? prev + ' '
      : prev;
    const newPos = pos === prev.length ? base.length + mention.length : pos + mention.length;
    if (pos === prev.length) {
      setText(base + mention);
    } else {
      setText(prev.slice(0, pos) + mention + prev.slice(pos));
    }
    setCursorPos(newPos);
  }, []);

  // Insert player @mention from the mention panel
  const handlePlayerMention = useCallback((player) => {
    bumpNpcFreq(player.id, locationId);
    const mention = `@${player.characterName} `;
    const prev = textRef.current;
    const pos = cursorPosRef.current;
    const base = pos === prev.length && prev.length && !prev.endsWith(' ')
      ? prev + ' '
      : prev;
    const newPos = pos === prev.length ? base.length + mention.length : pos + mention.length;
    if (pos === prev.length) {
      setText(base + mention);
    } else {
      setText(prev.slice(0, pos) + mention + prev.slice(pos));
    }
    setCursorPos(newPos);
  }, []);

  // Insert group @mention as a single tag from the npcs panel
  const handleGroupMention = useCallback((group) => {
    const mention = `@${group.displayName} `;
    const prev = textRef.current;
    const pos = cursorPosRef.current;
    const base = pos === prev.length && prev.length && !prev.endsWith(' ')
      ? prev + ' '
      : prev;
    const newPos = pos === prev.length ? base.length + mention.length : pos + mention.length;
    if (pos === prev.length) {
      setText(base + mention);
    } else {
      setText(prev.slice(0, pos) + mention + prev.slice(pos));
    }
    setCursorPos(newPos);
  }, []);

  // Build mention groups for the npcs panel (@Everyone + custom groups)
  const mentionGroups = useMemo(() => {
    const items = [];
    for (const [groupId, group] of Object.entries(groups)) {
      items.push({
        id: groupId,
        displayName: group.displayName,
        members: group.members || [],
      });
    }
    return items;
  }, [npcs, groups]);

  // Pre-build @mention regex (only changes when NPC/player/group lists change)
  const mentionRegex = useMemo(() => {
    const allNames = [
      ...npcs.map(n => n.displayName),
      ...players.map(p => p.characterName),
      ...Object.values(groups).map(g => g.displayName),
    ].filter(Boolean).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!allNames.length) return null;
    return new RegExp(`(@(?:${allNames.join('|')}))`, 'g');
  }, [npcs, players, groups]);

  // ── Display HTML — full text with formatting, NO cursor (cursor is an overlay) ──
  const displayHtml = useMemo(() => {
    if (!text) return '';

    // Autocorrect flash: wrap the corrected word before HTML-escaping
    let plain = text;
    let flashStart = -1, flashEnd = -1;
    if (flashRange && flashRange.start < text.length) {
      flashStart = flashRange.start;
      flashEnd = Math.min(flashRange.end, text.length);
    }

    let html;
    if (flashStart >= 0) {
      const before = plain.slice(0, flashStart);
      const word = plain.slice(flashStart, flashEnd);
      const after = plain.slice(flashEnd);
      const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      html = esc(before) + '<span class="cki-flash">' + esc(word) + '</span>' + esc(after);
    } else {
      html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // @mention highlighting
    if (mentionRegex) {
      mentionRegex.lastIndex = 0;
      html = html.replace(mentionRegex, '<span class="mention-highlight-inline">$1</span>');
    }

    // *italic*
    html = html.replace(
      /\*([^*]+)\*/g,
      '<span class="italic-marker">*</span><em>$1</em><span class="italic-marker">*</span>'
    );

    return html;
  }, [text, mentionRegex, flashRange]);

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
      {/* Hidden file input for image uploads — uses id so a <label> can trigger it natively on iOS */}
      <input
        id="chat-image-input"
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

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

      {/* Input bar + keyboard wrapper (for drag-to-close transform) */}
      <div ref={bottomBarRef} className="ck-bottom-bar">
      {/* Input display bar */}
      <div className="cki-form">
        <div className="cki-row">
          <button
            type="button"
            className={`chat-plus-btn${['extras', 'npcs', 'gifs', 'dice', 'items', 'monsters'].includes(kbMode) ? ' chat-plus-btn-active' : ''}`}
            onPointerDown={(e) => {
              e.preventDefault();
              if (!kbOpen) {
                setKbOpen(true);
                setKbMode('extras');
              } else {
                setKbMode(['extras', 'npcs', 'gifs', 'dice', 'items', 'monsters'].includes(kbMode) ? 'keys' : 'extras');
              }
            }}
            aria-label="Extras menu"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4H6z" />
              <path d="M3 6h18" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
          </button>
          <div
            data-testid="chat-input"
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
              {kbOpen && !hasSelection && kbMode !== 'gifs' && (
                <div ref={cursorOverlayRef} className={`cki-cursor-overlay${loupeInfo ? ' cki-cursor-dragging' : ''}`}>
                  <div className="cki-cursor-line" />
                </div>
              )}
            </div>
            {kbOpen && showHandle && !hasSelection && kbMode !== 'gifs' && (
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
            className="chat-emote-btn"
            aria-label="Open emotes"
            onPointerDown={(e) => {
              e.preventDefault();
              onOpenEmotes?.();
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <line x1="9" y1="9" x2="9.01" y2="9" />
              <line x1="15" y1="9" x2="15.01" y2="9" />
            </svg>
          </button>
          {text.trim() && (
            <button
              type="button"
              data-testid="chat-send-btn"
              className="chat-send-btn"
              disabled={disabled}
              aria-label="Send message"
              onPointerDown={(e) => { e.preventDefault(); handleSubmit(); }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          )}
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
        npcs={npcs}
        npcEmotions={npcEmotions}
        mentionGroups={mentionGroups}
        onNpcMention={handleNpcMention}
        onGroupMention={handleGroupMention}
        listening={listening}
        onToggleMic={toggleMic}
        onGifSelect={handleGifSelect}
        onImagePick={handleImagePick}
        inputText={text}
        players={players}
        onPlayerMention={handlePlayerMention}
        onSwipeWord={handleSwipeWord}
        onSwipeReplace={handleSwipeReplace}
        onDiceRoll={handleDiceRoll}
        onUseItem={handleUseItem}
        onOpenEmotes={onOpenEmotes}
        locationId={locationId}
        isDM={isDM}
      />
      </div>
    </>
  );
}

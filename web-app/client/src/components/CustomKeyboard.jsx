import { useState, useRef, useEffect, useMemo, memo } from 'react';
import { getAudioMuted } from '../hooks/useAudioSettings';
import { ensureContext } from '../hooks/useUiSounds';
import { EMOJI_CATEGORIES } from '../data/emojiData';
import { api } from '../hooks/useApi';
import NpcPortrait from './NpcPortrait';
import { matchSwipePath } from '../utils/swipeMatch';
import { getNpcFreqs, bumpNpcFreq } from '../lib/npcFreq';
import DicePanel from './DicePanel';

const NUMBERS_ROW = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

const ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

const SYMBOLS_ROWS = [
  ['@', '#', '$', '&', '*', '-', '+', '(', ')', '/'],
  ['\\', '|', '~', '`', '=', '{', '}', '[', ']'],
  ['!', '"', "'", ':', ';', ',', '?'],
];

const COMPACT_H = 254;

// Low-latency key tap sound using shared Web Audio context (pre-decoded buffer)
let _tapBuffer = null;
let _tapBufferLoading = false;

function loadKeyTapBuffer() {
  if (_tapBuffer || _tapBufferLoading) return;
  _tapBufferLoading = true;
  const ctx = ensureContext();
  if (!ctx) return;
  fetch('/sounds/ui/button-tap.wav')
    .then(r => r.arrayBuffer())
    .then(buf => ctx.decodeAudioData(buf))
    .then(decoded => { _tapBuffer = decoded; })
    .catch(() => {});
}

function playKeyTap() {
  if (getAudioMuted()) return;
  const ctx = ensureContext();
  if (!ctx || !_tapBuffer) return;
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  gain.gain.value = 0.3;
  src.buffer = _tapBuffer;
  src.connect(gain).connect(ctx.destination);
  src.start(0);
}

/**
 * Custom on-screen QWERTY keyboard with emoji picker.
 * Uses event delegation (single handler) for fast response on rapid typing.
 */
const LETTER_KEYS = new Set('abcdefghijklmnopqrstuvwxyz'.split(''));

// Find which precomputed key rect contains the given screen coordinates
function findKeyAtCoord(x, y, keyRects) {
  for (const k of keyRects) {
    if (x >= k.rect.left && x <= k.rect.right && y >= k.rect.top && y <= k.rect.bottom) return k;
  }
  return null;
}

const CustomKeyboard = memo(function CustomKeyboard({
  open, onKey, onBackspace, onSubmit, onClose, onPaste, onLeft, onRight, disabled, playSound,
  mode, onModeChange,
  npcs, npcEmotions, mentionGroups, onNpcMention, onGroupMention, listening, onToggleMic,
  onGifSelect,
  onImagePick,
  inputText,
  players, onPlayerMention,
  onSwipeWord, onSwipeReplace,
  onDiceRoll,
  onUseItem,
  onOpenEmotes,
  onNpcSpeak,
  locationId,
}) {
  const [shifted, setShifted] = useState(false);
  const [symbols, setSymbols] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [contactTab, setContactTab] = useState(null); // null | 'groups' | 'npcs' | 'players'
  const [activeCategory, setActiveCategory] = useState(EMOJI_CATEGORIES[0].id);
  const [gifQuery, setGifQuery] = useState('');
  const [gifResults, setGifResults] = useState([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [gifSearchActive, setGifSearchActive] = useState(false);
  const backspaceTimer = useRef(null);
  const backspaceInterval = useRef(null);
  const repeatTimer = useRef(null);
  const repeatInterval = useRef(null);
  const emojiTap = useRef(null);
  const emojiScrollRef = useRef(null);
  const activeCategoryRef = useRef(EMOJI_CATEGORIES[0].id);
  const gifsGridRef = useRef(null);
  const gifDebounceRef = useRef(null);
  const previewRef = useRef(null);
  const previewTimerRef = useRef(null);

  // Swipe-to-type state
  const [swipeSuggestion, setSwipeSuggestion] = useState(null); // { words: string[], selected: number } | null
  const [npcFreqBump, setNpcFreqBump] = useState(0);

  // Items inventory state
  const [itemsList, setItemsList] = useState(null); // null = not loaded
  const [usingItem, setUsingItem] = useState(false);

  const swipeState = useRef({ active: false, startX: 0, startY: 0, startBtn: null, keys: [], lastKey: '', points: [], pointerId: null, isTouch: false, keyRects: [] });
  const canvasRef = useRef(null);
  const boardRef = useRef(null);
  const cachedKeyRectsRef = useRef(null);

  // Drag-to-expand state
  const dragState = useRef({ active: false, startY: 0, currentH: COMPACT_H, maxH: 500 });

  // NPCs + players sorted by mention frequency (for suggestion bar quick-mention, top 4)
  const sortedContacts = useMemo(() => {
    const items = [];
    for (const npc of (npcs || [])) items.push({ type: 'npc', id: npc.id, data: npc });
    for (const p of (players || [])) items.push({ type: 'player', id: p.id, data: p });
    if (items.length === 0) return [];
    const freqs = getNpcFreqs(locationId);
    return items.sort((a, b) => (freqs[b.id] || 0) - (freqs[a.id] || 0)).slice(0, 4);
  }, [npcs, players, locationId, npcFreqBump]);

  // Keep callback refs current so the delegation handler stays stable
  const refs = useRef({});
  refs.current = { onKey, onBackspace, onSubmit, onClose, onPaste, onLeft, onRight, playSound, disabled, onModeChange, onNpcMention, onGroupMention, onPlayerMention, onToggleMic, onGifSelect, onImagePick, onSwipeWord, onSwipeReplace, onUseItem, onOpenEmotes, onNpcSpeak };

  const shiftedRef = useRef(false);
  const symbolsRef = useRef(false);
  shiftedRef.current = shifted;
  symbolsRef.current = symbols;

  // Init low-latency audio on first open
  useEffect(() => {
    if (open) loadKeyTapBuffer();
  }, [open]);

  // Cache letter key bounding rects so we don't force layout reflow on every tap.
  // Recompute when layout changes (open, symbols toggle, mode).
  useEffect(() => {
    cachedKeyRectsRef.current = null; // invalidate
    if (!open || mode !== 'keys' || symbols) return;
    // Defer to next frame so the DOM has settled
    const raf = requestAnimationFrame(() => {
      const board = boardRef.current;
      if (!board) return;
      const rects = [];
      const allKeys = board.querySelectorAll('[data-action="key"]');
      for (const k of allKeys) {
        const c = k.dataset.char;
        if (c && LETTER_KEYS.has(c)) {
          rects.push({ char: c, rect: k.getBoundingClientRect(), el: k });
        }
      }
      cachedKeyRectsRef.current = rects;
    });
    return () => cancelAnimationFrame(raf);
  }, [open, symbols, mode]);

  // Reset expanded and contact tab when keyboard closes
  useEffect(() => {
    if (!open) {
      setExpanded(false);
      setContactTab(null);
    }
  }, [open]);

  // Native touch event handling for swipe tracking.
  // Mobile browsers cancel pointer events (pointercancel) when they detect finger
  // movement on elements with touch-action:manipulation. By handling touchmove
  // natively with preventDefault(), we keep control of the touch AND do the swipe
  // tracking directly — more reliable than pointer events on iOS/Android.
  useEffect(() => {
    const board = boardRef.current;
    if (!board || !open) return;

    const onTouchMove = (e) => {
      const sw = swipeState.current;
      if (!sw.isTouch) return; // not tracking a touch swipe
      e.preventDefault(); // prevent browser from canceling our gesture

      const touch = e.touches[0];
      if (!touch) return;
      const boardRect = board.getBoundingClientRect();

      const dx = touch.clientX - sw.startX;
      const dy = touch.clientY - sw.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Activate swipe mode once finger moves > 20px from start
      if (!sw.active && dist > 20) {
        sw.active = true;
      }

      if (!sw.active) return;

      // Track trail point
      sw.points.push({ x: touch.clientX - boardRect.left, y: touch.clientY - boardRect.top });
      drawTrail(sw.points);

      // Detect which key the finger is over using precomputed bounding rects
      const hit = findKeyAtCoord(touch.clientX, touch.clientY, sw.keyRects);
      if (hit && hit.char !== sw.lastKey) {
        sw.keys.push(hit.char);
        sw.lastKey = hit.char;
      }

      // Live word predictions (throttled to every 150ms)
      const now = Date.now();
      if (sw.points.length >= 5 && now - sw.lastPredictTime > 150) {
        sw.lastPredictTime = now;
        const candidates = matchSwipePath([...sw.points], sw.keyRects, { left: boardRect.left, top: boardRect.top });
        if (candidates.length > 0) {
          setSwipeSuggestion({ words: candidates, selected: 0, capitalize: shiftedRef.current && !symbolsRef.current });
        }
      }
    };

    const onTouchEnd = () => {
      const sw = swipeState.current;
      if (!sw.isTouch) return;

      const wasActive = sw.active;
      const swPoints = [...sw.points];
      const swKeyRects = sw.keyRects;
      const startBtn = sw.startBtn;

      // Clean up swipe state
      sw.isTouch = false;
      sw.pointerId = null;
      sw.active = false;
      sw.startBtn = null;
      sw.keyRects = [];
      sw.keys = [];
      sw.points = [];
      clearSwipeHighlights();
      clearTrailCanvas();

      if (wasActive && swPoints.length >= 2) {
        // Swipe completed — match word using shape-template comparison
        const boardRect = board.getBoundingClientRect();
        const candidates = matchSwipePath(swPoints, swKeyRects, { left: boardRect.left, top: boardRect.top });
        if (candidates.length > 0) {
          playKeyTap();
          const capitalize = shiftedRef.current && !symbolsRef.current;
          let word = candidates[0];
          if (capitalize) {
            word = word[0].toUpperCase() + word.slice(1);
            setShifted(false);
          }
          refs.current.onSwipeWord?.(word);
          if (candidates.length > 1) {
            setSwipeSuggestion({ words: candidates, selected: 0, capitalize });
          } else {
            setSwipeSuggestion(null);
          }
        } else if (startBtn) {
          // No match — fall back to first letter as a normal tap
          flash(startBtn);
          playKeyTap();
          const char = startBtn.dataset.char;
          const out = shiftedRef.current && !symbolsRef.current ? char.toUpperCase() : char;
          refs.current.onKey(out);
          if (shiftedRef.current && !symbolsRef.current) setShifted(false);
        }
        return;
      }

      // Not a swipe (small movement) — treat as normal tap
      if (startBtn) {
        flash(startBtn);
        playKeyTap();
        const char = startBtn.dataset.char;
        const out = shiftedRef.current && !symbolsRef.current ? char.toUpperCase() : char;
        refs.current.onKey(out);
        showPreview(startBtn, out);
        if (shiftedRef.current && !symbolsRef.current) setShifted(false);
      }
    };

    board.addEventListener('touchmove', onTouchMove, { passive: false });
    board.addEventListener('touchend', onTouchEnd);
    return () => {
      board.removeEventListener('touchmove', onTouchMove);
      board.removeEventListener('touchend', onTouchEnd);
    };
  }, [open]);

  // Auto-capitalize: shift on when input is empty or after sentence-ending punctuation + space
  useEffect(() => {
    if (symbolsRef.current) return;
    if (!inputText) {
      setShifted(true);
      return;
    }
    if (/[.!?]\s$/.test(inputText) || inputText.endsWith('\n')) {
      setShifted(true);
    }
  }, [inputText]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      clearTimeout(backspaceTimer.current);
      clearTimeout(backspaceInterval.current);
      clearTimeout(repeatTimer.current);
      clearInterval(repeatInterval.current);
    };
  }, []);

  // IntersectionObserver for active category tracking
  useEffect(() => {
    if (mode !== 'emoji') return;
    const scrollEl = emojiScrollRef.current;
    if (!scrollEl) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const catId = entry.target.dataset.categoryHeader;
            if (catId) {
              activeCategoryRef.current = catId;
              setActiveCategory(catId);
            }
          }
        }
      },
      { root: scrollEl, rootMargin: '0px 0px -80% 0px', threshold: 0 }
    );

    const headers = scrollEl.querySelectorAll('[data-category-header]');
    headers.forEach(h => observer.observe(h));

    return () => observer.disconnect();
  }, [mode, open, expanded]);

  // Drag-to-expand: GPU-composited translateY for zero layout reflow during drag.
  // Works for both emoji and gifs panels. At drag start the bottom bar goes
  // position:fixed and the scroll area is set to full height (extending below
  // viewport). During drag only bar.style.transform changes — pure GPU compositing.
  useEffect(() => {
    if ((mode !== 'emoji' && mode !== 'gifs') || expanded) return;
    if (mode === 'gifs' && gifSearchActive) return;
    const el = mode === 'gifs' ? gifsGridRef.current : emojiScrollRef.current;
    if (!el) return;
    const cls = mode === 'gifs' ? 'ck-gifs' : 'ck-emoji';
    const isGifs = mode === 'gifs';

    const bar = el.closest('.ck-bottom-bar');
    const chatContainer = el.closest('.location-chat')?.querySelector('.chat-messages-container');
    if (!bar) return;

    const state = { active: false, startY: 0, excessH: 0, activateY: 0, barH: 0 };

    const clearBarStyles = () => {
      bar.style.position = '';
      bar.style.top = '';
      bar.style.left = '';
      bar.style.width = '';
      bar.style.zIndex = '';
      bar.style.willChange = '';
      bar.style.transform = '';
      bar.style.transition = '';
    };

    const clearAll = () => {
      clearBarStyles();
      el.style.height = '';
      el.classList.remove(`${cls}-expanding`);
      if (isGifs && el.parentElement) el.parentElement.style.height = '';
      if (chatContainer) {
        chatContainer.style.transform = '';
        chatContainer.style.willChange = '';
      }
    };

    const onTouchStart = (e) => {
      state.startY = e.touches[0].clientY;
      state.active = false;
    };

    const onTouchMove = (e) => {
      const dy = state.startY - e.touches[0].clientY; // positive = finger moving up

      if (!state.active && dy > 10) {
        // Measure available space
        const chatEl = chatContainer?.querySelector('.chat-messages');
        const available = chatEl?.offsetHeight || 0;
        if (available < 20) return; // no room to expand
        const maxH = COMPACT_H + available;
        state.excessH = available;
        state.activateY = e.touches[0].clientY;
        state.active = true;

        // Snapshot bar position before any style changes
        const barRect = bar.getBoundingClientRect();
        state.barH = barRect.height;

        // Pull bar to position:fixed at its current position (single reflow)
        bar.style.position = 'fixed';
        bar.style.top = `${barRect.top}px`;
        bar.style.left = `${barRect.left}px`;
        bar.style.width = `${barRect.width}px`;
        bar.style.zIndex = '100';

        // Counter-translate chat: bar leaving flow causes chat to grow by barH,
        // shift it back so messages don't jump
        if (chatContainer) {
          chatContainer.style.willChange = 'transform';
          chatContainer.style.transform = `translateY(${-state.barH}px)`;
        }

        // Pre-render content at full height — bar extends below viewport
        // For gifs, unlock the parent panel's fixed height so the grid can grow
        if (isGifs) el.parentElement.style.height = 'auto';
        el.style.height = `${maxH}px`;
        el.classList.add(`${cls}-expanding`);
        bar.style.willChange = 'transform';
      }

      if (state.active) {
        e.preventDefault();
        // Pure GPU: only translateY changes per frame
        const offset = Math.max(0, Math.min(state.excessH, state.activateY - e.touches[0].clientY));
        bar.style.transform = `translateY(${-offset}px)`;
      }
    };

    const onTouchEnd = () => {
      if (!state.active) return;
      state.active = false;

      const match = bar.style.transform.match(/translateY\((-?[0-9.]+)px\)/);
      const currentTY = match ? Math.abs(parseFloat(match[1])) : 0;
      const progress = state.excessH > 0 ? currentTY / state.excessH : 0;
      let cleaned = false;

      if (progress >= 0.3) {
        // Snap to expanded — animate translateY to full offset
        const remaining = state.excessH - currentTY;
        const duration = Math.max(80, Math.min(300, remaining * 0.8));
        bar.style.transition = `transform ${duration}ms ease-out`;
        bar.style.transform = `translateY(${-state.excessH}px)`;

        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          bar.style.transition = '';
          setExpanded(true);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              clearAll();
            });
          });
          bar.removeEventListener('transitionend', cleanup);
        };
        bar.addEventListener('transitionend', cleanup, { once: true });
        setTimeout(cleanup, duration + 50);
      } else {
        // Snap back to compact — animate translateY to 0
        const duration = Math.max(80, Math.min(300, currentTY * 0.8));
        bar.style.transition = `transform ${duration}ms ease-out`;
        bar.style.transform = 'translateY(0)';

        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          clearAll();
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
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      clearAll();
    };
  }, [mode, expanded, open, gifSearchActive]);

  // Drag-to-collapse: GPU-composited translateY, mirrors the expand technique.
  // Works for both emoji and gifs panels.
  useEffect(() => {
    if ((mode !== 'emoji' && mode !== 'gifs') || !expanded) return;
    if (mode === 'gifs' && gifSearchActive) return;
    const el = mode === 'gifs' ? gifsGridRef.current : emojiScrollRef.current;
    if (!el) return;
    const cls = mode === 'gifs' ? 'ck-gifs' : 'ck-emoji';
    const isGifs = mode === 'gifs';

    const bar = el.closest('.ck-bottom-bar');
    const chatContainer = el.closest('.location-chat')?.querySelector('.chat-messages-container');
    if (!bar) return;

    const state = { active: false, startY: 0, excessH: 0, activateY: 0, barH: 0, atTop: false };

    const clearBarStyles = () => {
      bar.style.position = '';
      bar.style.top = '';
      bar.style.left = '';
      bar.style.width = '';
      bar.style.zIndex = '';
      bar.style.willChange = '';
      bar.style.transform = '';
      bar.style.transition = '';
    };

    const clearAll = () => {
      clearBarStyles();
      el.style.height = '';
      el.classList.remove(`${cls}-collapsing`);
      if (isGifs && el.parentElement) el.parentElement.style.height = '';
      if (chatContainer) {
        chatContainer.style.transform = '';
        chatContainer.style.willChange = '';
        chatContainer.style.transition = '';
      }
    };

    const onTouchStart = (e) => {
      state.atTop = el.scrollTop <= 1;
      state.startY = e.touches[0].clientY;
      state.active = false;
    };

    const onTouchMove = (e) => {
      if (!state.atTop) return;
      const dy = e.touches[0].clientY - state.startY; // positive = finger moving down

      if (!state.active && dy > 10) {
        const startH = el.offsetHeight;
        state.excessH = startH - COMPACT_H;
        if (state.excessH < 20) { state.active = false; return; }
        state.activateY = e.touches[0].clientY;
        state.active = true;

        // Snapshot bar position
        const barRect = bar.getBoundingClientRect();
        state.barH = barRect.height;

        // Switch from flex to inline height, then go fixed
        el.classList.remove(`${cls}-expanded`);
        el.classList.add(`${cls}-collapsing`);
        el.style.height = `${startH}px`;
        if (isGifs) el.parentElement.style.height = 'auto';

        bar.style.position = 'fixed';
        bar.style.top = `${barRect.top}px`;
        bar.style.left = `${barRect.left}px`;
        bar.style.width = `${barRect.width}px`;
        bar.style.zIndex = '100';

        // Counter-translate chat so messages don't jump
        if (chatContainer) {
          chatContainer.style.willChange = 'transform';
          chatContainer.style.transform = `translateY(${-state.barH}px)`;
        }

        bar.style.willChange = 'transform';
      }

      if (state.active) {
        e.preventDefault();
        // Both GPU-composited: bar slides down, chat slides down in sync
        const offset = Math.max(0, Math.min(state.excessH, e.touches[0].clientY - state.activateY));
        bar.style.transform = `translateY(${offset}px)`;
        if (chatContainer) {
          chatContainer.style.transform = `translateY(${-state.barH + offset}px)`;
        }
      }
    };

    const onTouchEnd = () => {
      if (!state.active) return;
      state.active = false;

      const match = bar.style.transform.match(/translateY\(([0-9.]+)px\)/);
      const currentTY = match ? parseFloat(match[1]) : 0;
      const progress = state.excessH > 0 ? currentTY / state.excessH : 0;
      let cleaned = false;

      if (progress >= 0.3) {
        // Snap to compact — animate both transforms
        const remaining = state.excessH - currentTY;
        const duration = Math.max(80, Math.min(300, remaining * 0.8));
        bar.style.transition = `transform ${duration}ms ease-out`;
        bar.style.transform = `translateY(${state.excessH}px)`;
        if (chatContainer) {
          chatContainer.style.transition = `transform ${duration}ms ease-out`;
          chatContainer.style.transform = `translateY(${-state.barH + state.excessH}px)`;
        }

        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          bar.style.transition = '';
          setExpanded(false);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              clearAll();
            });
          });
          bar.removeEventListener('transitionend', cleanup);
        };
        bar.addEventListener('transitionend', cleanup, { once: true });
        setTimeout(cleanup, duration + 50);
      } else {
        // Snap back to expanded — animate both transforms back
        const duration = Math.max(80, Math.min(300, currentTY * 0.8));
        bar.style.transition = `transform ${duration}ms ease-out`;
        bar.style.transform = 'translateY(0)';
        if (chatContainer) {
          chatContainer.style.transition = `transform ${duration}ms ease-out`;
          chatContainer.style.transform = `translateY(${-state.barH}px)`;
        }

        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          el.classList.remove(`${cls}-collapsing`);
          el.classList.add(`${cls}-expanded`);
          clearBarStyles();
          el.style.height = '';
          if (isGifs && el.parentElement) el.parentElement.style.height = '';
          if (chatContainer) {
            chatContainer.style.transform = '';
            chatContainer.style.willChange = '';
            chatContainer.style.transition = '';
          }
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
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      clearAll();
    };
  }, [mode, expanded, open, gifSearchActive]);

  // Fetch GIFs: trending on mode enter, search with 350ms debounce
  useEffect(() => {
    if (mode !== 'gifs') return;
    clearTimeout(gifDebounceRef.current);

    const fetchGifs = async () => {
      setGifLoading(true);
      try {
        const q = gifQuery.trim();
        const url = q
          ? `/api/chat/gifs?q=${encodeURIComponent(q)}&limit=20`
          : '/api/chat/gifs?limit=20';
        const data = await api(url);
        setGifResults(data.results || []);
      } catch {
        setGifResults([]);
      } finally {
        setGifLoading(false);
      }
    };

    if (!gifQuery.trim()) {
      fetchGifs();
    } else {
      gifDebounceRef.current = setTimeout(fetchGifs, 350);
    }

    return () => clearTimeout(gifDebounceRef.current);
  }, [mode, gifQuery]);

  // Reset GIF state when leaving gifs mode
  useEffect(() => {
    if (mode !== 'gifs') {
      setGifQuery('');
      setGifResults([]);
      setGifSearchActive(false);
    }
  }, [mode]);

  // Unload off-screen GIF images to prevent Safari memory crash on iOS
  useEffect(() => {
    if (mode !== 'gifs') return;
    const grid = gifsGridRef.current;
    if (!grid) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const img = entry.target;
          if (entry.isIntersecting) {
            const real = img.dataset.src;
            if (real && img.src !== real) img.src = real;
          } else {
            if (img.src && !img.dataset.src) img.dataset.src = img.src;
            img.removeAttribute('src');
          }
        }
      },
      { root: grid, rootMargin: '200px 0px' }
    );

    const observeAll = () => {
      grid.querySelectorAll('img').forEach((img) => {
        if (img.src && !img.dataset.src) img.dataset.src = img.src;
        observer.observe(img);
      });
    };

    observeAll();

    const mutObs = new MutationObserver(observeAll);
    mutObs.observe(grid, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutObs.disconnect();
    };
  }, [mode, gifResults, gifSearchActive]);

  const showPreview = (btn, char) => {
    const el = previewRef.current;
    if (!el) return;
    clearTimeout(previewTimerRef.current);
    const rect = btn.getBoundingClientRect();
    el.textContent = char;
    const left = Math.max(28, Math.min(window.innerWidth - 28, rect.left + rect.width / 2));
    el.style.left = `${left}px`;
    el.style.top = `${rect.top - 8}px`;
    el.classList.add('ck-key-preview-visible');
    previewTimerRef.current = setTimeout(() => {
      el.classList.remove('ck-key-preview-visible');
    }, 120);
  };

  const hidePreview = () => {
    clearTimeout(previewTimerRef.current);
    previewRef.current?.classList.remove('ck-key-preview-visible');
  };

  // ── Swipe trail canvas helpers ──
  const initTrailCanvas = () => {
    const canvas = canvasRef.current;
    const board = boardRef.current;
    if (!canvas || !board) return;
    const rect = board.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const drawTrail = (points) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (points.length < 2) return;
    // Glow
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.strokeStyle = 'rgba(212, 168, 67, 0.2)';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    // Core line
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.strokeStyle = 'rgba(212, 168, 67, 0.6)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  const clearTrailCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Reset canvas by reassigning width — clears all content regardless of DPR transform
    canvas.width = canvas.width; // eslint-disable-line no-self-assign
  };

  const clearSwipeHighlights = () => {
    const board = boardRef.current;
    if (!board) return;
    board.querySelectorAll('.ck-key-swiping').forEach(el => el.classList.remove('ck-key-swiping'));
  };

  const flash = (btn) => {
    btn.classList.add('ck-key-pressed');
    setTimeout(() => btn.classList.remove('ck-key-pressed'), 100);
  };

  const handlePointerDown = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    if (btn.classList.contains('ck-emoji-cell') || btn.classList.contains('ck-gif-cell')) {
      emojiTap.current = { btn, x: e.clientX, y: e.clientY };
      return;
    }

    e.preventDefault();

    const { onKey, onBackspace, onSubmit, onClose, onPaste, playSound, disabled, onModeChange } = refs.current;
    const action = btn.dataset.action;

    // Flash all keys except swipeable letter keys (those flash on pointer up if it's a tap)
    const isSwipeable = action === 'key' && !symbolsRef.current && !gifSearchActive && LETTER_KEYS.has(btn.dataset.char);
    if (!isSwipeable) flash(btn);

    if (action === 'key') {
      if (!gifSearchActive && disabled) return;
      const char = btn.dataset.char;

      // Start swipe tracking for letter keys in keys mode (not symbols, not gif search)
      if (!symbolsRef.current && !gifSearchActive && LETTER_KEYS.has(char)) {
        const board = boardRef.current;
        const boardRect = board?.getBoundingClientRect();
        const sw = swipeState.current;
        sw.active = false; // not active yet — activated on move > 20px
        sw.startX = e.clientX;
        sw.startY = e.clientY;
        sw.startBtn = btn;
        sw.keys = [char];
        sw.lastKey = char;
        sw.points = boardRect ? [{ x: e.clientX - boardRect.left, y: e.clientY - boardRect.top }] : [];
        sw.lastPredictTime = 0;
        sw.pointerId = e.pointerId;
        sw.isTouch = (e.pointerType === 'touch');

        // Use cached key rects to avoid layout thrashing on every tap
        sw.keyRects = cachedKeyRectsRef.current || [];

        initTrailCanvas(); // size canvas now so coordinates are consistent
        return; // defer — don't dispatch key yet
      }

      // Non-letter key or symbols/gif mode: dispatch immediately
      playKeyTap();
      const out = shiftedRef.current && !symbolsRef.current ? char.toUpperCase() : char;
      if (gifSearchActive) {
        setGifQuery(q => q + out);
      } else {
        setSwipeSuggestion(null);
        onKey(out);
      }
      showPreview(btn, out);
      if (shiftedRef.current && !symbolsRef.current) setShifted(false);
    } else if (action === 'space') {
      // Clear swipe suggestion on space press
      setSwipeSuggestion(null);
      if (!gifSearchActive && disabled) return;
      playKeyTap();
      if (gifSearchActive) {
        setGifQuery(q => q + ' ');
      } else {
        onKey(' ');
      }
      if (shiftedRef.current && !symbolsRef.current) setShifted(false);
    } else if (action === 'backspace') {
      setSwipeSuggestion(null);
      if (!gifSearchActive && disabled) return;
      playKeyTap();
      if (gifSearchActive) {
        setGifQuery(q => q.slice(0, -1));
        backspaceTimer.current = setTimeout(() => {
          let delay = 120;
          const tick = () => {
            setGifQuery(q => q.slice(0, -1));
            if (delay > 30) delay = Math.max(30, delay - 10);
            backspaceInterval.current = setTimeout(tick, delay);
          };
          backspaceInterval.current = setTimeout(tick, delay);
        }, 400);
      } else {
        onBackspace();
        backspaceTimer.current = setTimeout(() => {
          let delay = 120;
          const tick = () => {
            refs.current.onBackspace();
            if (delay > 30) delay = Math.max(30, delay - 10);
            backspaceInterval.current = setTimeout(tick, delay);
          };
          backspaceInterval.current = setTimeout(tick, delay);
        }, 400);
      }
    } else if (action === 'shift') {
      playKeyTap();
      setShifted(s => !s);
    } else if (action === 'symbols') {
      playKeyTap();
      setSymbols(s => !s);
    } else if (action === 'return') {
      if (disabled) return;
      playKeyTap();
      onKey('\n');
    } else if (action === 'paste') {
      playKeyTap();
      onPaste?.();
    } else if (action === 'left') {
      playKeyTap();
      refs.current.onLeft?.();
      repeatTimer.current = setTimeout(() => {
        repeatInterval.current = setInterval(() => {
          refs.current.onLeft?.();
        }, 60);
      }, 400);
    } else if (action === 'right') {
      playKeyTap();
      refs.current.onRight?.();
      repeatTimer.current = setTimeout(() => {
        repeatInterval.current = setInterval(() => {
          refs.current.onRight?.();
        }, 60);
      }, 400);
    } else if (action === 'send') {
      if (disabled) return;
      playSound?.('messageSent');
      onSubmit();
    } else if (action === 'close') {
      playKeyTap();
      onClose();
    } else if (action === 'keys-mode') {
      playKeyTap();
      setExpanded(false);
      onModeChange('keys');
    } else if (action === 'emoji-tab') {
      playKeyTap();
      const catId = btn.dataset.category;
      const scrollEl = emojiScrollRef.current;
      if (scrollEl) {
        const header = scrollEl.querySelector(`[data-category-header="${catId}"]`);
        if (header) header.scrollIntoView({ behavior: 'smooth' });
      }
    } else if (action === 'open-contacts') {
      playKeyTap();
      setContactTab(null);
      onModeChange('npcs');
    } else if (action === 'toggle-mic') {
      playKeyTap();
      refs.current.onToggleMic?.();
    } else if (action === 'npc-mention') {
      playKeyTap();
      const npcId = btn.dataset.npcId;
      const npc = (npcs || []).find(n => n.id === npcId);
      if (npc) refs.current.onNpcMention?.(npc);
    } else if (action === 'player-mention') {
      playKeyTap();
      const playerId = btn.dataset.playerId;
      const player = (players || []).find(p => p.id === playerId);
      if (player) refs.current.onPlayerMention?.(player);
    } else if (action === 'group-mention') {
      playKeyTap();
      const groupId = btn.dataset.groupId;
      const group = (mentionGroups || []).find(g => g.id === groupId);
      if (group) refs.current.onGroupMention?.(group);
    } else if (action === 'contact-tab') {
      playKeyTap();
      setContactTab(btn.dataset.tab);
    } else if (action === 'back-from-contact-tab') {
      playKeyTap();
      setContactTab(null);
    } else if (action === 'back-to-extras') {
      playKeyTap();
      setGifSearchActive(false);
      setContactTab(null);
      onModeChange('extras');
    } else if (action === 'open-image-picker') {
      playKeyTap();
      refs.current.onImagePick?.();
    } else if (action === 'open-gifs') {
      playKeyTap();
      onModeChange('gifs');
    } else if (action === 'open-dice') {
      playKeyTap();
      onModeChange('dice');
    } else if (action === 'open-npc-speak') {
      playKeyTap();
      onModeChange('npc-speak');
    } else if (action === 'npc-speak') {
      playKeyTap();
      const npcId = btn.dataset.npcId;
      const npc = (npcs || []).find(n => n.id === npcId);
      if (npc) refs.current.onNpcSpeak?.(npc);
      onModeChange('extras');
    } else if (action === 'open-items') {
      playKeyTap();
      onModeChange('items');
      // Fetch inventory on panel open
      setItemsList(null);
      api('/api/inventory')
        .then(data => setItemsList((data.items || []).filter(i => i.type === 'consumable' && i.quantity > 0)))
        .catch(() => setItemsList([]));
    } else if (action === 'open-emoji') {
      playKeyTap();
      onModeChange('emoji');
    } else if (action === 'open-emotes') {
      playKeyTap();
      refs.current.onOpenEmotes?.();
    } else if (action === 'use-item') {
      playKeyTap();
      const itemId = btn.dataset.itemId;
      if (!itemId || usingItem) return;
      setUsingItem(true);
      refs.current.onUseItem?.(itemId).then((updatedInventory) => {
        if (updatedInventory) {
          setItemsList((updatedInventory.items || []).filter(i => i.type === 'consumable' && i.quantity > 0));
        }
        onModeChange('extras');
        setUsingItem(false);
      }).catch(() => {
        setUsingItem(false);
      });
    } else if (action === 'gif-select') {
      playKeyTap();
      const gifId = btn.dataset.gifId;
      const gif = gifResults.find(g => g.id === gifId);
      if (gif) {
        setGifSearchActive(false);
        refs.current.onGifSelect?.(gif);
      }
    } else if (action === 'activate-gif-search') {
      playKeyTap();
      setGifSearchActive(true);
    } else if (action === 'deactivate-gif-search') {
      playKeyTap();
      setExpanded(true);
      setGifSearchActive(false);
    } else if (action === 'clear-gif-search') {
      playKeyTap();
      setGifQuery('');
    }
  };

  // ── Swipe pointer move on .ck-board (desktop/mouse fallback) ──
  const handleBoardPointerMove = (e) => {
    const sw = swipeState.current;
    if (sw.isTouch) return; // touch swipes use native handlers
    if (sw.pointerId === null || e.pointerId !== sw.pointerId) return;

    const board = boardRef.current;
    if (!board) return;
    const boardRect = board.getBoundingClientRect();

    const dx = e.clientX - sw.startX;
    const dy = e.clientY - sw.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Activate swipe mode once finger moves > 20px from start
    if (!sw.active && dist > 20) {
      sw.active = true;
      initTrailCanvas();
    }

    if (!sw.active) return;

    // Track trail point
    sw.points.push({ x: e.clientX - boardRect.left, y: e.clientY - boardRect.top });
    drawTrail(sw.points);

    // Detect which key using precomputed bounding rects
    const hit = findKeyAtCoord(e.clientX, e.clientY, sw.keyRects);
    if (hit && hit.char !== sw.lastKey) {
      sw.keys.push(hit.char);
      sw.lastKey = hit.char;
    }

    // Live word predictions (throttled to every 150ms)
    const now = Date.now();
    if (sw.points.length >= 5 && now - sw.lastPredictTime > 150) {
      sw.lastPredictTime = now;
      const candidates = matchSwipePath([...sw.points], sw.keyRects, { left: boardRect.left, top: boardRect.top });
      if (candidates.length > 0) {
        setSwipeSuggestion({ words: candidates, selected: 0, capitalize: shiftedRef.current && !symbolsRef.current });
      }
    }
  };

  const handlePointerUp = (e) => {
    hidePreview();

    // ── Swipe finalization (desktop only — touch uses native touchend) ──
    const sw = swipeState.current;
    if (sw.pointerId !== null && e.pointerId === sw.pointerId && !sw.isTouch) {
      const wasActive = sw.active;
      const swPoints = [...sw.points];
      const swKeyRects = sw.keyRects;
      const startBtn = sw.startBtn;

      // Clean up swipe state
      sw.pointerId = null;
      sw.active = false;
      sw.startBtn = null;
      sw.keyRects = [];
      sw.keys = [];
      sw.points = [];
      clearSwipeHighlights();
      clearTrailCanvas();

      if (wasActive && swPoints.length >= 2) {
        // Swipe completed — match word using shape-template comparison
        const board = boardRef.current;
        const boardRect = board?.getBoundingClientRect();
        const candidates = boardRect
          ? matchSwipePath(swPoints, swKeyRects, { left: boardRect.left, top: boardRect.top })
          : [];
        if (candidates.length > 0) {
          playKeyTap();
          const capitalize = shiftedRef.current && !symbolsRef.current;
          let word = candidates[0];
          if (capitalize) {
            word = word[0].toUpperCase() + word.slice(1);
            setShifted(false);
          }
          refs.current.onSwipeWord?.(word);
          if (candidates.length > 1) {
            setSwipeSuggestion({ words: candidates, selected: 0, capitalize });
          } else {
            setSwipeSuggestion(null);
          }
        } else if (startBtn) {
          // No match — fall back to first letter as a normal tap
          flash(startBtn);
          playKeyTap();
          const char = startBtn.dataset.char;
          const out = shiftedRef.current && !symbolsRef.current ? char.toUpperCase() : char;
          refs.current.onKey(out);
          showPreview(startBtn, out);
          if (shiftedRef.current && !symbolsRef.current) setShifted(false);
        }
        return;
      }

      // Not a swipe (small movement) — treat as normal tap
      if (startBtn) {
        flash(startBtn);
        playKeyTap();
        const char = startBtn.dataset.char;
        const out = shiftedRef.current && !symbolsRef.current ? char.toUpperCase() : char;
        refs.current.onKey(out);
        showPreview(startBtn, out);
        if (shiftedRef.current && !symbolsRef.current) setShifted(false);
      }
      return;
    }

    // ── Emoji / GIF tap ──
    if (emojiTap.current) {
      const { btn, x, y } = emojiTap.current;
      emojiTap.current = null;
      const edx = Math.abs(e.clientX - x);
      const edy = Math.abs(e.clientY - y);
      if (edx < 10 && edy < 10) {
        flash(btn);
        if (btn.classList.contains('ck-gif-cell')) {
          playKeyTap();
          const gifId = btn.dataset.gifId;
          const gif = gifResults.find(g => g.id === gifId);
          if (gif) {
            setGifSearchActive(false);
            refs.current.onGifSelect?.(gif);
          }
        } else if (!refs.current.disabled) {
          playKeyTap();
          refs.current.onKey(btn.dataset.char);
        }
      }
      return;
    }

    const btn = e.target.closest('[data-action]');
    const action = btn?.dataset.action;
    if (action === 'backspace') {
      clearTimeout(backspaceTimer.current);
      clearTimeout(backspaceInterval.current);
    } else if (action === 'left' || action === 'right') {
      clearTimeout(repeatTimer.current);
      clearInterval(repeatInterval.current);
    }
  };

  const handlePointerCancel = () => {
    // Clean up swipe state (skip for touch — native touchend handles cleanup)
    const sw = swipeState.current;
    if (sw.pointerId !== null && !sw.isTouch) {
      sw.pointerId = null;
      sw.active = false;
      sw.startBtn = null;
      sw.keyRects = [];
      clearSwipeHighlights();
      clearTrailCanvas();
    }
    emojiTap.current = null;
    clearTimeout(backspaceTimer.current);
    clearTimeout(backspaceInterval.current);
    clearTimeout(repeatTimer.current);
    clearInterval(repeatInterval.current);
  };

  // Handle suggestion bar tap — replace the inserted word
  const handleSuggestionTap = (word, index) => {
    // Use stored capitalize flag (shift was already cleared after initial swipe insert)
    setSwipeSuggestion(prev => {
      if (!prev) return null;
      if (prev.capitalize) word = word[0].toUpperCase() + word.slice(1);
      refs.current.onSwipeReplace?.(word);
      return { ...prev, selected: index };
    });
  };

  // Handle contact portrait tap in suggestion bar — insert @mention + bump frequency
  const handleContactBarTap = (contact) => {
    playKeyTap();
    bumpNpcFreq(contact.id, locationId);
    setNpcFreqBump(c => c + 1);
    if (contact.type === 'npc') {
      refs.current.onNpcMention?.(contact.data);
    } else {
      refs.current.onPlayerMention?.(contact.data);
    }
  };

  if (!open) return null;

  const rows = symbols ? SYMBOLS_ROWS : ROWS;

  const keyboardRows = (
    <>
      <div className="ck-row">
        {NUMBERS_ROW.map(k => (
          <button key={k} className="ck-key" data-action="key" data-char={k} type="button">
            {k}
          </button>
        ))}
      </div>
      <div className="ck-row">
        {rows[0].map(k => (
          <button key={k} className="ck-key" data-action="key" data-char={k} type="button">
            {shifted && !symbols ? k.toUpperCase() : k}
          </button>
        ))}
      </div>
      <div className="ck-row ck-row-indent">
        {rows[1].map(k => (
          <button key={k} className="ck-key" data-action="key" data-char={k} type="button">
            {shifted && !symbols ? k.toUpperCase() : k}
          </button>
        ))}
      </div>
      <div className="ck-row">
        <button
          className={`ck-key ck-key-shift ${shifted ? 'ck-key-active' : ''}`}
          data-action="shift"
          type="button"
        >
          {'\u21E7'}
        </button>
        {rows[2].map(k => (
          <button key={k} className="ck-key" data-action="key" data-char={k} type="button">
            {shifted && !symbols ? k.toUpperCase() : k}
          </button>
        ))}
        <button className="ck-key ck-key-backspace" data-action="backspace" type="button">
          &#x232B;
        </button>
      </div>
    </>
  );

  const gifsHeader = (
    <div className="ck-gifs-header">
      {(!gifSearchActive || gifQuery) && (
        <button
          className="ck-npcs-back"
          data-action={gifSearchActive ? 'deactivate-gif-search' : 'back-to-extras'}
          type="button"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}
      <div
        className={`ck-gifs-search-display${gifSearchActive ? ' ck-gifs-search-active' : ''}`}
        data-action={gifSearchActive ? undefined : 'activate-gif-search'}
      >
        {gifSearchActive && !gifQuery && <span className="ck-gifs-search-cursor" />}
        {gifQuery ? (
          <>
            <span>{gifQuery}</span>
            {gifSearchActive && <span className="ck-gifs-search-cursor" />}
          </>
        ) : (
          <span className="ck-gifs-search-placeholder">Search GIFs...</span>
        )}
      </div>
      {gifSearchActive && gifQuery && (
        <button className="ck-gifs-clear" data-action="clear-gif-search" type="button">
          &#x2715;
        </button>
      )}
    </div>
  );

  return (
    <div className="ck-container" data-testid="keyboard-panel">
      <div
        ref={boardRef}
        className="ck-board"
        onPointerDown={handlePointerDown}
        onPointerMove={handleBoardPointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerCancel}
        onPointerCancel={handlePointerCancel}
      >
        {mode === 'emoji' ? (
          <>
            <div className="ck-emoji-area">
              <div
                ref={emojiScrollRef}
                className={`ck-emoji-scroll${expanded ? ' ck-emoji-expanded' : ''}`}
              >
                {EMOJI_CATEGORIES.map(cat => (
                  <div key={cat.id} className="ck-emoji-section">
                    <div className="ck-emoji-section-header" data-category-header={cat.id}>
                      {cat.label}
                    </div>
                    <div className="ck-emoji-section-grid">
                      {cat.emojis.map((emoji, i) => (
                        <button
                          key={`${cat.id}-${i}`}
                          className="ck-emoji-cell"
                          data-action="key"
                          data-char={emoji}
                          type="button"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <button
              className="ck-emoji-float-bksp"
              data-action="backspace"
              type="button"
            >
              &#x232B;
            </button>
          </>
        ) : mode === 'extras' ? (
          <div className="ck-extras-panel">
            <button
              className="ck-extras-btn"
              data-action="open-contacts"
              type="button"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span>Contacts</span>
            </button>
            <button
              className={`ck-extras-btn${listening ? ' ck-extras-btn-active' : ''}`}
              data-action="toggle-mic"
              type="button"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
              <span>Speech to Text</span>
            </button>
            <label
              className="ck-extras-btn"
              htmlFor="chat-image-input"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <span>Photo</span>
            </label>
            <button
              className="ck-extras-btn"
              data-action="open-gifs"
              type="button"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="2" />
                <text x="12" y="15.5" textAnchor="middle" fill="currentColor" stroke="none" fontSize="9" fontWeight="700" fontFamily="sans-serif">GIF</text>
              </svg>
              <span>GIFs</span>
            </button>
            <button
              className="ck-extras-btn"
              data-action="open-items"
              type="button"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
              <span>Items</span>
            </button>
            <button
              className="ck-extras-btn"
              data-action="open-emoji"
              type="button"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                <line x1="9" y1="9" x2="9.01" y2="9" />
                <line x1="15" y1="9" x2="15.01" y2="9" />
              </svg>
              <span>Emoji</span>
            </button>
            <button
              className="ck-extras-btn"
              data-action="open-emotes"
              type="button"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              <span>Emotes</span>
            </button>
            <button
              className="ck-extras-btn"
              data-action="open-dice"
              type="button"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="3" />
                <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="16" cy="8" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="8" cy="16" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
              </svg>
              <span>Dice</span>
            </button>
            <button
              className="ck-extras-btn"
              data-action="open-npc-speak"
              type="button"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
                <path d="M5 8l-3-3M19 8l3-3" />
              </svg>
              <span>NPC Speak</span>
            </button>
          </div>
        ) : mode === 'items' ? (
          <div className="ck-items-panel">
            <div className="ck-items-header">
              <button className="ck-npcs-back" data-action="back-to-extras" type="button">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <span className="ck-npcs-label">Items</span>
            </div>
            <div className="ck-items-list">
              {!itemsList ? (
                <div className="ck-items-loading">Loading inventory...</div>
              ) : itemsList.length === 0 ? (
                <div className="ck-items-loading">No consumable items</div>
              ) : itemsList.map(item => (
                <div key={item.item_id} className="ck-item-row">
                  <div className="ck-item-info">
                    <span className="ck-item-name">{item.name}</span>
                    <span className="ck-item-qty">Qty: {item.quantity}</span>
                  </div>
                  <button
                    className="ck-item-use-btn"
                    data-action="use-item"
                    data-item-id={item.item_id}
                    type="button"
                    disabled={usingItem}
                  >
                    Use
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : mode === 'npc-speak' ? (
          <div className="ck-npcs-panel">
            <div className="ck-npcs-header">
              <button className="ck-npcs-back" data-action="back-to-extras" type="button">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <span className="ck-npcs-label">NPC Speak</span>
            </div>
            <div className="ck-npcs-grid">
              {(npcs || []).map(npc => (
                <button
                  key={npc.id}
                  className="ck-npcs-item"
                  data-action="npc-speak"
                  data-npc-id={npc.id}
                  type="button"
                >
                  <NpcPortrait
                    npcId={npc.id}
                    emotion={npcEmotions?.[npc.id] || 'idle'}
                    size={44}
                  />
                  <span className="ck-npcs-name">
                    {npc.displayName.split(' ')[0]}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : mode === 'npcs' ? (
          <div className="ck-npcs-panel">
            <div className="ck-npcs-header">
              <button
                className="ck-npcs-back"
                data-action={contactTab ? 'back-from-contact-tab' : 'back-to-extras'}
                type="button"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <span className="ck-npcs-label">
                {contactTab === 'groups' ? 'Groups' : contactTab === 'npcs' ? 'NPCs' : contactTab === 'players' ? 'Players' : 'Contacts'}
              </span>
            </div>
            {!contactTab ? (
              <div className="ck-contacts-menu">
                {(mentionGroups || []).length > 0 && (
                  <button
                    className="ck-contacts-menu-btn"
                    data-action="contact-tab"
                    data-tab="groups"
                    type="button"
                  >
                    <div className="ck-contacts-menu-icon">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                    </div>
                    <span>Groups</span>
                    <span className="ck-contacts-menu-count">{(mentionGroups || []).length}</span>
                  </button>
                )}
                <button
                  className="ck-contacts-menu-btn"
                  data-action="contact-tab"
                  data-tab="npcs"
                  type="button"
                >
                  <div className="ck-contacts-menu-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>
                  <span>NPCs</span>
                  <span className="ck-contacts-menu-count">{(npcs || []).length}</span>
                </button>
                {(players || []).length > 0 && (
                  <button
                    className="ck-contacts-menu-btn"
                    data-action="contact-tab"
                    data-tab="players"
                    type="button"
                  >
                    <div className="ck-contacts-menu-icon">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="8" r="5" />
                        <path d="M20 21a8 8 0 1 0-16 0" />
                      </svg>
                    </div>
                    <span>Players</span>
                    <span className="ck-contacts-menu-count">{(players || []).length}</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="ck-npcs-grid">
                {contactTab === 'groups' && (mentionGroups || []).map(group => (
                  <button
                    key={`group-${group.id}`}
                    className="ck-npcs-item ck-npcs-group-item"
                    data-action="group-mention"
                    data-group-id={group.id}
                    type="button"
                  >
                    <div className="ck-npcs-group-icon">
                      {group.displayName.charAt(0)}
                    </div>
                    <span className="ck-npcs-name">{group.displayName}</span>
                  </button>
                ))}
                {contactTab === 'npcs' && (npcs || []).map(npc => (
                  <button
                    key={npc.id}
                    className="ck-npcs-item"
                    data-action="npc-mention"
                    data-npc-id={npc.id}
                    type="button"
                  >
                    <NpcPortrait
                      npcId={npc.id}
                      emotion={npcEmotions?.[npc.id] || 'idle'}
                      size={44}
                    />
                    <span className="ck-npcs-name">
                      {npc.displayName.split(' ')[0]}
                    </span>
                  </button>
                ))}
                {contactTab === 'players' && (players || []).map(player => (
                  <button
                    key={`player-${player.id}`}
                    className="ck-npcs-item ck-npcs-player-item"
                    data-action="player-mention"
                    data-player-id={player.id}
                    type="button"
                  >
                    <img
                      src={player.avatar}
                      alt={player.characterName}
                      className="ck-npcs-player-avatar"
                    />
                    <span className="ck-npcs-name">
                      {player.characterName}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : mode === 'gifs' ? (
          gifSearchActive ? (
            <>
              <div className="ck-gifs-panel">
                {gifsHeader}
                <div ref={gifsGridRef} className="ck-gifs-grid ck-gifs-expanded">
                  {gifLoading && gifResults.length === 0 ? (
                    <div className="ck-gifs-loading">Loading...</div>
                  ) : gifResults.length === 0 ? (
                    <div className="ck-gifs-loading">No GIFs found</div>
                  ) : (
                    gifResults.map(gif => (
                      <button
                        key={gif.id}
                        className="ck-gif-cell"
                        data-action="gif-select"
                        data-gif-id={gif.id}
                        type="button"
                      >
                        <img data-src={gif.preview} alt={gif.title} />
                      </button>
                    ))
                  )}
                </div>
                <div className="ck-gifs-attribution">Powered by GIPHY</div>
              </div>
              {keyboardRows}
            </>
          ) : (
            <div className="ck-gifs-panel">
              {gifsHeader}
              <div ref={gifsGridRef} className={`ck-gifs-grid${expanded ? ' ck-gifs-expanded' : ''}`}>
                {gifLoading && gifResults.length === 0 ? (
                  <div className="ck-gifs-loading">Loading...</div>
                ) : gifResults.length === 0 ? (
                  <div className="ck-gifs-loading">No GIFs found</div>
                ) : (
                  gifResults.map(gif => (
                    <button
                      key={gif.id}
                      className="ck-gif-cell"
                      data-action="gif-select"
                      data-gif-id={gif.id}
                      type="button"
                    >
                      <img data-src={gif.preview} alt={gif.title} />
                    </button>
                  ))
                )}
              </div>
              <div className="ck-gifs-attribution">Powered by GIPHY</div>
            </div>
          )
        ) : mode === 'dice' ? (
          <DicePanel
            onRoll={onDiceRoll}
            onBack={() => onModeChange('extras')}
          />
        ) : (
          <>
            {/* Swipe suggestion bar — always rendered to keep board height stable */}
            <div className="ck-swipe-suggestions">
              {swipeSuggestion && swipeSuggestion.words.length > 1 ? (
                swipeSuggestion.words.map((w, i) => (
                  <button
                    key={w}
                    className={`ck-swipe-suggestion${i === swipeSuggestion.selected ? ' ck-swipe-suggestion-active' : ''}`}
                    type="button"
                    onPointerDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); handleSuggestionTap(w, i); }}
                  >
                    {w}
                  </button>
                ))
              ) : !swipeSuggestion && sortedContacts.length > 0 ? (
                sortedContacts.map(contact => (
                  <button
                    key={`${contact.type}-${contact.id}`}
                    className="ck-swipe-npc"
                    type="button"
                    onPointerDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); handleContactBarTap(contact); }}
                  >
                    {contact.type === 'npc' ? (
                      <NpcPortrait
                        npcId={contact.id}
                        emotion={npcEmotions?.[contact.id] || 'idle'}
                        size={26}
                      />
                    ) : (
                      <img
                        src={contact.data.avatar}
                        alt={contact.data.characterName}
                        className="ck-swipe-npc-avatar"
                      />
                    )}
                  </button>
                ))
              ) : null}
            </div>
            {keyboardRows}
          </>
        )}

        {/* Canvas overlay for swipe trail — only in keys mode */}
        {mode === 'keys' && !symbols && (
          <canvas ref={canvasRef} className="ck-swipe-canvas" />
        )}

        <div ref={previewRef} className="ck-key-preview" />

        {/* Bottom row — keys mode or gif search mode */}
        {(mode === 'keys' || (mode === 'gifs' && gifSearchActive)) && (
          <div className="ck-row ck-row-bottom">
            <button
              className={`ck-key ck-key-sym ${symbols ? 'ck-key-active' : ''}`}
              data-action="symbols"
              type="button"
            >
              {symbols ? 'ABC' : '#+='}
            </button>
            <button className="ck-key ck-key-side" data-action="key" data-char="*" type="button">
              *
            </button>
            <button className="ck-key ck-key-space" data-action="space" type="button">
              {''}
            </button>
            <button className="ck-key ck-key-side" data-action="key" data-char="." type="button">
              .
            </button>
            {mode === 'gifs' ? (
              <button className="ck-key ck-key-return" data-action="deactivate-gif-search" type="button">
                &#x2713;
              </button>
            ) : (
              <button className="ck-key ck-key-return" data-action="return" type="button">
                {'\u21B5'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export default CustomKeyboard;

import { useState, useRef, useEffect, memo } from 'react';
import { getAudioMuted } from '../hooks/useAudioSettings';
import { EMOJI_CATEGORIES } from '../data/emojiData';
import { api } from '../hooks/useApi';
import NpcPortrait from './NpcPortrait';

const NUMBERS_ROW = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

const ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

const SYMBOLS_ROWS = [
  ['@', '#', '$', '&', '*', '-', '+', '(', ')', '/'],
  ['\\', '|', '~', '`', '=', '{', '}', '[', ']'],
  ['!', '"', "'", ':', ';', ',', '?', '.'],
];

const COMPACT_H = 254;

// Low-latency key tap sound using Web Audio API (pre-decoded buffer)
let _audioCtx = null;
let _tapBuffer = null;

function initKeyTapAudio() {
  if (_audioCtx) return;
  _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  fetch('/sounds/ui/button-tap.wav')
    .then(r => r.arrayBuffer())
    .then(buf => _audioCtx.decodeAudioData(buf))
    .then(decoded => { _tapBuffer = decoded; })
    .catch(() => {});
}

function playKeyTap() {
  if (!_audioCtx || !_tapBuffer || getAudioMuted()) return;
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  const src = _audioCtx.createBufferSource();
  const gain = _audioCtx.createGain();
  gain.gain.value = 0.3;
  src.buffer = _tapBuffer;
  src.connect(gain).connect(_audioCtx.destination);
  src.start(0);
}

/**
 * Custom on-screen QWERTY keyboard with emoji picker.
 * Uses event delegation (single handler) for fast response on rapid typing.
 */
const CustomKeyboard = memo(function CustomKeyboard({
  open, onKey, onBackspace, onSubmit, onClose, onPaste, onLeft, onRight, disabled, playSound,
  mode, onModeChange,
  npcs, npcEmotions, mentionGroups, onNpcMention, onGroupMention, listening, onToggleMic,
  onGifSelect,
}) {
  const [shifted, setShifted] = useState(false);
  const [symbols, setSymbols] = useState(false);
  const [expanded, setExpanded] = useState(false);
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

  // Drag-to-expand state
  const dragState = useRef({ active: false, startY: 0, currentH: COMPACT_H, maxH: 500 });

  // Keep callback refs current so the delegation handler stays stable
  const refs = useRef({});
  refs.current = { onKey, onBackspace, onSubmit, onClose, onPaste, onLeft, onRight, playSound, disabled, onModeChange, onNpcMention, onGroupMention, onToggleMic, onGifSelect };

  const shiftedRef = useRef(false);
  const symbolsRef = useRef(false);
  shiftedRef.current = shifted;
  symbolsRef.current = symbols;

  // Init low-latency audio on first open
  useEffect(() => {
    if (open) initKeyTapAudio();
  }, [open]);

  // Reset expanded when keyboard closes
  useEffect(() => {
    if (!open) setExpanded(false);
  }, [open]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      clearTimeout(backspaceTimer.current);
      clearInterval(backspaceInterval.current);
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
    flash(btn);

    const { onKey, onBackspace, onSubmit, onClose, onPaste, playSound, disabled, onModeChange } = refs.current;
    const action = btn.dataset.action;

    if (action === 'key') {
      if (!gifSearchActive && disabled) return;
      playKeyTap();
      const char = btn.dataset.char;
      const out = shiftedRef.current && !symbolsRef.current ? char.toUpperCase() : char;
      if (gifSearchActive) {
        setGifQuery(q => q + out);
      } else {
        onKey(out);
      }
      if (shiftedRef.current && !symbolsRef.current) setShifted(false);
    } else if (action === 'backspace') {
      if (!gifSearchActive && disabled) return;
      playKeyTap();
      if (gifSearchActive) {
        setGifQuery(q => q.slice(0, -1));
        backspaceTimer.current = setTimeout(() => {
          backspaceInterval.current = setInterval(() => {
            setGifQuery(q => q.slice(0, -1));
          }, 60);
        }, 400);
      } else {
        onBackspace();
        backspaceTimer.current = setTimeout(() => {
          backspaceInterval.current = setInterval(() => {
            refs.current.onBackspace();
          }, 60);
        }, 400);
      }
    } else if (action === 'shift') {
      playKeyTap();
      setShifted(s => !s);
    } else if (action === 'symbols') {
      playKeyTap();
      setSymbols(s => !s);
    } else if (action === 'space') {
      if (!gifSearchActive && disabled) return;
      playKeyTap();
      if (gifSearchActive) {
        setGifQuery(q => q + ' ');
      } else {
        onKey(' ');
      }
      if (shiftedRef.current && !symbolsRef.current) setShifted(false);
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
    } else if (action === 'open-npcs') {
      playKeyTap();
      onModeChange('npcs');
    } else if (action === 'toggle-mic') {
      playKeyTap();
      refs.current.onToggleMic?.();
    } else if (action === 'npc-mention') {
      playKeyTap();
      const npcId = btn.dataset.npcId;
      const npc = (npcs || []).find(n => n.id === npcId);
      if (npc) refs.current.onNpcMention?.(npc);
    } else if (action === 'group-mention') {
      playKeyTap();
      const groupId = btn.dataset.groupId;
      const group = (mentionGroups || []).find(g => g.id === groupId);
      if (group) refs.current.onGroupMention?.(group);
    } else if (action === 'back-to-extras') {
      playKeyTap();
      setGifSearchActive(false);
      onModeChange('extras');
    } else if (action === 'open-gifs') {
      playKeyTap();
      onModeChange('gifs');
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
      setGifSearchActive(false);
    } else if (action === 'clear-gif-search') {
      playKeyTap();
      setGifQuery('');
    }
  };

  const handlePointerUp = (e) => {
    if (emojiTap.current) {
      const { btn, x, y } = emojiTap.current;
      emojiTap.current = null;
      const dx = Math.abs(e.clientX - x);
      const dy = Math.abs(e.clientY - y);
      if (dx < 10 && dy < 10) {
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
      clearInterval(backspaceInterval.current);
    } else if (action === 'left' || action === 'right') {
      clearTimeout(repeatTimer.current);
      clearInterval(repeatInterval.current);
    }
  };

  const handlePointerCancel = () => {
    emojiTap.current = null;
    clearTimeout(backspaceTimer.current);
    clearInterval(backspaceInterval.current);
    clearTimeout(repeatTimer.current);
    clearInterval(repeatInterval.current);
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
    <div className="ck-container">
      <div
        className="ck-board"
        onPointerDown={handlePointerDown}
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
              data-action="open-npcs"
              type="button"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span>NPCs</span>
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
          </div>
        ) : mode === 'npcs' ? (
          <div className="ck-npcs-panel">
            <div className="ck-npcs-header">
              <button
                className="ck-npcs-back"
                data-action="back-to-extras"
                type="button"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <span className="ck-npcs-label">Mention an NPC</span>
            </div>
            <div className="ck-npcs-grid">
              {(mentionGroups || []).map(group => (
                <button
                  key={`group-${group.id}`}
                  className="ck-npcs-item ck-npcs-group-item"
                  data-action="group-mention"
                  data-group-id={group.id}
                  type="button"
                >
                  <div className="ck-npcs-group-icon">
                    {group.id === 'everyone' ? '👥' : group.displayName.charAt(0)}
                  </div>
                  <span className="ck-npcs-name">{group.displayName}</span>
                </button>
              ))}
              {(npcs || []).map(npc => (
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
            </div>
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
                        <img src={gif.preview} alt={gif.title} loading="lazy" />
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
                      <img src={gif.preview} alt={gif.title} loading="lazy" />
                    </button>
                  ))
                )}
              </div>
              <div className="ck-gifs-attribution">Powered by GIPHY</div>
            </div>
          )
        ) : (
          <>{keyboardRows}</>
        )}

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

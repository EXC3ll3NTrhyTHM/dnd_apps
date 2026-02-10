import { useState, useRef, useEffect, memo } from 'react';
import { getAudioMuted } from '../hooks/useAudioSettings';
import { EMOJI_CATEGORIES } from '../data/emojiData';

const ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

const SYMBOLS_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['@', '#', '*', '&', '-', '+', '(', ')', '/'],
  ['!', '"', "'", ':', ';', ',', '?', '.'],
];

const COMPACT_H = 150;

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
}) {
  const [shifted, setShifted] = useState(false);
  const [symbols, setSymbols] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [activeCategory, setActiveCategory] = useState(EMOJI_CATEGORIES[0].id);
  const backspaceTimer = useRef(null);
  const backspaceInterval = useRef(null);
  const repeatTimer = useRef(null);
  const repeatInterval = useRef(null);
  const emojiTap = useRef(null);
  const emojiScrollRef = useRef(null);
  const activeCategoryRef = useRef(EMOJI_CATEGORIES[0].id);

  // Drag-to-expand state
  const dragState = useRef({ active: false, startY: 0, currentH: COMPACT_H, maxH: 500 });

  // Keep callback refs current so the delegation handler stays stable
  const refs = useRef({});
  refs.current = { onKey, onBackspace, onSubmit, onClose, onPaste, onLeft, onRight, playSound, disabled, onModeChange };

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

  // Drag-to-expand: touch handlers on the scroll element
  useEffect(() => {
    if (mode !== 'emoji' || expanded) return;
    const el = emojiScrollRef.current;
    if (!el) return;

    const measureMaxH = () => {
      const board = el.closest('.ck-board');
      if (!board) return 500;
      const bottomRow = board.querySelector('.ck-row-bottom');
      const bottomH = bottomRow?.offsetHeight || 52;
      const bs = getComputedStyle(board);
      const padT = parseFloat(bs.paddingTop) || 8;
      const padB = parseFloat(bs.paddingBottom) || 8;
      return board.offsetHeight - bottomH - padT - padB;
    };

    const onTouchStart = (e) => {
      dragState.current = {
        active: false,
        startY: e.touches[0].clientY,
        currentH: COMPACT_H,
        maxH: 500,
      };
    };

    const onTouchMove = (e) => {
      const d = dragState.current;
      const dy = d.startY - e.touches[0].clientY; // positive = finger moving up

      if (!d.active && dy > 10) {
        d.active = true;
        el.classList.add('ck-emoji-expanding');
        // Force reflow so :has() layout changes apply, then measure
        d.maxH = measureMaxH();
      }

      if (d.active) {
        e.preventDefault();
        const newH = Math.max(COMPACT_H, Math.min(COMPACT_H + dy, d.maxH));
        d.currentH = newH;
        el.style.height = `${newH}px`;
      }
    };

    const onTouchEnd = () => {
      const d = dragState.current;
      if (!d.active) return;
      d.active = false;

      const currentH = d.currentH;
      const threshold = COMPACT_H + (d.maxH - COMPACT_H) * 0.3;
      let cleaned = false;

      if (currentH >= threshold) {
        // Snap to expanded
        const remaining = d.maxH - currentH;
        const duration = Math.max(80, Math.min(300, remaining * 0.8));
        el.style.transition = `height ${duration}ms ease-out`;
        el.style.height = `${d.maxH}px`;

        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          el.style.transition = '';
          el.style.height = '';
          el.classList.remove('ck-emoji-expanding');
          setExpanded(true);
          el.removeEventListener('transitionend', cleanup);
        };
        el.addEventListener('transitionend', cleanup, { once: true });
        setTimeout(cleanup, duration + 50);
      } else {
        // Snap back to compact
        const remaining = currentH - COMPACT_H;
        const duration = Math.max(80, Math.min(300, remaining * 0.8));
        el.style.transition = `height ${duration}ms ease-out`;
        el.style.height = `${COMPACT_H}px`;

        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          el.style.transition = '';
          el.style.height = '';
          el.classList.remove('ck-emoji-expanding');
          el.removeEventListener('transitionend', cleanup);
        };
        el.addEventListener('transitionend', cleanup, { once: true });
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
    };
  }, [mode, expanded, open]);

  const flash = (btn) => {
    btn.classList.add('ck-key-pressed');
    setTimeout(() => btn.classList.remove('ck-key-pressed'), 100);
  };

  const handlePointerDown = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    if (btn.classList.contains('ck-emoji-cell')) {
      emojiTap.current = { btn, x: e.clientX, y: e.clientY };
      return;
    }

    e.preventDefault();
    flash(btn);

    const { onKey, onBackspace, onSubmit, onClose, onPaste, playSound, disabled, onModeChange } = refs.current;
    const action = btn.dataset.action;

    if (action === 'key') {
      if (disabled) return;
      playKeyTap();
      const char = btn.dataset.char;
      const out = shiftedRef.current && !symbolsRef.current ? char.toUpperCase() : char;
      onKey(out);
      if (shiftedRef.current && !symbolsRef.current) setShifted(false);
    } else if (action === 'backspace') {
      if (disabled) return;
      playKeyTap();
      onBackspace();
      backspaceTimer.current = setTimeout(() => {
        backspaceInterval.current = setInterval(() => {
          refs.current.onBackspace();
        }, 60);
      }, 400);
    } else if (action === 'shift') {
      playKeyTap();
      setShifted(s => !s);
    } else if (action === 'symbols') {
      playKeyTap();
      setSymbols(s => !s);
    } else if (action === 'space') {
      if (disabled) return;
      playKeyTap();
      onKey(' ');
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
        if (!refs.current.disabled) {
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
        ) : (
          <>
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
        )}

        {/* Bottom row — keys mode only */}
        {mode !== 'emoji' && (
          <div className="ck-row ck-row-bottom">
            <button
              className={`ck-key ck-key-sym ${symbols ? 'ck-key-active' : ''}`}
              data-action="symbols"
              type="button"
            >
              {symbols ? 'ABC' : '123'}
            </button>
            <button className="ck-key ck-key-space" data-action="space" type="button">
              {''}
            </button>
            <button className="ck-key ck-key-return" data-action="return" type="button">
              {'\u21B5'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

export default CustomKeyboard;

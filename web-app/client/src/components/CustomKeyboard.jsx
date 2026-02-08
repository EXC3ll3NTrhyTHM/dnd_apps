import { useState, useRef, useEffect, memo } from 'react';
import { getAudioMuted } from '../hooks/useAudioSettings';

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
 * Custom on-screen QWERTY keyboard.
 * Uses event delegation (single handler) for fast response on rapid typing.
 */
const CustomKeyboard = memo(function CustomKeyboard({
  open, onKey, onBackspace, onSubmit, onClose, onPaste, onLeft, onRight, onMic, listening, disabled, playSound,
}) {
  const [shifted, setShifted] = useState(false);
  const [symbols, setSymbols] = useState(false);
  const backspaceTimer = useRef(null);
  const backspaceInterval = useRef(null);
  const repeatTimer = useRef(null);
  const repeatInterval = useRef(null);

  // Keep callback refs current so the delegation handler stays stable
  const refs = useRef({});
  refs.current = { onKey, onBackspace, onSubmit, onClose, onPaste, onLeft, onRight, onMic, playSound, disabled };

  const shiftedRef = useRef(false);
  const symbolsRef = useRef(false);
  shiftedRef.current = shifted;
  symbolsRef.current = symbols;

  // Init low-latency audio on first open
  useEffect(() => {
    if (open) initKeyTapAudio();
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

  // Flash a pressed class on the key for visual feedback (CSS :active is unreliable during rapid taps)
  const flash = (btn) => {
    btn.classList.add('ck-key-pressed');
    setTimeout(() => btn.classList.remove('ck-key-pressed'), 100);
  };

  // Single event-delegation handler for all keys
  const handlePointerDown = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.preventDefault();
    flash(btn);

    const { onKey, onBackspace, onSubmit, onClose, onPaste, playSound, disabled } = refs.current;
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
    } else if (action === 'mic') {
      playKeyTap();
      refs.current.onMic?.();
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
    }
  };

  const handlePointerUp = (e) => {
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

  if (!open) return null;

  const rows = symbols ? SYMBOLS_ROWS : ROWS;

  return (
    <div className="ck-container">
      <div
        className="ck-board"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Row 1 */}
        <div className="ck-row">
          {rows[0].map(k => (
            <button key={k} className="ck-key" data-action="key" data-char={k} type="button">
              {shifted && !symbols ? k.toUpperCase() : k}
            </button>
          ))}
        </div>

        {/* Row 2 — slightly indented */}
        <div className="ck-row ck-row-indent">
          {rows[1].map(k => (
            <button key={k} className="ck-key" data-action="key" data-char={k} type="button">
              {shifted && !symbols ? k.toUpperCase() : k}
            </button>
          ))}
        </div>

        {/* Row 3 — shift + letters + backspace */}
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

        {/* Row 4 — symbols toggle, paste, space, send, close */}
        <div className="ck-row ck-row-bottom">
          <button
            className={`ck-key ck-key-sym ${symbols ? 'ck-key-active' : ''}`}
            data-action="symbols"
            type="button"
          >
            {symbols ? 'ABC' : '123'}
          </button>
          <button
            className={`ck-key ck-key-mic ${listening ? 'ck-key-mic-active' : ''}`}
            data-action="mic"
            type="button"
            aria-label={listening ? 'Stop listening' : 'Voice input'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
          <button className="ck-key ck-key-space" data-action="space" type="button">
            {''}
          </button>
          <button className="ck-key ck-key-return" data-action="return" type="button">
            {'\u21B5'}
          </button>
        </div>
      </div>
    </div>
  );
});

export default CustomKeyboard;

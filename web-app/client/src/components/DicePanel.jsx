import { useState, useCallback, useEffect, useRef } from 'react';
import '../styles/dice.css';

const DICE_TYPES = [
  { sides: 4, label: 'd4' },
  { sides: 6, label: 'd6' },
  { sides: 8, label: 'd8' },
  { sides: 10, label: 'd10' },
  { sides: 12, label: 'd12' },
  { sides: 20, label: 'd20' },
  { sides: 100, label: 'd100' },
];

/**
 * Build a display string from the notation array.
 * Each group: { qty, sides, modifier, keep }
 * modifier: null | 'kh1' | 'kl1' | 'dl1'
 * keep: null | number (flat +/-)
 */
function buildNotationString(groups) {
  if (groups.length === 0) return '';
  const parts = [];
  for (const g of groups) {
    if (g.sides === 0) {
      // flat modifier group
      parts.push(g.flatMod > 0 ? `+${g.flatMod}` : `${g.flatMod}`);
    } else {
      let s = `${g.qty}d${g.sides}`;
      if (g.modifier) s += g.modifier;
      parts.push(s);
    }
  }
  return parts.join('+').replace(/\+\-/g, '-');
}

export default function DicePanel({ onRoll, onBack }) {
  const [groups, setGroups] = useState([]);
  const readyRef = useRef(false);

  // Prevent ghost taps from the extras button passing through on mount
  useEffect(() => {
    const timer = setTimeout(() => { readyRef.current = true; }, 200);
    return () => clearTimeout(timer);
  }, []);

  const addDie = useCallback((sides) => {
    if (!readyRef.current) return;
    setGroups(prev => {
      // Find the last dice group (not a flat modifier) with matching sides
      const lastIdx = prev.length - 1;
      if (lastIdx >= 0 && prev[lastIdx].sides === sides && !prev[lastIdx].modifier) {
        const updated = [...prev];
        updated[lastIdx] = { ...updated[lastIdx], qty: updated[lastIdx].qty + 1 };
        return updated;
      }
      return [...prev, { qty: 1, sides, modifier: null, flatMod: 0 }];
    });
  }, []);

  const addModifier = useCallback((type) => {
    setGroups(prev => {
      if (prev.length === 0) return prev;
      if (type === '+' || type === '-') {
        // Add/increment flat modifier
        const lastIdx = prev.length - 1;
        if (prev[lastIdx].sides === 0) {
          const updated = [...prev];
          const delta = type === '+' ? 1 : -1;
          updated[lastIdx] = { ...updated[lastIdx], flatMod: updated[lastIdx].flatMod + delta };
          // Remove if zero
          if (updated[lastIdx].flatMod === 0) updated.pop();
          return updated;
        }
        return [...prev, { qty: 0, sides: 0, modifier: null, flatMod: type === '+' ? 1 : -1 }];
      }
      // kh1, kl1, dl1 — apply to last dice group
      const lastDiceIdx = [...prev].reverse().findIndex(g => g.sides > 0);
      if (lastDiceIdx === -1) return prev;
      const idx = prev.length - 1 - lastDiceIdx;
      const updated = [...prev];
      const current = updated[idx].modifier;
      // Toggle off if same modifier
      updated[idx] = { ...updated[idx], modifier: current === type ? null : type };
      return updated;
    });
  }, []);

  const clearAll = useCallback(() => setGroups([]), []);

  const handleRoll = useCallback(() => {
    const notation = buildNotationString(groups);
    if (notation && onRoll) onRoll(notation);
  }, [groups, onRoll]);

  const notation = buildNotationString(groups);
  const lastDiceGroup = [...groups].reverse().find(g => g.sides > 0);
  const activeModifier = lastDiceGroup?.modifier || null;

  return (
    <div className="dice-panel">
      {/* Header */}
      <div className="dice-panel-header">
        <button className="dice-panel-back" type="button" onClick={onBack}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="dice-panel-title">Dice Roller</span>
        <button
          className="dice-panel-roll-btn"
          type="button"
          disabled={!notation}
          onClick={handleRoll}
        >
          Roll
        </button>
      </div>

      {/* Notation display */}
      <div className="dice-notation-bar">
        <span className="dice-notation-text">{notation || 'Tap dice to build a roll'}</span>
        {notation && (
          <button className="dice-notation-clear" type="button" onClick={clearAll}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Dice grid */}
      <div className="dice-grid">
        {DICE_TYPES.map(d => (
          <button
            key={d.sides}
            className="dice-btn"
            type="button"
            onClick={() => addDie(d.sides)}
          >
            <span className="dice-btn-label">{d.label}</span>
          </button>
        ))}
      </div>

      {/* Modifier row */}
      <div className="dice-modifiers">
        <button
          className="dice-mod-btn"
          type="button"
          onClick={() => addModifier('+')}
        >
          +1
        </button>
        <button
          className="dice-mod-btn"
          type="button"
          onClick={() => addModifier('-')}
        >
          -1
        </button>
        <button
          className={`dice-mod-btn${activeModifier === 'kh1' ? ' dice-mod-active' : ''}`}
          type="button"
          onClick={() => addModifier('kh1')}
          disabled={!lastDiceGroup}
        >
          ADV
        </button>
        <button
          className={`dice-mod-btn${activeModifier === 'kl1' ? ' dice-mod-active' : ''}`}
          type="button"
          onClick={() => addModifier('kl1')}
          disabled={!lastDiceGroup}
        >
          DIS
        </button>
        <button
          className={`dice-mod-btn${activeModifier === 'dl1' ? ' dice-mod-active' : ''}`}
          type="button"
          onClick={() => addModifier('dl1')}
          disabled={!lastDiceGroup}
        >
          Drop Low
        </button>
      </div>
    </div>
  );
}

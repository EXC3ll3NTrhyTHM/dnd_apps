import { useState, useEffect, useMemo } from 'react';
import { api } from '../hooks/useApi';
import '../styles/dm-roll-control.css';

/**
 * Parse dice notation like "2d6", "1d20" into { count, sides }.
 */
function parseNotation(notation) {
  const match = (notation || '').match(/(\d+)d(\d+)/i);
  if (!match) return [{ sides: 20 }];
  const count = parseInt(match[1], 10);
  const sides = parseInt(match[2], 10);
  return Array.from({ length: count }, () => ({ sides }));
}

export default function DmRollControl({ encounterId, enabled, pendingRoll, onToggle, onResolve }) {
  const [collapsed, setCollapsed] = useState(false);
  const [diceValues, setDiceValues] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  // Parse the pending roll's notation into dice config
  const diceConfig = useMemo(() => {
    if (!pendingRoll) return [];
    return parseNotation(pendingRoll.notation);
  }, [pendingRoll?.notation]);

  // Reset dice values when a new pending roll arrives
  useEffect(() => {
    if (diceConfig.length > 0) {
      setDiceValues(diceConfig.map(() => ''));
      setSubmitting(false);
    }
  }, [pendingRoll?.id]);

  const modifier = pendingRoll?.modifier || 0;
  const allFilled = diceValues.length > 0 && diceValues.every(v => v !== '' && !isNaN(v));
  const parsedValues = diceValues.map(v => parseInt(v, 10) || 0);
  const diceTotal = parsedValues.reduce((s, v) => s + v, 0);
  const grandTotal = diceTotal + modifier;

  function setDie(index, value) {
    setDiceValues(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function setAllMax() {
    setDiceValues(diceConfig.map(d => String(d.sides)));
  }

  function setAllMin() {
    setDiceValues(diceConfig.map(() => '1'));
  }

  async function handleLetFateDecide() {
    if (submitting) return;
    setSubmitting(true);
    // Generate random values and submit immediately
    const randomRolls = diceConfig.map(d => Math.floor(Math.random() * d.sides) + 1);
    setDiceValues(randomRolls.map(String));
    await onResolve(randomRolls);
  }

  async function handleWeaveFate() {
    if (!allFilled || submitting) return;
    setSubmitting(true);
    await onResolve(parsedValues);
  }

  if (collapsed) {
    return (
      <button
        className="dm-roll-collapsed-btn"
        onClick={() => setCollapsed(false)}
        title="Open Fate's Hand"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="3" />
          <line x1="12" y1="2" x2="12" y2="6" />
          <line x1="12" y1="18" x2="12" y2="22" />
          <line x1="2" y1="12" x2="6" y2="12" />
          <line x1="18" y1="12" x2="22" y2="12" />
        </svg>
      </button>
    );
  }

  return (
    <div className="dm-roll-panel">
      <div className="dm-roll-header">
        <span className="dm-roll-title">Fate's Hand</span>
        <div className="dm-roll-header-actions">
          <label className="dm-roll-toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onToggle(e.target.checked)}
            />
            <span className="dm-roll-toggle-slider" />
          </label>
          <button className="dm-roll-collapse-btn" onClick={() => setCollapsed(true)} title="Minimize">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      {!enabled && (
        <div className="dm-roll-disabled-hint">Toggle on to intercept dice rolls</div>
      )}

      {enabled && !pendingRoll && (
        <div className="dm-roll-waiting">Waiting for a roll...</div>
      )}

      {enabled && pendingRoll && (
        <div className="dm-roll-card">
          <div className="dm-roll-context">
            <span className="dm-roll-player">{pendingRoll.requesterName}'s</span>
            <span className="dm-roll-label">{pendingRoll.label || 'Roll'}</span>
          </div>

          <div className="dm-roll-notation">{pendingRoll.notation}</div>

          <div className="dm-roll-dice-inputs">
            {diceConfig.map((die, i) => (
              <div key={i} className="dm-roll-die-input">
                <label>d{die.sides}</label>
                <input
                  type="number"
                  min={1}
                  max={die.sides}
                  value={diceValues[i] || ''}
                  onChange={(e) => setDie(i, e.target.value)}
                  placeholder={`1-${die.sides}`}
                />
              </div>
            ))}
          </div>

          {modifier !== 0 && (
            <div className="dm-roll-modifier">
              Modifier: <strong>{modifier >= 0 ? `+${modifier}` : modifier}</strong>
            </div>
          )}

          {allFilled && (
            <div className="dm-roll-total">
              Total: <strong>{grandTotal}</strong>
              <span className="dm-roll-total-breakdown">
                ({parsedValues.join(' + ')}{modifier !== 0 ? ` ${modifier >= 0 ? '+' : ''}${modifier}` : ''})
              </span>
            </div>
          )}

          <div className="dm-roll-quick-actions">
            <button className="dm-roll-quick-btn dm-roll-quick-max" onClick={setAllMax}>
              {diceConfig.length === 1 && diceConfig[0].sides === 20 ? 'Nat 20' : 'Max'}
            </button>
            <button className="dm-roll-quick-btn dm-roll-quick-min" onClick={setAllMin}>
              {diceConfig.length === 1 && diceConfig[0].sides === 20 ? 'Nat 1' : 'Min'}
            </button>
            <button
              className="dm-roll-quick-btn dm-roll-quick-random"
              onClick={handleLetFateDecide}
              disabled={submitting}
            >
              Let Fate Decide
            </button>
          </div>

          <button
            className="dm-roll-confirm-btn"
            onClick={handleWeaveFate}
            disabled={!allFilled || submitting}
          >
            {submitting ? 'Weaving...' : 'Weave Fate'}
          </button>
        </div>
      )}
    </div>
  );
}

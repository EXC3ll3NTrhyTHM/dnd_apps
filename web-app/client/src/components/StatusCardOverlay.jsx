/**
 * StatusCardOverlay — tap a player or monster row to see detailed status.
 * Shows avatar, health bar, and all active conditions with descriptions + durations.
 */

import '../styles/status-card.css';

const CONCENTRATION_SPELL_NAMES = {
  hunters_mark: "Hunter's Mark",
  ensnaring_strike: 'Ensnaring Strike',
  bless: 'Bless',
};

/**
 * Build a unified list of display conditions from real conditions[] + virtual boolean flags.
 */
function buildDisplayConditions(participant, isEnemy) {
  const conditions = [];

  // Summon: show turns remaining as a virtual condition
  if (participant.isSummon && participant.turnsLeft != null) {
    conditions.push({
      id: '_turnsLeft',
      icon: '\u23F3',
      name: 'Summoned',
      description: `${participant.turnsLeft} turn${participant.turnsLeft !== 1 ? 's' : ''} remaining.`,
      durationText: 'Until: Duration expires',
    });
  }

  // Real conditions from the server
  for (const c of (participant.conditions || [])) {
    let durationText = '';
    if (c.durationType === 'rounds') {
      durationText = `${c.duration} round${c.duration !== 1 ? 's' : ''} remaining`;
    } else if (c.durationType === 'end_of_next_turn') {
      durationText = 'Until: End of next turn';
    } else if (c.durationType === 'save_end') {
      const parts = ['Until: Saved'];
      if (c.saveDC && c.saveAbility) parts[0] = `Until: Saved (DC ${c.saveDC} ${c.saveAbility})`;
      durationText = parts[0];
    } else if (c.durationType === 'action_escape') {
      const parts = ['Until: Escaped'];
      if (c.saveDC && c.saveAbility) parts[0] = `Until: Escaped (DC ${c.saveDC} ${c.saveAbility})`;
      durationText = parts[0];
    }
    conditions.push({
      id: c.id,
      icon: c.icon,
      name: c.name,
      description: c.description,
      durationText,
    });
  }

  // Virtual conditions from boolean flags
  if (participant.knockedOut) {
    conditions.push({
      id: '_knockedOut',
      icon: '\uD83D\uDC80',
      name: 'Knocked Out',
      description: 'Unconscious and making death saves.',
      durationText: 'Until: Stabilized or healed',
    });
  }

  if (participant.dodging && !participant.knockedOut) {
    conditions.push({
      id: '_dodging',
      icon: '\uD83D\uDEE1\uFE0F',
      name: 'Dodging',
      description: 'Attacks against you have disadvantage.',
      durationText: 'Until: Start of next turn',
    });
  }

  if (participant.advantageOnNextAttack && !participant.knockedOut) {
    conditions.push({
      id: '_advantage',
      icon: '\u2694\uFE0F',
      name: 'Advantage',
      description: 'Next attack roll has advantage.',
      durationText: 'Until: Used or turn ends',
    });
  }

  if (participant.inspirationDie && !participant.knockedOut) {
    conditions.push({
      id: '_inspiration',
      icon: '\uD83C\uDFB5',
      name: 'Bardic Inspiration',
      description: `Adds ${participant.inspirationDie} to next roll.`,
      durationText: 'Until: Used',
    });
  }

  if (participant.huntersMarkActive && !isEnemy) {
    conditions.push({
      id: '_huntersMark',
      icon: '\uD83C\uDFAF',
      name: "Hunter's Mark",
      description: 'Taking bonus damage on hits.',
      durationText: 'Until: Concentration broken',
    });
  }

  if (participant.spiritualWeaponActive) {
    conditions.push({
      id: '_spiritualWeapon',
      icon: '\u2728',
      name: 'Spiritual Weapon',
      description: 'Spectral weapon entity with own initiative turn.',
      durationText: 'Active (own turn)',
    });
  }

  if (participant.raging && !participant.knockedOut) {
    conditions.push({
      id: '_raging',
      icon: '\uD83D\uDD25',
      name: 'Raging',
      description: 'Bonus melee damage, resistance to physical.',
      durationText: 'Until: Rage ends',
    });
  }

  if (participant.concentration && !participant.knockedOut) {
    const spellId = participant.concentration.spellId || participant.concentration;
    const spellName = CONCENTRATION_SPELL_NAMES[spellId] || spellId;
    conditions.push({
      id: '_concentration',
      icon: '\uD83D\uDD2E',
      name: 'Concentrating',
      description: `Maintaining ${spellName}.`,
      durationText: 'Until: Broken',
    });
  }

  // Monster-only: guiding bolt mark
  if (isEnemy && participant.guidingBoltAdvantage) {
    conditions.push({
      id: '_guidingBolt',
      icon: '\u2728',
      name: 'Guiding Bolt Mark',
      description: 'Glowing — next attack has advantage.',
      durationText: 'Until: Hit',
    });
  }

  return conditions;
}

export default function StatusCardOverlay({ participant, isEnemy, onClose }) {
  if (!participant) return null;

  const name = participant.name || 'Unknown';
  const currentHp = participant.currentHp ?? 0;
  const maxHp = participant.maxHp ?? 1;
  const hpPct = Math.max(0, Math.round((currentHp / maxHp) * 100));
  const hpColor = participant.knockedOut ? '#ef4444' : hpPct > 60 ? '#4ade80' : hpPct > 30 ? '#fbbf24' : '#ef4444';
  const avatar = isEnemy && participant.image
    ? `/monsters/${participant.image}`
    : participant.avatar || null;
  const isSummon = participant.isSummon;

  const displayConditions = buildDisplayConditions(participant, isEnemy);

  return (
    <div className="status-card-backdrop" onClick={onClose}>
      <div
        className={`status-card ${isEnemy ? 'status-card-enemy' : 'status-card-player'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="status-card-header">
          {avatar ? (
            <img src={avatar} alt={name} className="status-card-avatar" onError={(e) => { e.target.src = '/images/default-avatar.png'; }} />
          ) : (
            <div className="status-card-avatar-fallback">{isSummon ? '\u2694\uFE0F' : name[0]}</div>
          )}
          <div className="status-card-name">{name}</div>
        </div>

        <div className="status-card-divider" />

        {/* Health */}
        <div className="status-card-health">
          <div className="status-card-health-label">Health</div>
          <div className="status-card-hp-bar">
            <div className="status-card-hp-fill" style={{ width: `${hpPct}%`, backgroundColor: hpColor }} />
          </div>
          <div className="status-card-hp-text">{currentHp} / {maxHp}</div>
          {participant.ac != null && <div className="status-card-ac-text">AC {participant.ac}</div>}
        </div>

        <div className="status-card-divider" />

        {/* Conditions */}
        <div className="status-card-section-label">Conditions</div>
        {displayConditions.length > 0 ? (
          <div className="status-card-conditions">
            {displayConditions.map((c) => (
              <div key={c.id} className="status-card-pill">
                <div className="status-card-pill-header">
                  <span className="status-card-pill-icon">{c.icon}</span>
                  <span className="status-card-pill-name">{c.name}</span>
                </div>
                {c.description && <div className="status-card-pill-desc">{c.description}</div>}
                {c.durationText && <div className="status-card-pill-duration">{c.durationText}</div>}
              </div>
            ))}
          </div>
        ) : (
          <div className="status-card-no-conditions">No active conditions</div>
        )}

        <button className="status-card-close" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

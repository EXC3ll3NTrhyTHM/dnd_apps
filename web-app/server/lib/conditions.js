/**
 * Conditions & Status Effects System
 *
 * Data-driven condition registry with helpers for adding, removing,
 * ticking durations, and computing attack/defense modifiers.
 */

const { rollDamage } = require('./weapons');

// ============================================
// CONDITION DEFINITIONS
// ============================================

const CONDITIONS = {
  stunned: {
    name: 'Stunned',
    icon: '\u{1F4AB}',
    description: 'Cannot take actions. Attacks against have advantage.',
    attackModifier: null,
    defenseModifier: 'advantage_against',
    canAct: false,
  },
  frightened: {
    name: 'Frightened',
    icon: '\u{1F628}',
    description: 'Disadvantage on attack rolls.',
    attackModifier: 'disadvantage',
    defenseModifier: null,
    canAct: true,
  },
  poisoned: {
    name: 'Poisoned',
    icon: '\u{2620}\u{FE0F}',
    description: 'Disadvantage on attack rolls.',
    attackModifier: 'disadvantage',
    defenseModifier: null,
    canAct: true,
  },
  burning: {
    name: 'Burning',
    icon: '\u{1F525}',
    description: 'Takes fire damage at the start of each turn.',
    attackModifier: null,
    defenseModifier: null,
    canAct: true,
    dot: { dice: '1d4', type: 'fire' },
  },
  blinded: {
    name: 'Blinded',
    icon: '\u{1F648}',
    description: 'Disadvantage on attacks. Attacks against have advantage.',
    attackModifier: 'disadvantage',
    defenseModifier: 'advantage_against',
    canAct: true,
  },
  restrained: {
    name: 'Restrained',
    icon: '\u{26D3}\u{FE0F}',
    description: 'Disadvantage on attacks. Attacks against have advantage.',
    attackModifier: 'disadvantage',
    defenseModifier: 'advantage_against',
    canAct: true,
  },
  mockery: {
    name: 'Mocked',
    icon: '\u{1F3AD}',
    description: 'Disadvantage on next attack (Vicious Mockery).',
    attackModifier: 'disadvantage',
    defenseModifier: null,
    canAct: true,
  },
};

// ============================================
// HELPERS
// ============================================

/**
 * Add a condition to a participant. No stacking — refreshes duration if already present.
 * @param {object} participant - player or monster object
 * @param {string} conditionId - key from CONDITIONS
 * @param {object} opts
 * @param {number} opts.duration - number of rounds/turns
 * @param {string} opts.durationType - 'rounds' | 'end_of_next_turn' | 'save_end'
 * @param {string} opts.source - name of the source (caster, monster, etc.)
 */
function addCondition(participant, conditionId, { duration = 1, durationType = 'rounds', source = '' } = {}) {
  const def = CONDITIONS[conditionId];
  if (!def) return;

  if (!participant.conditions) participant.conditions = [];

  // Remove existing instance (refresh, don't stack)
  participant.conditions = participant.conditions.filter(c => c.id !== conditionId);

  participant.conditions.push({
    id: conditionId,
    name: def.name,
    icon: def.icon,
    description: def.description,
    duration,
    durationType,
    source,
  });
}

/**
 * Remove a specific condition from a participant.
 */
function removeCondition(participant, conditionId) {
  if (!participant.conditions) return;
  participant.conditions = participant.conditions.filter(c => c.id !== conditionId);
}

/**
 * Check if a participant has a specific condition.
 */
function hasCondition(participant, conditionId) {
  return (participant.conditions || []).some(c => c.id === conditionId);
}

/**
 * Get attack modifiers from active conditions.
 * Returns { hasDisadvantage } — advantage from conditions is uncommon for attackers.
 */
function getAttackModifiers(participant) {
  let hasDisadvantage = false;

  for (const c of (participant.conditions || [])) {
    const def = CONDITIONS[c.id];
    if (!def) continue;
    if (def.attackModifier === 'disadvantage') {
      hasDisadvantage = true;
    }
  }

  return { hasDisadvantage };
}

/**
 * Get defense modifiers — how this participant's conditions affect attackers targeting them.
 * Returns { attackersHaveAdvantage, attackersHaveDisadvantage }.
 */
function getDefenseModifiers(participant) {
  let attackersHaveAdvantage = false;
  let attackersHaveDisadvantage = false;

  for (const c of (participant.conditions || [])) {
    const def = CONDITIONS[c.id];
    if (!def) continue;
    if (def.defenseModifier === 'advantage_against') {
      attackersHaveAdvantage = true;
    } else if (def.defenseModifier === 'disadvantage_against') {
      attackersHaveDisadvantage = true;
    }
  }

  return { attackersHaveAdvantage, attackersHaveDisadvantage };
}

/**
 * Check if this participant can take actions (false if stunned, etc.).
 */
function canAct(participant) {
  for (const c of (participant.conditions || [])) {
    const def = CONDITIONS[c.id];
    if (def && def.canAct === false) return false;
  }
  return true;
}

/**
 * Tick conditions at the start of a participant's turn.
 * Decrements round-based durations, removes expired ones, applies DoT damage.
 * Returns { removed: [{ id, name }], dotEffects: [{ id, name, damage, type }] }
 */
function tickConditions(participant) {
  if (!participant.conditions || participant.conditions.length === 0) {
    return { removed: [], dotEffects: [] };
  }

  const removed = [];
  const dotEffects = [];

  // Apply DoT damage first (before removing expired conditions)
  for (const c of participant.conditions) {
    const def = CONDITIONS[c.id];
    if (def && def.dot) {
      const result = rollDamage(def.dot.dice);
      dotEffects.push({
        id: c.id,
        name: def.name,
        damage: result.total,
        type: def.dot.type,
      });
      // Apply damage
      if (typeof participant.currentHp === 'number') {
        participant.currentHp -= result.total;
        if (participant.currentHp < 0) participant.currentHp = 0;
      }
    }
  }

  // Decrement durations and remove expired
  participant.conditions = participant.conditions.filter(c => {
    if (c.durationType === 'rounds') {
      c.duration--;
      if (c.duration <= 0) {
        removed.push({ id: c.id, name: c.name });
        return false;
      }
    }
    // 'end_of_next_turn' and 'save_end' handled elsewhere
    return true;
  });

  return { removed, dotEffects };
}

/**
 * Get conditions for public state (sent to client).
 */
function getConditionsPublic(participant) {
  return (participant.conditions || []).map(c => ({
    id: c.id,
    name: c.name,
    icon: c.icon,
    description: c.description,
    duration: c.duration,
    source: c.source,
  }));
}

module.exports = {
  CONDITIONS,
  addCondition,
  removeCondition,
  hasCondition,
  getAttackModifiers,
  getDefenseModifiers,
  canAct,
  tickConditions,
  getConditionsPublic,
};

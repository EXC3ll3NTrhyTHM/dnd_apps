/**
 * Conditions & Status Effects System
 *
 * Data-driven condition registry with helpers for adding, removing,
 * ticking durations, and computing attack/defense modifiers.
 */

const { rollDamage, rollD20 } = require('./weapons');

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
  ensnared: {
    name: 'Ensnared',
    icon: '\u{1FAB4}',
    description: 'Restrained by thorny vines. Takes 1d6 piercing per turn.',
    attackModifier: 'disadvantage',
    defenseModifier: 'advantage_against',
    canAct: true,
    dot: { dice: '1d6', type: 'piercing' },
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
function addCondition(participant, conditionId, { duration = 1, durationType = 'rounds', source = '', saveAbility = null, saveDC = null, saveBonus = null } = {}) {
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
    saveAbility,
    saveDC,
    saveBonus,
  });
  if (conditionId === 'ensnared' || conditionId === 'restrained') {
    console.log('[ES_DEBUG] addCondition:', conditionId, 'durationType:', durationType, 'saveDC:', saveDC, 'saveBonus:', saveBonus,
      'conditions now:', participant.conditions.map(c => `${c.id}(${c.durationType})`).join(', '));
  }
}

/**
 * Remove a specific condition from a participant.
 */
function removeCondition(participant, conditionId) {
  if (!participant.conditions) return;
  const had = participant.conditions.some(c => c.id === conditionId);
  participant.conditions = participant.conditions.filter(c => c.id !== conditionId);
  if (had) {
    const caller = new Error().stack.split('\n')[2]?.trim() || 'unknown';
    console.log('[ES_DEBUG] removeCondition:', conditionId, 'caller:', caller,
      'remaining:', participant.conditions.map(c => c.id).join(', ') || 'none');
  }
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
 * Check if a participant has any DoT conditions pending (for requesting client rolls).
 * Returns array of { conditionId, name, dice, type } for conditions with DoT effects.
 */
function getPendingDots(participant) {
  if (!participant.conditions || participant.conditions.length === 0) return [];
  const dots = [];
  for (const c of participant.conditions) {
    const def = CONDITIONS[c.id];
    if (def && def.dot) {
      dots.push({ conditionId: c.id, name: def.name, dice: def.dot.dice, type: def.dot.type });
    }
  }
  return dots;
}

/**
 * Apply only DoT damage from conditions (no expiry/removal).
 * Used to check if DoT kills a target before processing further actions.
 * @param {object} participant
 * @param {object} [clientDotRolls] - Optional map of conditionId → damage total (from client dice)
 * Returns { dotEffects: [{ id, name, damage, type }] }
 */
function applyDotDamage(participant, clientDotRolls) {
  if (!participant.conditions || participant.conditions.length === 0) {
    return { dotEffects: [] };
  }
  const dotEffects = [];
  for (const c of participant.conditions) {
    const def = CONDITIONS[c.id];
    if (def && def.dot) {
      const damage = (clientDotRolls && typeof clientDotRolls[c.id] === 'number')
        ? clientDotRolls[c.id]
        : rollDamage(def.dot.dice).total;
      dotEffects.push({ id: c.id, name: def.name, damage, type: def.dot.type });
      if (typeof participant.currentHp === 'number') {
        participant.currentHp -= damage;
        if (participant.currentHp < 0) participant.currentHp = 0;
      }
    }
  }
  return { dotEffects };
}

/**
 * Tick conditions at the start of a participant's turn.
 * Decrements round-based durations, removes expired ones, applies DoT damage.
 * @param {object} participant
 * @param {object} [clientDotRolls] - Optional map of conditionId → damage total (from client dice)
 * @param {object} [opts]
 * @param {boolean} [opts.skipDot] - Skip DoT damage (already applied separately)
 * Returns { removed: [{ id, name }], dotEffects: [{ id, name, damage, type }] }
 */
function tickConditions(participant, clientDotRolls, { skipDot = false } = {}) {
  if (!participant.conditions || participant.conditions.length === 0) {
    return { removed: [], dotEffects: [] };
  }
  const hadEnsnared = participant.conditions.some(c => c.id === 'ensnared');
  if (hadEnsnared) {
    const caller = new Error().stack.split('\n')[2]?.trim() || 'unknown';
    console.log('[ES_DEBUG] tickConditions ENTRY — has ensnared, caller:', caller,
      'all conditions:', participant.conditions.map(c => `${c.id}(${c.durationType}, dur:${c.duration})`).join(', '));
  }

  const removed = [];
  const dotEffects = [];

  // Apply DoT damage first (before removing expired conditions)
  if (!skipDot) {
    for (const c of participant.conditions) {
      const def = CONDITIONS[c.id];
      if (def && def.dot) {
        // Use client-provided roll if available, otherwise roll server-side
        const damage = (clientDotRolls && typeof clientDotRolls[c.id] === 'number')
          ? clientDotRolls[c.id]
          : rollDamage(def.dot.dice).total;
        dotEffects.push({
          id: c.id,
          name: def.name,
          damage,
          type: def.dot.type,
        });
        // Apply damage
        if (typeof participant.currentHp === 'number') {
          participant.currentHp -= damage;
          if (participant.currentHp < 0) participant.currentHp = 0;
        }
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

  if (hadEnsnared) {
    const stillHas = participant.conditions.some(c => c.id === 'ensnared');
    console.log('[ES_DEBUG] tickConditions EXIT — ensnared survived:', stillHas,
      'removed:', removed.map(r => r.id).join(', ') || 'none');
  }
  return { removed, dotEffects };
}

/**
 * Resolve end-of-turn saves for 'save_end' conditions (e.g. Nature's Wrath, Ensnaring Strike).
 * Called at the end of the monster's turn to let it attempt to break free.
 * Returns { savedConditions: [{ id, name, saveAbility, roll, saveBonus, total, saveDC, saved }] }
 */
function resolveEndOfTurnSaves(participant) {
  if (!participant.conditions || participant.conditions.length === 0) {
    return { savedConditions: [] };
  }
  const hadEnsnared = participant.conditions.some(c => c.id === 'ensnared');
  if (hadEnsnared) {
    console.log('[ES_DEBUG] resolveEndOfTurnSaves ENTRY — save_end conditions:',
      participant.conditions.filter(c => c.durationType === 'save_end').map(c => `${c.id}(DC:${c.saveDC}, bonus:${c.saveBonus})`).join(', '));
  }

  const savedConditions = [];

  participant.conditions = participant.conditions.filter(c => {
    if (c.durationType !== 'save_end' || !c.saveAbility || !c.saveDC) return true;

    const saveBonus = c.saveBonus ?? ((participant.savingThrows && participant.savingThrows[c.saveAbility]) || 0);
    const roll = rollD20();
    const total = roll + saveBonus;
    const saved = total >= c.saveDC;
    console.log('[ES_DEBUG] resolveEndOfTurnSaves:', c.id, 'roll:', roll, 'bonus:', saveBonus, 'total:', total, 'DC:', c.saveDC, 'saved:', saved);

    savedConditions.push({
      id: c.id,
      name: c.name,
      saveAbility: c.saveAbility,
      roll,
      saveBonus,
      total,
      saveDC: c.saveDC,
      saved,
    });

    return !saved; // keep if failed save
  });

  return { savedConditions };
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
    durationType: c.durationType || 'rounds',
    source: c.source,
    saveAbility: c.saveAbility || null,
    saveDC: c.saveDC || null,
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
  applyDotDamage,
  tickConditions,
  resolveEndOfTurnSaves,
  getConditionsPublic,
  getPendingDots,
};

/**
 * Encounter State Manager
 *
 * In-memory state for active combat encounters.
 * Handles round flow, action resolution, monster turns, rewards.
 * Encounters are ephemeral — not persisted to disk.
 */

const crypto = require('crypto');
const { getMonster } = require('./monsters');
const { getCharacterSheet } = require('./characterSheets');
const { getAllWeapons, rollD20, rollDamage } = require('./weapons');
const { awardQuestXp, incrementLifetimeStat, getLevel } = require('./xp');
const { awardGold } = require('./economy');
const { addCondition, removeCondition, hasCondition, getAttackModifiers, getDefenseModifiers, canAct, tickConditions, getConditionsPublic } = require('./conditions');

// ============================================
// SPELL DEFINITIONS (data-driven)
// ============================================

const SPELL_DEFINITIONS = {
  vicious_mockery: {
    name: 'Vicious Mockery',
    level: 0, // cantrip
    actionType: 'action',
    effectType: 'save_damage',
    saveAbility: 'WIS',
    damageDice: '1d4',
    damageType: 'psychic',
    extraEffect: 'disadvantage_next_attack',
    description: 'A string of insults laced with subtle enchantments',
    classes: ['Bard'],
  },
  healing_word: {
    name: 'Healing Word',
    level: 1,
    actionType: 'bonus',
    effectType: 'heal',
    healDice: '1d4',
    range: 'ally',
    description: 'A soothing word of healing carried on the wind',
    classes: ['Bard', 'Cleric'],
  },
  thunderwave: {
    name: 'Thunderwave',
    level: 1,
    actionType: 'action',
    effectType: 'save_damage',
    saveAbility: 'CON',
    damageDice: '2d8',
    damageType: 'thunder',
    description: 'A wave of thunderous force sweeps out',
    classes: ['Bard'],
  },
};

// ============================================
// ACTIVE ENCOUNTERS (in-memory)
// ============================================

const activeEncounters = new Map(); // encounterId → encounter

const ROUND_TIMER_MS = 90_000; // 90 seconds per round (legacy, kept for reference)
const TURN_TIMER_MS = 90_000; // 90 seconds per individual turn
const TIMEOUT_MS = 300_000; // 5 minutes of inactivity kills the encounter

// ============================================
// ENCOUNTER CREATION
// ============================================

function spawnEncounter(locationId, monsterId, startedBy) {
  // Don't allow two encounters for the same monster simultaneously
  for (const [, enc] of activeEncounters) {
    if (enc.monster.id === monsterId && enc.phase !== 'ended') {
      return { error: `A ${enc.monster.name} encounter is already active.` };
    }
  }

  const monsterDef = getMonster(monsterId);
  if (!monsterDef) {
    return { error: `Unknown monster: ${monsterId}` };
  }

  const encounterId = 'enc_' + crypto.randomBytes(6).toString('hex');

  const encounter = {
    id: encounterId,
    locationId,
    monster: {
      id: monsterDef.id,
      name: monsterDef.name,
      description: monsterDef.description,
      image: monsterDef.image,
      sprite: monsterDef.sprite,
      spriteScale: monsterDef.spriteScale,
      spriteOffsetX: monsterDef.spriteOffsetX,
      spriteOffsetY: monsterDef.spriteOffsetY,
      ac: monsterDef.ac,
      maxHp: monsterDef.maxHp,
      currentHp: monsterDef.maxHp,
      attacks: monsterDef.attacks,
      multiattack: monsterDef.multiattack || 1,
      cr: monsterDef.cr,
      xpReward: monsterDef.xpReward,
      goldReward: monsterDef.goldReward,
      spawnText: monsterDef.spawnText,
      deathText: monsterDef.deathText,
      fleeText: monsterDef.fleeText,
      attackTexts: monsterDef.attackTexts || [],
      missTexts: monsterDef.missTexts || [],
      initiativeBonus: monsterDef.initiativeBonus || 0,
      creatureType: monsterDef.creatureType || 'beast',
      savingThrows: monsterDef.savingThrows || {},
      disadvantageOnNextAttack: false,
      conditions: [],
    },
    round: 1,
    phase: 'initiative_rolling', // 'initiative_rolling' | 'action' | 'resolving' | 'monster_rolling' | 'monster_turn' | 'ended'
    participants: {},
    // Initiative tracking
    initiativeOrder: [],
    currentTurnIndex: 0,
    turnDeadline: null,
    initiativeRolls: {},
    // Legacy (kept for compatibility)
    actionDeadline: null,
    lastActivity: Date.now(),
    startedBy,
    startedAt: new Date().toISOString(),
    log: [],
  };

  activeEncounters.set(encounterId, encounter);

  return { encounter };
}

// ============================================
// PLAYER JOIN
// ============================================

function findPlayerEncounter(userId) {
  for (const [, enc] of activeEncounters) {
    if (enc.phase === 'ended') continue;
    const p = enc.participants[userId];
    // Player is still in the fight if not fully knocked out (dying/stabilized = still in)
    if (p && !p.knockedOut) return enc;
  }
  return null;
}

function joinEncounter(encounterId, userId, username, avatar, sprite) {
  const encounter = activeEncounters.get(encounterId);
  if (!encounter) return { error: 'Encounter not found.' };
  if (encounter.phase === 'ended') return { error: 'This encounter has ended.' };
  if (encounter.participants[userId]) return { error: 'Already in this encounter.' };

  // Prevent joining multiple encounters at once
  const existing = findPlayerEncounter(userId);
  if (existing && existing.id !== encounterId) {
    return { error: 'You are already fighting another monster.' };
  }

  // Load combat stats from character sheet
  const sheet = getCharacterSheet(userId);
  let combatStats;

  if (sheet) {
    const dexStat = sheet.stats.find(s => s.abbr === 'DEX');
    const dexMod = dexStat ? dexStat.modifier : 0;

    const allWeapons = getAllWeapons(sheet.equipment, sheet);
    const weapon = allWeapons[0] || { name: 'Fists', dice: '1d4', type: 'bludgeoning', attackBonus: 2, damageMod: 0 };

    combatStats = {
      name: username,
      avatar: avatar || null,
      sprite: sprite || null,
      maxHp: sheet.hp || 10,
      currentHp: sheet.hp || 10,
      ac: sheet.ac || 10,
      attackBonus: weapon.attackBonus,
      damageMod: weapon.damageMod,
      damageNotation: weapon.dice,
      weaponName: weapon.name,
      damageType: weapon.type,
      weapons: allWeapons,
      canOffhandAttack: allWeapons.filter(w => w.light && !w.ranged).length >= 2,
      dexMod,
      action: null,
      totalDamage: 0,
      knockedOut: false,
      // 5e: Advantage/Disadvantage & Dodge
      dodging: false,
      advantageOnNextAttack: false,
      // 5e: Bonus Action
      bonusActionUsed: false,
      // 5e: Class Abilities
      spellSlots: (sheet.spellcasting?.slots || []).map(s => ({ ...s, used: 0 })),
      classNames: (sheet.classes || []).map(c => c.name),
      classFeatures: sheet.classFeatures || [],
      layOnHandsPool: sheet.classFeatures?.includes('Lay on Hands')
        ? (sheet.classes.find(c => c.name === 'Paladin')?.level || 0) * 5
        : 0,
      layOnHandsUsed: 0,
      // Bardic Inspiration (bard only)
      hasBardicInspiration: sheet.classFeatures?.includes('Bardic Inspiration') || false,
      bardicInspirationUses: 0,
      bardicInspirationMax: (() => {
        if (!sheet.classFeatures?.includes('Bardic Inspiration')) return 0;
        const cha = sheet.stats?.find(s => s.abbr === 'CHA');
        return Math.max(1, cha?.modifier || 0);
      })(),
      bardicInspirationDie: (() => {
        const bardLvl = sheet.classes?.find(c => c.name === 'Bard')?.level || 0;
        return bardLvl >= 15 ? 'd12' : bardLvl >= 10 ? 'd10' : bardLvl >= 5 ? 'd8' : 'd6';
      })(),
      // Received inspiration (on all participants)
      inspirationDie: null,
      inspiredBy: null,
      // Sneak Attack (Rogue)
      sneakAttackDice: (() => {
        const rogueLevel = sheet.classes?.find(c => c.name === 'Rogue')?.level || 0;
        return rogueLevel > 0 ? Math.ceil(rogueLevel / 2) : 0;
      })(),
      sneakAttackUsed: false,
      // Spellcasting stats
      spellSaveDC: sheet.spellcasting?.spellSaveDC || 0,
      spellAttackBonus: sheet.spellcasting?.spellAttackBonus || 0,
      spellcastingMod: sheet.spellcasting?.abilityModifier || 0,
      conditions: [],
    };
  } else {
    // Default stats for players without character sheets
    combatStats = {
      name: username,
      avatar: avatar || null,
      sprite: sprite || null,
      maxHp: 10,
      currentHp: 10,
      ac: 10,
      attackBonus: 2, // 0 mod + 2 prof
      damageMod: 0,
      damageNotation: '1d4',
      weaponName: 'Fists',
      damageType: 'bludgeoning',
      weapons: [{ id: 'fists', name: 'Fists', dice: '1d4', type: 'bludgeoning', finesse: false, ranged: false, attackBonus: 2, damageMod: 0 }],
      canOffhandAttack: false,
      dexMod: 0,
      action: null,
      totalDamage: 0,
      knockedOut: false,
      dodging: false,
      advantageOnNextAttack: false,
      bonusActionUsed: false,
      spellSlots: [],
      classNames: [],
      classFeatures: [],
      layOnHandsPool: 0,
      layOnHandsUsed: 0,
      hasBardicInspiration: false,
      bardicInspirationUses: 0,
      bardicInspirationMax: 0,
      bardicInspirationDie: 'd6',
      inspirationDie: null,
      inspiredBy: null,
      sneakAttackDice: 0,
      sneakAttackUsed: false,
      spellSaveDC: 0,
      spellAttackBonus: 0,
      spellcastingMod: 0,
      conditions: [],
    };
  }

  encounter.participants[userId] = combatStats;
  encounter.lastActivity = Date.now();

  // If joining mid-combat (initiative already finalized), player needs to roll initiative
  const needsInitiativeRoll = encounter.phase !== 'initiative_rolling' && encounter.initiativeOrder.length > 0;
  if (needsInitiativeRoll) {
    combatStats.needsInitiativeRoll = true;
  }

  return { encounter, combatStats, needsInitiativeRoll };
}

// Atomic join + initiative: player joins AND rolls initiative in one step
function joinWithInitiative(encounterId, userId, username, avatar, sprite, roll) {
  const encounter = activeEncounters.get(encounterId);
  if (!encounter) return { error: 'Encounter not found.' };
  if (encounter.phase === 'ended') return { error: 'This encounter has ended.' };
  if (encounter.participants[userId]) return { error: 'Already in this encounter.' };

  const existing = findPlayerEncounter(userId);
  if (existing && existing.id !== encounterId) {
    return { error: 'You are already fighting another monster.' };
  }

  // Load combat stats from character sheet (same as joinEncounter)
  const sheet = getCharacterSheet(userId);
  let combatStats;

  if (sheet) {
    const dexStat = sheet.stats.find(s => s.abbr === 'DEX');
    const dexMod = dexStat ? dexStat.modifier : 0;

    const allWeapons = getAllWeapons(sheet.equipment, sheet);
    const weapon = allWeapons[0] || { name: 'Fists', dice: '1d4', type: 'bludgeoning', attackBonus: 2, damageMod: 0 };

    combatStats = {
      name: username,
      avatar: avatar || null,
      sprite: sprite || null,
      maxHp: sheet.hp || 10,
      currentHp: sheet.hp || 10,
      ac: sheet.ac || 10,
      attackBonus: weapon.attackBonus,
      damageMod: weapon.damageMod,
      damageNotation: weapon.dice,
      weaponName: weapon.name,
      damageType: weapon.type,
      weapons: allWeapons,
      canOffhandAttack: allWeapons.filter(w => w.light && !w.ranged).length >= 2,
      dexMod,
      action: null,
      totalDamage: 0,
      knockedOut: false,
      dodging: false,
      advantageOnNextAttack: false,
      bonusActionUsed: false,
      spellSlots: (sheet.spellcasting?.slots || []).map(s => ({ ...s, used: 0 })),
      classNames: (sheet.classes || []).map(c => c.name),
      classFeatures: sheet.classFeatures || [],
      layOnHandsPool: sheet.classFeatures?.includes('Lay on Hands')
        ? (sheet.classes.find(c => c.name === 'Paladin')?.level || 0) * 5
        : 0,
      layOnHandsUsed: 0,
      // Bardic Inspiration (bard only)
      hasBardicInspiration: sheet.classFeatures?.includes('Bardic Inspiration') || false,
      bardicInspirationUses: 0,
      bardicInspirationMax: (() => {
        if (!sheet.classFeatures?.includes('Bardic Inspiration')) return 0;
        const cha = sheet.stats?.find(s => s.abbr === 'CHA');
        return Math.max(1, cha?.modifier || 0);
      })(),
      bardicInspirationDie: (() => {
        const bardLvl = sheet.classes?.find(c => c.name === 'Bard')?.level || 0;
        return bardLvl >= 15 ? 'd12' : bardLvl >= 10 ? 'd10' : bardLvl >= 5 ? 'd8' : 'd6';
      })(),
      inspirationDie: null,
      inspiredBy: null,
      // Sneak Attack (Rogue)
      sneakAttackDice: (() => {
        const rogueLevel = sheet.classes?.find(c => c.name === 'Rogue')?.level || 0;
        return rogueLevel > 0 ? Math.ceil(rogueLevel / 2) : 0;
      })(),
      sneakAttackUsed: false,
      // Spellcasting stats
      spellSaveDC: sheet.spellcasting?.spellSaveDC || 0,
      spellAttackBonus: sheet.spellcasting?.spellAttackBonus || 0,
      spellcastingMod: sheet.spellcasting?.abilityModifier || 0,
      conditions: [],
    };
  } else {
    combatStats = {
      name: username,
      avatar: avatar || null,
      sprite: sprite || null,
      maxHp: 10,
      currentHp: 10,
      ac: 10,
      attackBonus: 2,
      damageMod: 0,
      damageNotation: '1d4',
      weaponName: 'Fists',
      damageType: 'bludgeoning',
      dexMod: 0,
      action: null,
      totalDamage: 0,
      knockedOut: false,
      dodging: false,
      advantageOnNextAttack: false,
      bonusActionUsed: false,
      spellSlots: [],
      classNames: [],
      classFeatures: [],
      layOnHandsPool: 0,
      layOnHandsUsed: 0,
      hasBardicInspiration: false,
      bardicInspirationUses: 0,
      bardicInspirationMax: 0,
      bardicInspirationDie: 'd6',
      inspirationDie: null,
      inspiredBy: null,
      sneakAttackDice: 0,
      sneakAttackUsed: false,
      spellSaveDC: 0,
      spellAttackBonus: 0,
      spellcastingMod: 0,
      conditions: [],
    };
  }

  // Add to participants
  encounter.participants[userId] = combatStats;
  encounter.lastActivity = Date.now();

  // Record initiative roll atomically
  const dexMod = combatStats.dexMod || 0;
  const total = roll + dexMod;
  const initiativeResult = { roll, modifier: dexMod, total };

  if (encounter.phase === 'initiative_rolling') {
    // Normal initiative phase — store the roll
    encounter.initiativeRolls[userId] = initiativeResult;
    const allRolled = Object.keys(encounter.participants)
      .every(uid => encounter.initiativeRolls[uid]);
    return { encounter, combatStats, initiativeResult, allRolled };
  } else {
    // Mid-combat join — insert into initiative order sorted by total
    const entry = {
      id: userId, name: combatStats.name, type: 'player',
      roll, modifier: dexMod, total,
      avatar: combatStats.avatar,
    };
    let insertIdx = encounter.initiativeOrder.length;
    for (let i = 0; i < encounter.initiativeOrder.length; i++) {
      if (total > encounter.initiativeOrder[i].total) {
        insertIdx = i;
        break;
      }
    }
    encounter.initiativeOrder.splice(insertIdx, 0, entry);
    if (insertIdx <= encounter.currentTurnIndex) {
      encounter.currentTurnIndex++;
    }
    return { encounter, combatStats, initiativeResult, midCombatJoin: true };
  }
}

// ============================================
// PLAYER ACTIONS
// ============================================

function submitAction(encounterId, userId, action, rollData) {
  const encounter = activeEncounters.get(encounterId);
  if (!encounter) return { error: 'Encounter not found.' };
  if (encounter.phase !== 'action') return { error: 'Not in action phase.' };

  // Validate it's this player's turn
  const currentTurn = encounter.initiativeOrder[encounter.currentTurnIndex];
  if (!currentTurn || currentTurn.id !== userId || currentTurn.type !== 'player') {
    return { error: 'It is not your turn.' };
  }

  const player = encounter.participants[userId];
  if (!player) return { error: 'Not a participant in this encounter.' };
  if (player.knockedOut) return { error: 'You are knocked out!' };

  // Potion action
  if (action === 'potion') {
    const result = resolvePotionUse(encounter, userId, rollData?.potionId, rollData?.targetId, rollData?.healRoll);
    if (result.error) return result;
    encounter.lastActivity = Date.now();
    player.action = 'potion';
    return { encounter, result };
  }

  // Lay on Hands action
  if (action === 'lay_on_hands') {
    const healAmount = rollData?.healAmount;
    const targetId = rollData?.targetId || userId;

    if (typeof healAmount !== 'number' || healAmount < 1 || !Number.isInteger(healAmount)) {
      return { error: 'Invalid heal amount.' };
    }

    const remaining = (player.layOnHandsPool || 0) - (player.layOnHandsUsed || 0);
    if (healAmount > remaining) {
      return { error: `Only ${remaining} HP remaining in Lay on Hands pool.` };
    }

    const target = targetId === userId ? player : encounter.participants[targetId];
    if (!target) return { error: 'Target not found.' };

    // Consume from pool
    player.layOnHandsUsed += healAmount;

    // Apply healing (revive if knocked out)
    let revived = false;
    if (target.knockedOut) {
      target.knockedOut = false;
      target.currentHp = Math.min(target.maxHp, healAmount);
      revived = true;
    } else {
      target.currentHp = Math.min(target.maxHp, target.currentHp + healAmount);
    }

    player.action = 'lay_on_hands';
    encounter.lastActivity = Date.now();

    const targetName = targetId === userId ? player.name : target.name;
    const poolRemaining = player.layOnHandsPool - player.layOnHandsUsed;

    const result = {
      type: 'lay_on_hands',
      userId, name: player.name,
      targetId, targetName,
      healAmount, revived,
      poolRemaining,
      text: revived
        ? `**${player.name}** places a hand on **${targetName}**, channeling divine energy. ${targetName} regains consciousness with **${target.currentHp} HP!**`
        : `**${player.name}** channels divine healing into **${targetName}**, restoring **${healAmount} HP.** (${target.currentHp}/${target.maxHp})`,
    };

    return { encounter, result };
  }

  // Cast Spell (main action spells: vicious_mockery, thunderwave)
  if (action === 'cast_spell') {
    const result = resolveCastSpell(encounter, userId, rollData?.spellId, rollData);
    if (result.error) return result;
    player.action = 'cast_spell';
    encounter.lastActivity = Date.now();
    return { encounter, result };
  }

  if (!['attack', 'defend', 'flee', 'help'].includes(action)) {
    return { error: 'Invalid action. Choose attack, defend, flee, potion, help, lay_on_hands, or cast_spell.' };
  }

  player.action = action;

  // Store help target
  if (action === 'help' && rollData?.helpTargetId) {
    player.helpTargetId = rollData.helpTargetId;
  }

  // Store client-provided dice rolls (from 3D dice overlay)
  if (action === 'attack' && rollData) {
    if (typeof rollData.attackRoll === 'number') {
      player.attackRollValue = rollData.attackRoll;
    }
    if (typeof rollData.attackRoll2 === 'number') {
      player.attackRollValue2 = rollData.attackRoll2;
    }
    if (typeof rollData.damageTotal === 'number') {
      player.damageTotalValue = rollData.damageTotal;
    }
    // Divine Smite data (client decides to smite after hitting)
    if (rollData.smiteData) {
      player.smiteData = rollData.smiteData;
    }
    // Sneak Attack data (client auto-rolls when eligible)
    if (rollData.sneakAttackData) {
      player.sneakAttackData = rollData.sneakAttackData;
    }
    // Bardic Inspiration data (client decides to use after seeing roll)
    if (rollData.inspirationData) {
      player.inspirationData = rollData.inspirationData;
    }
    // Weapon selection — client sends weaponId to pick which weapon to use
    if (rollData.weaponId && player.weapons) {
      const chosen = player.weapons.find(w => w.id === rollData.weaponId);
      if (chosen) {
        player.attackBonus = chosen.attackBonus;
        player.damageMod = chosen.damageMod;
        player.damageNotation = chosen.dice;
        player.weaponName = chosen.name;
        player.damageType = chosen.type;
        player.mainActionWeaponId = chosen.id;
      }
    }
  }

  encounter.lastActivity = Date.now();

  // Resolve this player's action immediately (turn-based)
  const result = resolveSingleAction(encounter, userId);

  return { encounter, result };
}

function checkAllActed(encounter) {
  const activePlayers = Object.values(encounter.participants)
    .filter(p => !p.knockedOut);
  if (activePlayers.length === 0) return true;
  // All remaining active players have submitted an action (attack, defend, or flee)
  return activePlayers.every(p => p.action !== null);
}

// ============================================
// INITIATIVE SYSTEM
// ============================================

function submitInitiativeRoll(encounterId, userId, roll) {
  const encounter = activeEncounters.get(encounterId);
  if (!encounter) return { error: 'Encounter not found.' };

  const player = encounter.participants[userId];
  if (!player) return { error: 'Not a participant.' };

  // Mid-combat join: player needs to roll initiative to enter the order
  if (player.needsInitiativeRoll && encounter.phase !== 'initiative_rolling') {
    const dexMod = player.dexMod || 0;
    const total = roll + dexMod;

    delete player.needsInitiativeRoll;

    // Insert into initiative order sorted by total
    const entry = {
      id: userId, name: player.name, type: 'player',
      roll, modifier: dexMod, total,
      avatar: player.avatar,
    };

    // Find insertion point (sorted descending by total)
    let insertIdx = encounter.initiativeOrder.length;
    for (let i = 0; i < encounter.initiativeOrder.length; i++) {
      if (total > encounter.initiativeOrder[i].total) {
        insertIdx = i;
        break;
      }
    }
    encounter.initiativeOrder.splice(insertIdx, 0, entry);

    // Adjust currentTurnIndex if inserted before current turn
    if (insertIdx <= encounter.currentTurnIndex) {
      encounter.currentTurnIndex++;
    }

    encounter.lastActivity = Date.now();
    return { encounter, midCombatJoin: true, initiativeResult: { roll, modifier: dexMod, total } };
  }

  // Normal initiative rolling phase
  if (encounter.phase !== 'initiative_rolling') return { error: 'Not in initiative phase.' };
  if (encounter.initiativeRolls[userId]) return { error: 'Already rolled initiative.' };

  const dexMod = player.dexMod || 0;
  const total = roll + dexMod;

  encounter.initiativeRolls[userId] = { roll, modifier: dexMod, total };
  encounter.lastActivity = Date.now();

  // Check if all players have rolled
  const allRolled = Object.keys(encounter.participants)
    .every(uid => encounter.initiativeRolls[uid]);

  return { encounter, allRolled, initiativeResult: { roll, modifier: dexMod, total } };
}

function finalizeInitiativeOrder(encounter) {
  const order = [];

  // Add players
  for (const [userId, player] of Object.entries(encounter.participants)) {
    const initData = encounter.initiativeRolls[userId];
    if (initData) {
      order.push({
        id: userId, name: player.name, type: 'player',
        roll: initData.roll, modifier: initData.modifier, total: initData.total,
        avatar: player.avatar,
      });
    } else {
      // Player didn't roll in time — auto-roll
      const autoRoll = rollD20();
      const dexMod = player.dexMod || 0;
      const total = autoRoll + dexMod;
      order.push({
        id: userId, name: player.name, type: 'player',
        roll: autoRoll, modifier: dexMod, total,
        avatar: player.avatar,
      });
    }
  }

  // Add monster
  const monsterBonus = encounter.monster.initiativeBonus || 0;
  const monsterRoll = rollD20();
  const monsterTotal = monsterRoll + monsterBonus;
  order.push({
    id: 'monster', name: encounter.monster.name, type: 'monster',
    roll: monsterRoll, modifier: monsterBonus, total: monsterTotal,
    avatar: encounter.monster.image,
  });

  // Sort by total descending; ties broken by modifier, then random
  order.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    if (b.modifier !== a.modifier) return b.modifier - a.modifier;
    return Math.random() - 0.5;
  });

  encounter.initiativeOrder = order;
  encounter.currentTurnIndex = 0;
  encounter.phase = 'action';
  encounter.round = 1;
  encounter.turnDeadline = Date.now() + TURN_TIMER_MS;

  return order;
}

// ============================================
// TURN-BASED ACTION RESOLUTION
// ============================================

/**
 * Resolve a single player's action immediately (turn-based).
 * Returns the narration result for this action.
 */
function resolveSingleAction(encounter, userId) {
  const player = encounter.participants[userId];
  if (!player || !player.action) return null;

  const action = player.action;

  if (action === 'flee') {
    player.knockedOut = true;
    // Remove from initiative order
    const idx = encounter.initiativeOrder.findIndex(e => e.id === userId);
    if (idx !== -1) {
      encounter.initiativeOrder.splice(idx, 1);
      // Adjust currentTurnIndex if removed before or at current position
      if (idx < encounter.currentTurnIndex) {
        encounter.currentTurnIndex--;
      } else if (idx === encounter.currentTurnIndex) {
        // The current turn entry was removed — don't increment, next advanceTurn
        // will look at the entry now at this index (effectively the next one)
        encounter.currentTurnIndex--;
      }
    }

    return {
      type: 'flee', userId, name: player.name,
      text: `**${player.name}** flees from the encounter!`,
    };
  }

  if (action === 'defend') {
    // 5e Dodge action: attacks against this player have disadvantage until their next turn
    player.dodging = true;
    return {
      type: 'defend', userId, name: player.name,
      text: `**${player.name}** takes the Dodge action. Attacks against them have **disadvantage** until their next turn.`,
    };
  }

  if (action === 'help') {
    // 5e Help action: give an ally advantage on their next attack roll
    const targetId = player.helpTargetId;
    delete player.helpTargetId;
    const target = targetId ? encounter.participants[targetId] : null;
    if (!target || target.knockedOut || targetId === userId) {
      return {
        type: 'help', userId, name: player.name,
        text: `**${player.name}** tries to help, but there's no valid ally to assist.`,
      };
    }
    target.advantageOnNextAttack = true;
    return {
      type: 'help', userId, name: player.name, targetId, targetName: target.name,
      text: `**${player.name}** takes the Help action, assisting **${target.name}**. ${target.name} has **advantage** on their next attack roll!`,
    };
  }

  if (action === 'attack') {
    // 5e Advantage/Disadvantage: determine if player has advantage on this attack
    const advantageType = resolveAttackAdvantage(player, encounter.monster);

    let attackRoll, attackRoll2;
    if (advantageType !== 'normal') {
      // Roll 2d20
      attackRoll = typeof player.attackRollValue === 'number' ? player.attackRollValue : rollD20();
      attackRoll2 = typeof player.attackRollValue2 === 'number' ? player.attackRollValue2 : rollD20();
    } else {
      attackRoll = typeof player.attackRollValue === 'number' ? player.attackRollValue : rollD20();
      attackRoll2 = null;
    }

    // Pick the used roll based on advantage type
    let usedRoll = attackRoll;
    if (advantageType === 'advantage' && attackRoll2 !== null) {
      usedRoll = Math.max(attackRoll, attackRoll2);
    } else if (advantageType === 'disadvantage' && attackRoll2 !== null) {
      usedRoll = Math.min(attackRoll, attackRoll2);
    }

    let totalAttack = usedRoll + player.attackBonus;
    const isNat20 = usedRoll === 20;
    const isNat1 = usedRoll === 1;

    // Bardic Inspiration — client-driven (player chooses to use after seeing roll)
    let inspirationBonus = 0;
    let inspirationDie = null;
    if (player.inspirationData && player.inspirationDie) {
      inspirationDie = player.inspirationDie;
      inspirationBonus = player.inspirationData.roll || 0;
      totalAttack += inspirationBonus;
      player.inspirationDie = null;
      player.inspiredBy = null;
    }

    // Clear advantage after use
    if (player.advantageOnNextAttack) {
      player.advantageOnNextAttack = false;
    }

    let hit = false;
    let damage = 0;
    let text = '';
    let smiteApplied = false;
    let smiteDamage = 0;
    let sneakAttackApplied = false;
    let sneakAttackDamage = 0;

    // Look up the weapon used for this attack (for Vex, Sneak Attack checks)
    const usedWeapon = (player.weapons || []).find(w => w.id === player.mainActionWeaponId) || null;

    const advLabel = advantageType === 'advantage' ? ' *(with advantage)*' : advantageType === 'disadvantage' ? ' *(with disadvantage)*' : '';

    if (isNat1) {
      text = `**${player.name}** swings their ${player.weaponName}...${advLabel} **NAT 1!** A fumble! The attack goes wildly off-target.`;
    } else if (isNat20 || totalAttack >= encounter.monster.ac) {
      hit = true;

      if (typeof player.damageTotalValue === 'number') {
        damage = player.damageTotalValue;
      } else {
        const damageResult = rollDamage(player.damageNotation);
        damage = damageResult.total + player.damageMod;
        if (isNat20) {
          const critExtra = rollDamage(player.damageNotation);
          damage += critExtra.total;
        }
      }

      // Sneak Attack — once per turn, finesse/ranged weapon, advantage or ally present
      if (player.sneakAttackDice > 0 && !player.sneakAttackUsed) {
        const isEligibleWeapon = usedWeapon ? (usedWeapon.finesse || usedWeapon.ranged) : false;
        if (isEligibleWeapon) {
          const hasAlly = Object.entries(encounter.participants)
            .some(([uid, p]) => uid !== userId && !p.knockedOut);
          const eligible = advantageType === 'advantage' || (hasAlly && advantageType !== 'disadvantage');
          if (eligible) {
            if (player.sneakAttackData) {
              // Client-driven: damage already included in damageTotalValue
              sneakAttackDamage = player.sneakAttackData.sneakAttackDamage || 0;
            } else {
              // Server-driven fallback (auto-attacks, NPCs)
              const saDice = `${player.sneakAttackDice}d6`;
              const saResult = rollDamage(saDice);
              sneakAttackDamage = saResult.total;
              if (isNat20) { sneakAttackDamage += rollDamage(saDice).total; }
              damage += sneakAttackDamage;
            }
            sneakAttackApplied = true;
            player.sneakAttackUsed = true;
          }
        }
      }

      // Divine Smite validation — consume spell slot if smite was applied
      if (player.smiteData) {
        const { slotLevel, smiteDamage: clientSmiteDmg } = player.smiteData;
        const slot = (player.spellSlots || []).find(s => s.level === slotLevel && s.used < s.total);
        if (slot) {
          slot.used++;
          smiteApplied = true;
          smiteDamage = clientSmiteDmg || 0;
        }
      }

      encounter.monster.currentHp -= damage;
      player.totalDamage += damage;

      if (isNat20) {
        text = `**${player.name}** strikes with their ${player.weaponName}...${advLabel} **NAT 20! CRITICAL HIT!** ` +
          `Deals **${damage} ${player.damageType} damage!**`;
      } else {
        text = `**${player.name}** swings their ${player.weaponName}...${advLabel} **${totalAttack}** vs AC ${encounter.monster.ac} — **Hit!** ` +
          `Deals **${damage} ${player.damageType} damage.**`;
      }

      if (sneakAttackApplied) {
        text += ` **SNEAK ATTACK!** (+${sneakAttackDamage} damage)`;
      }
      if (smiteApplied) {
        text += ` **DIVINE SMITE!** Holy radiant energy erupts from the blade!`;
      }
      if (inspirationBonus > 0) {
        text += ` *(+${inspirationBonus} Bardic Inspiration)*`;
      }

      // Vex — advantage on next attack after hitting with a Vex weapon
      if (usedWeapon && usedWeapon.vex) {
        player.advantageOnNextAttack = true;
      }
    } else {
      let missText = `**${player.name}** swings their ${player.weaponName}...${advLabel} **${totalAttack}** vs AC ${encounter.monster.ac} — **Miss!**`;
      if (inspirationBonus > 0) {
        missText += ` *(even with +${inspirationBonus} Bardic Inspiration)*`;
      }
      text = missText;
    }

    // Track lifetime stats
    if (isNat20) {
      try { incrementLifetimeStat(userId, player.name, 'combat_crits', 1); } catch {}
    }
    if (isNat1) {
      try { incrementLifetimeStat(userId, player.name, 'combat_fumbles', 1); } catch {}
    }

    // Clean up roll values (keep player.action so bonus action phase can check it)
    delete player.attackRollValue;
    delete player.attackRollValue2;
    delete player.damageTotalValue;
    delete player.smiteData;
    delete player.sneakAttackData;
    delete player.inspirationData;

    return {
      type: 'attack', userId, name: player.name,
      roll: usedRoll, roll2: attackRoll2, usedRoll, advantageType,
      total: totalAttack, hit, damage, isNat20, isNat1, text,
      smiteApplied, smiteDamage,
      sneakAttackApplied, sneakAttackDamage,
      inspirationBonus, inspirationDie,
    };
  }

  return null;
}

/**
 * Advance to the next combatant in initiative order.
 * Returns { type: 'victory' | 'defeat' | 'fled' | 'next_turn', ... }
 */
function advanceTurn(encounter) {
  // Check if monster is dead
  if (encounter.monster.currentHp <= 0) {
    encounter.monster.currentHp = 0;
    // Gather the last attack for killing blow detection
    const lastAttacks = encounter.log.length > 0
      ? (encounter.log[encounter.log.length - 1].results || [])
      : [];
    const victoryResult = resolveVictory(encounter, lastAttacks);
    return { type: 'victory', victoryResult };
  }

  // Check if all players are out (knockedOut = fully defeated, not just dying)
  const stillInFight = Object.values(encounter.participants).filter(p => !p.knockedOut);
  if (stillInFight.length === 0) {
    encounter.phase = 'ended';
    encounter.outcome = 'defeat';
    activeEncounters.delete(encounter.id);
    return {
      type: 'defeat',
      defeatText: encounter.monster.fleeText || 'The monster escapes as the last fighter falls.',
    };
  }

  // Move to next entry, wrapping around
  let nextIndex = encounter.currentTurnIndex + 1;
  let newRound = false;

  if (nextIndex >= encounter.initiativeOrder.length) {
    nextIndex = 0;
    newRound = true;
  }

  // Skip knocked-out and stabilized players (dying players still get turns for death saves)
  let attempts = 0;
  while (attempts < encounter.initiativeOrder.length) {
    const entry = encounter.initiativeOrder[nextIndex];
    if (entry.type === 'player') {
      const p = encounter.participants[entry.id];
      if (p && p.knockedOut) {
        nextIndex++;
        if (nextIndex >= encounter.initiativeOrder.length) {
          nextIndex = 0;
          newRound = true;
        }
        attempts++;
        continue;
      }
    }
    break;
  }

  // Safety: if we looped through all entries and none are active, it's a defeat
  if (attempts >= encounter.initiativeOrder.length) {
    encounter.phase = 'ended';
    encounter.outcome = 'defeat';
    activeEncounters.delete(encounter.id);
    return {
      type: 'defeat',
      defeatText: encounter.monster.fleeText || 'The monster escapes as the last fighter falls.',
    };
  }

  // Start new round — reset actions
  if (newRound) {
    encounter.round++;
    for (const player of Object.values(encounter.participants)) {
      if (!player.knockedOut) {
        player.action = null;
        delete player.attackRollValue;
        delete player.attackRollValue2;
        delete player.damageTotalValue;
      }
    }
  }

  // Clear dodge/defend status and reset bonus action when this player's turn comes around
  const nextEntry = encounter.initiativeOrder[nextIndex];
  let conditionEffects = null;
  if (nextEntry && nextEntry.type === 'player') {
    const nextPlayer = encounter.participants[nextEntry.id];
    if (nextPlayer) {
      // Tick conditions at start of turn (DoT damage, decrement durations, remove expired)
      conditionEffects = tickConditions(nextPlayer);

      // Clear dodge from their previous turn
      if (nextPlayer.dodging) {
        nextPlayer.dodging = false;
      }
      if (nextPlayer.action === 'defend') {
        nextPlayer.action = null;
      }
      // Reset bonus action and sneak attack for the new turn
      nextPlayer.bonusActionUsed = false;
      nextPlayer.sneakAttackUsed = false;

      // Stunned/incapacitated: skip this player's turn
      if (!canAct(nextPlayer)) {
        encounter.currentTurnIndex = nextIndex;
        encounter.lastActivity = Date.now();
        return {
          type: 'turn_skipped',
          entry: nextEntry,
          name: nextPlayer.name,
          reason: getIncapacitatingConditionName(nextPlayer),
          conditionEffects,
          round: encounter.round,
          newRound,
        };
      }
    }
  }

  // Note: Monster conditions are ticked AFTER monster attacks (in resolveMonsterTurn /
  // resolveMonsterWithRolls), not here. Ticking here would remove conditions like
  // "mockery" before the monster gets to attack with disadvantage.

  encounter.currentTurnIndex = nextIndex;
  encounter.turnDeadline = Date.now() + TURN_TIMER_MS;
  encounter.lastActivity = Date.now();

  return {
    type: 'next_turn',
    entry: encounter.initiativeOrder[nextIndex],
    round: encounter.round,
    newRound,
    conditionEffects,
  };
}

// ============================================
// ROUND RESOLUTION (legacy — kept for resolveRound reference)
// ============================================

function resolveRound(encounter) {
  if (encounter.phase !== 'action') return null;
  encounter.phase = 'resolving';

  const results = [];
  const playerAttacks = [];
  const defends = [];
  const flees = [];

  // Process each player's action
  for (const [userId, player] of Object.entries(encounter.participants)) {
    if (player.knockedOut) continue;

    if (player.action === 'flee') {
      flees.push({ userId, name: player.name });
      results.push({
        type: 'flee',
        userId,
        name: player.name,
        text: `**${player.name}** flees from the encounter!`,
      });
      continue;
    }

    if (player.action === 'defend') {
      defends.push({ userId, name: player.name });
      results.push({
        type: 'defend',
        userId,
        name: player.name,
        text: `**${player.name}** takes a defensive stance. (+2 AC this round)`,
      });
      continue;
    }

    if (player.action === 'attack') {
      // Use client-provided d20 roll if available, otherwise auto-roll
      const attackRoll = typeof player.attackRollValue === 'number' ? player.attackRollValue : rollD20();
      const totalAttack = attackRoll + player.attackBonus;
      const isNat20 = attackRoll === 20;
      const isNat1 = attackRoll === 1;

      let hit = false;
      let damage = 0;
      let text = '';

      if (isNat1) {
        text = `**${player.name}** swings their ${player.weaponName}... **NAT 1!** A fumble! The attack goes wildly off-target.`;
      } else if (isNat20 || totalAttack >= encounter.monster.ac) {
        hit = true;

        // Use client-provided damage total if available, otherwise auto-roll
        if (typeof player.damageTotalValue === 'number') {
          damage = player.damageTotalValue;
        } else {
          const damageResult = rollDamage(player.damageNotation);
          damage = damageResult.total + player.damageMod;
          if (isNat20) {
            const critExtra = rollDamage(player.damageNotation);
            damage += critExtra.total;
          }
        }

        if (isNat20) {
          text = `**${player.name}** strikes with their ${player.weaponName}... **NAT 20! CRITICAL HIT!** ` +
            `Deals **${damage} ${player.damageType} damage!**`;
        } else {
          text = `**${player.name}** swings their ${player.weaponName}... **${totalAttack}** vs AC ${encounter.monster.ac} — **Hit!** ` +
            `Deals **${damage} ${player.damageType} damage.**`;
        }

        encounter.monster.currentHp -= damage;
        player.totalDamage += damage;
      } else {
        text = `**${player.name}** swings their ${player.weaponName}... **${totalAttack}** vs AC ${encounter.monster.ac} — **Miss!**`;
      }

      // Track crit/fumble lifetime stats
      if (isNat20) {
        try { incrementLifetimeStat(userId, player.name, 'combat_crits', 1); } catch {}
      }
      if (isNat1) {
        try { incrementLifetimeStat(userId, player.name, 'combat_fumbles', 1); } catch {}
      }

      playerAttacks.push({
        userId,
        name: player.name,
        roll: attackRoll,
        total: totalAttack,
        hit,
        damage,
        isNat20,
        isNat1,
      });

      results.push({
        type: 'attack',
        userId,
        name: player.name,
        roll: attackRoll,
        total: totalAttack,
        hit,
        damage,
        isNat20,
        isNat1,
        text,
      });
    }

    // Players who didn't act (timed out) — treat as no action
    if (!player.action) {
      results.push({
        type: 'timeout',
        userId,
        name: player.name,
        text: `**${player.name}** hesitates and does nothing this round.`,
      });
    }
  }

  // Mark fleeing players (they stay in participants for reward tracking but are effectively out)
  for (const flee of flees) {
    encounter.participants[flee.userId].action = 'fled';
    encounter.participants[flee.userId].knockedOut = true; // treated as out
  }

  // If everyone fled, end immediately — no monster counterattack
  const remainingAfterFlee = Object.values(encounter.participants)
    .filter(p => !p.knockedOut);
  if (remainingAfterFlee.length === 0 && flees.length > 0) {
    encounter.phase = 'ended';
    encounter.outcome = 'fled';
    activeEncounters.delete(encounter.id);

    return {
      phase: 'ended',
      results,
      fled: true,
      monsterHp: encounter.monster.currentHp,
    };
  }

  // Check monster death
  if (encounter.monster.currentHp <= 0) {
    encounter.monster.currentHp = 0;
    const victoryResult = resolveVictory(encounter, playerAttacks);
    return {
      phase: 'ended',
      results,
      victory: victoryResult,
      monsterHp: 0,
    };
  }

  // Prepare monster counterattack — don't auto-roll, let client roll dice
  const monsterSetup = prepareMonsterAttacks(encounter);

  if (monsterSetup.attacks.length === 0) {
    // No targets for monster (edge case) — advance to next round
    encounter.round += 1;
    encounter.phase = 'action';
    encounter.actionDeadline = Date.now() + ROUND_TIMER_MS;
    for (const player of Object.values(encounter.participants)) {
      if (!player.knockedOut) {
        player.action = null;
        delete player.attackRollValue;
        delete player.damageTotalValue;
      }
    }
    return {
      phase: 'action',
      round: encounter.round,
      results,
      monsterHp: encounter.monster.currentHp,
      deadline: encounter.actionDeadline,
    };
  }

  // Store setup and wait for client to roll dice
  encounter.monsterAttackSetup = monsterSetup;
  encounter.phase = 'monster_rolling';
  encounter.monsterRollDeadline = Date.now() + 30_000; // 30s to roll

  encounter.log.push({ round: encounter.round, results });

  return {
    phase: 'monster_rolling',
    results,
    monsterRollSetup: monsterSetup,
    monsterHp: encounter.monster.currentHp,
  };
}

// ============================================
// MONSTER TURN
// ============================================

function resolveMonsterTurn(encounter) {
  encounter.phase = 'monster_turn';
  const monster = encounter.monster;
  const results = [];

  // Get monster attack modifiers from conditions (e.g., mockery → disadvantage)
  const monsterAttackMods = getAttackModifiers(monster);

  // Get players active for combat (not knocked out, not dying, not stabilized)
  const activePlayers = Object.entries(encounter.participants)
    .filter(([, p]) => isActiveForCombat(p));

  if (activePlayers.length === 0) return results;

  // Pick targets — weighted by damage dealt (aggro)
  const targets = pickTargets(activePlayers, monster.multiattack);

  for (const attack of monster.attacks) {
    for (const [targetId, targetPlayer] of targets) {
      if (!isActiveForCombat(targetPlayer)) continue;

      // 5e: Determine advantage/disadvantage for this monster attack
      let monsterHasAdvantage = false;
      let monsterHasDisadvantage = targetPlayer.dodging || monsterAttackMods.hasDisadvantage;

      // Check target's conditions (e.g., stunned → attackers have advantage)
      const targetDefMods = getDefenseModifiers(targetPlayer);
      if (targetDefMods.attackersHaveAdvantage) monsterHasAdvantage = true;
      if (targetDefMods.attackersHaveDisadvantage) monsterHasDisadvantage = true;

      // 5e: advantage + disadvantage cancel out
      const hasAdvantage = monsterHasAdvantage && !monsterHasDisadvantage;
      const hasDisadvantage = monsterHasDisadvantage && !monsterHasAdvantage;
      const rollTwice = hasAdvantage || hasDisadvantage;

      let attackRoll = rollD20();
      let attackRoll2 = rollTwice ? rollD20() : null;
      const usedRoll = hasAdvantage ? Math.max(attackRoll, attackRoll2)
        : hasDisadvantage ? Math.min(attackRoll, attackRoll2)
        : attackRoll;

      const totalAttack = usedRoll + attack.bonus;
      const effectiveAC = targetPlayer.ac;

      const isNat20 = usedRoll === 20;
      const isNat1 = usedRoll === 1;

      let hit = false;
      let damage = 0;
      let text = '';

      // Pick random flavor text
      const attackTextTemplate = monster.attackTexts[Math.floor(Math.random() * monster.attackTexts.length)]
        || `The ${monster.name} attacks {target}!`;
      const missTextTemplate = monster.missTexts[Math.floor(Math.random() * monster.missTexts.length)]
        || `{target} avoids the attack.`;

      if (isNat1) {
        text = missTextTemplate.replace('{target}', `**${targetPlayer.name}**`) +
          ` *(The ${monster.name} rolled a nat 1!)*`;
      } else if (isNat20 || totalAttack >= effectiveAC) {
        hit = true;
        const damageResult = rollDamage(attack.damage);
        damage = damageResult.total;

        if (isNat20) {
          const critExtra = rollDamage(attack.damage);
          damage += critExtra.total;
        }

        // Apply damage
        const damageInfo = applyDamageToPlayer(targetPlayer, damage);

        text = attackTextTemplate.replace('{target}', `**${targetPlayer.name}**`) +
          ` **${totalAttack}** vs AC ${effectiveAC} — **Hit!** ` +
          `**${targetPlayer.name}** takes **${damage} ${attack.type} damage.** ` +
          `(HP: ${targetPlayer.currentHp}/${targetPlayer.maxHp})`;

        if (damageInfo.knocked) {
          text += `\n**${targetPlayer.name}** has been knocked out!`;
        }
      } else {
        text = missTextTemplate.replace('{target}', `**${targetPlayer.name}**`) +
          ` *(${totalAttack} vs AC ${effectiveAC})*`;
      }

      results.push({
        type: 'monster_attack',
        targetId,
        targetName: targetPlayer.name,
        attackName: attack.name,
        roll: usedRoll,
        total: totalAttack,
        effectiveAC,
        hit,
        damage,
        isNat20,
        isNat1,
        knocked: targetPlayer.knockedOut && hit,
        text,
      });
    }
  }

  // Tick monster conditions AFTER attacks (so conditions like "mockery" apply during the attacks)
  const monsterConditionEffects = tickConditions(monster);

  return { results, monsterConditionEffects };
}

/**
 * Prepare monster attacks without rolling dice.
 * Returns { attacks, rollerId } for client to roll.
 */
function prepareMonsterAttacks(encounter) {
  const monster = encounter.monster;
  // Only target players active for combat (not dying/stabilized/KO)
  const activePlayers = Object.entries(encounter.participants)
    .filter(([, p]) => isActiveForCombat(p));

  if (activePlayers.length === 0) return { attacks: [], rollerId: null };

  const targets = pickTargets(activePlayers, monster.multiattack);
  const attacks = [];
  let index = 0;
  const monsterAttackMods = getAttackModifiers(monster);

  for (const attack of monster.attacks) {
    for (const [targetId, targetPlayer] of targets) {
      if (!isActiveForCombat(targetPlayer)) continue;
      const effectiveAC = targetPlayer.ac;
      // 5e: Check advantage/disadvantage from conditions
      let hasAdv = false;
      let hasDisadv = !!targetPlayer.dodging || monsterAttackMods.hasDisadvantage;
      const targetDefMods = getDefenseModifiers(targetPlayer);
      if (targetDefMods.attackersHaveAdvantage) hasAdv = true;
      if (targetDefMods.attackersHaveDisadvantage) hasDisadv = true;
      // Advantage + disadvantage cancel
      const advantage = hasAdv && !hasDisadv;
      const disadvantage = hasDisadv && !hasAdv;
      attacks.push({
        index,
        name: attack.name,
        bonus: attack.bonus,
        damageDice: attack.damage,
        damageType: attack.type,
        targetId,
        targetName: targetPlayer.name,
        targetAC: effectiveAC,
        advantage,
        disadvantage,
      });
      index++;
    }
  }

  // First target rolls the monster's dice
  const rollerId = attacks.length > 0 ? attacks[0].targetId : null;
  return { attacks, rollerId };
}

/**
 * Resolve monster attacks using client-provided dice rolls.
 * Called after client rolls and sends results back.
 */
function resolveMonsterWithRolls(encounterId, rollData) {
  const encounter = activeEncounters.get(encounterId);
  if (!encounter) return { error: 'Encounter not found.' };
  if (encounter.phase !== 'monster_rolling') return { error: 'Not in monster rolling phase.' };

  encounter.phase = 'monster_turn';
  encounter.lastActivity = Date.now();
  const monster = encounter.monster;
  const results = [];

  for (const roll of rollData) {
    const setup = encounter.monsterAttackSetup?.attacks?.[roll.index];
    if (!setup) continue;

    const targetPlayer = encounter.participants[setup.targetId];
    if (!targetPlayer) continue;
    if (targetPlayer.knockedOut) continue;

    // 5e: Resolve advantage/disadvantage from attack setup
    let attackRoll, usedRoll;
    if (setup.advantage || setup.disadvantage) {
      attackRoll = typeof roll.attackRoll === 'number' ? roll.attackRoll : rollD20();
      const attackRoll2 = typeof roll.attackRoll2 === 'number' ? roll.attackRoll2 : rollD20();
      usedRoll = setup.advantage ? Math.max(attackRoll, attackRoll2) : Math.min(attackRoll, attackRoll2);
    } else {
      attackRoll = typeof roll.attackRoll === 'number' ? roll.attackRoll : rollD20();
      usedRoll = attackRoll;
    }

    const totalAttack = usedRoll + setup.bonus;
    const isNat20 = usedRoll === 20;
    const isNat1 = usedRoll === 1;

    let hit = false;
    let damage = 0;
    let text = '';

    const attackTextTemplate = monster.attackTexts[Math.floor(Math.random() * monster.attackTexts.length)]
      || `The ${monster.name} attacks {target}!`;
    const missTextTemplate = monster.missTexts[Math.floor(Math.random() * monster.missTexts.length)]
      || `{target} avoids the attack.`;

    if (isNat1) {
      text = missTextTemplate.replace('{target}', `**${targetPlayer.name}**`) +
        ` *(The ${monster.name} rolled a nat 1!)*`;
    } else if (isNat20 || totalAttack >= setup.targetAC) {
      hit = true;
      damage = typeof roll.damageTotal === 'number' ? roll.damageTotal : 0;

      // Fallback: auto-roll damage if client didn't provide it
      if (damage === 0 && typeof roll.damageTotal !== 'number') {
        const damageResult = rollDamage(setup.damageDice);
        damage = damageResult.total;
        if (isNat20) {
          damage += rollDamage(setup.damageDice).total;
        }
      }

      // Apply damage
      const damageInfo = applyDamageToPlayer(targetPlayer, damage);

      text = attackTextTemplate.replace('{target}', `**${targetPlayer.name}**`) +
        ` **${totalAttack}** vs AC ${setup.targetAC} — **Hit!** ` +
        `**${targetPlayer.name}** takes **${damage} ${setup.damageType} damage.** ` +
        `(HP: ${targetPlayer.currentHp}/${targetPlayer.maxHp})`;

      if (damageInfo.knocked) {
        text += `\n**${targetPlayer.name}** has been knocked out!`;
      }
    } else {
      text = missTextTemplate.replace('{target}', `**${targetPlayer.name}**`) +
        ` *(${totalAttack} vs AC ${setup.targetAC})*`;
    }

    results.push({
      type: 'monster_attack',
      targetId: setup.targetId,
      targetName: targetPlayer.name,
      attackName: setup.name,
      roll: usedRoll,
      total: totalAttack,
      effectiveAC: setup.targetAC,
      hit,
      damage,
      isNat20,
      isNat1,
      knocked: targetPlayer.knockedOut && hit,
      text,
    });
  }

  // Clean up setup
  delete encounter.monsterAttackSetup;
  delete encounter.monsterRollDeadline;

  // Tick monster conditions AFTER attacks (so conditions like "mockery" applied during attacks)
  const monsterConditionEffects = tickConditions(monster);

  // Check if all players are out of the fight (knocked out = fully defeated)
  const activePlayers = Object.values(encounter.participants)
    .filter(p => !p.knockedOut);

  if (activePlayers.length === 0) {
    encounter.phase = 'ended';
    encounter.outcome = 'defeat';
    activeEncounters.delete(encounter.id);

    return {
      locationId: encounter.locationId,
      results,
      monsterConditionEffects,
      defeat: true,
      defeatText: monster.fleeText || 'The monster escapes as the last fighter falls.',
    };
  }

  // Don't auto-advance — the route handler will call advanceTurn()
  return {
    locationId: encounter.locationId,
    results,
    monsterConditionEffects,
  };
}

// ============================================
// 5e HELPERS: ADVANTAGE, CONDITIONS, POTIONS
// ============================================

/**
 * Get the name of the condition preventing a participant from acting.
 */
function getIncapacitatingConditionName(participant) {
  const { CONDITIONS } = require('./conditions');
  for (const c of (participant.conditions || [])) {
    const def = CONDITIONS[c.id];
    if (def && !def.canAct) return c.name;
  }
  return 'a condition';
}

/**
 * Check if a player is active for combat targeting (not knocked out).
 */
function isActiveForCombat(p) {
  return !p.knockedOut;
}

/**
 * Check if a player is still in the fight (for defeat detection).
 * Dying and stabilized players are still "in" — only knockedOut = defeated.
 */
function isStillInFight(p) {
  return !p.knockedOut;
}

/**
 * Determine advantage/disadvantage for a player's attack roll.
 * Returns 'advantage' | 'disadvantage' | 'normal'.
 * If both advantage and disadvantage apply, they cancel to 'normal' (5e rule).
 */
function resolveAttackAdvantage(attacker, defender) {
  let hasAdvantage = !!attacker.advantageOnNextAttack;
  let hasDisadvantage = false;

  // Attacker conditions (e.g., frightened, poisoned → disadvantage)
  const attackMods = getAttackModifiers(attacker);
  if (attackMods.hasDisadvantage) hasDisadvantage = true;

  // Defender conditions (e.g., stunned, restrained → attackers have advantage)
  const defenseMods = getDefenseModifiers(defender);
  if (defenseMods.attackersHaveAdvantage) hasAdvantage = true;
  if (defenseMods.attackersHaveDisadvantage) hasDisadvantage = true;

  if (hasAdvantage && hasDisadvantage) return 'normal';
  if (hasAdvantage) return 'advantage';
  if (hasDisadvantage) return 'disadvantage';
  return 'normal';
}

/**
 * Get a monster's saving throw bonus for a given ability.
 * Falls back to CR-based defaults if not defined.
 */
function getMonsterSaveBonus(monster, ability) {
  if (monster.savingThrows?.[ability] != null) return monster.savingThrows[ability];
  if (monster.cr >= 5) return 3;
  if (monster.cr >= 1) return 2;
  return 0;
}

/**
 * Apply damage to a player, handling dying state transitions.
 * Returns { knocked }.
 */
function applyDamageToPlayer(player, damage) {
  if (player.knockedOut) return { knocked: true };

  player.currentHp -= damage;
  if (player.currentHp <= 0) {
    player.currentHp = 0;
    player.knockedOut = true;
    return { knocked: true };
  }
  return { knocked: false };
}

/**
 * Resolve a potion use in combat.
 * Returns narration result or { error }.
 */
function resolvePotionUse(encounter, userId, potionId, targetId, healRoll) {
  const { getInventory, useItem, findItemInCatalog } = require('./economy');
  const player = encounter.participants[userId];
  if (!player) return { error: 'Not a participant.' };

  // Find the potion in inventory
  const inv = getInventory(userId);
  const invItem = (inv?.items || []).find(i => i.item_id === potionId);
  if (!invItem || invItem.quantity <= 0) return { error: 'You don\'t have that potion.' };

  // Verify it's actually a potion in the catalog
  const catalogResult = findItemInCatalog(potionId);
  if (!catalogResult || catalogResult.item.type !== 'potion') return { error: 'That\'s not a potion.' };

  // Consume the potion
  const useResult = useItem(userId, potionId);
  if (useResult.error) return { error: useResult.error };

  // Determine healing amount
  const healAmount = typeof healRoll === 'number' ? healRoll : 0;
  const potion = catalogResult.item;

  // Determine target
  const effectiveTargetId = targetId || userId;
  const target = encounter.participants[effectiveTargetId];
  if (!target) return { error: 'Target not found in encounter.' };

  let text = '';
  let revived = false;

  if (target.knockedOut) {
    // Revive a knocked out ally
    target.knockedOut = false;
    target.currentHp = Math.min(target.maxHp, healAmount);
    revived = true;

    if (effectiveTargetId === userId) {
      text = `**${player.name}** drinks a **${potion.name}**, regaining consciousness with **${target.currentHp} HP!**`;
    } else {
      text = `**${player.name}** administers a **${potion.name}** to **${target.name}**, reviving them with **${target.currentHp} HP!**`;
    }
  } else {
    // Normal healing
    const oldHp = target.currentHp;
    target.currentHp = Math.min(target.maxHp, target.currentHp + healAmount);
    const healed = target.currentHp - oldHp;

    if (effectiveTargetId === userId) {
      text = `**${player.name}** drinks a **${potion.name}**, restoring **${healed} HP!** (${target.currentHp}/${target.maxHp})`;
    } else {
      text = `**${player.name}** gives a **${potion.name}** to **${target.name}**, restoring **${healed} HP!** (${target.currentHp}/${target.maxHp})`;
    }
  }

  // Track lifetime stat
  try { incrementLifetimeStat(userId, player.name, 'potions_used', 1); } catch {}

  return {
    type: 'potion', userId, name: player.name,
    targetId: effectiveTargetId, targetName: target.name,
    potionName: potion.name, healAmount, revived,
    newHp: target.currentHp, maxHp: target.maxHp,
    text,
  };
}

/**
 * Pick monster attack targets, weighted by damage dealt.
 * Returns array of [userId, player] pairs.
 */
function pickTargets(activePlayers, count) {
  if (activePlayers.length <= count) return activePlayers;

  // Weight by damage dealt (aggro) + base weight of 1
  const weights = activePlayers.map(([, p]) => p.totalDamage + 1);
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  const chosen = new Set();
  const targets = [];

  while (targets.length < count && targets.length < activePlayers.length) {
    let roll = Math.random() * totalWeight;
    for (let i = 0; i < activePlayers.length; i++) {
      if (chosen.has(i)) continue;
      roll -= weights[i];
      if (roll <= 0) {
        chosen.add(i);
        targets.push(activePlayers[i]);
        break;
      }
    }
  }

  return targets;
}

// ============================================
// VICTORY & REWARDS
// ============================================

function resolveVictory(encounter, lastAttacks) {
  encounter.phase = 'ended';
  encounter.outcome = 'victory';

  const monster = encounter.monster;
  const totalDamageDealt = Object.values(encounter.participants)
    .reduce((s, p) => s + p.totalDamage, 0);

  // Find who dealt the killing blow
  const killingBlow = lastAttacks.length > 0
    ? lastAttacks.filter(a => a.hit).pop()
    : null;

  const rewards = {};
  const participants = Object.entries(encounter.participants);
  const activeCount = participants.filter(([, p]) => p.totalDamage > 0).length;

  for (const [userId, player] of participants) {
    if (player.totalDamage === 0) continue;

    const share = player.totalDamage / totalDamageDealt;
    let xp = Math.round(monster.xpReward * share);
    let gold = Math.round(monster.goldReward * share);

    // Killing blow bonus: +10% XP
    if (killingBlow && killingBlow.userId === userId) {
      xp = Math.round(xp * 1.1);
    }

    // Untouchable bonus: no damage taken, +5% XP
    if (player.currentHp === player.maxHp) {
      xp = Math.round(xp * 1.05);
    }

    // Solo kill bonus: +25% XP
    if (activeCount === 1) {
      xp = Math.round(xp * 1.25);
    }

    rewards[userId] = {
      name: player.name,
      xp,
      gold,
      share: Math.round(share * 100),
      killingBlow: killingBlow?.userId === userId,
      untouchable: player.currentHp === player.maxHp,
    };
  }

  // Clean up
  activeEncounters.delete(encounter.id);

  return {
    rewards,
    deathText: monster.deathText,
    monsterName: monster.name,
    totalDamage: totalDamageDealt,
  };
}

/**
 * Distribute rewards (XP and gold) to participants.
 * Called after resolveVictory. Returns level-up and achievement info.
 */
function distributeRewards(rewards, monsterId) {
  const results = {};

  for (const [userId, reward] of Object.entries(rewards)) {
    const levelBefore = getLevel(userId, reward.name);

    // Award XP
    awardQuestXp(userId, reward.name, 'combat_encounter', reward.xp);

    // Award gold
    if (reward.gold > 0) {
      awardGold(userId, reward.name, reward.gold, { source: 'combat_encounter' });
    }

    // Track lifetime stats
    incrementLifetimeStat(userId, reward.name, 'encounters_won', 1);
    incrementLifetimeStat(userId, reward.name, 'total_combat_damage', reward.xp); // approximate

    // Track per-monster defeats for all participants
    if (monsterId) {
      incrementLifetimeStat(userId, reward.name, `defeated_${monsterId}`, 1);
    }

    if (reward.killingBlow) {
      incrementLifetimeStat(userId, reward.name, 'monsters_killed', 1);
    }

    const levelAfter = getLevel(userId, reward.name);
    results[userId] = {
      ...reward,
      levelUp: levelAfter > levelBefore ? { newLevel: levelAfter } : null,
    };
  }

  return results;
}

// ============================================
// ENCOUNTER LIFECYCLE
// ============================================

function getEncounter(encounterId) {
  return activeEncounters.get(encounterId) || null;
}

function getActiveEncounters(filter) {
  const results = [];
  for (const [, enc] of activeEncounters) {
    if (enc.phase === 'ended') continue;
    if (filter?.locationId && enc.locationId !== filter.locationId) continue;
    results.push(enc);
  }
  return results;
}

function cancelEncounter(encounterId) {
  const encounter = activeEncounters.get(encounterId);
  if (!encounter) return { error: 'Encounter not found.' };

  encounter.phase = 'ended';
  encounter.outcome = 'cancelled';
  activeEncounters.delete(encounterId);

  return { success: true, locationId: encounter.locationId };
}

/**
 * Check for timed-out rounds. Called periodically.
 * Returns encounters that need round resolution due to timeout.
 */
function checkTimeouts() {
  const now = Date.now();
  const timedOut = [];

  for (const [encId, encounter] of activeEncounters) {
    if (encounter.phase === 'ended') continue;

    // Full encounter timeout (no activity for 2 min)
    if (now - encounter.lastActivity > TIMEOUT_MS) {
      encounter.phase = 'ended';
      encounter.outcome = 'timeout';
      activeEncounters.delete(encId);
  
      timedOut.push({ encounter, reason: 'timeout' });
      continue;
    }

    // Turn timer expired (turn-based)
    if (encounter.phase === 'action' && encounter.turnDeadline && now > encounter.turnDeadline) {
      timedOut.push({ encounter, reason: 'turn_timeout' });
    }

    // Monster roll timeout — auto-roll if client didn't respond in time
    if (encounter.phase === 'monster_rolling' && encounter.monsterRollDeadline && now > encounter.monsterRollDeadline) {
      timedOut.push({ encounter, reason: 'monster_roll_timeout' });
    }
  }

  return timedOut;
}

/**
 * Get a sanitized encounter state safe for sending to clients.
 */
function getPublicState(encounter) {
  if (!encounter) return null;

  const participants = {};
  for (const [userId, p] of Object.entries(encounter.participants)) {
    participants[userId] = {
      name: p.name,
      avatar: p.avatar || null,
      sprite: p.sprite || null,
      maxHp: p.maxHp,
      currentHp: p.currentHp,
      ac: p.ac,
      attackBonus: p.attackBonus,
      damageNotation: p.damageNotation,
      damageMod: p.damageMod,
      weaponName: p.weaponName,
      damageType: p.damageType,
      weapons: p.weapons || [],
      dexMod: p.dexMod || 0,
      action: p.action ? (p.action === 'fled' ? 'fled' : 'chosen') : null,
      totalDamage: p.totalDamage,
      knockedOut: p.knockedOut,
      needsInitiativeRoll: p.needsInitiativeRoll || false,
      // 5e fields
      dodging: p.dodging || false,
      advantageOnNextAttack: p.advantageOnNextAttack || false,
      bonusActionUsed: p.bonusActionUsed || false,
      conditions: getConditionsPublic(p),
      // Class abilities
      spellSlots: p.spellSlots || [],
      classNames: p.classNames || [],
      classFeatures: p.classFeatures || [],
      hasAvailableSpells: (p.classFeatures || []).includes('Spellcasting') &&
        Object.values(SPELL_DEFINITIONS).some(spell =>
          spell.actionType === 'action' && spell.classes?.some(c => (p.classNames || []).includes(c))
        ),
      layOnHandsPool: p.layOnHandsPool || 0,
      layOnHandsUsed: p.layOnHandsUsed || 0,
      // Rogue features
      sneakAttackDice: p.sneakAttackDice || 0,
      // Bardic Inspiration
      hasBardicInspiration: p.hasBardicInspiration || false,
      bardicInspirationUses: p.bardicInspirationUses || 0,
      bardicInspirationMax: p.bardicInspirationMax || 0,
      bardicInspirationDie: p.bardicInspirationDie || 'd6',
      inspirationDie: p.inspirationDie || null,
      inspiredBy: p.inspiredBy || null,
      // Spellcasting
      spellSaveDC: p.spellSaveDC || 0,
      spellAttackBonus: p.spellAttackBonus || 0,
      spellcastingMod: p.spellcastingMod || 0,
      // Healing Word availability
      hasHealingWord: (p.classFeatures || []).includes('Spellcasting') &&
        SPELL_DEFINITIONS.healing_word.classes.some(c => (p.classNames || []).includes(c)) &&
        (p.spellSlots || []).some(s => s.level >= SPELL_DEFINITIONS.healing_word.level && s.used < s.total),
    };
  }

  return {
    id: encounter.id,
    locationId: encounter.locationId,
    monster: {
      id: encounter.monster.id,
      name: encounter.monster.name,
      description: encounter.monster.description,
      image: encounter.monster.image,
      sprite: encounter.monster.sprite,
      spriteScale: encounter.monster.spriteScale,
      spriteOffsetX: encounter.monster.spriteOffsetX,
      spriteOffsetY: encounter.monster.spriteOffsetY,
      ac: encounter.monster.ac,
      maxHp: encounter.monster.maxHp,
      currentHp: encounter.monster.currentHp,
      cr: encounter.monster.cr,
      creatureType: encounter.monster.creatureType || 'beast',
      savingThrows: encounter.monster.savingThrows || {},
      disadvantageOnNextAttack: encounter.monster.disadvantageOnNextAttack || false,
      conditions: getConditionsPublic(encounter.monster),
    },
    round: encounter.round,
    phase: encounter.phase,
    participants,
    actionDeadline: encounter.actionDeadline,
    startedAt: encounter.startedAt,
    // Initiative fields
    initiativeOrder: encounter.initiativeOrder || [],
    currentTurnIndex: encounter.currentTurnIndex || 0,
    turnDeadline: encounter.turnDeadline || null,
    bonusActionPhase: encounter.bonusActionPhase || false,
    initiativeRolls: encounter.phase === 'initiative_rolling'
      ? Object.fromEntries(
          Object.entries(encounter.initiativeRolls || {}).map(([uid, data]) => [uid, { total: data.total, roll: data.roll, modifier: data.modifier }])
        )
      : null,
  };
}

// ============================================
// SPELLCASTING
// ============================================

/**
 * Resolve a save-based damage spell (Vicious Mockery, Thunderwave).
 */
function resolveSaveDamageSpell(encounter, player, userId, spell, spellId, rollData) {
  const monster = encounter.monster;
  const saveBonus = getMonsterSaveBonus(monster, spell.saveAbility);
  const saveRoll = typeof rollData?.saveRoll === 'number' ? rollData.saveRoll : rollD20();
  const saveTotal = saveRoll + saveBonus;
  const saveDC = player.spellSaveDC;
  const saved = saveTotal >= saveDC;

  let damage = 0;
  if (!saved) {
    damage = typeof rollData?.damageTotal === 'number'
      ? rollData.damageTotal
      : rollDamage(spell.damageDice).total;
    monster.currentHp -= damage;
    player.totalDamage += damage;
  }

  // Apply extra effects via conditions system
  if (!saved && spell.extraEffect === 'disadvantage_next_attack') {
    addCondition(monster, 'mockery', { duration: 1, durationType: 'rounds', source: player.name });
  }

  let text;
  if (saved) {
    text = `**${player.name}** casts **${spell.name}**! ${monster.name} rolls a ${spell.saveAbility} save: **${saveTotal}** vs DC ${saveDC} — **Saved!** The spell has no effect.`;
  } else {
    text = `**${player.name}** casts **${spell.name}**! ${monster.name} rolls a ${spell.saveAbility} save: **${saveTotal}** vs DC ${saveDC} — **Failed!** Deals **${damage} ${spell.damageType} damage!**`;
    if (spell.extraEffect === 'disadvantage_next_attack') {
      text += ` The ${monster.name} has **disadvantage** on its next attack!`;
    }
  }

  return {
    type: 'cast_spell', spellId,
    userId, name: player.name,
    spellName: spell.name, saveAbility: spell.saveAbility,
    saveRoll, saveBonus, saveTotal, saveDC, saved,
    damage, damageType: spell.damageType,
    extraEffect: !saved ? (spell.extraEffect || null) : null,
    text,
  };
}

/**
 * Resolve a healing spell (Healing Word).
 */
function resolveHealSpell(encounter, player, userId, spell, spellId, rollData) {
  const targetId = rollData?.targetId || userId;
  const target = encounter.participants[targetId];
  if (!target) return { error: 'Target not found.' };

  const healRoll = typeof rollData?.healRoll === 'number'
    ? rollData.healRoll
    : rollDamage(spell.healDice).total;
  const healAmount = healRoll + player.spellcastingMod;

  let revived = false;
  if (target.knockedOut) {
    target.knockedOut = false;
    target.currentHp = Math.min(target.maxHp, healAmount);
    revived = true;
  } else {
    target.currentHp = Math.min(target.maxHp, target.currentHp + healAmount);
  }

  const targetName = targetId === userId ? player.name : target.name;
  const text = revived
    ? `**${player.name}** casts **${spell.name}** on **${targetName}**! They regain consciousness with **${target.currentHp} HP!**`
    : `**${player.name}** casts **${spell.name}** on **${targetName}**, restoring **${healAmount} HP!** (${target.currentHp}/${target.maxHp})`;

  return {
    type: 'cast_spell', spellId,
    userId, name: player.name,
    targetId, targetName,
    healAmount, revived,
    spellName: spell.name,
    newHp: target.currentHp, maxHp: target.maxHp,
    text,
  };
}

/**
 * Dispatch spell casting. Validates slots, then calls the right resolver.
 */
function resolveCastSpell(encounter, userId, spellId, rollData) {
  const player = encounter.participants[userId];
  if (!player) return { error: 'Not a participant.' };

  const spell = SPELL_DEFINITIONS[spellId];
  if (!spell) return { error: 'Unknown spell.' };

  // Validate player's class can cast this spell
  if (spell.classes && !spell.classes.some(c => (player.classNames || []).includes(c))) {
    return { error: 'Your class cannot cast this spell.' };
  }

  // Validate & consume spell slot for leveled spells
  if (spell.level > 0) {
    const slot = (player.spellSlots || []).find(s => s.level >= spell.level && s.used < s.total);
    if (!slot) return { error: 'No spell slots remaining.' };
    slot.used++;
  }

  if (spell.effectType === 'save_damage') {
    return resolveSaveDamageSpell(encounter, player, userId, spell, spellId, rollData);
  }
  if (spell.effectType === 'heal') {
    return resolveHealSpell(encounter, player, userId, spell, spellId, rollData);
  }
  return { error: 'Unknown spell effect type.' };
}

// ============================================
// BONUS ACTIONS
// ============================================

function getAvailableBonusActions(encounter, userId) {
  const player = encounter.participants[userId];
  if (!player || player.bonusActionUsed || player.knockedOut) return [];
  const actions = [];

  // Bardic Inspiration
  if (player.hasBardicInspiration && player.bardicInspirationUses < player.bardicInspirationMax) {
    const allies = Object.entries(encounter.participants)
      .filter(([uid, p]) => uid !== userId && !p.knockedOut && !p.inspirationDie)
      .map(([uid, p]) => ({ id: uid, name: p.name }));
    if (allies.length > 0) {
      actions.push({
        type: 'bardic_inspiration',
        die: player.bardicInspirationDie,
        usesLeft: player.bardicInspirationMax - player.bardicInspirationUses,
        targets: allies,
      });
    }
  }

  // Offhand Attack — only when main action was an attack, with a different light melee weapon
  if (player.canOffhandAttack && player.action === 'attack' && player.mainActionWeaponId) {
    const offhandWeapons = (player.weapons || []).filter(w =>
      w.id !== player.mainActionWeaponId && w.light && !w.ranged && !w.twoHanded
    );
    if (offhandWeapons.length > 0) {
      actions.push({
        type: 'offhand_attack',
        weapons: offhandWeapons,
      });
    }
  }

  // Healing Word (bonus action spell — Bard/Cleric only)
  if (player.classFeatures?.includes('Spellcasting') &&
      SPELL_DEFINITIONS.healing_word.classes.some(c => (player.classNames || []).includes(c))) {
    const hw = SPELL_DEFINITIONS.healing_word;
    const hasSlot = (player.spellSlots || []).some(s => s.level >= hw.level && s.used < s.total);
    if (hasSlot) {
      const targets = Object.entries(encounter.participants)
        .filter(([, p]) => !p.knockedOut)
        .map(([uid, p]) => ({ id: uid, name: p.name, currentHp: p.currentHp, maxHp: p.maxHp }));
      if (targets.length > 0) {
        actions.push({
          type: 'healing_word',
          spellName: hw.name,
          healDice: hw.healDice,
          spellcastingMod: player.spellcastingMod,
          targets,
        });
      }
    }
  }

  return actions;
}

function resolveBonusAction(encounter, userId, bonusAction, data) {
  const player = encounter.participants[userId];
  if (!player) return { error: 'Not a participant.' };
  if (player.bonusActionUsed) return { error: 'Bonus action already used.' };

  if (bonusAction === 'bardic_inspiration') {
    if (!player.hasBardicInspiration) return { error: 'You don\'t have Bardic Inspiration.' };
    if (player.bardicInspirationUses >= player.bardicInspirationMax) return { error: 'No Bardic Inspiration uses remaining.' };

    const targetId = data.targetId;
    const target = encounter.participants[targetId];
    if (!target) return { error: 'Target not found.' };
    if (targetId === userId) return { error: 'Cannot inspire yourself.' };
    if (target.knockedOut) return { error: 'Target is knocked out.' };
    if (target.inspirationDie) return { error: 'Target already has inspiration.' };

    player.bardicInspirationUses++;
    target.inspirationDie = player.bardicInspirationDie;
    target.inspiredBy = userId;
    player.bonusActionUsed = true;

    const usesLeft = player.bardicInspirationMax - player.bardicInspirationUses;
    return {
      type: 'bardic_inspiration',
      userId, name: player.name,
      targetId, targetName: target.name,
      die: player.bardicInspirationDie,
      usesLeft,
      text: `**${player.name}** plays an inspiring melody for **${target.name}**! They gain a **${player.bardicInspirationDie}** Bardic Inspiration die to add to their next attack roll.`,
    };
  }

  if (bonusAction === 'healing_word') {
    const result = resolveCastSpell(encounter, userId, 'healing_word', data);
    if (result.error) return result;
    player.bonusActionUsed = true;
    return result;
  }

  if (bonusAction === 'offhand_attack') {
    // Swap to offhand weapon if provided
    const weaponId = data.weaponId;
    let wpn = null;
    if (weaponId && player.weapons) {
      wpn = player.weapons.find(w => w.id === weaponId);
      if (wpn) {
        player.attackBonus = wpn.attackBonus;
        player.damageMod = wpn.damageMod;
        player.damageNotation = wpn.dice;
        player.weaponName = wpn.name;
        player.damageType = wpn.type;
      }
    }

    // Resolve offhand attack (same logic as main attack)
    const attackRoll = typeof data.attackRoll === 'number' ? data.attackRoll : rollD20();
    const totalAttack = attackRoll + player.attackBonus;
    const isNat20 = attackRoll === 20;
    const isNat1 = attackRoll === 1;

    let hit = false;
    let damage = 0;
    let text = '';

    if (isNat1) {
      text = `**${player.name}** swings their ${player.weaponName} (offhand)... **NAT 1!** A fumble!`;
    } else if (isNat20 || totalAttack >= encounter.monster.ac) {
      hit = true;
      if (typeof data.damageTotal === 'number') {
        damage = data.damageTotal;
      } else {
        const damageResult = rollDamage(player.damageNotation);
        damage = damageResult.total + player.damageMod;
        if (isNat20) {
          const critExtra = rollDamage(player.damageNotation);
          damage += critExtra.total;
        }
      }
      encounter.monster.currentHp = Math.max(0, encounter.monster.currentHp - damage);
      player.totalDamage = (player.totalDamage || 0) + damage;

      if (isNat20) {
        text = `**${player.name}** strikes with their ${player.weaponName} (offhand)... **NAT 20! CRITICAL HIT!** Deals **${damage} ${player.damageType} damage!**`;
      } else {
        text = `**${player.name}** strikes with their ${player.weaponName} (offhand)... **${totalAttack}** vs AC ${encounter.monster.ac} — **Hit!** Deals **${damage} ${player.damageType} damage.**`;
      }
    } else {
      text = `**${player.name}** swings their ${player.weaponName} (offhand)... **${totalAttack}** vs AC ${encounter.monster.ac} — **Miss!**`;
    }

    player.bonusActionUsed = true;

    return {
      type: 'offhand_attack',
      userId, name: player.name,
      weaponName: player.weaponName,
      attackRoll, totalAttack, isNat20, isNat1,
      hit, damage, damageType: player.damageType,
      monsterHp: encounter.monster.currentHp,
      monsterMaxHp: encounter.monster.maxHp,
      text,
    };
  }

  return { error: 'Unknown bonus action.' };
}

module.exports = {
  spawnEncounter,
  joinEncounter,
  joinWithInitiative,
  submitAction,
  submitInitiativeRoll,
  finalizeInitiativeOrder,
  resolveSingleAction,
  advanceTurn,
  resolveRound,
  resolveMonsterWithRolls,
  resolveMonsterTurn,
  prepareMonsterAttacks,
  distributeRewards,
  resolvePotionUse,
  getEncounter,
  getActiveEncounters,
  findPlayerEncounter,
  cancelEncounter,
  checkTimeouts,
  checkAllActed,
  getPublicState,
  getAvailableBonusActions,
  resolveBonusAction,
  resolveCastSpell,
  SPELL_DEFINITIONS,
  ROUND_TIMER_MS,
  TURN_TIMER_MS,
};

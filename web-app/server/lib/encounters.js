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
const { getBestWeapon, rollD20, rollDamage } = require('./weapons');
const { awardQuestXp, incrementLifetimeStat, getLevel } = require('./xp');
const { awardGold } = require('./economy');

// ============================================
// ACTIVE ENCOUNTERS (in-memory)
// ============================================

const activeEncounters = new Map(); // encounterId → encounter
const locationEncounters = new Map(); // locationId → encounterId

const ROUND_TIMER_MS = 90_000; // 90 seconds per round
const TIMEOUT_MS = 300_000; // 5 minutes of inactivity kills the encounter

// ============================================
// ENCOUNTER CREATION
// ============================================

function spawnEncounter(locationId, monsterId, startedBy) {
  // Only one encounter per location
  if (locationEncounters.has(locationId)) {
    return { error: 'An encounter is already active at this location.' };
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
    },
    round: 1,
    phase: 'action', // 'action' | 'resolving' | 'monster_rolling' | 'monster_turn' | 'ended'
    participants: {},
    actionDeadline: Date.now() + ROUND_TIMER_MS,
    lastActivity: Date.now(),
    startedBy,
    startedAt: new Date().toISOString(),
    log: [],
  };

  activeEncounters.set(encounterId, encounter);
  locationEncounters.set(locationId, encounterId);

  return { encounter };
}

// ============================================
// PLAYER JOIN
// ============================================

function joinEncounter(encounterId, userId, username) {
  const encounter = activeEncounters.get(encounterId);
  if (!encounter) return { error: 'Encounter not found.' };
  if (encounter.phase === 'ended') return { error: 'This encounter has ended.' };
  if (encounter.participants[userId]) return { error: 'Already in this encounter.' };

  // Load combat stats from character sheet
  const sheet = getCharacterSheet(userId);
  let combatStats;

  if (sheet) {
    const strStat = sheet.stats.find(s => s.abbr === 'STR');
    const dexStat = sheet.stats.find(s => s.abbr === 'DEX');
    const strMod = strStat ? strStat.modifier : 0;
    const dexMod = dexStat ? dexStat.modifier : 0;

    const weapon = getBestWeapon(sheet.equipment);
    let attackMod;
    if (weapon.finesse) {
      attackMod = Math.max(strMod, dexMod);
    } else if (weapon.ranged) {
      attackMod = dexMod;
    } else {
      attackMod = strMod;
    }

    combatStats = {
      name: username,
      maxHp: sheet.hp || 10,
      currentHp: sheet.hp || 10,
      ac: sheet.ac || 10,
      attackBonus: attackMod + sheet.profBonus,
      damageMod: weapon.finesse ? Math.max(strMod, dexMod) : (weapon.ranged ? dexMod : strMod),
      damageNotation: weapon.dice,
      weaponName: weapon.name,
      damageType: weapon.type,
      action: null,
      totalDamage: 0,
      knockedOut: false,
    };
  } else {
    // Default stats for players without character sheets
    combatStats = {
      name: username,
      maxHp: 10,
      currentHp: 10,
      ac: 10,
      attackBonus: 2, // 0 mod + 2 prof
      damageMod: 0,
      damageNotation: '1d4',
      weaponName: 'Fists',
      damageType: 'bludgeoning',
      action: null,
      totalDamage: 0,
      knockedOut: false,
    };
  }

  encounter.participants[userId] = combatStats;
  encounter.lastActivity = Date.now();

  return { encounter, combatStats };
}

// ============================================
// PLAYER ACTIONS
// ============================================

function submitAction(encounterId, userId, action, rollData) {
  const encounter = activeEncounters.get(encounterId);
  if (!encounter) return { error: 'Encounter not found.' };
  if (encounter.phase !== 'action') return { error: 'Not in action phase.' };

  const player = encounter.participants[userId];
  if (!player) return { error: 'Not a participant in this encounter.' };
  if (player.knockedOut) return { error: 'You are knocked out!' };
  if (player.action) return { error: 'You already chose an action this round.' };

  if (!['attack', 'defend', 'flee'].includes(action)) {
    return { error: 'Invalid action. Choose attack, defend, or flee.' };
  }

  player.action = action;

  // Store client-provided dice rolls (from 3D dice overlay)
  if (action === 'attack' && rollData) {
    if (typeof rollData.attackRoll === 'number') {
      player.attackRollValue = rollData.attackRoll;
    }
    if (typeof rollData.damageTotal === 'number') {
      player.damageTotalValue = rollData.damageTotal;
    }
  }

  encounter.lastActivity = Date.now();

  // Check if all active players have acted
  const allActed = checkAllActed(encounter);

  return { encounter, allActed };
}

function checkAllActed(encounter) {
  const activePlayers = Object.values(encounter.participants)
    .filter(p => !p.knockedOut);
  if (activePlayers.length === 0) return true;
  // All remaining active players have submitted an action (attack, defend, or flee)
  return activePlayers.every(p => p.action !== null);
}

// ============================================
// ROUND RESOLUTION
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
    locationEncounters.delete(encounter.locationId);
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

  // Get active (non-knocked-out, non-fled) players
  const activePlayers = Object.entries(encounter.participants)
    .filter(([, p]) => !p.knockedOut);

  if (activePlayers.length === 0) return results;

  // Pick targets — weighted by damage dealt (aggro)
  const targets = pickTargets(activePlayers, monster.multiattack);

  for (const attack of monster.attacks) {
    for (const [targetId, targetPlayer] of targets) {
      if (targetPlayer.knockedOut) continue;

      const attackRoll = rollD20();
      const totalAttack = attackRoll + attack.bonus;

      // Defend bonus: +2 AC if player chose defend
      const effectiveAC = targetPlayer.ac + (targetPlayer.action === 'defend' ? 2 : 0);

      const isNat20 = attackRoll === 20;
      const isNat1 = attackRoll === 1;

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

        targetPlayer.currentHp -= damage;
        const knocked = targetPlayer.currentHp <= 0;

        if (knocked) {
          targetPlayer.currentHp = 0;
          targetPlayer.knockedOut = true;
        }

        text = attackTextTemplate.replace('{target}', `**${targetPlayer.name}**`) +
          ` **${totalAttack}** vs AC ${effectiveAC} — **Hit!** ` +
          `**${targetPlayer.name}** takes **${damage} ${attack.type} damage.** ` +
          `(HP: ${targetPlayer.currentHp}/${targetPlayer.maxHp})`;

        if (knocked) {
          text += `\n**${targetPlayer.name}** is knocked out!`;
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
        roll: attackRoll,
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

  return results;
}

/**
 * Prepare monster attacks without rolling dice.
 * Returns { attacks, rollerId } for client to roll.
 */
function prepareMonsterAttacks(encounter) {
  const monster = encounter.monster;
  const activePlayers = Object.entries(encounter.participants)
    .filter(([, p]) => !p.knockedOut);

  if (activePlayers.length === 0) return { attacks: [], rollerId: null };

  const targets = pickTargets(activePlayers, monster.multiattack);
  const attacks = [];
  let index = 0;

  for (const attack of monster.attacks) {
    for (const [targetId, targetPlayer] of targets) {
      if (targetPlayer.knockedOut) continue;
      const effectiveAC = targetPlayer.ac + (targetPlayer.action === 'defend' ? 2 : 0);
      attacks.push({
        index,
        name: attack.name,
        bonus: attack.bonus,
        damageDice: attack.damage,
        damageType: attack.type,
        targetId,
        targetName: targetPlayer.name,
        targetAC: effectiveAC,
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
    // Allow hitting already-KO'd targets (they got KO'd by an earlier attack this turn)
    if (targetPlayer.knockedOut) continue;

    const attackRoll = typeof roll.attackRoll === 'number' ? roll.attackRoll : rollD20();
    const totalAttack = attackRoll + setup.bonus;
    const isNat20 = attackRoll === 20;
    const isNat1 = attackRoll === 1;

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

      targetPlayer.currentHp -= damage;
      const knocked = targetPlayer.currentHp <= 0;
      if (knocked) {
        targetPlayer.currentHp = 0;
        targetPlayer.knockedOut = true;
      }

      text = attackTextTemplate.replace('{target}', `**${targetPlayer.name}**`) +
        ` **${totalAttack}** vs AC ${setup.targetAC} — **Hit!** ` +
        `**${targetPlayer.name}** takes **${damage} ${setup.damageType} damage.** ` +
        `(HP: ${targetPlayer.currentHp}/${targetPlayer.maxHp})`;

      if (knocked) {
        text += `\n**${targetPlayer.name}** is knocked out!`;
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
      roll: attackRoll,
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

  // Check if all players are knocked out
  const activePlayers = Object.values(encounter.participants)
    .filter(p => !p.knockedOut);

  if (activePlayers.length === 0) {
    encounter.phase = 'ended';
    encounter.outcome = 'defeat';
    activeEncounters.delete(encounter.id);
    locationEncounters.delete(encounter.locationId);

    return {
      locationId: encounter.locationId,
      results,
      defeat: true,
      defeatText: monster.fleeText || 'The monster escapes as the last fighter falls.',
    };
  }

  // Advance to next round
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
    locationId: encounter.locationId,
    results,
    round: encounter.round,
    deadline: encounter.actionDeadline,
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
  locationEncounters.delete(encounter.locationId);

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
function distributeRewards(rewards) {
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

function getActiveEncounter(locationId) {
  const encId = locationEncounters.get(locationId);
  if (!encId) return null;
  return activeEncounters.get(encId) || null;
}

function cancelEncounter(encounterId) {
  const encounter = activeEncounters.get(encounterId);
  if (!encounter) return { error: 'Encounter not found.' };

  encounter.phase = 'ended';
  encounter.outcome = 'cancelled';
  activeEncounters.delete(encounterId);
  locationEncounters.delete(encounter.locationId);

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
      locationEncounters.delete(encounter.locationId);
      timedOut.push({ encounter, reason: 'timeout' });
      continue;
    }

    // Round timer expired
    if (encounter.phase === 'action' && now > encounter.actionDeadline) {
      timedOut.push({ encounter, reason: 'round_timeout' });
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
      maxHp: p.maxHp,
      currentHp: p.currentHp,
      ac: p.ac,
      attackBonus: p.attackBonus,
      damageNotation: p.damageNotation,
      damageMod: p.damageMod,
      weaponName: p.weaponName,
      damageType: p.damageType,
      action: p.action ? (p.action === 'fled' ? 'fled' : 'chosen') : null,
      totalDamage: p.totalDamage,
      knockedOut: p.knockedOut,
    };
  }

  return {
    id: encounter.id,
    locationId: encounter.locationId,
    monster: {
      id: encounter.monster.id,
      name: encounter.monster.name,
      description: encounter.monster.description,
      ac: encounter.monster.ac,
      maxHp: encounter.monster.maxHp,
      currentHp: encounter.monster.currentHp,
      cr: encounter.monster.cr,
    },
    round: encounter.round,
    phase: encounter.phase,
    participants,
    actionDeadline: encounter.actionDeadline,
    startedAt: encounter.startedAt,
  };
}

module.exports = {
  spawnEncounter,
  joinEncounter,
  submitAction,
  resolveRound,
  resolveMonsterWithRolls,
  resolveMonsterTurn,
  distributeRewards,
  getEncounter,
  getActiveEncounter,
  cancelEncounter,
  checkTimeouts,
  checkAllActed,
  getPublicState,
  ROUND_TIMER_MS,
};

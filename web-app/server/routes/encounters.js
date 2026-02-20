/**
 * Encounter API Routes
 *
 * Handles combat encounter spawn, join, actions, and status.
 * WebSocket broadcasts for real-time combat narration.
 */

const express = require('express');
const router = express.Router();
const { authRequired } = require('../middleware/auth');
const { getAllMonsters } = require('../lib/monsters');
const {
  spawnEncounter,
  joinEncounter,
  joinWithInitiative,
  submitAction,
  submitInitiativeRoll,
  finalizeInitiativeOrder,
  advanceTurn,
  prepareMonsterAttacks,
  resolveRound,
  resolveMonsterWithRolls,
  resolveMonsterTurn,
  distributeRewards,
  getEncounter,
  getActiveEncounters,
  cancelEncounter,
  checkTimeouts,
  checkAllActed,
  getPublicState,
  getAvailableBonusActions,
  resolveBonusAction,
  SPELL_DEFINITIONS,
} = require('../lib/encounters');
const { checkAchievements } = require('../lib/achievements');
const { generateRolls } = require('../lib/weapons');
const { getActiveAlias } = require('../lib/characterSheets');
const fs = require('fs');
const path = require('path');

const PLAYERS_PATH = path.resolve(__dirname, '..', '..', 'data', 'players.json');

function getPlayerData(userId) {
  try {
    const players = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf-8'));
    return players[userId] || null;
  } catch { return null; }
}

const DM_USER_IDS = (process.env.DM_USER_IDS || '').split(',').filter(Boolean);

function isDM(userId) {
  return DM_USER_IDS.includes(userId);
}

/**
 * Broadcast a message to all WS clients at a specific location.
 */
function broadcastToLocation(req, locationId, payload) {
  const wss = req.app.get('wss');
  if (!wss) return;

  const data = JSON.stringify(payload);
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(data);
    }
  });
}

// ============================================
// DM CONTROLS
// ============================================

/**
 * POST /api/encounters/spawn
 * Spawn a monster at a location. DM only.
 * Body: { locationId, monsterId }
 */
router.post('/spawn', authRequired, (req, res) => {
  const userId = req.user.id;
  const { locationId, monsterId } = req.body;
  // Allow any player to spawn in the Arena; DM-only elsewhere
  if (locationId !== 'the_arena' && !isDM(userId)) {
    return res.status(403).json({ error: 'Only the DM can spawn encounters.' });
  }

  if (!locationId || !monsterId) {
    return res.status(400).json({ error: 'locationId and monsterId are required.' });
  }

  const result = spawnEncounter(locationId, monsterId, userId);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  const publicState = getPublicState(result.encounter);

  // Broadcast spawn to location
  broadcastToLocation(req, locationId, {
    type: 'encounter_spawn',
    locationId,
    encounterId: result.encounter.id,
    encounter: publicState,
  });

  res.json({ encounter: publicState });
});

/**
 * POST /api/encounters/:encounterId/cancel
 * Cancel an encounter. DM only.
 */
router.post('/:encounterId/cancel', authRequired, (req, res) => {
  const userId = req.user.id;
  if (!isDM(userId)) {
    return res.status(403).json({ error: 'Only the DM can cancel encounters.' });
  }

  const result = cancelEncounter(req.params.encounterId);
  if (result.error) {
    return res.status(404).json({ error: result.error });
  }

  broadcastToLocation(req, result.locationId, {
    type: 'encounter_end',
    locationId: result.locationId,
    encounterId: req.params.encounterId,
    outcome: 'cancelled',
  });

  res.json({ success: true });
});

// ============================================
// PLAYER ACTIONS
// ============================================

/**
 * POST /api/encounters/:encounterId/join
 * Join an active encounter.
 */
router.post('/:encounterId/join', authRequired, (req, res) => {
  const userId = req.user.id;
  const aliasId = getActiveAlias(userId);
  const playerData = aliasId ? getPlayerData(aliasId) : getPlayerData(userId);
  const fallbackData = aliasId ? getPlayerData(userId) : null;
  const username = playerData?.characterName || fallbackData?.characterName || req.user.global_name || req.user.username;
  const sprite = playerData?.sprite || fallbackData?.sprite || null;
  const { roll } = req.body || {};

  // Atomic join + initiative when roll is provided
  if (typeof roll === 'number' && roll >= 1 && roll <= 20) {
    const result = joinWithInitiative(req.params.encounterId, userId, username, req.user.avatar, sprite, roll);
    if (result.error) return res.status(400).json({ error: result.error });

    const encounter = result.encounter;
    let publicState = getPublicState(encounter);

    // Broadcast join with initiative result
    broadcastToLocation(req, encounter.locationId, {
      type: 'encounter_join',
      locationId: encounter.locationId,
      encounterId: encounter.id,
      userId,
      playerName: username,
      encounter: publicState,
      initiativeResult: result.initiativeResult,
    });

    // Track lifetime stat
    try { require('../lib/xp').incrementLifetimeStat(userId, username, 'encounters_joined', 1); } catch {}

    // Handle initiative completion
    if (result.midCombatJoin) {
      broadcastToLocation(req, encounter.locationId, {
        type: 'encounter_initiative_update',
        locationId: encounter.locationId,
        encounterId: encounter.id,
        initiativeOrder: encounter.initiativeOrder,
        encounter: getPublicState(encounter),
      });
    } else if (result.allRolled) {
      const order = finalizeInitiativeOrder(encounter);
      publicState = getPublicState(encounter);

      broadcastToLocation(req, encounter.locationId, {
        type: 'encounter_initiative_complete',
        locationId: encounter.locationId,
        encounterId: encounter.id,
        initiativeOrder: order,
        encounter: publicState,
      });

      // Start the first turn
      const firstTurn = order[0];
      if (firstTurn.type === 'monster') {
        handleMonsterTurn(req, encounter);
      } else {
        broadcastToLocation(req, encounter.locationId, {
          type: 'encounter_turn_start',
          locationId: encounter.locationId,
          encounterId: encounter.id,
          currentTurn: firstTurn,
          turnDeadline: encounter.turnDeadline,
          round: encounter.round,
          encounter: getPublicState(encounter),
        });
      }
    }

    return res.json({ encounter: getPublicState(encounter), combatStats: result.combatStats, initiativeResult: result.initiativeResult });
  }

  // Fallback: join without roll (legacy)
  const result = joinEncounter(req.params.encounterId, userId, username, req.user.avatar, sprite);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  const publicState = getPublicState(result.encounter);

  broadcastToLocation(req, result.encounter.locationId, {
    type: 'encounter_join',
    locationId: result.encounter.locationId,
    encounterId: result.encounter.id,
    userId,
    playerName: username,
    encounter: publicState,
  });

  try { require('../lib/xp').incrementLifetimeStat(userId, username, 'encounters_joined', 1); } catch {}

  res.json({ encounter: publicState, combatStats: result.combatStats });
});

/**
 * POST /api/encounters/:encounterId/initiative
 * Submit an initiative roll (d20 result from client dice roll).
 * Body: { roll: number (1-20) }
 */
router.post('/:encounterId/initiative', authRequired, (req, res) => {
  const userId = req.user.id;
  const { roll } = req.body;

  if (typeof roll !== 'number' || roll < 1 || roll > 20) {
    return res.status(400).json({ error: 'Invalid initiative roll.' });
  }

  const result = submitInitiativeRoll(req.params.encounterId, userId, roll);
  if (result.error) return res.status(400).json({ error: result.error });

  const encounter = result.encounter;

  // Broadcast the individual roll to all players
  broadcastToLocation(req, encounter.locationId, {
    type: 'encounter_initiative_roll',
    locationId: encounter.locationId,
    encounterId: encounter.id,
    userId,
    playerName: encounter.participants[userId].name,
    initiativeResult: result.initiativeResult,
  });

  // Mid-combat join: player rolled and was inserted into initiative order
  if (result.midCombatJoin) {
    broadcastToLocation(req, encounter.locationId, {
      type: 'encounter_initiative_update',
      locationId: encounter.locationId,
      encounterId: encounter.id,
      initiativeOrder: encounter.initiativeOrder,
      encounter: getPublicState(encounter),
    });
    return res.json({ success: true, initiativeResult: result.initiativeResult, midCombatJoin: true });
  }

  // If all have rolled, finalize initiative order
  if (result.allRolled) {
    const order = finalizeInitiativeOrder(encounter);

    broadcastToLocation(req, encounter.locationId, {
      type: 'encounter_initiative_complete',
      locationId: encounter.locationId,
      encounterId: encounter.id,
      initiativeOrder: order,
      encounter: getPublicState(encounter),
    });

    // Start the first turn
    const firstTurn = order[0];
    if (firstTurn.type === 'monster') {
      handleMonsterTurn(req, encounter);
    } else {
      broadcastToLocation(req, encounter.locationId, {
        type: 'encounter_turn_start',
        locationId: encounter.locationId,
        encounterId: encounter.id,
        currentTurn: firstTurn,
        turnDeadline: encounter.turnDeadline,
        round: encounter.round,
        encounter: getPublicState(encounter),
      });
    }
  }

  res.json({ success: true, initiativeResult: result.initiativeResult });
});

/**
 * POST /api/encounters/:encounterId/action
 * Submit a combat action (attack, defend, flee, potion, help, lay_on_hands, cast_spell).
 * Body: { action, attackRoll?, attackRoll2?, damageTotal?, potionId?, targetId?, healRoll?, helpTargetId?, smiteData?, healAmount?, spellId?, saveRoll? }
 */
router.post('/:encounterId/action', authRequired, (req, res) => {
  const userId = req.user.id;
  const { action, attackRoll, attackRoll2, damageTotal, potionId, targetId, healRoll, helpTargetId, smiteData, sneakAttackData, inspirationData, healAmount, spellId, saveRoll, weaponId } = req.body;

  if (!action) {
    return res.status(400).json({ error: 'action is required.' });
  }

  // Build rollData from all possible client-provided dice data
  const rollData = {};
  if (typeof attackRoll === 'number') rollData.attackRoll = attackRoll;
  if (typeof attackRoll2 === 'number') rollData.attackRoll2 = attackRoll2;
  if (typeof damageTotal === 'number') rollData.damageTotal = damageTotal;
  if (potionId) rollData.potionId = potionId;
  if (targetId) rollData.targetId = targetId;
  if (typeof healRoll === 'number') rollData.healRoll = healRoll;
  if (helpTargetId) rollData.helpTargetId = helpTargetId;
  if (smiteData) rollData.smiteData = smiteData;
  if (sneakAttackData) rollData.sneakAttackData = sneakAttackData;
  if (inspirationData) rollData.inspirationData = inspirationData;
  if (typeof healAmount === 'number') rollData.healAmount = healAmount;
  if (spellId) rollData.spellId = spellId;
  if (typeof saveRoll === 'number') rollData.saveRoll = saveRoll;
  if (weaponId) rollData.weaponId = weaponId;

  const result = submitAction(req.params.encounterId, userId, action, rollData);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  const encounter = result.encounter;

  // Broadcast the resolved action result (turn-based: action resolves immediately)
  if (result.result) {
    // Log the result for killing blow tracking
    if (!encounter.log[encounter.round - 1]) {
      encounter.log[encounter.round - 1] = { round: encounter.round, results: [] };
    }
    encounter.log[encounter.round - 1].results.push(result.result);

    broadcastToLocation(req, encounter.locationId, {
      type: 'encounter_turn_result',
      locationId: encounter.locationId,
      encounterId: encounter.id,
      result: result.result,
      monsterHp: encounter.monster.currentHp,
      monsterMaxHp: encounter.monster.maxHp,
      encounter: getPublicState(encounter),
    });
  }

  // Check if bonus actions are available before advancing turn
  const playerAfterAction = encounter.participants[userId];
  const monsterDead = encounter.monster.currentHp <= 0;
  const playerFled = result.result?.type === 'flee';
  const playerKO = playerAfterAction?.knockedOut;

  if (!monsterDead && !playerFled && !playerKO && !playerAfterAction?.bonusActionUsed) {
    const bonusActions = getAvailableBonusActions(encounter, userId);

    if (bonusActions.length > 0) {
      encounter.bonusActionPhase = true;
      broadcastToLocation(req, encounter.locationId, {
        type: 'encounter_bonus_phase',
        locationId: encounter.locationId,
        encounterId: encounter.id,
        userId,
        playerName: playerAfterAction.name,
        availableBonusActions: bonusActions,
        encounter: getPublicState(encounter),
      });
      return res.json({ success: true, bonusActionPhase: true });
    }
  }

  // No bonus actions — advance as normal
  const turnResult = advanceTurn(encounter);
  handleTurnAdvance(req, encounter, turnResult);

  res.json({ success: true });
});

/**
 * GET /api/encounters/:encounterId/potions
 * Get the current player's potion inventory for use in combat.
 */
router.get('/:encounterId/potions', authRequired, (req, res) => {
  const userId = req.user.id;
  try {
    const { getInventory, findItemInCatalog } = require('../lib/economy');
    const inv = getInventory(userId);
    const potions = (inv?.items || [])
      .filter(i => {
        const cat = findItemInCatalog(i.item_id);
        return cat && cat.item.type === 'potion';
      })
      .map(i => {
        const cat = findItemInCatalog(i.item_id);
        return {
          item_id: i.item_id,
          name: i.name,
          quantity: i.quantity,
          heal_dice: cat.item.heal_dice,
          description: cat.item.description,
        };
      });
    res.json({ potions });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load potions.' });
  }
});

/**
 * GET /api/encounters/:encounterId/spells
 * Get available main-action spells for the current player.
 */
router.get('/:encounterId/spells', authRequired, (req, res) => {
  const encounter = getEncounter(req.params.encounterId);
  if (!encounter) return res.status(404).json({ error: 'Encounter not found.' });
  const player = encounter.participants?.[req.user.id];
  if (!player) return res.status(403).json({ error: 'Not a participant.' });

  if (!player.classFeatures?.includes('Spellcasting')) {
    return res.json({ spells: [] });
  }

  const playerClasses = player.classNames || [];
  const spells = [];
  for (const [id, spell] of Object.entries(SPELL_DEFINITIONS)) {
    if (spell.actionType !== 'action') continue; // bonus action spells handled separately
    // Only show spells available to the player's class(es)
    if (spell.classes && !spell.classes.some(c => playerClasses.includes(c))) continue;
    if (spell.level === 0) {
      // Cantrips — always available
      spells.push({ id, ...spell });
    } else {
      // Leveled spells — need an available slot
      const hasSlot = (player.spellSlots || []).some(s => s.level >= spell.level && s.used < s.total);
      if (hasSlot) {
        spells.push({ id, ...spell });
      }
    }
  }
  res.json({ spells });
});

/**
 * GET /api/encounters/:encounterId/weapons
 * Get available weapons for the current player.
 */
router.get('/:encounterId/weapons', authRequired, (req, res) => {
  const encounter = getEncounter(req.params.encounterId);
  if (!encounter) return res.status(404).json({ error: 'Encounter not found.' });
  const player = encounter.participants?.[req.user.id];
  if (!player) return res.status(403).json({ error: 'Not a participant.' });
  res.json({ weapons: player.weapons || [] });
});

/**
 * POST /api/encounters/:encounterId/bonus-action
 * Execute a bonus action (potion_self, bardic_inspiration) or skip.
 * Body: { bonusAction: 'skip' | 'potion_self' | 'bardic_inspiration', potionId?, healRoll?, targetId? }
 */
router.post('/:encounterId/bonus-action', authRequired, (req, res) => {
  const userId = req.user.id;
  const encounter = getEncounter(req.params.encounterId);
  if (!encounter) return res.status(404).json({ error: 'Encounter not found.' });

  const player = encounter.participants?.[userId];
  if (!player) return res.status(403).json({ error: 'Not a participant.' });

  // Validate it's this player's turn
  const currentTurn = encounter.initiativeOrder[encounter.currentTurnIndex];
  if (!currentTurn || currentTurn.id !== userId) {
    return res.status(400).json({ error: 'It is not your turn.' });
  }

  if (!encounter.bonusActionPhase) {
    return res.status(400).json({ error: 'Not in bonus action phase.' });
  }

  const { bonusAction, potionId, healRoll, targetId, weaponId, attackRoll, damageTotal } = req.body;

  if (bonusAction === 'skip') {
    encounter.bonusActionPhase = false;
    const turnResult = advanceTurn(encounter);
    handleTurnAdvance(req, encounter, turnResult);
    return res.json({ success: true });
  }

  const result = resolveBonusAction(encounter, userId, bonusAction, { potionId, healRoll, targetId, weaponId, attackRoll, damageTotal });
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  encounter.bonusActionPhase = false;

  // Broadcast the bonus action result
  broadcastToLocation(req, encounter.locationId, {
    type: 'encounter_bonus_result',
    locationId: encounter.locationId,
    encounterId: encounter.id,
    result,
    encounter: getPublicState(encounter),
  });

  // Advance turn
  const turnResult = advanceTurn(encounter);
  handleTurnAdvance(req, encounter, turnResult);

  res.json({ success: true });
});

/**
 * POST /api/encounters/:encounterId/pre-bonus-action
 * Use a bonus action BEFORE the main action (e.g. Bardic Inspiration before attacking).
 * Same resolution as bonus-action but does NOT advance the turn.
 */
router.post('/:encounterId/pre-bonus-action', authRequired, (req, res) => {
  const userId = req.user.id;
  const encounter = getEncounter(req.params.encounterId);
  if (!encounter) return res.status(404).json({ error: 'Encounter not found.' });

  const player = encounter.participants?.[userId];
  if (!player) return res.status(403).json({ error: 'Not a participant.' });

  const currentTurn = encounter.initiativeOrder[encounter.currentTurnIndex];
  if (!currentTurn || currentTurn.id !== userId) {
    return res.status(400).json({ error: 'It is not your turn.' });
  }

  if (player.bonusActionUsed) {
    return res.status(400).json({ error: 'Bonus action already used this turn.' });
  }

  const { bonusAction, targetId, potionId, healRoll } = req.body;

  const result = resolveBonusAction(encounter, userId, bonusAction, { potionId, healRoll, targetId });
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  // Broadcast result but do NOT advance turn — player still needs their main action
  broadcastToLocation(req, encounter.locationId, {
    type: 'encounter_bonus_result',
    locationId: encounter.locationId,
    encounterId: encounter.id,
    result,
    encounter: getPublicState(encounter),
  });

  res.json({ success: true });
});

/**
 * POST /api/encounters/:encounterId/monster-rolls
 * Submit dice roll results for monster attacks.
 * Called by the designated roller client after rolling 3D dice.
 * Body: { rolls: [{ index, attackRoll, attackRoll2?, damageTotal }, ...] }
 */
router.post('/:encounterId/monster-rolls', authRequired, (req, res) => {
  const { rolls } = req.body;
  if (!Array.isArray(rolls)) {
    return res.status(400).json({ error: 'rolls array is required.' });
  }

  const result = resolveMonsterWithRolls(req.params.encounterId, rolls);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  const encounter = getEncounter(req.params.encounterId);
  const locationId = result.locationId;

  // Return to action phase before broadcasting so clients get the right phase
  if (encounter && !result.defeat) {
    encounter.phase = 'action';
  }

  // Broadcast monster attack results
  if (result.results && result.results.length > 0) {
    broadcastToLocation(req, locationId, {
      type: 'encounter_monster_turn',
      locationId,
      encounterId: req.params.encounterId,
      attacks: result.results,
      monsterConditionEffects: result.monsterConditionEffects || null,
      encounter: encounter ? getPublicState(encounter) : null,
    });
  }

  // Turn-based: after monster attacks, advance turn
  if (encounter && !result.defeat) {
    const turnResult = advanceTurn(encounter);
    handleTurnAdvance(req, encounter, turnResult);
  } else if (result.defeat) {
    broadcastToLocation(req, locationId, {
      type: 'encounter_end',
      locationId,
      encounterId: req.params.encounterId,
      outcome: 'defeat',
      defeatText: result.defeatText,
    });
  }

  res.json({ success: true });
});

/**
 * GET /api/encounters/active/:locationId
 * Get the active encounter at a location (or null).
 */
router.get('/active/:locationId', authRequired, (req, res) => {
  const encounters = getActiveEncounters({ locationId: req.params.locationId });
  res.json({ encounters: encounters.map(e => getPublicState(e)) });
});

/**
 * GET /api/encounters/monsters/list
 * List available monsters (for DM spawn UI).
 */
router.get('/monsters/list', authRequired, (req, res) => {
  if (!isDM(req.user.id)) {
    return res.status(403).json({ error: 'DM only.' });
  }

  const monsters = getAllMonsters().map(m => ({
    id: m.id,
    name: m.name,
    cr: m.cr,
    ac: m.ac,
    maxHp: m.maxHp,
    description: m.description,
  }));

  res.json({ monsters });
});

/**
 * GET /api/encounters/monsters/arena
 * List available monsters for the Arena (any player).
 */
router.get('/monsters/arena', authRequired, (req, res) => {
  const monsters = getAllMonsters().map(m => ({
    id: m.id,
    name: m.name,
    image: m.image,
    sprite: m.sprite,
    cr: m.cr,
    ac: m.ac,
    maxHp: m.maxHp,
    description: m.description,
    xpReward: m.xpReward,
    goldReward: m.goldReward,
  }));

  res.json({ monsters });
});

/**
 * POST /api/encounters/roll-broadcast
 * Generate server-side dice rolls, broadcast to all arena spectators, and return to caller.
 * Body: { notation, modifier, color, label, locationId }
 * Returns: { rolls, total } where rolls = raw die faces, total = sum(rolls) + modifier
 */
router.post('/roll-broadcast', authRequired, (req, res) => {
  const { notation, modifier, color, label, locationId, colorset, material, advantageType } = req.body;
  if (locationId !== 'the_arena') {
    return res.status(400).json({ error: 'Roll broadcasts are arena-only.' });
  }
  if (!notation) {
    return res.status(400).json({ error: 'notation is required.' });
  }

  const { rolls, total: diceTotal } = generateRolls(notation);
  const mod = modifier || 0;
  const total = diceTotal + mod;

  broadcastToLocation(req, locationId, {
    type: 'arena_dice_roll',
    locationId,
    senderId: req.user.id,
    notation,
    modifier: mod,
    total,
    rolls,
    color: color || '#eab308',
    colorset: colorset || 'white',
    material: material || 'plastic',
    label: label || '',
    advantageType: advantageType || undefined,
  });

  res.json({ rolls, total });
});

/**
 * POST /api/encounters/result-broadcast
 * Broadcast a roll result overlay to all players at the arena location.
 * Body: { locationId, resultData }
 */
router.post('/result-broadcast', authRequired, (req, res) => {
  const { locationId, resultData } = req.body;
  if (locationId !== 'the_arena') {
    return res.status(400).json({ error: 'Result broadcasts are arena-only.' });
  }

  broadcastToLocation(req, locationId, {
    type: 'arena_roll_result',
    locationId,
    senderId: req.user.id,
    resultData,
  });

  res.json({ success: true });
});

/**
 * GET /api/encounters/:encounterId
 * Get current encounter state. Must be after /active and /monsters routes.
 */
router.get('/:encounterId', authRequired, (req, res) => {
  const encounter = getEncounter(req.params.encounterId);
  if (!encounter) {
    return res.status(404).json({ error: 'Encounter not found.' });
  }

  res.json({ encounter: getPublicState(encounter) });
});

// ============================================
// TURN-BASED ADVANCEMENT HANDLERS
// ============================================

function handleTurnAdvance(req, encounter, turnResult) {
  const locationId = encounter.locationId;

  if (turnResult.type === 'victory') {
    const rewardResults = distributeRewards(turnResult.victoryResult.rewards, encounter.monster?.id);

    // Check achievements for all participants
    const allAchievements = {};
    for (const [userId, reward] of Object.entries(rewardResults)) {
      try {
        const achResult = checkAchievements(userId, reward.name, 'combat_encounter', {
          encounters_won: true,
          combat_kill: reward.killingBlow,
          untouchable: reward.untouchable,
          monster_cr: encounter.monster?.cr,
          monster_id: encounter.monster?.id,
        });
        if (achResult.newAchievements && achResult.newAchievements.length > 0) {
          allAchievements[userId] = achResult.newAchievements;
        }
      } catch {}
    }

    broadcastToLocation(req, locationId, {
      type: 'encounter_end',
      locationId,
      encounterId: encounter.id,
      outcome: 'victory',
      deathText: turnResult.victoryResult.deathText,
      monsterName: turnResult.victoryResult.monsterName,
      rewards: rewardResults,
      achievements: allAchievements,
    });
    return;
  }

  if (turnResult.type === 'defeat') {
    // Track knockouts
    for (const [userId, player] of Object.entries(encounter.participants)) {
      if (player.knockedOut && player.action !== 'fled') {
        try {
          require('../lib/xp').incrementLifetimeStat(userId, player.name, 'times_knocked_out', 1);
        } catch {}
      }
    }

    broadcastToLocation(req, locationId, {
      type: 'encounter_end',
      locationId,
      encounterId: encounter.id,
      outcome: 'defeat',
      defeatText: turnResult.defeatText,
    });
    return;
  }

  if (turnResult.type === 'turn_skipped') {
    // Player is stunned/incapacitated — broadcast skip and auto-advance
    broadcastToLocation(req, locationId, {
      type: 'encounter_turn_skip',
      locationId,
      encounterId: encounter.id,
      name: turnResult.name,
      reason: turnResult.reason,
      conditionEffects: turnResult.conditionEffects || null,
      encounter: getPublicState(encounter),
    });
    // Auto-advance to next turn after a brief delay so clients can show the skip
    setTimeout(() => {
      const nextResult = advanceTurn(encounter);
      handleTurnAdvance(req, encounter, nextResult);
    }, 1500);
    return;
  }

  if (turnResult.type === 'next_turn') {
    // Broadcast player condition effects (DoT damage, expired conditions) if any
    if (turnResult.conditionEffects) {
      const effects = turnResult.conditionEffects;
      if (effects.dotEffects.length > 0 || effects.removed.length > 0) {
        broadcastToLocation(req, locationId, {
          type: 'encounter_condition_tick',
          locationId,
          encounterId: encounter.id,
          entry: turnResult.entry,
          conditionEffects: effects,
          encounter: getPublicState(encounter),
        });
      }
    }
    // Note: Monster condition effects are broadcast via encounter_monster_turn
    // (ticked after monster attacks in resolveMonsterWithRolls)

    if (turnResult.entry.type === 'monster') {
      handleMonsterTurn(req, encounter);
    } else {
      broadcastToLocation(req, locationId, {
        type: 'encounter_turn_start',
        locationId,
        encounterId: encounter.id,
        currentTurn: turnResult.entry,
        turnDeadline: encounter.turnDeadline,
        round: encounter.round,
        newRound: turnResult.newRound || false,
        encounter: getPublicState(encounter),
      });
    }
  }
}

function handleMonsterTurn(req, encounter) {
  const monsterSetup = prepareMonsterAttacks(encounter);

  if (monsterSetup.attacks.length === 0) {
    // No targets — skip monster turn, advance
    const turnResult = advanceTurn(encounter);
    handleTurnAdvance(req, encounter, turnResult);
    return;
  }

  encounter.monsterAttackSetup = monsterSetup;
  encounter.phase = 'monster_rolling';
  encounter.monsterRollDeadline = Date.now() + 30_000;

  broadcastToLocation(req, encounter.locationId, {
    type: 'encounter_monster_roll_needed',
    locationId: encounter.locationId,
    encounterId: encounter.id,
    rollerId: monsterSetup.rollerId,
    attacks: monsterSetup.attacks,
    monsterName: encounter.monster.name,
    encounter: getPublicState(encounter),
  });
}

// ============================================
// ROUND RESOLUTION HANDLER (legacy — kept for timeout fallback)
// ============================================

function handleRoundResult(req, encounter, roundResult) {
  if (!roundResult) return;

  const locationId = encounter.locationId;

  // Broadcast player attack results
  if (roundResult.results && roundResult.results.length > 0) {
    broadcastToLocation(req, locationId, {
      type: 'encounter_round',
      locationId,
      encounterId: encounter.id,
      round: encounter.round - (roundResult.phase === 'action' ? 1 : 0),
      results: roundResult.results,
      monsterHp: roundResult.monsterHp !== undefined ? roundResult.monsterHp : encounter.monster.currentHp,
      monsterMaxHp: encounter.monster.maxHp,
    });
  }

  // Monster roll needed — send setup to clients so designated roller can roll dice
  if (roundResult.monsterRollSetup) {
    broadcastToLocation(req, locationId, {
      type: 'encounter_monster_roll_needed',
      locationId,
      encounterId: encounter.id,
      rollerId: roundResult.monsterRollSetup.rollerId,
      attacks: roundResult.monsterRollSetup.attacks,
      monsterName: encounter.monster.name,
    });
    return; // Wait for client to roll and POST /monster-rolls
  }

  // Everyone fled — end cleanly
  if (roundResult.fled) {
    broadcastToLocation(req, locationId, {
      type: 'encounter_end',
      locationId,
      encounterId: encounter.id,
      outcome: 'fled',
      defeatText: encounter.monster.fleeText || 'The party flees into the shadows...',
    });
    return;
  }

  // Victory
  if (roundResult.victory) {
    const rewardResults = distributeRewards(roundResult.victory.rewards, encounter.monster?.id);

    // Check achievements for all participants
    const allAchievements = {};
    for (const [userId, reward] of Object.entries(rewardResults)) {
      try {
        const achResult = checkAchievements(userId, reward.name, 'combat_encounter', {
          encounters_won: true,
          combat_kill: reward.killingBlow,
          untouchable: reward.untouchable,
          monster_cr: encounter.monster.cr,
          monster_id: encounter.monster?.id,
        });
        if (achResult.newAchievements && achResult.newAchievements.length > 0) {
          allAchievements[userId] = achResult.newAchievements;
        }
      } catch {}
    }

    broadcastToLocation(req, locationId, {
      type: 'encounter_end',
      locationId,
      encounterId: encounter.id,
      outcome: 'victory',
      deathText: roundResult.victory.deathText,
      monsterName: roundResult.victory.monsterName,
      rewards: rewardResults,
      achievements: allAchievements,
    });
    return;
  }

  // Defeat
  if (roundResult.defeat) {
    // Track knockouts for all participants
    for (const [userId, player] of Object.entries(encounter.participants)) {
      if (player.knockedOut && player.action !== 'fled') {
        try {
          require('../lib/xp').incrementLifetimeStat(userId, player.name, 'times_knocked_out', 1);
        } catch {}
      }
    }

    broadcastToLocation(req, locationId, {
      type: 'encounter_end',
      locationId,
      encounterId: encounter.id,
      outcome: 'defeat',
      defeatText: roundResult.defeatText,
    });
    return;
  }

  // Next round — broadcast updated state with new deadline
  broadcastToLocation(req, locationId, {
    type: 'encounter_new_round',
    locationId,
    encounterId: encounter.id,
    round: roundResult.round,
    deadline: roundResult.deadline,
    encounter: getPublicState(encounter),
  });
}

// ============================================
// TIMEOUT CHECKER (runs every 5 seconds)
// ============================================

let timeoutInterval = null;

function startTimeoutChecker(app) {
  if (timeoutInterval) return;

  timeoutInterval = setInterval(() => {
    const timedOut = checkTimeouts();

    for (const { encounter, reason } of timedOut) {
      if (reason === 'turn_timeout') {
        const fakeReq = { app };

        // If in bonus action phase, auto-skip it
        if (encounter.bonusActionPhase) {
          encounter.bonusActionPhase = false;
          const turnResult = advanceTurn(encounter);
          handleTurnAdvance(fakeReq, encounter, turnResult);
          continue;
        }

        // Current player's turn timed out — skip with "hesitates" message
        const currentEntry = encounter.initiativeOrder[encounter.currentTurnIndex];
        if (currentEntry && currentEntry.type === 'player') {
          broadcastToLocation(fakeReq, encounter.locationId, {
            type: 'encounter_turn_result',
            locationId: encounter.locationId,
            encounterId: encounter.id,
            result: {
              type: 'timeout',
              userId: currentEntry.id,
              name: currentEntry.name,
              text: `**${currentEntry.name}** hesitates and does nothing.`,
            },
            encounter: getPublicState(encounter),
          });
        }
        const turnResult = advanceTurn(encounter);
        handleTurnAdvance(fakeReq, encounter, turnResult);
      } else if (reason === 'round_timeout') {
        // Legacy round timeout — shouldn't happen in new system but kept for safety
        const roundResult = resolveRound(encounter);
        const fakeReq = { app };
        handleRoundResult(fakeReq, encounter, roundResult);
      } else if (reason === 'monster_roll_timeout') {
        // Client didn't roll in time — auto-roll monster attacks server-side
        const fakeReq = { app };
        const autoRolls = (encounter.monsterAttackSetup?.attacks || []).map(a => ({
          index: a.index,
          // No attackRoll/damageTotal — resolveMonsterWithRolls will auto-roll
        }));
        const result = resolveMonsterWithRolls(encounter.id, autoRolls);
        if (!result.error) {
          const locationId = result.locationId;
          if (result.results && result.results.length > 0) {
            broadcastToLocation(fakeReq, locationId, {
              type: 'encounter_monster_turn',
              locationId,
              encounterId: encounter.id,
              attacks: result.results,
              encounter: getPublicState(getEncounter(encounter.id)),
            });
          }
          if (result.defeat) {
            broadcastToLocation(fakeReq, locationId, {
              type: 'encounter_end',
              locationId,
              encounterId: encounter.id,
              outcome: 'defeat',
              defeatText: result.defeatText,
            });
          } else {
            // Turn-based: advance to next turn after monster auto-roll
            const enc = getEncounter(encounter.id);
            if (enc) {
              enc.phase = 'action';
              const turnResult = advanceTurn(enc);
              handleTurnAdvance(fakeReq, enc, turnResult);
            }
          }
        }
      } else if (reason === 'timeout') {
        // Full encounter timeout
        const fakeReq = { app };
        broadcastToLocation(fakeReq, encounter.locationId, {
          type: 'encounter_end',
          locationId: encounter.locationId,
          encounterId: encounter.id,
          outcome: 'timeout',
          defeatText: 'The creature retreats into the shadows as silence falls...',
        });
      }
    }
  }, 5000);
}

router.startTimeoutChecker = startTimeoutChecker;

module.exports = router;

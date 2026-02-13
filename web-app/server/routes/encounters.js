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
} = require('../lib/encounters');
const { checkAchievements } = require('../lib/achievements');

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
  const username = req.user.characterName || req.user.global_name || req.user.username;

  const result = joinEncounter(req.params.encounterId, userId, username);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  const publicState = getPublicState(result.encounter);

  // Broadcast player joined
  broadcastToLocation(req, result.encounter.locationId, {
    type: 'encounter_join',
    locationId: result.encounter.locationId,
    encounterId: result.encounter.id,
    userId,
    playerName: username,
    encounter: publicState,
  });

  // Track lifetime stat
  try {
    require('../lib/xp').incrementLifetimeStat(userId, username, 'encounters_joined', 1);
  } catch {}

  res.json({ encounter: publicState, combatStats: result.combatStats });
});

/**
 * POST /api/encounters/:encounterId/action
 * Submit a combat action (attack, defend, flee).
 * Body: { action: 'attack' | 'defend' | 'flee' }
 */
router.post('/:encounterId/action', authRequired, (req, res) => {
  const userId = req.user.id;
  const { action, attackRoll, damageTotal } = req.body;

  if (!action) {
    return res.status(400).json({ error: 'action is required.' });
  }

  // Pass client dice roll data (from 3D dice overlay) if provided
  const rollData = (typeof attackRoll === 'number' || typeof damageTotal === 'number')
    ? { attackRoll, damageTotal }
    : undefined;

  const result = submitAction(req.params.encounterId, userId, action, rollData);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  // Broadcast that a player has acted (without revealing the action)
  broadcastToLocation(req, result.encounter.locationId, {
    type: 'encounter_action',
    locationId: result.encounter.locationId,
    encounterId: result.encounter.id,
    userId,
    encounter: getPublicState(result.encounter),
  });

  // If all players have acted, resolve the round
  if (result.allActed) {
    const roundResult = resolveRound(result.encounter);
    handleRoundResult(req, result.encounter, roundResult);
  }

  res.json({ success: true, allActed: result.allActed });
});

/**
 * POST /api/encounters/:encounterId/monster-rolls
 * Submit dice roll results for monster attacks.
 * Called by the designated roller client after rolling 3D dice.
 * Body: { rolls: [{ index, attackRoll, damageTotal }, ...] }
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

  // Broadcast monster attack results
  if (result.results && result.results.length > 0) {
    broadcastToLocation(req, locationId, {
      type: 'encounter_monster_turn',
      locationId,
      encounterId: req.params.encounterId,
      attacks: result.results,
      encounter: encounter ? getPublicState(encounter) : null,
    });
  }

  if (result.defeat) {
    // Track knockouts
    const enc = getEncounter(req.params.encounterId);
    // Encounter already cleaned up in resolveMonsterWithRolls, use result data
    broadcastToLocation(req, locationId, {
      type: 'encounter_end',
      locationId,
      encounterId: req.params.encounterId,
      outcome: 'defeat',
      defeatText: result.defeatText,
    });
  } else if (result.round) {
    // Next round
    broadcastToLocation(req, locationId, {
      type: 'encounter_new_round',
      locationId,
      encounterId: req.params.encounterId,
      round: result.round,
      deadline: result.deadline,
      encounter: encounter ? getPublicState(encounter) : null,
    });
  }

  res.json({ success: true });
});

/**
 * GET /api/encounters/active/:locationId
 * Get the active encounter at a location (or null).
 */
router.get('/active/:locationId', authRequired, (req, res) => {
  const encounter = getActiveEncounter(req.params.locationId);
  res.json({ encounter: encounter ? getPublicState(encounter) : null });
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
    cr: m.cr,
    ac: m.ac,
    maxHp: m.maxHp,
    description: m.description,
  }));

  res.json({ monsters });
});

/**
 * POST /api/encounters/roll-broadcast
 * Broadcast a dice roll to all players at the arena location.
 * Body: { notation, modifier, total, color, label, locationId }
 */
router.post('/roll-broadcast', authRequired, (req, res) => {
  const { notation, modifier, total, color, label, locationId } = req.body;
  if (locationId !== 'the_arena') {
    return res.status(400).json({ error: 'Roll broadcasts are arena-only.' });
  }

  broadcastToLocation(req, locationId, {
    type: 'arena_dice_roll',
    locationId,
    senderId: req.user.id,
    notation,
    modifier: modifier || 0,
    total,
    color: color || '#eab308',
    label: label || '',
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
// ROUND RESOLUTION HANDLER
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
    const rewardResults = distributeRewards(roundResult.victory.rewards);

    // Check achievements for all participants
    const allAchievements = {};
    for (const [userId, reward] of Object.entries(rewardResults)) {
      try {
        const achResult = checkAchievements(userId, reward.name, 'combat_encounter', {
          encounters_won: true,
          combat_kill: reward.killingBlow,
          untouchable: reward.untouchable,
          monster_cr: encounter.monster.cr,
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
      if (reason === 'round_timeout') {
        // Resolve the round with whatever actions were submitted
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
          } else if (result.round) {
            broadcastToLocation(fakeReq, locationId, {
              type: 'encounter_new_round',
              locationId,
              encounterId: encounter.id,
              round: result.round,
              deadline: result.deadline,
              encounter: getPublicState(getEncounter(encounter.id)),
            });
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

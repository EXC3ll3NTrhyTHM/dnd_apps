/**
 * Admin API Routes
 *
 * Protected routes for managing game data (scene placements, etc.)
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { authRequired } = require('../middleware/auth');
const { awardGold, getWallet, spendGold } = require('../lib/economy');
const { dmAwardXp, getXpRecord, getLevelFromXp, getLevel, loadXpData, saveXpData } = require('../lib/xp');
const { loadMonsters } = require('../lib/monsters');
const { getActiveEncounters } = require('../lib/encounters');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const LOCATIONS_FILE = path.join(DATA_DIR, 'locations.json');
const MONSTERS_FILE = path.join(DATA_DIR, 'monsters.json');
const ARENA_CONFIG_FILE = path.join(DATA_DIR, 'arena_config.json');

// List of admin Discord user IDs
const ADMIN_IDS = [
  '424061511833747467' // Blake
];

function adminRequired(req, res, next) {
  if (!req.user || !ADMIN_IDS.includes(req.user.id)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/**
 * PUT /api/admin/locations/:locationId/scene
 * Update NPC placements for a location's scene
 */
router.put('/locations/:locationId/scene', authRequired, adminRequired, (req, res) => {
  const { locationId } = req.params;
  const { npcPlacements } = req.body;

  if (!npcPlacements || typeof npcPlacements !== 'object') {
    return res.status(400).json({ error: 'npcPlacements object required' });
  }

  try {
    // Load current locations
    const locations = JSON.parse(fs.readFileSync(LOCATIONS_FILE, 'utf-8'));

    if (!locations[locationId]) {
      return res.status(404).json({ error: 'Location not found' });
    }

    if (!locations[locationId].scene) {
      return res.status(400).json({ error: 'Location does not have a scene' });
    }

    // Update placements
    locations[locationId].scene.npcPlacements = npcPlacements;

    // Write back (atomic via temp file)
    const tmpPath = LOCATIONS_FILE + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(locations, null, 2));
    fs.renameSync(tmpPath, LOCATIONS_FILE);

    console.log(`[admin] Updated scene placements for ${locationId}`);
    res.json({ success: true, locationId, npcPlacements });
  } catch (err) {
    console.error('[admin] Failed to update scene:', err.message);
    res.status(500).json({ error: 'Failed to save placements' });
  }
});

/**
 * PUT /api/admin/locations/:locationId/groups
 * Update groups for a location
 */
router.put('/locations/:locationId/groups', authRequired, adminRequired, (req, res) => {
  const { locationId } = req.params;
  const { groups } = req.body;

  if (!groups || typeof groups !== 'object') {
    return res.status(400).json({ error: 'groups object required' });
  }

  // Validate group structure
  for (const [groupId, group] of Object.entries(groups)) {
    if (!group.displayName || typeof group.displayName !== 'string') {
      return res.status(400).json({ error: `Group "${groupId}" requires a displayName string` });
    }
    if (!Array.isArray(group.members)) {
      return res.status(400).json({ error: `Group "${groupId}" requires a members array` });
    }
  }

  try {
    const locations = JSON.parse(fs.readFileSync(LOCATIONS_FILE, 'utf-8'));

    if (!locations[locationId]) {
      return res.status(404).json({ error: 'Location not found' });
    }

    locations[locationId].groups = groups;

    // Write back (atomic via temp file)
    const tmpPath = LOCATIONS_FILE + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(locations, null, 2));
    fs.renameSync(tmpPath, LOCATIONS_FILE);

    console.log(`[admin] Updated groups for ${locationId}`);
    res.json({ success: true, locationId, groups });
  } catch (err) {
    console.error('[admin] Failed to update groups:', err.message);
    res.status(500).json({ error: 'Failed to save groups' });
  }
});

// Notify a player's client to refresh their wallet/XP data
function broadcastRefresh(req, userId, awardType, change) {
  const wss = req.app.get('wss');
  if (!wss) return;
  const payload = JSON.stringify({ type: 'dm_award', userId, awardType, change });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(payload);
  });
}

/**
 * POST /api/admin/award-gold
 * Award or deduct gold from a player
 * Body: { user_id, amount } — positive to give, negative to take
 */
router.post('/award-gold', authRequired, adminRequired, (req, res) => {
  const { user_id, amount } = req.body;
  if (!user_id || typeof amount !== 'number' || amount === 0) {
    return res.status(400).json({ error: 'user_id and non-zero amount required' });
  }

  try {
    if (amount > 0) {
      const wallet = awardGold(user_id, undefined, amount, { source: 'dm_award' });
      console.log(`[admin] Awarded ${amount} gold to ${user_id}`);
      broadcastRefresh(req, user_id, 'gold', amount);
      res.json({ success: true, user_id, balance: wallet.balance, change: amount });
    } else {
      // Deduct gold — use spendGold but allow going to zero
      const wallet = getWallet(user_id);
      const deduction = Math.min(Math.abs(amount), wallet.balance);
      if (deduction === 0) {
        return res.json({ success: true, user_id, balance: wallet.balance, change: 0, note: 'Player has no gold' });
      }
      const updated = spendGold(user_id, undefined, deduction, 'dm_deduction', { source: 'dm_deduction' });
      console.log(`[admin] Deducted ${deduction} gold from ${user_id}`);
      broadcastRefresh(req, user_id, 'gold', -deduction);
      res.json({ success: true, user_id, balance: updated.balance, change: -deduction });
    }
  } catch (err) {
    console.error('[admin] Gold award error:', err.message);
    res.status(500).json({ error: 'Failed to update gold' });
  }
});

/**
 * POST /api/admin/award-xp
 * Award or deduct XP from a player
 * Body: { user_id, amount } — positive to give, negative to take
 */
router.post('/award-xp', authRequired, adminRequired, (req, res) => {
  const { user_id, amount } = req.body;
  if (!user_id || typeof amount !== 'number' || amount === 0) {
    return res.status(400).json({ error: 'user_id and non-zero amount required' });
  }

  try {
    const levelBefore = getLevel(user_id, undefined);

    if (amount > 0) {
      const record = dmAwardXp(user_id, undefined, amount, 'DM award');
      const levelInfo = getLevelFromXp(record.total_xp);
      console.log(`[admin] Awarded ${amount} XP to ${user_id}`);

      // Broadcast level-up via WebSocket if level increased
      if (levelInfo.level > levelBefore) {
        const wss = req.app.get('wss');
        if (wss) {
          const payload = JSON.stringify({ type: 'level_up', userId: user_id, newLevel: levelInfo.level });
          wss.clients.forEach(client => {
            if (client.readyState === 1) client.send(payload);
          });
        }
      }

      broadcastRefresh(req, user_id, 'xp', amount);
      res.json({ success: true, user_id, total_xp: record.total_xp, level: levelInfo.level, change: amount });
    } else {
      // Deduct XP — dmAwardXp doesn't support negative, so do it manually
      const data = loadXpData();
      const record = data[user_id];
      if (!record) {
        return res.status(404).json({ error: 'Player XP record not found' });
      }
      const deduction = Math.min(Math.abs(amount), record.total_xp);
      record.total_xp -= deduction;
      record.last_updated = new Date().toISOString();
      saveXpData(data);
      const levelInfo = getLevelFromXp(record.total_xp);
      console.log(`[admin] Deducted ${deduction} XP from ${user_id}`);
      broadcastRefresh(req, user_id, 'xp', -deduction);
      res.json({ success: true, user_id, total_xp: record.total_xp, level: levelInfo.level, change: -deduction });
    }
  } catch (err) {
    console.error('[admin] XP award error:', err.message);
    res.status(500).json({ error: 'Failed to update XP' });
  }
});

/**
 * POST /api/admin/assign-pet
 * Grant a pet to a player
 * Body: { user_id, pet_type, location }
 */
router.post('/assign-pet', authRequired, adminRequired, (req, res) => {
  const { user_id, pet_type, location } = req.body;
  if (!user_id || !pet_type) {
    return res.status(400).json({ error: 'user_id and pet_type required' });
  }

  const pets = require('../lib/pets');

  if (!pets.PET_TYPES[pet_type]) {
    return res.status(400).json({ error: `Unknown pet type: ${pet_type}. Valid: ${Object.keys(pets.PET_TYPES).join(', ')}` });
  }

  const existing = pets.getPet(user_id);
  if (existing) {
    return res.status(400).json({ error: 'Player already has a pet' });
  }

  const pet = pets.createPet(user_id, req.body.username || 'Unknown', pet_type, location);
  console.log(`[admin] Assigned pet ${pet_type} to ${user_id}`);
  res.json({ success: true, pet });
});

/**
 * PUT /api/admin/pets/placements
 * Update pet sprite placements (positions, scale, flip, etc.)
 * Body: { placements: { userId: { x, y, scale, flipX, zIndex, ... } } }
 */
router.put('/pets/placements', authRequired, adminRequired, (req, res) => {
  const { placements } = req.body;
  if (!placements || typeof placements !== 'object') {
    return res.status(400).json({ error: 'placements object required' });
  }

  try {
    const pets = require('../lib/pets');
    pets.updatePetPlacements(placements);
    console.log(`[admin] Updated pet placements for ${Object.keys(placements).length} pet(s)`);
    res.json({ success: true });
  } catch (err) {
    console.error('[admin] Failed to update pet placements:', err.message);
    res.status(500).json({ error: 'Failed to save pet placements' });
  }
});

/**
 * GET /api/arena-config
 * Return arena display config (no auth — display-only data)
 */
router.get('/arena-config', (req, res) => {
  try {
    if (fs.existsSync(ARENA_CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(ARENA_CONFIG_FILE, 'utf-8'));
      res.json(config);
    } else {
      res.json({ playerTileSize: 160, playerTileGap: 10, playerOffsetY: 0 });
    }
  } catch {
    res.json({ playerTileSize: 160, playerTileGap: 10, playerOffsetY: 0 });
  }
});

/**
 * PUT /api/admin/arena-config
 * Update global arena display settings
 */
router.put('/arena-config', authRequired, adminRequired, (req, res) => {
  const { playerTileSize, playerTileGap } = req.body;

  try {
    let config = { playerTileSize: 160, playerTileGap: 10, playerOffsetY: 0 };
    if (fs.existsSync(ARENA_CONFIG_FILE)) {
      config = JSON.parse(fs.readFileSync(ARENA_CONFIG_FILE, 'utf-8'));
    }
    if (playerTileSize != null) config.playerTileSize = Number(playerTileSize);
    if (playerTileGap != null) config.playerTileGap = Number(playerTileGap);

    const tmpPath = ARENA_CONFIG_FILE + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2));
    fs.renameSync(tmpPath, ARENA_CONFIG_FILE);

    console.log('[admin] Updated arena config:', config);
    res.json({ success: true, config });
  } catch (err) {
    console.error('[admin] Failed to update arena config:', err.message);
    res.status(500).json({ error: 'Failed to save arena config' });
  }
});

/**
 * PUT /api/admin/monsters/:monsterId/sprite
 * Update sprite display settings for a monster
 */
router.put('/monsters/:monsterId/sprite', authRequired, adminRequired, (req, res) => {
  const { monsterId } = req.params;
  const { spriteScale, spriteOffsetX, spriteOffsetY } = req.body;

  try {
    const monsters = JSON.parse(fs.readFileSync(MONSTERS_FILE, 'utf-8'));
    const monster = monsters.find(m => m.id === monsterId);
    if (!monster) {
      return res.status(404).json({ error: `Monster "${monsterId}" not found` });
    }

    if (spriteScale != null) monster.spriteScale = Number(spriteScale);
    if (spriteOffsetX != null) monster.spriteOffsetX = Number(spriteOffsetX);
    if (spriteOffsetY != null) monster.spriteOffsetY = Number(spriteOffsetY);

    const tmpPath = MONSTERS_FILE + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(monsters, null, 2));
    fs.renameSync(tmpPath, MONSTERS_FILE);

    // Refresh in-memory cache
    loadMonsters();

    // Patch any active encounter using this monster so changes take effect immediately
    const activeEncs = getActiveEncounters();
    for (const enc of activeEncs) {
      if (enc.monster && enc.monster.id === monsterId) {
        if (spriteScale != null) enc.monster.spriteScale = Number(spriteScale);
        if (spriteOffsetX != null) enc.monster.spriteOffsetX = Number(spriteOffsetX);
        if (spriteOffsetY != null) enc.monster.spriteOffsetY = Number(spriteOffsetY);
      }
    }

    console.log(`[admin] Updated sprite settings for ${monsterId}:`, { spriteScale, spriteOffsetX, spriteOffsetY });
    res.json({ success: true, monsterId, spriteScale: monster.spriteScale, spriteOffsetX: monster.spriteOffsetX, spriteOffsetY: monster.spriteOffsetY });
  } catch (err) {
    console.error('[admin] Failed to update monster sprite:', err.message);
    res.status(500).json({ error: 'Failed to save monster sprite settings' });
  }
});

module.exports = router;

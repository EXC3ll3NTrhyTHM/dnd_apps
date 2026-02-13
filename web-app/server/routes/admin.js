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

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const LOCATIONS_FILE = path.join(DATA_DIR, 'locations.json');

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

module.exports = router;

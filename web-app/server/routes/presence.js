/**
 * Presence API Routes
 *
 * Lightweight player presence tracking for the map view.
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { WebSocket } = require('ws');
const { authRequired, authOptional } = require('../middleware/auth');
const presence = require('../lib/presence');

function broadcastPresence(req, locationId) {
  const wss = req.app.get('wss');
  if (!wss) return;
  const all = presence.getAll();
  const users = all[locationId] || [];
  const payload = JSON.stringify({ type: 'presence_update', locationId, users });
  let sent = 0;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.currentLocation === locationId) {
      client.send(payload);
      sent++;
    }
  });
  console.log(`[presence] Broadcast to ${sent}/${wss.clients.size} WS clients at ${locationId}, ${users.length} users`);
}

/**
 * GET /api/presence
 * Returns all players currently at each location
 */
router.get('/', authRequired, (req, res) => {
  res.json({ presence: presence.getAll() });
});

/**
 * POST /api/presence/join
 * Mark the current user as present at a location
 */
router.post('/join', authRequired, (req, res) => {
  const { locationId } = req.body;
  if (!locationId) {
    return res.status(400).json({ error: 'locationId required' });
  }
  presence.join(locationId, req.user);
  console.log(`[presence] ${req.user.username} joined ${locationId}. Current users:`, JSON.stringify(presence.getAll()[locationId]?.map(u => u.username)));
  let xpAwarded = 0;
  let levelUp = null;
  try {
    const xp = require('../lib/xp');
    const levelBefore = xp.getLevel(req.user.id, req.user.username);
    const before = xp.getXpRecord(req.user.id, req.user.username).total_xp;
    xp.awardLocationVisitXp(req.user.id, req.user.username, locationId);
    xp.awardDailyLoginXp(req.user.id, req.user.username);
    const after = xp.getXpRecord(req.user.id, req.user.username).total_xp;
    xpAwarded = after - before;
    const levelAfter = xp.getLevel(req.user.id, req.user.username);
    if (levelAfter > levelBefore) levelUp = { newLevel: levelAfter };
  } catch (e) { console.error('[xp]', e.message); }

  let newAchievements = [];
  try { newAchievements = require('../lib/achievements').checkAchievements(req.user.id, req.user.username, 'location_visited').newAchievements; } catch (e) { console.error('[achievements]', e.message); }

  const response = { success: true, xpAwarded, newAchievements };
  if (levelUp) response.levelUp = levelUp;
  res.json(response);
  broadcastPresence(req, locationId);
});

/**
 * POST /api/presence/heartbeat
 * Keep the user's presence alive at a location
 */
router.post('/heartbeat', authRequired, (req, res) => {
  const { locationId } = req.body;
  if (!locationId) {
    return res.status(400).json({ error: 'locationId required' });
  }
  presence.heartbeat(locationId, req.user);
  res.json({ success: true });
});

/**
 * POST /api/presence/leave
 * Remove the user from their current location.
 * Supports sendBeacon (token in body) since fetch is cancelled on unmount.
 */
router.post('/leave', authOptional, (req, res) => {
  // Try standard auth first, fall back to token in body (sendBeacon)
  let userId = req.user?.id;

  if (!userId && req.body?.token) {
    try {
      const decoded = jwt.verify(req.body.token, process.env.JWT_SECRET);
      userId = decoded.id;
    } catch (e) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const leftLocations = presence.leave(null, userId);
  res.json({ success: true });
  leftLocations.forEach(locId => broadcastPresence(req, locId));
});

module.exports = router;

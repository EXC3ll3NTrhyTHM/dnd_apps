/**
 * Presence API Routes
 *
 * Lightweight player presence tracking for the map view.
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { authRequired, authOptional } = require('../middleware/auth');
const presence = require('../lib/presence');

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
  res.json({ success: true });
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
  presence.heartbeat(locationId, req.user.id);
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

  presence.leave(null, userId);
  res.json({ success: true });
});

module.exports = router;

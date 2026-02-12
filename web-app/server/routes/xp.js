/**
 * XP API Routes
 *
 * GET  /api/xp/me           - Player's XP, level, daily progress
 * GET  /api/xp/leaderboard  - XP leaderboard (top N)
 * POST /api/xp/dm-award     - DM-only: award XP to any player
 * POST /api/xp/convert-gold - DM-only: one-time gold-to-XP conversion
 */

const express = require('express');
const { authRequired } = require('../middleware/auth');
const { getXpRecord, getLevelFromXp, getXpLeaderboard, dmAwardXp, convertGoldToXp } = require('../lib/xp');
const { getWallet } = require('../lib/economy');

const DM_USER_IDS = (process.env.DM_USER_IDS || '').split(',').filter(Boolean);
const router = express.Router();

// GET /api/xp/me - Player's XP, level, daily progress
router.get('/me', authRequired, (req, res) => {
  const record = getXpRecord(req.user.id, req.user.username);
  const levelInfo = getLevelFromXp(record.total_xp);

  res.json({
    total_xp: record.total_xp,
    level: levelInfo.level,
    xp_in_level: levelInfo.xpInCurrentLevel,
    xp_for_next: levelInfo.xpForNextLevel,
    xp_to_next: levelInfo.xpToNextLevel,
    daily: record.daily
  });
});

// GET /api/xp/leaderboard - XP leaderboard
router.get('/leaderboard', authRequired, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const leaderboard = getXpLeaderboard(limit);
  res.json({ leaderboard, updated_at: new Date().toISOString() });
});

// POST /api/xp/dm-award - DM-only: award XP
router.post('/dm-award', authRequired, (req, res) => {
  if (!DM_USER_IDS.includes(req.user.id)) {
    return res.status(403).json({ error: 'DM only' });
  }

  const { user_id, amount, reason } = req.body;
  if (!user_id || !amount || typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'user_id and positive amount required' });
  }

  const record = dmAwardXp(user_id, req.body.username || 'Unknown', amount, reason || 'DM award');
  const levelInfo = getLevelFromXp(record.total_xp);

  res.json({
    success: true,
    user_id,
    total_xp: record.total_xp,
    level: levelInfo.level,
    reason
  });
});

// POST /api/xp/convert-gold - DM-only: one-time gold conversion
router.post('/convert-gold', authRequired, (req, res) => {
  if (!DM_USER_IDS.includes(req.user.id)) {
    return res.status(403).json({ error: 'DM only' });
  }

  const { user_id } = req.body;
  if (!user_id) {
    return res.status(400).json({ error: 'user_id required' });
  }

  const wallet = getWallet(user_id);
  const result = convertGoldToXp(user_id, wallet.username, wallet.balance);

  if (!result.success) {
    return res.status(400).json({ error: result.message });
  }

  res.json({
    success: true,
    user_id,
    gold_balance: wallet.balance,
    xp_gained: result.xp_gained,
    total_xp: result.total_xp
  });
});

module.exports = router;

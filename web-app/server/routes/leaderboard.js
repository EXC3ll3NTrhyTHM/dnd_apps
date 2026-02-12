/**
 * Leaderboard Routes
 *
 * GET /api/leaderboard - Top players by XP / level
 */

const express = require('express');
const { authOptional } = require('../middleware/auth');
const { getXpLeaderboard } = require('../lib/xp');

const router = express.Router();

router.get('/', authOptional, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const leaderboard = getXpLeaderboard(limit);

  res.json({
    leaderboard,
    updated_at: new Date().toISOString()
  });
});

module.exports = router;

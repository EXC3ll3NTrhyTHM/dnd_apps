/**
 * Leaderboard Routes
 * 
 * GET /api/leaderboard - Top players by gold balance
 */

const express = require('express');
const { authOptional } = require('../middleware/auth');
const { getLeaderboard } = require('../lib/economy');

const router = express.Router();

router.get('/', authOptional, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const leaderboard = getLeaderboard(limit);

  res.json({
    leaderboard,
    updated_at: new Date().toISOString()
  });
});

module.exports = router;

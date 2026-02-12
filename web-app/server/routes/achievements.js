/**
 * Achievement Routes
 *
 * GET /api/achievements/me - Get all achievements with unlock status
 */

const express = require('express');
const router = express.Router();
const { authRequired } = require('../middleware/auth');
const { getUserAchievements } = require('../lib/achievements');

router.get('/me', authRequired, (req, res) => {
  try {
    const result = getUserAchievements(req.user.id);
    res.json(result);
  } catch (err) {
    console.error('[achievements] Error:', err.message);
    res.status(500).json({ error: 'Failed to load achievements' });
  }
});

module.exports = router;

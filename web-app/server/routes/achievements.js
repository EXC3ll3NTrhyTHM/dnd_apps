/**
 * Achievement Routes
 *
 * GET  /api/achievements/me    - Get all achievements with unlock status
 * POST /api/achievements/claim - Claim rewards for an unlocked achievement
 */

const express = require('express');
const router = express.Router();
const { authRequired } = require('../middleware/auth');
const { getUserAchievements, claimAchievement } = require('../lib/achievements');

router.get('/me', authRequired, (req, res) => {
  try {
    const result = getUserAchievements(req.user.id);
    res.json(result);
  } catch (err) {
    console.error('[achievements] Error:', err.message);
    res.status(500).json({ error: 'Failed to load achievements' });
  }
});

router.post('/claim', authRequired, (req, res) => {
  try {
    const { achievementId } = req.body;
    if (!achievementId) return res.status(400).json({ error: 'Missing achievementId' });

    const result = claimAchievement(req.user.id, req.user.username, achievementId);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[achievements] Claim error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

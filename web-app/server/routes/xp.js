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
const { getXpRecord, getLevelFromXp, getXpLeaderboard, dmAwardXp, convertGoldToXp, loadXpData, saveXpData, ensureFreshDaily } = require('../lib/xp');
const { getWallet, awardGold } = require('../lib/economy');
const { ARENA_DAILY_GOALS } = require('../lib/arenaGoals');

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

// GET /api/xp/arena-daily - Arena daily goal progress
router.get('/arena-daily', authRequired, (req, res) => {
  const record = getXpRecord(req.user.id, req.user.username);
  const daily = record.daily;

  const goals = ARENA_DAILY_GOALS.map(goal => ({
    ...goal,
    progress: daily[goal.stat] || 0,
    completed: (daily[goal.stat] || 0) >= goal.target,
    claimed: (daily.arena_goals_claimed || []).includes(goal.key),
  }));

  res.json({ goals });
});

// POST /api/xp/arena-daily/claim - Claim a completed arena daily goal
router.post('/arena-daily/claim', authRequired, (req, res) => {
  const { goalKey } = req.body;
  if (!goalKey) return res.status(400).json({ error: 'goalKey required' });

  const goal = ARENA_DAILY_GOALS.find(g => g.key === goalKey);
  if (!goal) return res.status(400).json({ error: 'Unknown goal' });

  const data = loadXpData();
  const record = data[req.user.id];
  if (!record) return res.status(404).json({ error: 'No XP record' });
  ensureFreshDaily(record);

  if (!record.daily.arena_goals_claimed) record.daily.arena_goals_claimed = [];
  if (record.daily.arena_goals_claimed.includes(goalKey)) {
    return res.status(400).json({ error: 'Already claimed' });
  }

  const progress = record.daily[goal.stat] || 0;
  if (progress < goal.target) {
    return res.status(400).json({ error: 'Goal not completed yet' });
  }

  // Award XP
  record.total_xp += goal.xp;
  record.daily.arena_goals_claimed.push(goalKey);
  record.last_updated = new Date().toISOString();
  saveXpData(data);

  // Award gold
  if (goal.gold > 0) {
    awardGold(req.user.id, req.user.username, goal.gold, { source: 'arena_daily_goal', goal: goalKey });
  }

  const levelInfo = getLevelFromXp(record.total_xp);

  res.json({
    success: true,
    goalKey,
    xpAwarded: goal.xp,
    goldAwarded: goal.gold,
    total_xp: record.total_xp,
    level: levelInfo.level,
  });
});

module.exports = router;

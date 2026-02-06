/**
 * Quest Routes
 * 
 * GET /api/quests/available  - Quests that are open/available
 * GET /api/quests/active     - Currently active quests
 * GET /api/quests/completed  - Completed quests
 * GET /api/quests/all        - All quests
 */

const express = require('express');
const { authOptional } = require('../middleware/auth');
const { getAllQuests, getAvailableQuests, getActiveQuests, getCompletedQuests } = require('../lib/economy');

const router = express.Router();

// All quests (full board)
router.get('/all', authOptional, (req, res) => {
  const quests = getAllQuests();
  res.json(quests);
});

// Available (not started or in progress, not completed/failed)
router.get('/available', authOptional, (req, res) => {
  const quests = getAvailableQuests();
  res.json({ quests });
});

// Active quests
router.get('/active', authOptional, (req, res) => {
  const quests = getActiveQuests();
  res.json({ quests });
});

// Completed quests
router.get('/completed', authOptional, (req, res) => {
  const quests = getCompletedQuests();
  res.json({ quests });
});

module.exports = router;

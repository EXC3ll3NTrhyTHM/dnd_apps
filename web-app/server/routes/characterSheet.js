/**
 * Character Sheet API Routes
 *
 * GET /api/character-sheet/me        - Own character sheet
 * GET /api/character-sheet/:userId   - Any player's sheet
 * PUT /api/character-sheet/:userId   - Update text fields (own or DM)
 */

const express = require('express');
const { authRequired } = require('../middleware/auth');
const { getCharacterSheet, updateCharacterSheet } = require('../lib/characterSheets');
const { incrementLifetimeStat } = require('../lib/xp');
const { checkAchievements } = require('../lib/achievements');

const DM_USER_IDS = (process.env.DM_USER_IDS || '').split(',').filter(Boolean);

const ALLOWED_TOP_KEYS = ['backstory', 'enemies', 'organizations', 'traits', 'physical'];
const ALLOWED_TRAIT_KEYS = ['personalityTraits', 'ideals', 'bonds', 'flaws'];
const ALLOWED_PHYSICAL_KEYS = ['age', 'gender', 'hair', 'eyes', 'skin', 'height', 'weight'];

const router = express.Router();

// GET /me — own character sheet
router.get('/me', authRequired, (req, res) => {
  const sheet = getCharacterSheet(req.user.id);
  res.json({ characterSheet: sheet });
});

// POST /inspect-stat — track that the user tapped a stat to read its description
router.post('/inspect-stat', authRequired, (req, res) => {
  incrementLifetimeStat(req.user.id, req.user.username, 'stats_inspected', 1);
  const { newAchievements } = checkAchievements(req.user.id, req.user.username, 'stat_inspected');
  res.json({ newAchievements });
});

// GET /:userId — any player's character sheet
router.get('/:userId', authRequired, (req, res) => {
  const sheet = getCharacterSheet(req.params.userId);
  res.json({ characterSheet: sheet });
});

// PUT /:userId — update editable text fields
router.put('/:userId', authRequired, (req, res) => {
  const { userId } = req.params;

  // Permission: own sheet or DM
  if (req.user.id !== userId && !DM_USER_IDS.includes(req.user.id)) {
    return res.status(403).json({ error: 'Not allowed' });
  }

  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid body' });
  }

  // Whitelist validation
  const validated = {};

  for (const key of Object.keys(body)) {
    if (!ALLOWED_TOP_KEYS.includes(key)) {
      return res.status(400).json({ error: `Field "${key}" is not editable` });
    }
  }

  // Validate top-level string fields
  for (const key of ['backstory', 'enemies', 'organizations']) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== 'string') {
        return res.status(400).json({ error: `${key} must be a string` });
      }
      validated[key] = body[key];
    }
  }

  // Validate traits (partial object of strings)
  if (body.traits !== undefined) {
    if (typeof body.traits !== 'object' || body.traits === null) {
      return res.status(400).json({ error: 'traits must be an object' });
    }
    validated.traits = {};
    for (const key of Object.keys(body.traits)) {
      if (!ALLOWED_TRAIT_KEYS.includes(key)) {
        return res.status(400).json({ error: `Trait "${key}" is not editable` });
      }
      if (typeof body.traits[key] !== 'string') {
        return res.status(400).json({ error: `traits.${key} must be a string` });
      }
      validated.traits[key] = body.traits[key];
    }
  }

  // Validate physical (partial object of strings)
  if (body.physical !== undefined) {
    if (typeof body.physical !== 'object' || body.physical === null) {
      return res.status(400).json({ error: 'physical must be an object' });
    }
    validated.physical = {};
    for (const key of Object.keys(body.physical)) {
      if (!ALLOWED_PHYSICAL_KEYS.includes(key)) {
        return res.status(400).json({ error: `Physical field "${key}" is not editable` });
      }
      if (typeof body.physical[key] !== 'string') {
        return res.status(400).json({ error: `physical.${key} must be a string` });
      }
      validated.physical[key] = body.physical[key];
    }
  }

  if (Object.keys(validated).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const updatedSheet = updateCharacterSheet(userId, validated);
  res.json({ characterSheet: updatedSheet });
});

module.exports = router;

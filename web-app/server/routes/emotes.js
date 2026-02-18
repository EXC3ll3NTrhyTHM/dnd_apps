/**
 * Emote Routes
 *
 * GET  /api/emotes/catalog — Return emote catalog for picker UI
 * POST /api/emotes/send    — Broadcast an emote to all players at a location
 */

const express = require('express');
const { authRequired } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const EMOTES_PATH = path.resolve(__dirname, '..', '..', 'data', 'emotes.json');
const PLAYERS_PATH = path.resolve(__dirname, '..', '..', 'data', 'players.json');

// Server-side cooldown (5s per player)
const EMOTE_COOLDOWN_MS = 5_000;
const lastEmoteTimes = new Map();

function getEmoteCatalog() {
  try {
    return JSON.parse(fs.readFileSync(EMOTES_PATH, 'utf-8'));
  } catch { return { categories: [], emotes: [] }; }
}

function getPlayerData(userId) {
  try {
    const players = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf-8'));
    return players[userId] || null;
  } catch { return null; }
}

function broadcastToLocation(req, locationId, payload) {
  const wss = req.app.get('wss');
  if (!wss) return;
  const data = JSON.stringify(payload);
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(data);
    }
  });
}

// ============================================
// GET /catalog
// ============================================

router.get('/catalog', (req, res) => {
  const catalog = getEmoteCatalog();
  res.json(catalog);
});

// ============================================
// POST /send
// ============================================

router.post('/send', authRequired, (req, res) => {
  const userId = req.user.id;
  const { emoteId, locationId } = req.body;

  if (!emoteId || !locationId) {
    return res.status(400).json({ error: 'emoteId and locationId are required' });
  }

  // Cooldown check
  const now = Date.now();
  const lastTime = lastEmoteTimes.get(userId) || 0;
  if (now - lastTime < EMOTE_COOLDOWN_MS) {
    const remaining = Math.ceil((EMOTE_COOLDOWN_MS - (now - lastTime)) / 1000);
    return res.status(429).json({ error: `Cooldown: ${remaining}s remaining` });
  }

  // Validate emote exists
  const catalog = getEmoteCatalog();
  const emote = catalog.emotes.find(e => e.id === emoteId);
  if (!emote) {
    return res.status(404).json({ error: 'Emote not found' });
  }

  lastEmoteTimes.set(userId, now);

  // Get character name
  const player = getPlayerData(userId);
  const characterName = player?.characterName || req.user.username || 'Someone';

  // Broadcast to all clients at this location
  broadcastToLocation(req, locationId, {
    type: 'emote',
    locationId,
    userId,
    characterName,
    emoteId: emote.id,
    emoteImage: emote.image,
    emoteDescription: emote.description,
  });

  res.json({
    success: true,
    emoteImage: emote.image,
    emoteDescription: emote.description,
  });
});

module.exports = router;

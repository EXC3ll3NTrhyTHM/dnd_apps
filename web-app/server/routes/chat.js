/**
 * Chat API Routes
 *
 * Location-based NPC chat system.
 * Supports room chat (auto-picks NPC) and 1-on-1 mode.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { authRequired } = require('../middleware/auth');
const {
  loadLocations,
  loadNpcRegistry,
  generateResponse,
  pickRespondingNpc,
  writeWebJournal
} = require('../lib/dialogue');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'chat_history');
const MAX_HISTORY = 30;
const JOURNAL_INTERVAL = 8; // Write journal every N messages per NPC

// ============================================
// RATE LIMITING (in-memory, sufficient for 5 players)
// ============================================

const rateLimits = new Map();
const RATE_LIMIT = 5; // requests per minute
const RATE_WINDOW = 60 * 1000;

function checkRateLimit(userId) {
  const now = Date.now();
  const userRequests = rateLimits.get(userId) || [];

  // Remove old entries
  const recent = userRequests.filter(ts => now - ts < RATE_WINDOW);

  if (recent.length >= RATE_LIMIT) {
    return false;
  }

  recent.push(now);
  rateLimits.set(userId, recent);
  return true;
}

// ============================================
// CHAT HISTORY (file-based, per-player per-location)
// ============================================

function getHistoryPath(userId, locationId) {
  const userDir = path.join(HISTORY_DIR, userId);
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  return path.join(userDir, `${locationId}.json`);
}

function loadHistory(userId, locationId) {
  const histPath = getHistoryPath(userId, locationId);
  try {
    return JSON.parse(fs.readFileSync(histPath, 'utf-8'));
  } catch {
    return [];
  }
}

function saveHistory(userId, locationId, history) {
  // Keep last MAX_HISTORY messages
  const trimmed = history.slice(-MAX_HISTORY);
  const histPath = getHistoryPath(userId, locationId);
  const tmpPath = histPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(trimmed, null, 2));
  fs.renameSync(tmpPath, histPath);
}

// Track message counts for journal writes per NPC
const messageCounters = new Map();

function getNpcMessageKey(npcName, userId) {
  return `${npcName}:${userId}`;
}

// ============================================
// ROUTES
// ============================================

/**
 * GET /api/chat/locations
 * Returns all locations with their NPC assignments
 */
router.get('/locations', authRequired, (req, res) => {
  const locations = loadLocations();
  const registry = loadNpcRegistry();

  const result = Object.entries(locations).map(([id, loc]) => ({
    id,
    name: loc.name,
    description: loc.description,
    features: loc.features || [],
    mapCoords: loc.mapCoords || null,
    mapIcon: loc.mapIcon || null,
    scene: loc.scene || null,
    npcs: (loc.npcs || []).map(npcName => {
      const entry = registry[npcName];
      return {
        id: npcName,
        displayName: entry?.displayName || entry?.username || npcName,
        hasPortrait: true
      };
    })
  }));

  res.json({ locations: result });
});

/**
 * GET /api/chat/locations/:locationId/history
 * Returns chat history for the authenticated user at a location
 */
router.get('/locations/:locationId/history', authRequired, (req, res) => {
  const { locationId } = req.params;
  const locations = loadLocations();

  if (!locations[locationId]) {
    return res.status(404).json({ error: 'Location not found' });
  }

  const history = loadHistory(req.user.id, locationId);
  res.json({ history, locationId });
});

/**
 * POST /api/chat/locations/:locationId/message
 * Room chat — system picks which NPC(s) respond
 */
router.post('/locations/:locationId/message', authRequired, async (req, res) => {
  const { locationId } = req.params;
  const { message } = req.body;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'Message is required' });
  }

  if (message.length > 1000) {
    return res.status(400).json({ error: 'Message too long (max 1000 characters)' });
  }

  if (!checkRateLimit(req.user.id)) {
    return res.status(429).json({ error: 'Too many messages. Please wait a moment.' });
  }

  const locations = loadLocations();
  const location = locations[locationId];

  if (!location) {
    return res.status(404).json({ error: 'Location not found' });
  }

  const locationNpcs = location.npcs || [];
  if (locationNpcs.length === 0) {
    return res.status(400).json({ error: 'No NPCs at this location' });
  }

  try {
    const history = loadHistory(req.user.id, locationId);
    const playerName = req.user.global_name || req.user.username;

    // Add player message to history
    const playerMsg = {
      role: 'player',
      playerName,
      text: message.trim(),
      timestamp: new Date().toISOString()
    };
    history.push(playerMsg);

    // Pick which NPC(s) should respond
    const respondingNpcs = await pickRespondingNpc(locationNpcs, message, history);

    const registry = loadNpcRegistry();
    const responses = [];

    // Build location context for the NPC
    const locationContext = {
      name: location.name,
      description: location.description,
      otherNpcs: locationNpcs
        .filter(n => !respondingNpcs.includes(n))
        .map(n => registry[n]?.displayName || n)
    };

    // Generate response from each responding NPC
    for (const npcName of respondingNpcs) {
      const result = await generateResponse(npcName, playerName, message, history, locationContext);

      const npcMsg = {
        role: 'npc',
        npc: npcName,
        npcDisplayName: registry[npcName]?.displayName || npcName,
        text: result.text,
        emotion: result.emotion,
        timestamp: new Date().toISOString()
      };

      history.push(npcMsg);
      responses.push(npcMsg);

      // Journal tracking
      const key = getNpcMessageKey(npcName, req.user.id);
      const count = (messageCounters.get(key) || 0) + 1;
      messageCounters.set(key, count);

      if (count >= JOURNAL_INTERVAL) {
        messageCounters.set(key, 0);
        writeWebJournal(npcName, history).catch(err =>
          console.error(`[chat] Journal error for ${npcName}:`, err.message)
        );
      }
    }

    saveHistory(req.user.id, locationId, history);

    res.json({
      playerMessage: playerMsg,
      responses
    });
  } catch (error) {
    console.error('[chat] Room message error:', error.message);
    res.status(500).json({ error: 'Failed to generate response' });
  }
});

/**
 * POST /api/chat/locations/:locationId/npc/:npcName/message
 * 1-on-1 mode — send message directly to a specific NPC
 */
router.post('/locations/:locationId/npc/:npcName/message', authRequired, async (req, res) => {
  const { locationId, npcName } = req.params;
  const { message } = req.body;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'Message is required' });
  }

  if (message.length > 1000) {
    return res.status(400).json({ error: 'Message too long (max 1000 characters)' });
  }

  if (!checkRateLimit(req.user.id)) {
    return res.status(429).json({ error: 'Too many messages. Please wait a moment.' });
  }

  const locations = loadLocations();
  const location = locations[locationId];

  if (!location) {
    return res.status(404).json({ error: 'Location not found' });
  }

  if (!location.npcs.includes(npcName)) {
    return res.status(400).json({ error: `${npcName} is not at this location` });
  }

  try {
    const history = loadHistory(req.user.id, locationId);
    const playerName = req.user.global_name || req.user.username;
    const registry = loadNpcRegistry();

    // Add player message to history
    const playerMsg = {
      role: 'player',
      playerName,
      text: message.trim(),
      timestamp: new Date().toISOString()
    };
    history.push(playerMsg);

    // Build location context
    const locationContext = {
      name: location.name,
      description: location.description,
      otherNpcs: location.npcs
        .filter(n => n !== npcName)
        .map(n => registry[n]?.displayName || n)
    };

    // Generate response from the targeted NPC
    const result = await generateResponse(npcName, playerName, message, history, locationContext);

    const npcMsg = {
      role: 'npc',
      npc: npcName,
      npcDisplayName: registry[npcName]?.displayName || npcName,
      text: result.text,
      emotion: result.emotion,
      timestamp: new Date().toISOString()
    };

    history.push(npcMsg);
    saveHistory(req.user.id, locationId, history);

    // Journal tracking
    const key = getNpcMessageKey(npcName, req.user.id);
    const count = (messageCounters.get(key) || 0) + 1;
    messageCounters.set(key, count);

    if (count >= JOURNAL_INTERVAL) {
      messageCounters.set(key, 0);
      writeWebJournal(npcName, history).catch(err =>
        console.error(`[chat] Journal error for ${npcName}:`, err.message)
      );
    }

    res.json({
      playerMessage: playerMsg,
      responses: [npcMsg]
    });
  } catch (error) {
    console.error('[chat] 1-on-1 message error:', error.message);
    res.status(500).json({ error: 'Failed to generate response' });
  }
});

module.exports = router;

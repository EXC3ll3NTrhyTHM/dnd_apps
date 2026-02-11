/**
 * Chat API Routes
 *
 * Location-based NPC chat system.
 * Supports room chat (auto-picks NPC) and 1-on-1 mode.
 * Chat history is shared per-location so all players see the same conversation.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { authRequired } = require('../middleware/auth');
const {
  loadLocations,
  loadNpcRegistry,
  generateResponse,
  pickRespondingNpc,
  writeWebJournal
} = require('../lib/dialogue');

// DM Discord user IDs (same list as campaign.js)
const DM_USER_IDS = (process.env.DM_USER_IDS || '').split(',').filter(Boolean);

function isLocationLocked(location, userId) {
  if (location.locked) return true;
  if (Array.isArray(location.lockedFor) && location.lockedFor.includes(userId)) return true;
  return false;
}

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'chat_history');
const SHARED_DIR = path.join(HISTORY_DIR, 'shared');
const PLAYERS_PATH = path.join(DATA_DIR, 'players.json');
const MAX_HISTORY = 30;
const JOURNAL_INTERVAL = 8; // Write journal every N messages per NPC

function loadPlayers() {
  try { return JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf-8')); }
  catch { return {}; }
}

function savePlayers(players) {
  const tmpPath = PLAYERS_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(players, null, 2));
  fs.renameSync(tmpPath, PLAYERS_PATH);
}

function getPlayerName(user) {
  const players = loadPlayers();
  return players[user.id]?.characterName || user.global_name || user.username;
}

// Persist avatar URL and display name so enrichHistory can backfill old messages
function updatePlayerInfo(user) {
  const players = loadPlayers();
  if (!players[user.id]) players[user.id] = {};
  const p = players[user.id];
  const displayName = user.global_name || user.username || null;
  if (p.avatar !== user.avatar || p.displayName !== displayName) {
    p.avatar = user.avatar;
    p.displayName = displayName;
    savePlayers(players);
  }
}

// Backfill playerName and playerAvatar in old history messages
function enrichHistory(history) {
  const players = loadPlayers();
  for (const msg of history) {
    if (msg.role === 'player' && msg.userId && players[msg.userId]) {
      const p = players[msg.userId];
      if (p.characterName) msg.playerName = p.characterName;
      if (p.avatar && !msg.playerAvatar) msg.playerAvatar = p.avatar;
    }
  }
  return history;
}

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
// CHAT HISTORY (file-based, shared per-location)
// ============================================

function getHistoryPath(locationId) {
  if (!fs.existsSync(SHARED_DIR)) {
    fs.mkdirSync(SHARED_DIR, { recursive: true });
  }
  return path.join(SHARED_DIR, `${locationId}.json`);
}

function loadHistory(locationId) {
  const histPath = getHistoryPath(locationId);
  try {
    return JSON.parse(fs.readFileSync(histPath, 'utf-8'));
  } catch {
    return [];
  }
}

function saveHistory(locationId, history) {
  // Keep last MAX_HISTORY messages
  const trimmed = history.slice(-MAX_HISTORY);
  const histPath = getHistoryPath(locationId);
  const tmpPath = histPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(trimmed, null, 2));
  fs.renameSync(tmpPath, histPath);
}

// ============================================
// PER-LOCATION MUTEX (prevents concurrent writes)
// ============================================

const locationLocks = new Map();

function acquireLock(locationId) {
  if (!locationLocks.has(locationId)) {
    locationLocks.set(locationId, { locked: false, queue: [] });
  }
  const lock = locationLocks.get(locationId);

  return new Promise(resolve => {
    if (!lock.locked) {
      lock.locked = true;
      resolve();
    } else {
      lock.queue.push(resolve);
    }
  });
}

function releaseLock(locationId) {
  const lock = locationLocks.get(locationId);
  if (!lock) return;

  if (lock.queue.length > 0) {
    const next = lock.queue.shift();
    next();
  } else {
    lock.locked = false;
  }
}

// Track message counts for journal writes per NPC (shared, not per-user)
const messageCounters = new Map();

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
  const isDM = DM_USER_IDS.includes(req.user.id);

  const result = Object.entries(locations)
    .filter(([, loc]) => isDM || !isLocationLocked(loc, req.user.id))
    .map(([id, loc]) => {
    const npcList = (loc.npcs || []).map(npcName => {
      const entry = registry[npcName];
      return {
        id: npcName,
        displayName: entry?.displayName || entry?.username || npcName,
        hasPortrait: true
      };
    });

    // Map group member IDs to display names
    const groups = {};
    if (loc.groups) {
      for (const [groupId, group] of Object.entries(loc.groups)) {
        groups[groupId] = {
          displayName: group.displayName,
          memberIds: group.members || [],
          members: (group.members || []).map(npcName => {
            const entry = registry[npcName];
            return entry?.displayName || entry?.username || npcName;
          })
        };
      }
    }

    return {
      id,
      name: loc.name,
      description: loc.description,
      features: loc.features || [],
      mapCoords: loc.mapCoords || null,
      mapIcon: loc.mapIcon || null,
      scene: loc.scene || null,
      npcs: npcList,
      groups,
      locked: !!loc.locked,
      lockedFor: isDM ? (loc.lockedFor || []) : undefined
    };
  });

  res.json({ locations: result });
});

/**
 * GET /api/chat/locations/:locationId/history
 * Returns shared chat history for a location
 */
router.get('/locations/:locationId/history', authRequired, (req, res) => {
  const { locationId } = req.params;
  const locations = loadLocations();

  if (!locations[locationId]) {
    return res.status(404).json({ error: 'Location not found' });
  }

  if (isLocationLocked(locations[locationId], req.user.id) && !DM_USER_IDS.includes(req.user.id)) {
    return res.status(403).json({ error: 'This location is currently locked' });
  }

  const history = enrichHistory(loadHistory(locationId));
  res.json({ history, locationId });
});

/**
 * GET /api/chat/locations/:locationId/messages?since=<ISO timestamp>
 * Returns messages newer than the given timestamp (for polling)
 */
router.get('/locations/:locationId/messages', authRequired, (req, res) => {
  const { locationId } = req.params;
  const { since } = req.query;

  const locations = loadLocations();
  if (!locations[locationId]) {
    return res.status(404).json({ error: 'Location not found' });
  }

  if (isLocationLocked(locations[locationId], req.user.id) && !DM_USER_IDS.includes(req.user.id)) {
    return res.status(403).json({ error: 'This location is currently locked' });
  }

  const history = enrichHistory(loadHistory(locationId));

  if (!since) {
    return res.json({ messages: history });
  }

  const newMessages = history.filter(msg => msg.timestamp > since);
  res.json({ messages: newMessages });
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

  if (isLocationLocked(location, req.user.id) && !DM_USER_IDS.includes(req.user.id)) {
    return res.status(403).json({ error: 'This location is currently locked' });
  }

  const locationNpcs = location.npcs || [];
  if (locationNpcs.length === 0) {
    return res.status(400).json({ error: 'No NPCs at this location' });
  }

  updatePlayerInfo(req.user);

  await acquireLock(locationId);
  try {
    const history = loadHistory(locationId);
    const playerName = getPlayerName(req.user);

    // Add player message to history
    const playerMsg = {
      id: crypto.randomUUID(),
      role: 'player',
      userId: req.user.id,
      playerName,
      playerAvatar: req.user.avatar,
      text: message.trim(),
      timestamp: new Date().toISOString()
    };
    history.push(playerMsg);

    // Pick which NPC(s) should respond — only @mentioned NPCs
    const respondingNpcs = await pickRespondingNpc(locationNpcs, message, history);

    // No NPCs mentioned — just record the player message, no NPC responses
    if (respondingNpcs.length === 0) {
      saveHistory(locationId, history);
      return res.json({ playerMessage: playerMsg, responses: [] });
    }

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
        id: crypto.randomUUID(),
        role: 'npc',
        npc: npcName,
        npcDisplayName: registry[npcName]?.displayName || npcName,
        text: result.text,
        emotion: result.emotion,
        timestamp: new Date().toISOString()
      };

      history.push(npcMsg);
      responses.push(npcMsg);

      // Journal tracking (per-NPC, shared)
      const count = (messageCounters.get(npcName) || 0) + 1;
      messageCounters.set(npcName, count);

      if (count >= JOURNAL_INTERVAL) {
        messageCounters.set(npcName, 0);
        writeWebJournal(npcName, history).catch(err =>
          console.error(`[chat] Journal error for ${npcName}:`, err.message)
        );
      }
    }

    saveHistory(locationId, history);

    res.json({
      playerMessage: playerMsg,
      responses
    });
  } catch (error) {
    console.error('[chat] Room message error:', error.message);
    res.status(500).json({ error: 'Failed to generate response' });
  } finally {
    releaseLock(locationId);
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

  if (isLocationLocked(location, req.user.id) && !DM_USER_IDS.includes(req.user.id)) {
    return res.status(403).json({ error: 'This location is currently locked' });
  }

  if (!location.npcs.includes(npcName)) {
    return res.status(400).json({ error: `${npcName} is not at this location` });
  }

  updatePlayerInfo(req.user);

  await acquireLock(locationId);
  try {
    const history = loadHistory(locationId);
    const playerName = getPlayerName(req.user);
    const registry = loadNpcRegistry();

    // Add player message to history
    const playerMsg = {
      id: crypto.randomUUID(),
      role: 'player',
      userId: req.user.id,
      playerName,
      playerAvatar: req.user.avatar,
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
      id: crypto.randomUUID(),
      role: 'npc',
      npc: npcName,
      npcDisplayName: registry[npcName]?.displayName || npcName,
      text: result.text,
      emotion: result.emotion,
      timestamp: new Date().toISOString()
    };

    history.push(npcMsg);
    saveHistory(locationId, history);

    // Journal tracking (per-NPC, shared)
    const count = (messageCounters.get(npcName) || 0) + 1;
    messageCounters.set(npcName, count);

    if (count >= JOURNAL_INTERVAL) {
      messageCounters.set(npcName, 0);
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
  } finally {
    releaseLock(locationId);
  }
});

module.exports = router;

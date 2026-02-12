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
const { acquireLock, releaseLock } = require('../lib/locks');
const {
  loadLocations,
  loadNpcRegistry,
  generateResponse,
  pickRespondingNpc,
  writeWebJournal
} = require('../lib/dialogue');
const { getTypingInLocation, setNpcTyping } = require('../lib/typing');
const { notifyPlayerMentions } = require('../lib/notifications');
const clawdbotRoutes = require('./clawdbot');

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

// Track recently deleted message IDs per location (for polling)
// Map<locationId, { ids: Set<string>, timers: Map<string, timeout> }>
const deletedIds = new Map();
const DELETED_TTL = 60 * 1000; // auto-clean after 60s

function trackDeletedId(locationId, messageId) {
  if (!deletedIds.has(locationId)) {
    deletedIds.set(locationId, { ids: new Set(), timers: new Map() });
  }
  const entry = deletedIds.get(locationId);
  entry.ids.add(messageId);
  // Auto-clean after TTL
  const timer = setTimeout(() => {
    entry.ids.delete(messageId);
    entry.timers.delete(messageId);
    if (entry.ids.size === 0) deletedIds.delete(locationId);
  }, DELETED_TTL);
  entry.timers.set(messageId, timer);
}

function consumeDeletedIds(locationId) {
  const entry = deletedIds.get(locationId);
  if (!entry || entry.ids.size === 0) return [];
  const ids = [...entry.ids];
  // Clear timers and remove
  for (const timer of entry.timers.values()) clearTimeout(timer);
  deletedIds.delete(locationId);
  return ids;
}

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

// Track message counts for journal writes per NPC (shared, not per-user)
const messageCounters = new Map();

// Export helper for other routes
router.setNpcTyping = setNpcTyping;

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

  // Append virtual Marcel DM marker
  result.push({
    id: 'marcel_dm',
    name: 'Marcel DM',
    description: 'Private message with Marcel',
    features: [],
    mapCoords: { x: 8, y: 92 },
    mapIcon: '✉️',
    scene: null,
    npcs: [{ id: 'marcel', displayName: 'Marcel', hasPortrait: true }],
    groups: {},
    locked: false,
    isMarcelDm: true
  });

  // Include player list for @mention support
  const players = loadPlayers();
  const playerList = Object.entries(players).map(([userId, p]) => ({
    id: userId,
    characterName: p.characterName || p.displayName || userId,
    avatar: p.avatar || null,
  }));

  res.json({ locations: result, players: playerList });
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
  const typing = getTypingInLocation(locationId);

  // Build reactions map for all messages that have reactions
  const reactions = {};
  for (const msg of history) {
    if (msg.id && msg.reactions && Object.keys(msg.reactions).length > 0) {
      reactions[msg.id] = msg.reactions;
    }
  }

  const deleted = consumeDeletedIds(locationId);

  res.json({
    messages: newMessages,
    reactions,
    deletedIds: deleted,
    typing: Object.entries(typing).map(([id, data]) => ({
      id,
      displayName: data.displayName
    }))
  });
});

/**
 * GET /api/chat/gifs
 * Proxy to GIPHY API — search or trending GIFs
 */
router.get('/gifs', authRequired, async (req, res) => {
  const apiKey = process.env.GIPHY_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'GIF service not configured' });
  }

  const { q, limit = '20', offset = '0' } = req.query;
  const params = new URLSearchParams({
    api_key: apiKey,
    limit,
    offset,
    rating: 'pg-13',
  });

  const endpoint = q
    ? `https://api.giphy.com/v1/gifs/search?${params}&q=${encodeURIComponent(q)}`
    : `https://api.giphy.com/v1/gifs/trending?${params}`;

  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      return res.status(502).json({ error: 'GIPHY API error' });
    }
    const data = await response.json();
    const results = (data.data || []).map(r => {
      const fixed = r.images?.fixed_width;
      const small = r.images?.fixed_width_small;
      return {
        id: r.id,
        title: r.title || '',
        url: fixed?.url || small?.url || '',
        preview: small?.url || fixed?.url || '',
        width: parseInt(fixed?.width, 10) || 200,
        height: parseInt(fixed?.height, 10) || 150,
      };
    });
    res.json({ results, next: String(parseInt(offset, 10) + results.length) });
  } catch (err) {
    console.error('[chat] GIPHY fetch error:', err.message);
    res.status(502).json({ error: 'Failed to fetch GIFs' });
  }
});

/**
 * POST /api/chat/locations/:locationId/message
 * Room chat — system picks which NPC(s) respond
 */
router.post('/locations/:locationId/message', authRequired, async (req, res) => {
  const { locationId } = req.params;
  const { message, type, gifUrl, gifWidth, gifHeight } = req.body;

  // Handle GIF messages — no NPC response
  if (type === 'gif') {
    if (!gifUrl || typeof gifUrl !== 'string' || !/^https:\/\/media[0-4]?\.giphy\.com\//.test(gifUrl)) {
      return res.status(400).json({ error: 'Invalid GIF URL' });
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

    updatePlayerInfo(req.user);

    await acquireLock(locationId);
    try {
      const history = loadHistory(locationId);
      const playerName = getPlayerName(req.user);

      const playerMsg = {
        id: crypto.randomUUID(),
        role: 'player',
        type: 'gif',
        userId: req.user.id,
        playerName,
        playerAvatar: req.user.avatar,
        gifUrl,
        gifWidth: gifWidth || 220,
        gifHeight: gifHeight || 165,
        text: message || '',
        timestamp: new Date().toISOString()
      };
      history.push(playerMsg);
      saveHistory(locationId, history);

      try { require('../lib/xp').awardMessageXp(req.user.id, req.user.username); } catch (e) { console.error('[xp]', e.message); }
      try { require('../lib/xp').incrementLifetimeStat(req.user.id, req.user.username, 'gifs_sent'); } catch (e) { console.error('[xp]', e.message); }
      notifyPlayerMentions(playerMsg.text, locationId, location.name, playerName, req.app, req.user.id);

      let newAchievements = [];
      try { newAchievements = require('../lib/achievements').checkAchievements(req.user.id, req.user.username, 'message_sent', { hour: new Date().getUTCHours() }).newAchievements; } catch (e) { console.error('[achievements]', e.message); }

      return res.json({ playerMessage: playerMsg, responses: [], newAchievements });
    } catch (error) {
      console.error('[chat] GIF message error:', error.message);
      return res.status(500).json({ error: 'Failed to save GIF message' });
    } finally {
      releaseLock(locationId);
    }
  }

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

    // Check for Marcel (Clawdbot) mention specifically
    const isMarcelMentioned = message.toLowerCase().includes('@marcel');
    if (isMarcelMentioned) {
      clawdbotRoutes.enqueueMention(locationId, playerMsg);

      // Schedule a delayed 👀 reaction from Marcel on the player's message
      const msgId = playerMsg.id;
      setTimeout(async () => {
        await acquireLock(locationId);
        try {
          const hist = loadHistory(locationId);
          const msg = hist.find(m => m.id === msgId);
          if (msg) {
            if (!msg.reactions) msg.reactions = {};
            if (!msg.reactions['👀']) msg.reactions['👀'] = [];
            if (!msg.reactions['👀'].includes('marcel')) {
              msg.reactions['👀'].push('marcel');
            }
            saveHistory(locationId, hist);

            const wss = req.app.get('wss');
            if (wss) {
              const payload = JSON.stringify({
                type: 'reaction',
                locationId,
                messageId: msgId,
                reactions: msg.reactions
              });
              wss.clients.forEach(client => {
                if (client.readyState === 1) client.send(payload);
              });
            }
          }
        } finally {
          releaseLock(locationId);
        }
      }, 1500);
    }

    // No NPCs mentioned — just record the player message, no NPC responses
    if (respondingNpcs.length === 0) {
      saveHistory(locationId, history);
      try { require('../lib/xp').awardMessageXp(req.user.id, req.user.username); } catch (e) { console.error('[xp]', e.message); }
      notifyPlayerMentions(playerMsg.text, locationId, location.name, playerName, req.app, req.user.id);
      let newAchievements = [];
      try { newAchievements = require('../lib/achievements').checkAchievements(req.user.id, req.user.username, 'message_sent', { hour: new Date().getUTCHours() }).newAchievements; } catch (e) { console.error('[achievements]', e.message); }
      return res.json({ playerMessage: playerMsg, responses: [], marcelMentioned: isMarcelMentioned, newAchievements });
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

    try { require('../lib/xp').awardMessageXp(req.user.id, req.user.username); } catch (e) { console.error('[xp]', e.message); }

    // Notify @mentions in the player message
    notifyPlayerMentions(playerMsg.text, locationId, location.name, playerName, req.app, req.user.id);
    // Notify @mentions in each NPC response
    for (const npcMsg of responses) {
      notifyPlayerMentions(npcMsg.text, locationId, location.name, npcMsg.npcDisplayName, req.app);
    }

    let newAchievements = [];
    try { newAchievements = require('../lib/achievements').checkAchievements(req.user.id, req.user.username, 'message_sent', { hour: new Date().getUTCHours() }).newAchievements; } catch (e) { console.error('[achievements]', e.message); }

    res.json({
      playerMessage: playerMsg,
      responses,
      newAchievements
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

    try { require('../lib/xp').awardMessageXp(req.user.id, req.user.username); } catch (e) { console.error('[xp]', e.message); }

    // Notify @mentions in the player message and NPC response
    notifyPlayerMentions(playerMsg.text, locationId, location.name, playerName, req.app, req.user.id);
    notifyPlayerMentions(npcMsg.text, locationId, location.name, npcMsg.npcDisplayName, req.app);

    // Journal tracking (per-NPC, shared)
    const count = (messageCounters.get(npcName) || 0) + 1;
    messageCounters.set(npcName, count);

    if (count >= JOURNAL_INTERVAL) {
      messageCounters.set(npcName, 0);
      writeWebJournal(npcName, history).catch(err =>
        console.error(`[chat] Journal error for ${npcName}:`, err.message)
      );
    }

    let newAchievements = [];
    try { newAchievements = require('../lib/achievements').checkAchievements(req.user.id, req.user.username, 'message_sent', { hour: new Date().getUTCHours() }).newAchievements; } catch (e) { console.error('[achievements]', e.message); }

    res.json({
      playerMessage: playerMsg,
      responses: [npcMsg],
      newAchievements
    });
  } catch (error) {
    console.error('[chat] 1-on-1 message error:', error.message);
    res.status(500).json({ error: 'Failed to generate response' });
  } finally {
    releaseLock(locationId);
  }
});

/**
 * POST /api/chat/locations/:locationId/messages/:messageId/react
 * Toggle an emoji reaction on a message
 */
router.post('/locations/:locationId/messages/:messageId/react', authRequired, async (req, res) => {
  const { locationId, messageId } = req.params;
  const { emoji } = req.body;

  if (!emoji || typeof emoji !== 'string') {
    return res.status(400).json({ error: 'Emoji is required' });
  }

  const locations = loadLocations();
  if (!locations[locationId]) {
    return res.status(404).json({ error: 'Location not found' });
  }

  const userId = req.user.id;

  await acquireLock(locationId);
  try {
    const history = loadHistory(locationId);
    const message = history.find(m => m.id === messageId);

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (!message.reactions) message.reactions = {};

    if (!message.reactions[emoji]) {
      message.reactions[emoji] = [];
    }

    let xpAwarded = 0;
    let newAchievements = [];
    const idx = message.reactions[emoji].indexOf(userId);
    if (idx === -1) {
      // Add reaction
      message.reactions[emoji].push(userId);
      try {
        const xp = require('../lib/xp');
        const before = xp.getXpRecord(userId, req.user.username).total_xp;
        xp.awardReactionXp(userId, req.user.username);
        const after = xp.getXpRecord(userId, req.user.username).total_xp;
        xpAwarded = after - before;
      } catch (e) { console.error('[xp]', e.message); }
      try { newAchievements = require('../lib/achievements').checkAchievements(userId, req.user.username, 'reaction_added').newAchievements; } catch (e) { console.error('[achievements]', e.message); }
    } else {
      // Remove reaction
      message.reactions[emoji].splice(idx, 1);
      // Clean up empty arrays
      if (message.reactions[emoji].length === 0) {
        delete message.reactions[emoji];
      }
    }

    // Clean up empty reactions object
    if (Object.keys(message.reactions).length === 0) {
      delete message.reactions;
    }

    saveHistory(locationId, history);

    res.json({ reactions: message.reactions || {}, xpAwarded, newAchievements });
  } catch (error) {
    console.error('[chat] React error:', error.message);
    res.status(500).json({ error: 'Failed to toggle reaction' });
  } finally {
    releaseLock(locationId);
  }
});

/**
 * DELETE /api/chat/locations/:locationId/messages/:messageId
 * Delete a message — own player messages or any message if admin
 */
router.delete('/locations/:locationId/messages/:messageId', authRequired, async (req, res) => {
  const { locationId, messageId } = req.params;

  const locations = loadLocations();
  if (!locations[locationId]) {
    return res.status(404).json({ error: 'Location not found' });
  }

  const userId = req.user.id;
  const isAdmin = DM_USER_IDS.includes(userId);

  await acquireLock(locationId);
  try {
    const history = loadHistory(locationId);
    const msgIndex = history.findIndex(m => m.id === messageId);

    if (msgIndex === -1) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const message = history[msgIndex];

    // Authorization: player messages can be deleted by owner or admin; NPC messages only by admin
    if (message.role === 'player') {
      if (message.userId !== userId && !isAdmin) {
        return res.status(403).json({ error: 'Cannot delete another player\'s message' });
      }
    } else {
      // NPC or other message types — admin only
      if (!isAdmin) {
        return res.status(403).json({ error: 'Only admins can delete NPC messages' });
      }
    }

    // Clean up uploaded image file if this was an image message
    if (message.type === 'image' && message.imageUrl) {
      const filename = path.basename(message.imageUrl);
      const filePath = path.join(DATA_DIR, 'uploads', filename);
      fs.unlink(filePath, () => {}); // best-effort cleanup
    }

    history.splice(msgIndex, 1);
    saveHistory(locationId, history);
    trackDeletedId(locationId, messageId);

    res.json({ success: true });
  } catch (error) {
    console.error('[chat] Delete error:', error.message);
    res.status(500).json({ error: 'Failed to delete message' });
  } finally {
    releaseLock(locationId);
  }
});

/**
 * POST /api/chat/locations/:locationId/mark-read
 * Mark a location as read for the current user
 */
router.post('/locations/:locationId/mark-read', authRequired, (req, res) => {
  const { locationId } = req.params;
  const userId = req.user.id;

  try {
    const players = loadPlayers();
    if (!players[userId]) players[userId] = {};
    if (!players[userId].lastReadTimestamps) players[userId].lastReadTimestamps = {};
    players[userId].lastReadTimestamps[locationId] = new Date().toISOString();
    savePlayers(players);
    res.json({ success: true });
  } catch (error) {
    console.error('[chat] Mark-read error:', error.message);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

/**
 * GET /api/chat/unread
 * Returns which locations have unread messages for the current user
 */
router.get('/unread', authRequired, (req, res) => {
  try {
    const players = loadPlayers();
    const lastRead = players[req.user.id]?.lastReadTimestamps || {};
    const unread = {};

    // Check each shared location history file
    if (fs.existsSync(SHARED_DIR)) {
      const files = fs.readdirSync(SHARED_DIR).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const locationId = file.replace('.json', '');
        try {
          const history = JSON.parse(fs.readFileSync(path.join(SHARED_DIR, file), 'utf-8'));
          if (history.length === 0) continue;
          const lastMsg = history[history.length - 1];
          if (!lastMsg.timestamp) continue;
          const userLastRead = lastRead[locationId];
          if (!userLastRead || lastMsg.timestamp > userLastRead) {
            unread[locationId] = true;
          }
        } catch {
          // Skip unreadable files
        }
      }
    }

    // Check Marcel DM channels
    const dmDir = path.join(HISTORY_DIR, 'marcel_dm');
    if (fs.existsSync(dmDir)) {
      const dmFiles = fs.readdirSync(dmDir).filter(f => f.endsWith('.json'));
      for (const file of dmFiles) {
        const channelKey = file.replace('.json', '');
        const locationId = `marcel_dm_${channelKey}`;
        try {
          const history = JSON.parse(fs.readFileSync(path.join(dmDir, file), 'utf-8'));
          if (history.length === 0) continue;
          const lastMsg = history[history.length - 1];
          if (!lastMsg.timestamp) continue;
          const userLastRead = lastRead[locationId];
          if (!userLastRead || lastMsg.timestamp > userLastRead) {
            unread[locationId] = true;
          }
        } catch {
          // Skip unreadable files
        }
      }
    }

    res.json({ unread });
  } catch (error) {
    console.error('[chat] Unread check error:', error.message);
    res.status(500).json({ error: 'Failed to check unread status' });
  }
});

module.exports = router;

/**
 * Marcel DM Routes
 *
 * Private 1-on-1 chat channels between players and Marcel.
 * Each player gets their own channel with ID `marcel_dm_{userId}`.
 * Chat history stored in data/chat_history/marcel_dm/{userId}.json.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { authRequired } = require('../middleware/auth');
const { getTypingInLocation } = require('../lib/typing');

const DM_USER_IDS = (process.env.DM_USER_IDS || '').split(',').filter(Boolean);

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const DM_HISTORY_DIR = path.join(DATA_DIR, 'chat_history', 'marcel_dm');
const PLAYERS_PATH = path.join(DATA_DIR, 'players.json');
const MAX_HISTORY = 30;

// Ensure DM history directory exists
if (!fs.existsSync(DM_HISTORY_DIR)) {
  fs.mkdirSync(DM_HISTORY_DIR, { recursive: true });
}

function loadPlayers() {
  try { return JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf-8')); }
  catch { return {}; }
}

function getPlayerName(user) {
  const players = loadPlayers();
  return players[user.id]?.characterName || user.global_name || user.username;
}

function getHistoryPath(userId) {
  return path.join(DM_HISTORY_DIR, `${userId}.json`);
}

function loadHistory(userId) {
  try {
    return JSON.parse(fs.readFileSync(getHistoryPath(userId), 'utf-8'));
  } catch {
    return [];
  }
}

function saveHistory(userId, history) {
  const trimmed = history.slice(-MAX_HISTORY);
  const histPath = getHistoryPath(userId);
  const tmpPath = histPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(trimmed, null, 2));
  fs.renameSync(tmpPath, histPath);
}

// Enrichment: backfill player names/avatars
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

// Per-channel mutex
const channelLocks = new Map();

function acquireLock(userId) {
  if (!channelLocks.has(userId)) {
    channelLocks.set(userId, { locked: false, queue: [] });
  }
  const lock = channelLocks.get(userId);
  return new Promise(resolve => {
    if (!lock.locked) {
      lock.locked = true;
      resolve();
    } else {
      lock.queue.push(resolve);
    }
  });
}

function releaseLock(userId) {
  const lock = channelLocks.get(userId);
  if (!lock) return;
  if (lock.queue.length > 0) {
    lock.queue.shift()();
  } else {
    lock.locked = false;
  }
}

// Rate limiting
const rateLimits = new Map();
const RATE_LIMIT = 5;
const RATE_WINDOW = 60 * 1000;

function checkRateLimit(userId) {
  const now = Date.now();
  const recent = (rateLimits.get(userId) || []).filter(ts => now - ts < RATE_WINDOW);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  rateLimits.set(userId, recent);
  return true;
}

// Deleted IDs tracking (for polling)
const deletedIds = new Map();
const DELETED_TTL = 60 * 1000;

function trackDeletedId(channelUserId, messageId) {
  if (!deletedIds.has(channelUserId)) {
    deletedIds.set(channelUserId, { ids: new Set(), timers: new Map() });
  }
  const entry = deletedIds.get(channelUserId);
  entry.ids.add(messageId);
  const timer = setTimeout(() => {
    entry.ids.delete(messageId);
    entry.timers.delete(messageId);
    if (entry.ids.size === 0) deletedIds.delete(channelUserId);
  }, DELETED_TTL);
  entry.timers.set(messageId, timer);
}

function consumeDeletedIds(channelUserId) {
  const entry = deletedIds.get(channelUserId);
  if (!entry || entry.ids.size === 0) return [];
  const ids = [...entry.ids];
  for (const timer of entry.timers.values()) clearTimeout(timer);
  deletedIds.delete(channelUserId);
  return ids;
}

// Access control helper
function resolveChannelUser(req, res) {
  const isDM = DM_USER_IDS.includes(req.user.id);
  const targetUserId = req.query.userId;

  if (isDM && targetUserId) {
    return targetUserId;
  }
  if (!isDM && targetUserId && targetUserId !== req.user.id) {
    res.status(403).json({ error: 'You can only access your own DM channel' });
    return null;
  }
  return targetUserId || req.user.id;
}

/**
 * GET /api/marcel-dm/channel
 * Virtual location data for the Marcel DM channel
 */
router.get('/channel', authRequired, (req, res) => {
  const channelUserId = resolveChannelUser(req, res);
  if (!channelUserId) return;

  const players = loadPlayers();
  const player = players[channelUserId];
  const playerName = player?.characterName || player?.displayName || 'Adventurer';

  let newAchievements = [];
  try { newAchievements = require('../lib/achievements').checkAchievements(req.user.id, req.user.username, 'marcel_dm_opened').newAchievements; } catch (e) { console.error('[achievements]', e.message); }

  res.json({
    location: {
      id: `marcel_dm_${channelUserId}`,
      name: 'Marcel DM',
      description: `Private conversation with Marcel`,
      features: [],
      npcs: [{
        id: 'marcel',
        displayName: 'Marcel',
        hasPortrait: true
      }],
      groups: {},
      scene: null,
      isMarcelDm: true
    },
    newAchievements
  });
});

/**
 * GET /api/marcel-dm/channel/history
 * Full chat history for the DM channel
 */
router.get('/channel/history', authRequired, (req, res) => {
  const channelUserId = resolveChannelUser(req, res);
  if (!channelUserId) return;

  const history = enrichHistory(loadHistory(channelUserId));
  res.json({ history, locationId: `marcel_dm_${channelUserId}` });
});

/**
 * GET /api/marcel-dm/channel/messages?since=<ISO>
 * Poll for new messages
 */
router.get('/channel/messages', authRequired, (req, res) => {
  const channelUserId = resolveChannelUser(req, res);
  if (!channelUserId) return;

  const { since } = req.query;
  const locationId = `marcel_dm_${channelUserId}`;
  const history = enrichHistory(loadHistory(channelUserId));

  if (!since) {
    return res.json({ messages: history });
  }

  const newMessages = history.filter(msg => msg.timestamp > since);
  const typing = getTypingInLocation(locationId);

  const reactions = {};
  for (const msg of history) {
    if (msg.id && msg.reactions && Object.keys(msg.reactions).length > 0) {
      reactions[msg.id] = msg.reactions;
    }
  }

  const deleted = consumeDeletedIds(channelUserId);

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
 * POST /api/marcel-dm/channel/message
 * Send a message in the DM channel (auto-enqueues to Clawdbot)
 */
router.post('/channel/message', authRequired, async (req, res) => {
  const channelUserId = resolveChannelUser(req, res);
  if (!channelUserId) return;

  const { message, type, gifUrl, gifWidth, gifHeight } = req.body;
  const locationId = `marcel_dm_${channelUserId}`;

  // GIF messages
  if (type === 'gif') {
    if (!gifUrl || typeof gifUrl !== 'string' || !/^https:\/\/media[0-4]?\.giphy\.com\//.test(gifUrl)) {
      return res.status(400).json({ error: 'Invalid GIF URL' });
    }
    if (!checkRateLimit(req.user.id)) {
      return res.status(429).json({ error: 'Too many messages. Please wait a moment.' });
    }

    await acquireLock(channelUserId);
    try {
      const history = loadHistory(channelUserId);
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
      saveHistory(channelUserId, history);

      try { require('../lib/xp').awardMessageXp(req.user.id, req.user.username); } catch (e) { console.error('[xp]', e.message); }
      try { require('../lib/xp').incrementLifetimeStat(req.user.id, req.user.username, 'gifs_sent'); } catch (e) { console.error('[xp]', e.message); }
      let newAchievements = [];
      try { newAchievements = require('../lib/achievements').checkAchievements(req.user.id, req.user.username, 'message_sent', { hour: new Date().getUTCHours() }).newAchievements; } catch (e) { console.error('[achievements]', e.message); }

      return res.json({ playerMessage: playerMsg, responses: [], newAchievements });
    } finally {
      releaseLock(channelUserId);
    }
  }

  // Text messages
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'Message is required' });
  }
  if (message.length > 1000) {
    return res.status(400).json({ error: 'Message too long (max 1000 characters)' });
  }
  if (!checkRateLimit(req.user.id)) {
    return res.status(429).json({ error: 'Too many messages. Please wait a moment.' });
  }

  await acquireLock(channelUserId);
  try {
    const history = loadHistory(channelUserId);
    const playerName = getPlayerName(req.user);

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
    saveHistory(channelUserId, history);

    // Auto-enqueue to Clawdbot (every message in a private DM goes to Marcel)
    const clawdbotRoutes = require('./clawdbot');
    clawdbotRoutes.enqueueMention(locationId, playerMsg);

    // Schedule a delayed 👀 reaction from Marcel on the player's message
    const msgId = playerMsg.id;
    const lockKey = channelUserId;
    setTimeout(async () => {
      await acquireLock(lockKey);
      try {
        const hist = loadHistory(lockKey);
        const msg = hist.find(m => m.id === msgId);
        if (msg) {
          if (!msg.reactions) msg.reactions = {};
          if (!msg.reactions['👀']) msg.reactions['👀'] = [];
          if (!msg.reactions['👀'].includes('marcel')) {
            msg.reactions['👀'].push('marcel');
          }
          saveHistory(lockKey, hist);

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
        releaseLock(lockKey);
      }
    }, 1500);

    try { require('../lib/xp').awardMessageXp(req.user.id, req.user.username); } catch (e) { console.error('[xp]', e.message); }
    let newAchievements = [];
    try { newAchievements = require('../lib/achievements').checkAchievements(req.user.id, req.user.username, 'message_sent', { hour: new Date().getUTCHours() }).newAchievements; } catch (e) { console.error('[achievements]', e.message); }

    res.json({ playerMessage: playerMsg, responses: [], marcelMentioned: true, newAchievements });
  } catch (error) {
    console.error('[marcelDm] Message error:', error.message);
    res.status(500).json({ error: 'Failed to send message' });
  } finally {
    releaseLock(channelUserId);
  }
});

/**
 * POST /api/marcel-dm/channel/messages/:messageId/react
 * Toggle emoji reaction on a DM message
 */
router.post('/channel/messages/:messageId/react', authRequired, async (req, res) => {
  const channelUserId = resolveChannelUser(req, res);
  if (!channelUserId) return;

  const { messageId } = req.params;
  const { emoji } = req.body;

  if (!emoji || typeof emoji !== 'string') {
    return res.status(400).json({ error: 'Emoji is required' });
  }

  const userId = req.user.id;

  await acquireLock(channelUserId);
  try {
    const history = loadHistory(channelUserId);
    const message = history.find(m => m.id === messageId);

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (!message.reactions) message.reactions = {};
    if (!message.reactions[emoji]) message.reactions[emoji] = [];

    const idx = message.reactions[emoji].indexOf(userId);
    if (idx === -1) {
      message.reactions[emoji].push(userId);
    } else {
      message.reactions[emoji].splice(idx, 1);
      if (message.reactions[emoji].length === 0) {
        delete message.reactions[emoji];
      }
    }

    if (Object.keys(message.reactions).length === 0) {
      delete message.reactions;
    }

    saveHistory(channelUserId, history);
    res.json({ reactions: message.reactions || {} });
  } catch (error) {
    console.error('[marcelDm] React error:', error.message);
    res.status(500).json({ error: 'Failed to toggle reaction' });
  } finally {
    releaseLock(channelUserId);
  }
});

/**
 * GET /api/marcel-dm/players
 * DM-only: list all players who have DM channels
 */
router.get('/players', authRequired, (req, res) => {
  if (!DM_USER_IDS.includes(req.user.id)) {
    return res.status(403).json({ error: 'DM access required' });
  }

  const players = loadPlayers();

  // Find all DM history files — channelKey is the filename minus .json
  // channelKey can be a bare userId or userId_suffix (e.g. 12345_2)
  let dmFiles = [];
  try {
    dmFiles = fs.readdirSync(DM_HISTORY_DIR).filter(f => f.endsWith('.json'));
  } catch {
    // Directory might not exist yet
  }

  const seenChannelKeys = new Set();
  const result = dmFiles.map(f => {
    const channelKey = f.replace('.json', '');
    seenChannelKeys.add(channelKey);
    // Extract base userId (strip _N suffix if present)
    const baseUserId = channelKey.replace(/_\d+$/, '');
    const player = players[baseUserId];
    const suffix = channelKey !== baseUserId ? channelKey.replace(`${baseUserId}_`, '') : null;
    const baseName = player?.characterName || player?.displayName || baseUserId;
    return {
      userId: channelKey,
      characterName: suffix ? `${baseName} (${suffix})` : baseName,
      displayName: player?.displayName || null,
      avatar: player?.avatar || null
    };
  });

  // Also include all known players even without DM history
  for (const [userId, player] of Object.entries(players)) {
    if (!seenChannelKeys.has(userId)) {
      result.push({
        userId,
        characterName: player?.characterName || null,
        displayName: player?.displayName || null,
        avatar: player?.avatar || null
      });
    }
  }

  res.json({ players: result });
});

module.exports = router;

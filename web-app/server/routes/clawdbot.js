/**
 * Clawdbot Integration Routes
 * 
 * Provides endpoints for Clawdbot (Marcel) to interact with the web app.
 * Clawdbot uses these to see locations, read history, and post responses.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { 
  loadLocations, 
  loadNpcRegistry 
} = require('../lib/dialogue');
const { WebSocket } = require('ws');
const { setNpcTyping } = require('../lib/typing');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'chat_history', 'shared');
const PLAYERS_PATH = path.join(DATA_DIR, 'players.json');

// In-memory queue for messages mentioning Marcel
// In a real app, this might be Redis or a database table
const marcelQueue = [];

/**
 * Internal helper to add a message to Marcel's queue
 */
router.enqueueMention = function(locationId, playerMsg) {
  const mention = {
    locationId,
    message: playerMsg,
    timestamp: new Date().toISOString()
  };
  marcelQueue.push(mention);
  // Keep queue small
  if (marcelQueue.length > 50) marcelQueue.shift();

  // Broadcast via WebSocket
  const wss = router.getWss();
  if (wss) {
    const payload = JSON.stringify({ type: 'mention', ...mention });
    console.log(`[clawdbot] Broadcasting mention to ${wss.clients.size} clients`);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }
};

/**
 * Helper to get WSS from app
 */
router.getWss = function() {
  return router.app ? router.app.get('wss') : null;
};

/**
 * GET /api/clawdbot/queue
 * Polling endpoint for Clawdbot to check for new mentions.
 */
router.get('/queue', (req, res) => {
  const messages = [...marcelQueue];
  // We don't clear it here yet, let the client handle what it has seen
  // or simple: clear it on read if it's 1-on-1
  marcelQueue.length = 0; 
  res.json({ messages });
});

/**
 * POST /api/clawdbot/message
 * Trigger a mention notification for Clawdbot.
 */
router.post('/message', (req, res) => {
  const { locationId, message } = req.body;
  if (!locationId || !message) {
    return res.status(400).json({ error: 'locationId and message are required' });
  }
  router.enqueueMention(locationId, message);
  res.json({ status: 'enqueued' });
});

/**
 * POST /api/clawdbot/typing
 * Trigger a typing notification for Clawdbot.
 */
router.post('/typing', (req, res) => {
  const { locationId, npc, npcDisplayName, typing } = req.body;
  if (!locationId) {
    return res.status(400).json({ error: 'locationId is required' });
  }

  // Use shared typing library
  setNpcTyping(locationId, npc || 'marcel', npcDisplayName || 'Marcel', !!typing);

  // Broadcast via WebSocket for real-time UI
  const wss = router.getWss();
  if (wss) {
    const payload = JSON.stringify({ 
      type: 'typing', 
      locationId, 
      npc: npc || 'marcel', 
      npcDisplayName: npcDisplayName || 'Marcel',
      typing: !!typing 
    });
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }
  res.json({ success: true });
});

/**
 * GET /api/channels
 * List all locations/rooms
 */
router.get('/channels', (req, res) => {
  const locations = loadLocations();
  const channels = Object.entries(locations).map(([id, loc]) => ({
    id,
    name: loc.name,
    description: loc.description,
    npcs: loc.npcs || []
  }));
  res.json({ channels });
});

/**
 * GET /api/channels/:id/messages
 * Message history for context
 */
router.get('/channels/:id/messages', (req, res) => {
  const { id } = req.params;
  const histPath = path.join(HISTORY_DIR, `${id}.json`);
  
  try {
    const history = JSON.parse(fs.readFileSync(histPath, 'utf-8'));
    res.json({ history });
  } catch {
    res.json({ history: [] });
  }
});

/**
 * POST /api/channels/:id/messages
 * Clawdbot sends a response back to the channel
 */
router.post('/channels/:id/messages', (req, res) => {
  const { id } = req.params;
  const { text, emotion, npc } = req.body;

  if (!text) return res.status(400).json({ error: 'Text is required' });

  const histPath = path.join(HISTORY_DIR, `${id}.json`);
  let history = [];
  try {
    history = JSON.parse(fs.readFileSync(histPath, 'utf-8'));
  } catch {
    // ignore
  }

  const npcMsg = {
    id: crypto.randomUUID(),
    role: 'npc',
    npc: npc || 'marcel',
    npcDisplayName: 'Marcel',
    text,
    emotion: emotion || 'idle',
    timestamp: new Date().toISOString()
  };

  history.push(npcMsg);
  
  // Clear typing status for this NPC in the shared registry
  setNpcTyping(id, npcMsg.npc, npcMsg.npcDisplayName, false);

  const wss = router.getWss();
  if (wss) {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ 
          type: 'typing', 
          locationId: id, 
          npc: npcMsg.npc, 
          typing: false 
        }));
      }
    });
  }
  
  // Keep history trimmed (matches MAX_HISTORY in chat.js)
  const trimmed = history.slice(-30);
  
  try {
    fs.writeFileSync(histPath, JSON.stringify(trimmed, null, 2));
    res.json({ success: true, message: npcMsg });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save message' });
  }
});

/**
 * GET /api/users/:id
 * Player info
 */
router.get('/users/:id', (req, res) => {
  const { id } = req.params;
  try {
    const players = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf-8'));
    const player = players[id];
    if (!player) return res.status(404).json({ error: 'User not found' });
    
    res.json({
      id,
      displayName: player.displayName,
      characterName: player.characterName,
      avatar: player.avatar
    });
  } catch {
    res.status(500).json({ error: 'Failed to load players' });
  }
});

module.exports = router;

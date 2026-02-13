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
const multer = require('multer');
const { WebSocket } = require('ws');
const { setNpcTyping } = require('../lib/typing');
const { notifyPlayerMentions } = require('../lib/notifications');

const { loadHistory, saveHistory, resolveHistoryPath, DM_HISTORY_DIR } = require('../lib/chatHistory');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
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

  // Also list marcel_dm_* channels from the DM directory
  try {
    const dmFiles = fs.readdirSync(DM_HISTORY_DIR).filter(f => f.endsWith('.json'));
    for (const f of dmFiles) {
      const userId = f.replace('.json', '');
      channels.push({
        id: `marcel_dm_${userId}`,
        name: `Marcel DM (${userId})`,
        description: 'Private Marcel DM channel',
        npcs: ['marcel']
      });
    }
  } catch {
    // DM directory may not exist yet
  }

  res.json({ channels });
});

/**
 * GET /api/channels/:id/messages
 * Message history for context
 */
router.get('/channels/:id/messages', (req, res) => {
  const { id } = req.params;
  const history = loadHistory(id);
  res.json({ history });
});

/**
 * POST /api/channels/:id/messages
 * Clawdbot sends a response back to the channel
 */
router.post('/channels/:id/messages', (req, res) => {
  const { id } = req.params;
  const { text, emotion, npc } = req.body;

  if (!text) return res.status(400).json({ error: 'Text is required' });

  const history = loadHistory(id);

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

  try {
    saveHistory(id, history);

    // Notify @mentions in Marcel's message
    if (router.app) {
      const locations = loadLocations();
      const locName = locations[id]?.name || id;
      notifyPlayerMentions(text, id, locName, 'Marcel', router.app);
    }

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

/**
 * POST /api/clawdbot/channels/:id/upload
 * Bot/NPC image upload — multipart/form-data
 */
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const UPLOAD_LOG_PATH = path.join(DATA_DIR, 'upload_log.json');
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const botStorage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});

const botUpload = multer({
  storage: botStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type'));
  }
});

router.post('/channels/:id/upload', (req, res) => {
  botUpload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const { id } = req.params;
    const { caption, npc, emotion } = req.body;
    const filename = req.file.filename;
    const imageUrl = `/uploads/${filename}`;
    const registry = loadNpcRegistry();
    const npcName = npc || 'marcel';

    const npcMsg = {
      id: crypto.randomUUID(),
      role: 'npc',
      type: 'image',
      npc: npcName,
      npcDisplayName: registry[npcName]?.displayName || 'Marcel',
      imageUrl,
      imageWidth: null,
      imageHeight: null,
      text: caption || '',
      emotion: emotion || 'idle',
      timestamp: new Date().toISOString()
    };

    const history = loadHistory(id);

    history.push(npcMsg);
    setNpcTyping(id, npcMsg.npc, npcMsg.npcDisplayName, false);

    try {
      saveHistory(id, history);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to save message' });
    }

    // Log the upload
    let log = [];
    try { log = JSON.parse(fs.readFileSync(UPLOAD_LOG_PATH, 'utf-8')); }
    catch { /* first entry */ }
    log.push({
      id: npcMsg.id,
      filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      width: null,
      height: null,
      uploadedBy: 'bot',
      uploaderName: npcMsg.npcDisplayName,
      channel: id,
      channelType: id.startsWith('marcel_dm_') ? 'marcel_dm' : 'shared',
      messageId: npcMsg.id,
      timestamp: npcMsg.timestamp
    });
    const tmpLog = UPLOAD_LOG_PATH + '.tmp';
    fs.writeFileSync(tmpLog, JSON.stringify(log, null, 2));
    fs.renameSync(tmpLog, UPLOAD_LOG_PATH);

    res.json({ success: true, message: npcMsg });
  });
});

module.exports = router;

/**
 * Image Upload Route
 *
 * Handles player image uploads for location chats and DM channels.
 * Stores files as UUID-named in data/uploads/, logs metadata to upload_log.json.
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { authRequired } = require('../middleware/auth');
const { acquireLock, releaseLock } = require('../lib/locks');
const { loadLocations } = require('../lib/dialogue');
const clawdbotRoutes = require('./clawdbot');

const DM_USER_IDS = (process.env.DM_USER_IDS || '').split(',').filter(Boolean);

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const UPLOAD_LOG_PATH = path.join(DATA_DIR, 'upload_log.json');
const HISTORY_DIR = path.join(DATA_DIR, 'chat_history');
const SHARED_DIR = path.join(HISTORY_DIR, 'shared');
const DM_HISTORY_DIR = path.join(HISTORY_DIR, 'marcel_dm');
const PLAYERS_PATH = path.join(DATA_DIR, 'players.json');
const MAX_HISTORY = 30;

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];
const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// Rate limit for uploads (stricter than chat)
const uploadRateLimits = new Map();
const UPLOAD_RATE_LIMIT = 3; // per minute
const UPLOAD_RATE_WINDOW = 60 * 1000;

function checkUploadRateLimit(userId) {
  const now = Date.now();
  const userRequests = uploadRateLimits.get(userId) || [];
  const recent = userRequests.filter(ts => now - ts < UPLOAD_RATE_WINDOW);
  if (recent.length >= UPLOAD_RATE_LIMIT) return false;
  recent.push(now);
  uploadRateLimits.set(userId, recent);
  return true;
}

function isLocationLocked(location, userId) {
  if (location.locked) return true;
  if (Array.isArray(location.lockedFor) && location.lockedFor.includes(userId)) return true;
  return false;
}

function loadPlayers() {
  try { return JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf-8')); }
  catch { return {}; }
}

function getPlayerName(user) {
  const players = loadPlayers();
  return players[user.id]?.characterName || user.global_name || user.username;
}

// Resolve history file path for a channel
function resolveHistoryPath(channelId) {
  const dmMatch = channelId.match(/^marcel_dm_(.+)$/);
  if (dmMatch) {
    if (!fs.existsSync(DM_HISTORY_DIR)) {
      fs.mkdirSync(DM_HISTORY_DIR, { recursive: true });
    }
    return path.join(DM_HISTORY_DIR, `${dmMatch[1]}.json`);
  }
  if (!fs.existsSync(SHARED_DIR)) {
    fs.mkdirSync(SHARED_DIR, { recursive: true });
  }
  return path.join(SHARED_DIR, `${channelId}.json`);
}

function loadHistory(channelId) {
  const histPath = resolveHistoryPath(channelId);
  try { return JSON.parse(fs.readFileSync(histPath, 'utf-8')); }
  catch { return []; }
}

function saveHistory(channelId, history) {
  const trimmed = history.slice(-MAX_HISTORY);
  const histPath = resolveHistoryPath(channelId);
  const tmpPath = histPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(trimmed, null, 2));
  fs.renameSync(tmpPath, histPath);
}

function appendUploadLog(entry) {
  let log = [];
  try { log = JSON.parse(fs.readFileSync(UPLOAD_LOG_PATH, 'utf-8')); }
  catch { /* first entry */ }
  log.push(entry);
  const tmpPath = UPLOAD_LOG_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(log, null, 2));
  fs.renameSync(tmpPath, UPLOAD_LOG_PATH);
}

// Multer: store to disk with UUID filenames
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    // iOS Safari sometimes reports empty or incorrect MIME for HEIC — fall back to extension
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIMES.includes(file.mimetype) || ALLOWED_EXTS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: jpg, png, webp, gif, heic'));
    }
  }
});

/**
 * POST /api/chat/upload
 * Player image upload — multipart/form-data
 */
router.post('/upload', authRequired, (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large (max 5MB)' });
      }
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const { channelId, caption, imageWidth, imageHeight } = req.body;

    if (!channelId) {
      // Clean up uploaded file
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'channelId is required' });
    }

    if (!checkUploadRateLimit(req.user.id)) {
      fs.unlink(req.file.path, () => {});
      return res.status(429).json({ error: 'Too many uploads. Please wait a moment.' });
    }

    // Validate channel access
    const isDM = DM_USER_IDS.includes(req.user.id);
    const isMarcelDm = channelId.match(/^marcel_dm_(.+)$/);

    if (isMarcelDm) {
      // DM channel: only the owner or admin can upload
      const dmUserId = isMarcelDm[1];
      if (dmUserId !== req.user.id && !isDM) {
        fs.unlink(req.file.path, () => {});
        return res.status(403).json({ error: 'Not your DM channel' });
      }
    } else {
      // Shared location: validate it exists and isn't locked
      const locations = loadLocations();
      const location = locations[channelId];
      if (!location) {
        fs.unlink(req.file.path, () => {});
        return res.status(404).json({ error: 'Location not found' });
      }
      if (isLocationLocked(location, req.user.id) && !isDM) {
        fs.unlink(req.file.path, () => {});
        return res.status(403).json({ error: 'This location is currently locked' });
      }
    }

    const messageId = crypto.randomUUID();
    const filename = req.file.filename;
    const imageUrl = `/uploads/${filename}`;
    const playerName = getPlayerName(req.user);

    const playerMsg = {
      id: messageId,
      role: 'player',
      type: 'image',
      userId: req.user.id,
      playerName,
      playerAvatar: req.user.avatar,
      imageUrl,
      imageWidth: parseInt(imageWidth, 10) || null,
      imageHeight: parseInt(imageHeight, 10) || null,
      text: caption || '',
      timestamp: new Date().toISOString()
    };

    await acquireLock(channelId);
    try {
      const history = loadHistory(channelId);
      history.push(playerMsg);
      saveHistory(channelId, history);

      // Forward image to Clawdbot for Marcel DM channels
      if (isMarcelDm) {
        const locationId = channelId;
        const fullImageUrl = `${req.protocol}://${req.get('host')}${imageUrl}`;
        clawdbotRoutes.enqueueMention(locationId, {
          ...playerMsg,
          imageUrl: fullImageUrl
        });
      }

      // Log the upload
      appendUploadLog({
        id: messageId,
        filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        width: parseInt(imageWidth, 10) || null,
        height: parseInt(imageHeight, 10) || null,
        uploadedBy: req.user.id,
        uploaderName: playerName,
        channel: channelId,
        channelType: isMarcelDm ? 'marcel_dm' : 'shared',
        messageId,
        timestamp: playerMsg.timestamp
      });

      try { require('../lib/xp').incrementLifetimeStat(req.user.id, req.user.username, 'images_sent'); } catch (e) { console.error('[xp]', e.message); }

      let newAchievements = [];
      try { newAchievements = require('../lib/achievements').checkAchievements(req.user.id, req.user.username, 'image_uploaded').newAchievements; } catch (e) { console.error('[achievements]', e.message); }

      res.json({ playerMessage: playerMsg, responses: [], newAchievements });
    } catch (error) {
      console.error('[upload] Save error:', error.message);
      res.status(500).json({ error: 'Failed to save image message' });
    } finally {
      releaseLock(channelId);
    }
  });
});

module.exports = router;

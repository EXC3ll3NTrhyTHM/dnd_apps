/**
 * Notification Settings API
 *
 * Manages push subscriptions and per-channel mute settings.
 * Push has two states:
 *   - pushDesired: user toggled push ON (permission granted)
 *   - pushSubscription: actual browser push subscription (may arrive later)
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { authRequired } = require('../middleware/auth');
const { getVapidKeys } = require('../lib/notifications');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const PLAYERS_PATH = path.join(DATA_DIR, 'players.json');

function loadPlayers() {
  try { return JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf-8')); }
  catch { return {}; }
}

function savePlayers(players) {
  const tmpPath = PLAYERS_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(players, null, 2));
  fs.renameSync(tmpPath, PLAYERS_PATH);
}

/**
 * GET /api/notifications/vapid-public-key
 */
router.get('/vapid-public-key', (req, res) => {
  const keys = getVapidKeys();
  res.json({ publicKey: keys.publicKey });
});

/**
 * GET /api/notifications/settings
 * Returns the user's notification preferences
 */
router.get('/settings', authRequired, (req, res) => {
  const players = loadPlayers();
  const player = players[req.user.id] || {};
  res.json({
    pushDesired: !!player.pushDesired,
    pushSubscribed: !!player.pushSubscription,
    mutedChannels: player.mutedChannels || []
  });
});

/**
 * POST /api/notifications/enable-push
 * User toggled push ON — record intent (subscription comes later)
 */
router.post('/enable-push', authRequired, (req, res) => {
  const players = loadPlayers();
  if (!players[req.user.id]) players[req.user.id] = {};
  players[req.user.id].pushDesired = true;
  savePlayers(players);
  res.json({ success: true });
});

/**
 * POST /api/notifications/disable-push
 * User toggled push OFF — clear intent and subscription
 */
router.post('/disable-push', authRequired, (req, res) => {
  const players = loadPlayers();
  if (players[req.user.id]) {
    players[req.user.id].pushDesired = false;
    delete players[req.user.id].pushSubscription;
    savePlayers(players);
  }
  res.json({ success: true });
});

/**
 * POST /api/notifications/subscribe
 * Save the actual push subscription (called by background process)
 */
router.post('/subscribe', authRequired, (req, res) => {
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Valid subscription required' });
  }

  const players = loadPlayers();
  if (!players[req.user.id]) players[req.user.id] = {};
  players[req.user.id].pushSubscription = subscription;
  players[req.user.id].pushDesired = true;
  savePlayers(players);

  res.json({ success: true });
});

/**
 * POST /api/notifications/unsubscribe
 * Remove push subscription (legacy, disable-push is preferred)
 */
router.post('/unsubscribe', authRequired, (req, res) => {
  const players = loadPlayers();
  if (players[req.user.id]) {
    delete players[req.user.id].pushSubscription;
    savePlayers(players);
  }
  res.json({ success: true });
});

/**
 * POST /api/notifications/mute-channel
 */
router.post('/mute-channel', authRequired, (req, res) => {
  const { channelId } = req.body;
  if (!channelId) return res.status(400).json({ error: 'channelId required' });

  const players = loadPlayers();
  if (!players[req.user.id]) players[req.user.id] = {};
  if (!players[req.user.id].mutedChannels) players[req.user.id].mutedChannels = [];

  if (!players[req.user.id].mutedChannels.includes(channelId)) {
    players[req.user.id].mutedChannels.push(channelId);
    savePlayers(players);
  }

  res.json({ mutedChannels: players[req.user.id].mutedChannels });
});

/**
 * POST /api/notifications/unmute-channel
 */
router.post('/unmute-channel', authRequired, (req, res) => {
  const { channelId } = req.body;
  if (!channelId) return res.status(400).json({ error: 'channelId required' });

  const players = loadPlayers();
  if (!players[req.user.id]) players[req.user.id] = {};
  if (!players[req.user.id].mutedChannels) players[req.user.id].mutedChannels = [];

  players[req.user.id].mutedChannels = players[req.user.id].mutedChannels.filter(c => c !== channelId);
  savePlayers(players);

  res.json({ mutedChannels: players[req.user.id].mutedChannels });
});

module.exports = router;

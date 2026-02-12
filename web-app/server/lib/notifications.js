/**
 * Notification System
 *
 * Handles @mention detection, in-app WebSocket notifications,
 * and push notifications via web-push.
 */

const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const PLAYERS_PATH = path.join(DATA_DIR, 'players.json');
const VAPID_PATH = path.join(DATA_DIR, 'vapid-keys.json');

// ============================================
// VAPID KEY MANAGEMENT
// ============================================

let vapidKeys = null;

function getVapidKeys() {
  if (vapidKeys) return vapidKeys;

  // Try loading from file
  try {
    vapidKeys = JSON.parse(fs.readFileSync(VAPID_PATH, 'utf-8'));
  } catch {
    // Generate new keys
    vapidKeys = webpush.generateVAPIDKeys();
    fs.writeFileSync(VAPID_PATH, JSON.stringify(vapidKeys, null, 2));
    console.log('[notifications] Generated new VAPID keys');
  }

  webpush.setVapidDetails(
    'mailto:noreply@dragonshollow.app',
    vapidKeys.publicKey,
    vapidKeys.privateKey
  );

  return vapidKeys;
}

// Initialize on load
getVapidKeys();

// ============================================
// PLAYER MENTION DETECTION
// ============================================

function loadPlayers() {
  try { return JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf-8')); }
  catch { return {}; }
}

/**
 * Scan text for @CharacterName mentions and return matched player IDs.
 * Returns [{ userId, characterName }]
 */
function detectPlayerMentions(text, players) {
  if (!text) return [];

  const mentions = [];
  const lowerText = text.toLowerCase();

  for (const [userId, player] of Object.entries(players)) {
    if (!player.characterName) continue;
    const pattern = '@' + player.characterName.toLowerCase();
    if (lowerText.includes(pattern)) {
      mentions.push({ userId, characterName: player.characterName });
    }
  }

  return mentions;
}

/**
 * After a message is saved, check for @mentions and notify affected players.
 *
 * @param {string} text - The message text to scan
 * @param {string} locationId - The chat location ID
 * @param {string} locationName - Human-readable location name
 * @param {string} fromName - Display name of the sender
 * @param {object} app - Express app (for wss access)
 * @param {string} [excludeUserId] - Don't notify this user (the sender)
 */
function notifyPlayerMentions(text, locationId, locationName, fromName, app, excludeUserId) {
  const players = loadPlayers();
  const mentions = detectPlayerMentions(text, players);

  if (mentions.length === 0) return;

  const wss = app.get('wss');

  for (const { userId, characterName } of mentions) {
    // Don't notify the sender
    if (userId === excludeUserId) continue;

    // Check if player has muted this channel
    const player = players[userId];
    if (player.mutedChannels && player.mutedChannels.includes(locationId)) continue;

    // Check WebSocket connections for this user
    let wsClient = null;
    let isViewingChat = false;

    if (wss) {
      for (const client of wss.clients) {
        if (client.readyState === 1 && client.userId === userId) {
          wsClient = client;
          if (client.currentLocation === locationId) {
            isViewingChat = true;
          }
          break;
        }
      }
    }

    // Suppress if actively viewing this chat
    if (isViewingChat) continue;

    const payload = {
      type: 'mention',
      locationId,
      locationName: locationName || locationId,
      fromName,
      text: text.length > 120 ? text.slice(0, 120) + '...' : text,
      timestamp: new Date().toISOString()
    };

    // Connected on a different page → send via WS
    if (wsClient) {
      try {
        wsClient.send(JSON.stringify(payload));
      } catch (e) {
        console.error('[notifications] WS send error:', e.message);
      }
      continue;
    }

    // Not connected → push notification
    if (player.pushSubscription) {
      sendPush(player.pushSubscription, {
        title: `${fromName} mentioned you`,
        body: text.length > 100 ? text.slice(0, 100) + '...' : text,
        locationId,
        locationName: locationName || locationId
      }).then(result => {
        if (result.expired) {
          // Remove stale subscription
          const fresh = loadPlayers();
          if (fresh[userId]) {
            delete fresh[userId].pushSubscription;
            const tmpPath = PLAYERS_PATH + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(fresh, null, 2));
            fs.renameSync(tmpPath, PLAYERS_PATH);
          }
        }
      }).catch(() => {});
    }
  }
}

// ============================================
// PUSH NOTIFICATIONS
// ============================================

/**
 * Send a push notification to a subscription.
 * Returns { success, expired }
 */
async function sendPush(subscription, payload) {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { success: true, expired: false };
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      return { success: false, expired: true };
    }
    console.error('[notifications] Push error:', err.message);
    return { success: false, expired: false };
  }
}

module.exports = {
  getVapidKeys,
  detectPlayerMentions,
  notifyPlayerMentions,
  sendPush
};

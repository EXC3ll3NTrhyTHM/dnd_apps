/**
 * In-memory player presence tracker
 *
 * Tracks which players are at which location.
 * Entries expire after STALE_MS without a heartbeat.
 */

const fs = require('fs');
const path = require('path');

const STALE_MS = 2 * 60 * 1000; // 2 minutes
const PLAYERS_PATH = path.resolve(__dirname, '..', '..', 'data', 'players.json');

function loadPlayers() {
  try { return JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf-8')); }
  catch { return {}; }
}

// locationId -> Map<userId, { username, avatar, lastSeen }>
const locations = new Map();

function join(locationId, user) {
  // Remove from any previous location first
  leave(null, user.id);

  const players = loadPlayers();
  const displayName = players[user.id]?.characterName || user.global_name || user.username;

  if (!locations.has(locationId)) locations.set(locationId, new Map());
  locations.get(locationId).set(user.id, {
    username: displayName,
    avatar: user.avatar,
    lastSeen: Date.now()
  });
}

function leave(locationId, userId) {
  if (locationId) {
    const loc = locations.get(locationId);
    if (loc) loc.delete(userId);
  } else {
    // Remove from all locations
    for (const users of locations.values()) {
      users.delete(userId);
    }
  }
}

function heartbeat(locationId, userId) {
  const loc = locations.get(locationId);
  if (loc?.has(userId)) {
    loc.get(userId).lastSeen = Date.now();
  }
}

function getAll() {
  const now = Date.now();
  const result = {};

  for (const [locId, users] of locations) {
    const active = [];
    for (const [userId, data] of users) {
      if (now - data.lastSeen < STALE_MS) {
        active.push({ id: userId, username: data.username, avatar: data.avatar });
      } else {
        users.delete(userId);
      }
    }
    if (active.length > 0) result[locId] = active;
  }
  return result;
}

module.exports = { join, leave, heartbeat, getAll };

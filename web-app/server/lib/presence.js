/**
 * In-memory player presence tracker
 *
 * Tracks which players are at which location.
 * Entries expire after STALE_MS without a heartbeat.
 */

const fs = require('fs');
const path = require('path');

const STALE_MS = 30 * 1000; // 30 seconds
const PERSIST_INTERVAL_MS = 10 * 1000; // debounce disk writes to every 10s
const PLAYERS_PATH = path.resolve(__dirname, '..', '..', 'data', 'players.json');

function loadPlayers() {
  try { return JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf-8')); }
  catch { return {}; }
}

function savePlayers(data) {
  const tmp = PLAYERS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, PLAYERS_PATH);
}

// Debounced persistence for lastSeen/lastLocation
let _persistTimer = null;
let _pendingUpdates = new Map(); // userId -> { lastSeen, lastLocation }

function _schedulePersist() {
  if (_persistTimer) return;
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    if (_pendingUpdates.size === 0) return;
    try {
      const players = loadPlayers();
      for (const [userId, update] of _pendingUpdates) {
        if (!players[userId]) players[userId] = {};
        players[userId].lastSeen = update.lastSeen;
        players[userId].lastLocation = update.lastLocation;
      }
      savePlayers(players);
    } catch (e) {
      console.error('[presence] Failed to persist lastSeen:', e.message);
    }
    _pendingUpdates.clear();
  }, PERSIST_INTERVAL_MS);
}

function _queuePersist(userId, locationId) {
  _pendingUpdates.set(userId, {
    lastSeen: new Date().toISOString(),
    lastLocation: locationId
  });
  _schedulePersist();
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

  // Persist lastSeen + lastLocation to players.json immediately on join
  try {
    const allPlayers = loadPlayers();
    if (!allPlayers[user.id]) allPlayers[user.id] = {};
    allPlayers[user.id].lastSeen = new Date().toISOString();
    allPlayers[user.id].lastLocation = locationId;
    savePlayers(allPlayers);
  } catch (e) {
    console.error('[presence] Failed to persist on join:', e.message);
  }
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
    // Persist lastSeen update (debounced)
    _queuePersist(userId, locationId);
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

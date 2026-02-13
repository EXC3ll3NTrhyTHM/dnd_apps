/**
 * Players API Routes
 *
 * Returns all registered players with merged profile, XP, and presence data.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { authRequired } = require('../middleware/auth');
const presence = require('../lib/presence');
const { loadXpData, getLevelFromXp, incrementLifetimeStat } = require('../lib/xp');
const { loadWallets, getInventory } = require('../lib/economy');
const { getUserAchievements, checkAchievements } = require('../lib/achievements');

const PLAYERS_PATH = path.resolve(__dirname, '..', '..', 'data', 'players.json');
const LOCATIONS_PATH = path.resolve(__dirname, '..', '..', 'data', 'locations.json');

function loadJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch { return {}; }
}

function resolveLocationName(locationId, locationsData) {
  if (!locationId) return null;
  if (locationId.startsWith('marcel_dm_')) return 'Marcel DM';
  return locationsData[locationId]?.name || null;
}

/**
 * GET /api/players
 * Returns all players with profile, XP, and online status
 */
router.get('/', authRequired, (req, res) => {
  const playersData = loadJson(PLAYERS_PATH);
  const xpData = loadXpData();
  const locationsData = loadJson(LOCATIONS_PATH);
  const livePresence = presence.getAll();

  // Build a set of online user IDs and their current location
  const onlineMap = new Map(); // userId -> locationId
  for (const [locId, users] of Object.entries(livePresence)) {
    for (const u of users) {
      onlineMap.set(u.id, locId);
    }
  }

  const players = Object.entries(playersData).map(([id, p]) => {
    const xpRecord = xpData[id];
    const totalXp = xpRecord?.total_xp || 0;
    const levelInfo = getLevelFromXp(totalXp);
    const online = onlineMap.has(id);
    const currentLocation = onlineMap.get(id);

    return {
      id,
      characterName: p.characterName || p.displayName || 'Unknown',
      avatar: p.avatar || null,
      level: levelInfo.level,
      totalXp,
      online,
      lastSeen: p.lastSeen || null,
      lastLocation: online ? currentLocation : (p.lastLocation || null),
      lastLocationName: resolveLocationName(online ? currentLocation : p.lastLocation, locationsData)
    };
  });

  // Sort: online first, then by lastSeen desc
  players.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    if (!a.lastSeen && !b.lastSeen) return 0;
    if (!a.lastSeen) return 1;
    if (!b.lastSeen) return -1;
    return new Date(b.lastSeen) - new Date(a.lastSeen);
  });

  res.json({ players });
});

/**
 * GET /api/players/:playerId
 * Returns a single player's public profile
 */
router.get('/:playerId', authRequired, (req, res) => {
  const { playerId } = req.params;
  const playersData = loadJson(PLAYERS_PATH);

  if (!playersData[playerId]) {
    return res.status(404).json({ error: 'Player not found' });
  }

  const p = playersData[playerId];
  const xpData = loadXpData();
  const locationsData = loadJson(LOCATIONS_PATH);
  const wallets = loadWallets();
  const livePresence = presence.getAll();

  // Check online status
  let online = false;
  let currentLocation = null;
  for (const [locId, users] of Object.entries(livePresence)) {
    for (const u of users) {
      if (u.id === playerId) {
        online = true;
        currentLocation = locId;
      }
    }
  }

  // XP & level
  const xpRecord = xpData[playerId];
  const totalXp = xpRecord?.total_xp || 0;
  const levelInfo = getLevelFromXp(totalXp);

  // Gold
  const wallet = wallets[playerId];
  const gold = wallet?.balance || 0;

  // Inventory
  const inventory = getInventory(playerId);

  // Achievements
  const { achievements, stats: achievementStats } = getUserAchievements(playerId, req.user.id);

  // Location
  const lastLocation = online ? currentLocation : (p.lastLocation || null);
  const lastLocationName = resolveLocationName(lastLocation, locationsData);

  // Check if the requesting user can access this player's location
  let locationAccessible = false;
  if (lastLocation) {
    const loc = locationsData[lastLocation];
    if (loc) {
      const isLocked = loc.locked || (Array.isArray(loc.lockedFor) && loc.lockedFor.includes(req.user.id));
      locationAccessible = !isLocked;
    }
    // Marcel DM locations are only accessible to the DM channel owner
    if (lastLocation.startsWith('marcel_dm_')) {
      const channelOwner = lastLocation.replace('marcel_dm_', '');
      locationAccessible = channelOwner === req.user.id;
    }
  }

  // Track achievement for viewing another player's profile
  let viewerAchievements = [];
  if (req.user.id !== playerId) {
    incrementLifetimeStat(req.user.id, req.user.username, 'profiles_viewed', 1);
    const { newAchievements } = checkAchievements(req.user.id, req.user.username, 'profile_viewed');
    viewerAchievements = newAchievements;
  }

  res.json({
    id: playerId,
    characterName: p.characterName || p.displayName || 'Unknown',
    avatar: p.avatar || null,
    level: levelInfo.level,
    totalXp,
    xpInLevel: levelInfo.xpInCurrentLevel,
    xpForNext: levelInfo.xpForNextLevel,
    gold,
    online,
    lastSeen: p.lastSeen || null,
    lastLocation,
    lastLocationName,
    locationAccessible,
    inventory: { items: inventory.items || [], badges: inventory.badges || [] },
    achievements,
    achievementStats,
    viewerAchievements,
  });
});

module.exports = router;

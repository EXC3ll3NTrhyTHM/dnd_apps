/**
 * Fishing System - Core Logic
 *
 * Fish catalog, weighted rarity selection, catch determination,
 * and per-player fishing stats.
 */

const fs = require('fs');
const path = require('path');

const FISH_CATALOG_PATH = path.resolve(__dirname, '..', '..', 'data', 'fish_catalog.json');
const FISHING_STATS_PATH = path.resolve(__dirname, '..', '..', 'data', 'fishing_stats.json');

// ============================================
// ATOMIC I/O
// ============================================

function atomicWrite(filePath, data) {
  const tempPath = filePath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filePath);
}

function loadFishCatalog() {
  try {
    return JSON.parse(fs.readFileSync(FISH_CATALOG_PATH, 'utf-8'));
  } catch {
    return { fish: [], baitWeights: {} };
  }
}

function loadFishingStats() {
  try {
    return JSON.parse(fs.readFileSync(FISHING_STATS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveFishingStats(data) {
  atomicWrite(FISHING_STATS_PATH, data);
}

// ============================================
// CATCH DETERMINATION
// ============================================

/**
 * Weighted random rarity selection, then random fish of that rarity,
 * then random weight within the fish's range.
 * If equippedRod is 'iron_rod', roll for junk first.
 */
function determineCatch(baitId, equippedRod) {
  const catalog = loadFishCatalog();
  const weights = catalog.baitWeights[baitId];
  if (!weights) return null;

  // Junk roll — iron_rod only
  if (equippedRod === 'iron_rod' && catalog.junkChance) {
    const junkPct = catalog.junkChance[baitId] || 0;
    if (junkPct > 0 && Math.random() < junkPct) {
      const junkItems = catalog.fish.filter(f => f.rarity === 'junk');
      if (junkItems.length > 0) {
        const junk = junkItems[Math.floor(Math.random() * junkItems.length)];
        const rolledWeight = +(junk.weight.min + Math.random() * (junk.weight.max - junk.weight.min)).toFixed(1);
        const biteDelay = 2000 + Math.floor(Math.random() * 6000);
        return { fish: junk, rolledWeight, biteDelay };
      }
    }
  }

  // Weighted random rarity pick
  const rarities = Object.entries(weights);
  const totalWeight = rarities.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * totalWeight;

  let selectedRarity = 'common';
  for (const [rarity, weight] of rarities) {
    roll -= weight;
    if (roll <= 0) {
      selectedRarity = rarity;
      break;
    }
  }

  // Pick random fish of that rarity
  const candidates = catalog.fish.filter(f => f.rarity === selectedRarity);
  if (candidates.length === 0) return null;

  const fish = candidates[Math.floor(Math.random() * candidates.length)];

  // Roll weight
  const rolledWeight = +(fish.weight.min + Math.random() * (fish.weight.max - fish.weight.min)).toFixed(1);

  // Bite delay: 2-8 seconds
  const biteDelay = 2000 + Math.floor(Math.random() * 6000);

  return {
    fish,
    rolledWeight,
    biteDelay,
  };
}

// ============================================
// STATS TRACKING
// ============================================

function recordCatch(userId, username, fishId, rarity, weight) {
  const stats = loadFishingStats();
  if (!stats[userId]) {
    stats[userId] = {
      username,
      total_caught: 0,
      total_escaped: 0,
      total_sold: 0,
      gold_earned: 0,
      catches: {},
      biggest_catch: null,
    };
  }

  const s = stats[userId];
  s.username = username;
  s.total_caught += 1;
  s.catches[fishId] = (s.catches[fishId] || 0) + 1;
  s.last_catch = new Date().toISOString();

  // Track biggest catch by weight (junk doesn't count)
  if (rarity !== 'junk' && (!s.biggest_catch || weight > s.biggest_catch.weight)) {
    const catalog = loadFishCatalog();
    const fish = catalog.fish.find(f => f.id === fishId);
    s.biggest_catch = {
      fishId,
      name: fish?.name || fishId,
      rarity,
      weight,
      icon: fish?.icon || '',
      date: new Date().toISOString(),
    };
  }

  saveFishingStats(stats);
  return s;
}

function getBiggestCatchLeaderboard(limit = 5) {
  const stats = loadFishingStats();
  const playersPath = path.resolve(__dirname, '..', '..', 'data', 'players.json');
  let players = {};
  try { players = JSON.parse(fs.readFileSync(playersPath, 'utf-8')); } catch {}

  return Object.entries(stats)
    .filter(([, s]) => s.biggest_catch)
    .map(([userId, s]) => ({
      userId,
      username: players[userId]?.characterName || s.username,
      fish: s.biggest_catch.name,
      rarity: s.biggest_catch.rarity,
      weight: s.biggest_catch.weight,
      icon: s.biggest_catch.icon,
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
}

function recordEscape(userId, username) {
  const stats = loadFishingStats();
  if (!stats[userId]) {
    stats[userId] = {
      username,
      total_caught: 0,
      total_escaped: 0,
      total_sold: 0,
      gold_earned: 0,
      catches: {},
    };
  }

  stats[userId].username = username;
  stats[userId].total_escaped += 1;
  saveFishingStats(stats);
  return stats[userId];
}

function recordSale(userId, username, goldAmount) {
  const stats = loadFishingStats();
  if (!stats[userId]) {
    stats[userId] = {
      username,
      total_caught: 0,
      total_escaped: 0,
      total_sold: 0,
      gold_earned: 0,
      catches: {},
    };
  }

  stats[userId].username = username;
  stats[userId].total_sold += 1;
  stats[userId].gold_earned += goldAmount;
  saveFishingStats(stats);
  return stats[userId];
}

module.exports = {
  loadFishCatalog,
  loadFishingStats,
  saveFishingStats,
  determineCatch,
  recordCatch,
  recordEscape,
  recordSale,
  getBiggestCatchLeaderboard,
};

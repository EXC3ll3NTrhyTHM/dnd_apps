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
 */
function determineCatch(baitId) {
  const catalog = loadFishCatalog();
  const weights = catalog.baitWeights[baitId];
  if (!weights) return null;

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

function recordCatch(userId, username, fishId, rarity) {
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

  const s = stats[userId];
  s.username = username;
  s.total_caught += 1;
  s.catches[fishId] = (s.catches[fishId] || 0) + 1;
  s.last_catch = new Date().toISOString();

  saveFishingStats(stats);
  return s;
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
};

/**
 * Monster Data Loader
 *
 * Loads monster definitions from data/monsters.json.
 * Provides lookup by ID and listing functions.
 */

const fs = require('fs');
const path = require('path');

const MONSTERS_PATH = path.resolve(__dirname, '..', '..', 'data', 'monsters.json');

let monstersCache = null;

function loadMonsters() {
  try {
    const raw = fs.readFileSync(MONSTERS_PATH, 'utf-8');
    monstersCache = JSON.parse(raw);
    return monstersCache;
  } catch (err) {
    console.error('[monsters] Failed to load monsters.json:', err.message);
    monstersCache = [];
    return monstersCache;
  }
}

// Load on first require
loadMonsters();

function getMonster(monsterId) {
  if (!monstersCache) loadMonsters();
  return monstersCache.find(m => m.id === monsterId) || null;
}

function getAllMonsters() {
  if (!monstersCache) loadMonsters();
  return monstersCache;
}

function getMonstersByLocation(locationSetting) {
  if (!monstersCache) loadMonsters();
  // Future: filter by setting tags. For now return all.
  return monstersCache;
}

module.exports = { getMonster, getAllMonsters, getMonstersByLocation, loadMonsters };

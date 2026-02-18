/**
 * Monster Data Loader
 *
 * Loads monster definitions from data/monsters.json.
 * Reads fresh from disk each call so edits are picked up without a server restart.
 */

const fs = require('fs');
const path = require('path');

const MONSTERS_PATH = path.resolve(__dirname, '..', '..', 'data', 'monsters.json');

function loadMonsters() {
  try {
    const raw = fs.readFileSync(MONSTERS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[monsters] Failed to load monsters.json:', err.message);
    return [];
  }
}

function getMonster(monsterId) {
  return loadMonsters().find(m => m.id === monsterId) || null;
}

function getAllMonsters() {
  return loadMonsters();
}

function getMonstersByLocation(locationSetting) {
  // Future: filter by setting tags. For now return all.
  return loadMonsters();
}

module.exports = { getMonster, getAllMonsters, getMonstersByLocation, loadMonsters };

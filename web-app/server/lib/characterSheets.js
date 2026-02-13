/**
 * Character Sheet Parser
 *
 * Reads D&D Beyond JSON exports from players_stat/ and produces
 * condensed character-sheet objects for the web app.
 * Supports player overrides (backstory, traits, physical, etc.)
 * stored separately so original D&D Beyond exports stay untouched.
 */

const fs = require('fs');
const path = require('path');

const STAT_DIR = path.join(__dirname, '..', '..', 'players_stat');
const OVERRIDES_FILE = path.join(__dirname, '..', '..', 'data', 'character_overrides.json');

// Discord user ID → filename in players_stat/
const CHARACTER_MAP = {
  '424061511833747467': 'the_architect.json',
  '1374906408046166036': 'tyren.json',
  '765978025937469481': 'aly.json',
  '1073385140669128725': 'nalyd.json',
  '228241331296665600': 'acacia.json'
};

const STAT_NAMES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const STAT_FULL_NAMES = ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'];

function calcModifier(score) {
  return Math.floor((score - 10) / 2);
}

function calcProfBonus(level) {
  return Math.ceil(level / 4) + 1;
}

/**
 * Sum racial/class/item stat bonuses from data.modifiers
 * Returns { 1: bonus, 2: bonus, ... } keyed by stat ID
 */
function getStatBonuses(data) {
  const bonuses = {};
  if (!data.modifiers) return bonuses;

  const sources = ['race', 'class', 'background', 'item', 'feat'];
  for (const src of sources) {
    const mods = data.modifiers[src];
    if (!Array.isArray(mods)) continue;
    for (const mod of mods) {
      if (mod.type !== 'bonus' || !mod.isGranted) continue;
      // subType like "strength-score" → stat ID from entityId
      const match = (mod.subType || '').match(/^(strength|dexterity|constitution|intelligence|wisdom|charisma)-score$/);
      if (match) {
        const idx = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'].indexOf(match[1]);
        const statId = idx + 1;
        bonuses[statId] = (bonuses[statId] || 0) + (mod.value || 0);
      }
    }
  }
  return bonuses;
}

/**
 * Calculate AC from equipped armor + DEX modifier
 */
function calcAC(inventory, dexMod) {
  let ac = 10 + dexMod; // default unarmored

  if (!Array.isArray(inventory)) return ac;

  for (const item of inventory) {
    if (!item.equipped || !item.definition) continue;
    const def = item.definition;
    if (def.armorClass && def.filterType === 'Armor' && def.armorTypeId) {
      const baseAC = def.armorClass;
      // Heavy armor: no DEX, Medium: max +2 DEX, Light: full DEX
      if (def.type === 'Heavy Armor') {
        ac = baseAC;
      } else if (def.type === 'Medium Armor') {
        ac = baseAC + Math.min(dexMod, 2);
      } else {
        // Light armor
        ac = baseAC + dexMod;
      }
      break; // only one armor worn
    }
  }

  // Shield bonus
  for (const item of inventory) {
    if (!item.equipped || !item.definition) continue;
    if (item.definition.type === 'Shield') {
      ac += 2;
      break;
    }
  }

  return ac;
}

/**
 * Parse a D&D Beyond JSON export into a condensed sheet.
 * Returns null if the data is invalid or empty.
 */
function parseSheet(raw) {
  if (!raw || !raw.data) return null;
  const d = raw.data;

  // Base stats + racial/class bonuses
  const statBonuses = getStatBonuses(d);
  const stats = (d.stats || []).map((s, i) => {
    const base = s.value || 10;
    const bonus = statBonuses[s.id] || 0;
    // Also add bonusStats if set
    const bonusStat = (d.bonusStats || [])[i];
    const extra = (bonusStat && bonusStat.value) || 0;
    const total = base + bonus + extra;
    return {
      id: s.id,
      abbr: STAT_NAMES[i],
      name: STAT_FULL_NAMES[i],
      score: total,
      modifier: calcModifier(total)
    };
  });

  // Classes
  const classes = (d.classes || []).map(c => ({
    name: c.definition?.name || 'Unknown',
    level: c.level || 1,
    subclass: c.subclassDefinition?.name || null
  }));

  const totalLevel = classes.reduce((sum, c) => sum + c.level, 0);
  const profBonus = calcProfBonus(totalLevel);

  // DEX mod for AC calc
  const dexStat = stats.find(s => s.id === 2);
  const dexMod = dexStat ? dexStat.modifier : 0;
  const ac = calcAC(d.inventory, dexMod);

  // Equipped items (weapons + armor + shield)
  const equippedItems = (d.inventory || [])
    .filter(item => item.equipped && item.definition)
    .map(item => ({
      name: item.definition.name,
      type: item.definition.type || item.definition.filterType || 'Item',
      filterType: item.definition.filterType || null
    }))
    .filter(item => ['Weapon', 'Armor'].includes(item.filterType) || item.type === 'Shield');

  // Traits
  const traits = d.traits || {};

  // Physical description
  const physical = {};
  if (d.age) physical.age = d.age;
  if (d.gender) physical.gender = d.gender;
  if (d.hair) physical.hair = d.hair;
  if (d.eyes) physical.eyes = d.eyes;
  if (d.skin) physical.skin = d.skin;
  if (d.height) physical.height = d.height;
  if (d.weight) physical.weight = d.weight + ' lbs';

  // Notes
  const notes = d.notes || {};

  return {
    name: d.name || 'Unknown',
    race: d.race?.fullName || d.race?.baseName || 'Unknown',
    classes,
    totalLevel,
    background: d.background?.definition?.name || null,
    stats,
    hp: d.baseHitPoints || 0,
    ac,
    profBonus,
    traits: {
      personalityTraits: traits.personalityTraits || null,
      ideals: traits.ideals || null,
      bonds: traits.bonds || null,
      flaws: traits.flaws || null
    },
    physical,
    backstory: notes.backstory || null,
    enemies: notes.enemies || null,
    organizations: notes.organizations || null,
    equipment: equippedItems
  };
}

// ============================================
// ATOMIC WRITE (matches economy.js pattern)
// ============================================

function atomicWrite(filePath, data) {
  const tempPath = filePath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filePath);
}

// ============================================
// OVERRIDES
// ============================================

let overridesCache = {};

function loadOverrides() {
  try {
    const content = fs.readFileSync(OVERRIDES_FILE, 'utf8');
    overridesCache = JSON.parse(content);
  } catch {
    overridesCache = {};
  }
}

loadOverrides();

/**
 * Merge overrides on top of a parsed sheet.
 * Overrides win for text fields only (backstory, enemies, organizations, traits, physical).
 */
function applyOverrides(sheet, discordUserId) {
  if (!sheet) return null;
  const ov = overridesCache[discordUserId];
  if (!ov) return sheet;

  const merged = { ...sheet };

  if (ov.backstory !== undefined) merged.backstory = ov.backstory;
  if (ov.enemies !== undefined) merged.enemies = ov.enemies;
  if (ov.organizations !== undefined) merged.organizations = ov.organizations;

  if (ov.traits) {
    merged.traits = { ...merged.traits };
    for (const key of ['personalityTraits', 'ideals', 'bonds', 'flaws']) {
      if (ov.traits[key] !== undefined) merged.traits[key] = ov.traits[key];
    }
  }

  if (ov.physical) {
    merged.physical = { ...merged.physical, ...ov.physical };
  }

  return merged;
}

// Pre-load all character sheets at require-time
const sheetsCache = {};

for (const [discordId, filename] of Object.entries(CHARACTER_MAP)) {
  try {
    const filePath = path.join(STAT_DIR, filename);
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content || content.trim().length === 0) {
      sheetsCache[discordId] = null;
      continue;
    }
    const raw = JSON.parse(content);
    sheetsCache[discordId] = parseSheet(raw);
  } catch {
    sheetsCache[discordId] = null;
  }
}

/**
 * Get a character sheet for a Discord user ID.
 * Returns the condensed sheet object (with overrides merged) or null.
 */
function getCharacterSheet(discordUserId) {
  const base = sheetsCache[discordUserId] || null;
  return applyOverrides(base, discordUserId);
}

/**
 * Update character sheet overrides for a user.
 * Accepts partial updates: { backstory?, enemies?, organizations?, traits?: { partial }, physical?: { partial } }
 */
function updateCharacterSheet(discordUserId, updates) {
  // Re-read from disk to avoid stale data
  loadOverrides();

  const existing = overridesCache[discordUserId] || {};

  // Deep-merge traits and physical; flat-merge top-level strings
  if (updates.backstory !== undefined) existing.backstory = updates.backstory;
  if (updates.enemies !== undefined) existing.enemies = updates.enemies;
  if (updates.organizations !== undefined) existing.organizations = updates.organizations;

  if (updates.traits) {
    existing.traits = existing.traits || {};
    for (const key of ['personalityTraits', 'ideals', 'bonds', 'flaws']) {
      if (updates.traits[key] !== undefined) existing.traits[key] = updates.traits[key];
    }
  }

  if (updates.physical) {
    existing.physical = existing.physical || {};
    for (const [key, val] of Object.entries(updates.physical)) {
      existing.physical[key] = val;
    }
  }

  overridesCache[discordUserId] = existing;
  atomicWrite(OVERRIDES_FILE, overridesCache);

  return getCharacterSheet(discordUserId);
}

module.exports = { getCharacterSheet, updateCharacterSheet };

/**
 * Weapon Damage Lookup (SRD Data)
 *
 * Maps weapon names to their damage dice, damage type, and properties.
 * Used by the encounter system to determine damage rolls from player equipment.
 * Also parses D&D Beyond weapon item definitions directly.
 */

// SRD weapon table — fallback when D&D Beyond data isn't available
const WEAPON_TABLE = {
  // Simple Melee
  'Club':           { dice: '1d4',  type: 'bludgeoning', light: true },
  'Dagger':         { dice: '1d4',  type: 'piercing', finesse: true, light: true, thrown: true },
  'Greatclub':      { dice: '1d8',  type: 'bludgeoning', twoHanded: true },
  'Handaxe':        { dice: '1d6',  type: 'slashing', light: true, thrown: true },
  'Javelin':        { dice: '1d6',  type: 'piercing', thrown: true },
  'Light Hammer':   { dice: '1d4',  type: 'bludgeoning', light: true, thrown: true },
  'Mace':           { dice: '1d6',  type: 'bludgeoning' },
  'Quarterstaff':   { dice: '1d6',  type: 'bludgeoning', versatile: '1d8' },
  'Sickle':         { dice: '1d4',  type: 'slashing', light: true },
  'Spear':          { dice: '1d6',  type: 'piercing', thrown: true, versatile: '1d8' },

  // Simple Ranged
  'Light Crossbow':  { dice: '1d8',  type: 'piercing', ranged: true, twoHanded: true },
  'Dart':            { dice: '1d4',  type: 'piercing', ranged: true, finesse: true },
  'Shortbow':        { dice: '1d6',  type: 'piercing', ranged: true, twoHanded: true },
  'Sling':           { dice: '1d4',  type: 'bludgeoning', ranged: true },

  // Martial Melee
  'Battleaxe':       { dice: '1d8',  type: 'slashing', versatile: '1d10' },
  'Flail':           { dice: '1d8',  type: 'bludgeoning' },
  'Glaive':          { dice: '1d10', type: 'slashing', twoHanded: true, reach: true },
  'Greataxe':        { dice: '1d12', type: 'slashing', twoHanded: true },
  'Greatsword':      { dice: '2d6',  type: 'slashing', twoHanded: true },
  'Halberd':         { dice: '1d10', type: 'slashing', twoHanded: true, reach: true },
  'Lance':           { dice: '1d12', type: 'piercing', reach: true },
  'Longsword':       { dice: '1d8',  type: 'slashing', versatile: '1d10' },
  'Maul':            { dice: '2d6',  type: 'bludgeoning', twoHanded: true },
  'Morningstar':     { dice: '1d8',  type: 'piercing' },
  'Pike':            { dice: '1d10', type: 'piercing', twoHanded: true, reach: true },
  'Rapier':          { dice: '1d8',  type: 'piercing', finesse: true, light: true, vex: true },
  'Scimitar':        { dice: '1d6',  type: 'slashing', finesse: true, light: true },
  'Shortsword':      { dice: '1d6',  type: 'piercing', finesse: true, light: true },
  'Trident':         { dice: '1d6',  type: 'piercing', thrown: true, versatile: '1d8' },
  'War Pick':        { dice: '1d8',  type: 'piercing' },
  'Warhammer':       { dice: '1d8',  type: 'bludgeoning', versatile: '1d10' },
  'Whip':            { dice: '1d4',  type: 'slashing', finesse: true, reach: true },

  // Martial Ranged
  'Longbow':         { dice: '1d8',  type: 'piercing', ranged: true, twoHanded: true },
  'Heavy Crossbow':  { dice: '1d10', type: 'piercing', ranged: true, twoHanded: true },
  'Hand Crossbow':   { dice: '1d6',  type: 'piercing', ranged: true, light: true },

  // Fallback unarmed
  'Unarmed Strike':  { dice: '1d4',  type: 'bludgeoning' },
  'Fists':           { dice: '1d4',  type: 'bludgeoning' },
};

/**
 * Look up a weapon by name from the SRD table.
 * Returns { dice, type, finesse?, ranged?, ... } or null.
 */
function getWeaponStats(weaponName) {
  return WEAPON_TABLE[weaponName] || null;
}

/**
 * Parse a D&D Beyond inventory weapon item into combat-ready stats.
 * Uses the raw item definition data from the character export.
 */
function parseWeaponFromItem(item) {
  const def = item.definition;
  if (!def || def.filterType !== 'Weapon') return null;

  const props = (def.properties || []).map(p => p.name.toLowerCase());
  const isFinesse = props.includes('finesse');
  const isRanged = def.attackType === 2 || (def.range && def.range > 10);
  const isThrown = props.includes('thrown');

  return {
    name: def.name,
    dice: def.damage?.diceString || '1d4',
    type: (def.damageType || 'bludgeoning').toLowerCase(),
    finesse: isFinesse,
    ranged: isRanged,
    thrown: isThrown,
  };
}

/**
 * Get the best equipped weapon from a character sheet's equipment array.
 * Prefers melee weapons, falls back to ranged, then unarmed.
 */
function getBestWeapon(equipment) {
  if (!equipment || equipment.length === 0) {
    return { name: 'Fists', dice: '1d4', type: 'bludgeoning', finesse: false, ranged: false };
  }

  // Filter to weapons only
  const weapons = equipment
    .filter(e => e.filterType === 'Weapon')
    .map(e => getWeaponStats(e.name) ? { name: e.name, ...getWeaponStats(e.name) } : null)
    .filter(Boolean);

  if (weapons.length === 0) {
    return { name: 'Fists', dice: '1d4', type: 'bludgeoning', finesse: false, ranged: false };
  }

  // Pick the weapon with the highest average damage
  return weapons.sort((a, b) => avgDamage(b.dice) - avgDamage(a.dice))[0];
}

/**
 * Calculate average damage from a dice notation like "2d6" or "1d8".
 */
function avgDamage(diceStr) {
  const match = diceStr.match(/^(\d+)d(\d+)$/);
  if (!match) return 2.5;
  return (parseInt(match[1]) * (parseInt(match[2]) + 1)) / 2;
}

/**
 * Roll damage from a dice notation like "2d6+3".
 * Returns { total, rolls, notation }.
 */
function rollDamage(notation) {
  const match = notation.match(/^(\d+)d(\d+)(?:\+(\d+))?$/);
  if (!match) return { total: 1, rolls: [1], notation };

  const count = parseInt(match[1]);
  const sides = parseInt(match[2]);
  const bonus = match[3] ? parseInt(match[3]) : 0;

  const rolls = [];
  for (let i = 0; i < count; i++) {
    rolls.push(Math.floor(Math.random() * sides) + 1);
  }

  const total = rolls.reduce((s, r) => s + r, 0) + bonus;
  return { total, rolls, bonus, notation };
}

/**
 * Roll a d20.
 */
function rollD20() {
  return Math.floor(Math.random() * 20) + 1;
}

/**
 * Generate individual die rolls from a notation string.
 * Supports multi-group notation like "1d8+1d6" or simple "2d6".
 * Returns { rolls: [face1, face2, ...], total } (raw faces, no modifier).
 */
function generateRolls(notation) {
  const rolls = [];
  const dicePattern = /(\d+)d(\d+)/gi;
  let match;

  while ((match = dicePattern.exec(notation)) !== null) {
    const count = parseInt(match[1], 10);
    const sides = parseInt(match[2], 10);
    for (let i = 0; i < count; i++) {
      rolls.push(Math.floor(Math.random() * sides) + 1);
    }
  }

  if (rolls.length === 0) rolls.push(1);
  const total = rolls.reduce((s, r) => s + r, 0);
  return { rolls, total };
}

/**
 * Get ALL equipped weapons for a character, plus Unarmed Strike.
 * Each weapon includes pre-computed attackBonus and damageMod based on stats.
 * Sorted by average damage (highest first).
 */
function getAllWeapons(equipment, sheet) {
  const weapons = [];
  const strStat = (sheet.stats || []).find(s => s.abbr === 'STR');
  const dexStat = (sheet.stats || []).find(s => s.abbr === 'DEX');
  const strMod = strStat ? strStat.modifier : 0;
  const dexMod = dexStat ? dexStat.modifier : 0;
  const profBonus = sheet.profBonus || 2;

  if (equipment && equipment.length > 0) {
    const weaponItems = equipment
      .filter(e => e.filterType === 'Weapon')
      .map(e => getWeaponStats(e.name) ? { name: e.name, ...getWeaponStats(e.name) } : null)
      .filter(Boolean);

    for (const w of weaponItems) {
      const atkMod = w.finesse ? Math.max(strMod, dexMod) : (w.ranged ? dexMod : strMod);
      weapons.push({
        id: w.name.toLowerCase().replace(/\s+/g, '_'),
        name: w.name,
        dice: w.dice,
        type: w.type,
        finesse: w.finesse || false,
        ranged: w.ranged || false,
        light: w.light || false,
        twoHanded: w.twoHanded || false,
        vex: w.vex || false,
        attackBonus: atkMod + profBonus,
        damageMod: atkMod,
      });
    }
  }

  // Always include Unarmed Strike
  if (!weapons.some(w => w.name === 'Unarmed Strike')) {
    weapons.push({
      id: 'unarmed_strike',
      name: 'Unarmed Strike',
      dice: '1d4',
      type: 'bludgeoning',
      finesse: false,
      ranged: false,
      attackBonus: strMod + profBonus,
      damageMod: strMod,
    });
  }

  // Sort by average damage (highest first)
  weapons.sort((a, b) => avgDamage(b.dice) - avgDamage(a.dice));

  return weapons;
}

module.exports = {
  WEAPON_TABLE,
  getWeaponStats,
  parseWeaponFromItem,
  getBestWeapon,
  getAllWeapons,
  avgDamage,
  rollDamage,
  rollD20,
  generateRolls,
};

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
  'Rapier':          { dice: '1d8',  type: 'piercing', finesse: true },
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
  'Unarmed Strike':  { dice: '1d1',  type: 'bludgeoning' },
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

module.exports = {
  WEAPON_TABLE,
  getWeaponStats,
  parseWeaponFromItem,
  getBestWeapon,
  avgDamage,
  rollDamage,
  rollD20,
};

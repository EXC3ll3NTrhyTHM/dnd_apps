/**
 * Treasure Chest System
 *
 * After arena combat victories, players receive a chest with randomized gold
 * and items based on monster CR. Chests are ephemeral in-memory state (like
 * encounters) with a 5-minute expiry. Gold/items are only awarded on claim.
 */

const crypto = require('crypto');
const { awardGold, addItemToInventory, getInventory, loadCatalog } = require('./economy');

// ============================================
// IN-MEMORY PENDING CHESTS
// ============================================

const pendingChests = new Map();
const CHEST_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

// Cleanup expired chests every 60s
setInterval(() => {
  const now = Date.now();
  for (const [id, chest] of pendingChests) {
    if (now - chest.createdAt > CHEST_EXPIRY_MS) {
      pendingChests.delete(id);
    }
  }
}, 60_000);

// ============================================
// RARITY CONFIG
// ============================================

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

const RARITY_WEIGHTS_BY_CR = {
  0.25: [60, 30, 8, 1.5, 0.5],
  1:    [45, 35, 15, 4, 1],
  2:    [30, 35, 25, 8, 2],
  3:    [20, 35, 30, 12, 3],
  5:    [10, 25, 35, 22, 8],
};

const GOLD_MULTIPLIERS = {
  common:    [0.50, 0.75],
  uncommon:  [0.75, 1.00],
  rare:      [1.00, 1.50],
  epic:      [1.50, 2.00],
  legendary: [2.00, 3.00],
};

const ITEM_SLOTS = {
  common:    [0, 1],
  uncommon:  [1, 1],
  rare:      [1, 2],
  epic:      [2, 3],
  legendary: [3, 4],
};

const TAP_SEQUENCES = {
  common:    ['common', 'common', 'common', 'common', 'common'],
  uncommon:  ['common', 'common', 'common', 'common', 'uncommon'],
  rare:      ['common', 'common', 'common', 'uncommon', 'rare'],
  epic:      ['common', 'common', 'uncommon', 'rare', 'epic'],
  legendary: ['common', 'uncommon', 'rare', 'epic', 'legendary'],
};

// ============================================
// LOOT POOLS
// ============================================

const LOOT_POOLS = {
  common: [
    { id: 'basic_worm', name: 'Basic Worm', type: 'bait', icon: '\uD83E\uDEB1' },
    { id: 'item_blunt', name: 'Blunt', type: 'consumable', icon: '\uD83C\uDF3F' },
  ],
  uncommon: [
    { id: 'enchanted_grub', name: 'Enchanted Grub', type: 'bait', icon: '\u2728' },
    { id: 'potion_healing', name: 'Potion of Healing', type: 'potion', icon: '\uD83E\uDDEA' },
  ],
  rare: [
    { id: 'potion_greater_healing', name: 'Potion of Greater Healing', type: 'potion', icon: '\uD83E\uDDEA' },
    { id: 'abyssal_lure', name: 'Abyssal Lure', type: 'bait', icon: '\uD83C\uDFA3' },
  ],
  // epic and legendary use dice sets — resolved dynamically
};

// ============================================
// HELPERS
// ============================================

function rollRarity(monsterCr) {
  // Find closest CR tier (round down to nearest key)
  const tiers = Object.keys(RARITY_WEIGHTS_BY_CR).map(Number).sort((a, b) => a - b);
  let tier = tiers[0];
  for (const t of tiers) {
    if (monsterCr >= t) tier = t;
  }
  const weights = RARITY_WEIGHTS_BY_CR[tier];
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * totalWeight;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return RARITIES[i];
  }
  return 'common';
}

function randomInRange(min, max) {
  return min + Math.random() * (max - min);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getUnownedDiceSets(userId, minPrice, maxPrice) {
  const catalog = loadCatalog();
  const diceCategory = catalog.categories?.dice_sets;
  if (!diceCategory) return [];

  const inventory = getInventory(userId);
  const ownedIds = new Set(inventory.items.map(i => i.item_id));

  return diceCategory.items.filter(d =>
    d.price >= minPrice && d.price <= maxPrice && !ownedIds.has(d.id)
  );
}

function pickItems(rarity, userId) {
  const [minSlots, maxSlots] = ITEM_SLOTS[rarity];
  const count = randomInt(minSlots, maxSlots);
  if (count === 0) return [];

  const items = [];
  for (let i = 0; i < count; i++) {
    const item = pickSingleItem(rarity, userId, items);
    if (item) items.push(item);
  }
  return items;
}

function pickSingleItem(rarity, userId, alreadyPicked) {
  const pickedIds = new Set(alreadyPicked.map(i => i.id));

  if (rarity === 'epic') {
    // Random unowned dice set 150-300G
    const sets = getUnownedDiceSets(userId, 150, 300).filter(d => !pickedIds.has(d.id));
    if (sets.length > 0) {
      const pick = sets[Math.floor(Math.random() * sets.length)];
      return { id: pick.id, name: pick.name, type: 'dice_set', icon: '\uD83C\uDFB2', quantity: 1 };
    }
    // Duplicate fallback — bonus gold
    const allSets = loadCatalog().categories?.dice_sets?.items?.filter(d => d.price >= 150 && d.price <= 300) || [];
    if (allSets.length > 0) {
      const pick = allSets[Math.floor(Math.random() * allSets.length)];
      return { id: `bonus_gold_${pick.id}`, name: `${pick.price}G (duplicate ${pick.name})`, type: 'bonus_gold', icon: '\uD83D\uDCB0', quantity: 1, bonusGold: pick.price };
    }
    return null;
  }

  if (rarity === 'legendary') {
    // 50% chance: Potion of Superior Healing, 50% chance: dice set 500-750G
    if (Math.random() < 0.5 && !pickedIds.has('potion_superior_healing')) {
      return { id: 'potion_superior_healing', name: 'Potion of Superior Healing', type: 'potion', icon: '\uD83E\uDDEA', quantity: 1 };
    }
    const sets = getUnownedDiceSets(userId, 500, 750).filter(d => !pickedIds.has(d.id));
    if (sets.length > 0) {
      const pick = sets[Math.floor(Math.random() * sets.length)];
      return { id: pick.id, name: pick.name, type: 'dice_set', icon: '\uD83C\uDFB2', quantity: 1 };
    }
    // Duplicate fallback
    const allSets = loadCatalog().categories?.dice_sets?.items?.filter(d => d.price >= 500 && d.price <= 750) || [];
    if (allSets.length > 0) {
      const pick = allSets[Math.floor(Math.random() * allSets.length)];
      return { id: `bonus_gold_${pick.id}`, name: `${pick.price}G (duplicate ${pick.name})`, type: 'bonus_gold', icon: '\uD83D\uDCB0', quantity: 1, bonusGold: pick.price };
    }
    // Ultimate fallback — superior healing potion
    return { id: 'potion_superior_healing', name: 'Potion of Superior Healing', type: 'potion', icon: '\uD83E\uDDEA', quantity: 1 };
  }

  // Common, uncommon, rare — pick from static pool
  const pool = LOOT_POOLS[rarity];
  if (!pool || pool.length === 0) return null;
  const available = pool.filter(p => !pickedIds.has(p.id));
  if (available.length === 0) return pool[Math.floor(Math.random() * pool.length)]; // allow duplicates for consumables
  const pick = available[Math.floor(Math.random() * available.length)];
  return { ...pick, quantity: 1 };
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Generate a chest for a combat victor.
 * @param {string} userId
 * @param {string} username
 * @param {number} monsterCr - Monster challenge rating
 * @param {number} baseGold - Gold from damage share calculation
 * @returns {object} Chest data for client
 */
function generateChest(userId, username, monsterCr, baseGold) {
  const rarity = rollRarity(monsterCr || 1);
  const [minMult, maxMult] = GOLD_MULTIPLIERS[rarity];
  const gold = Math.max(1, Math.round(baseGold * randomInRange(minMult, maxMult)));
  const items = pickItems(rarity, userId);
  const tapSequence = TAP_SEQUENCES[rarity];
  const chestId = `chest_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  const chest = {
    chestId,
    userId,
    username,
    rarity,
    gold,
    items,
    tapSequence,
    createdAt: Date.now(),
  };

  pendingChests.set(chestId, chest);
  return {
    chestId,
    rarity,
    gold,
    items,
    tapSequence,
  };
}

/**
 * Claim a pending chest — awards gold and items to the player.
 * @param {string} chestId
 * @param {string} userId
 * @returns {{ success: boolean, gold?: number, items?: array, error?: string }}
 */
function claimChest(chestId, userId) {
  const chest = pendingChests.get(chestId);
  if (!chest) return { success: false, error: 'Chest not found or expired' };
  if (chest.userId !== userId) return { success: false, error: 'Not your chest' };

  // Award gold
  let totalGold = chest.gold;
  for (const item of chest.items) {
    if (item.type === 'bonus_gold' && item.bonusGold) {
      totalGold += item.bonusGold;
    }
  }
  console.log(`[Chest] Awarding ${totalGold}g to ${userId} (${chest.username}) from ${chest.rarity} chest`);
  const walletAfter = awardGold(userId, chest.username, totalGold, { source: 'treasure_chest', type: 'treasure_chest', chestRarity: chest.rarity });
  console.log(`[Chest] Wallet after award:`, walletAfter?.balance);

  // Award items (skip bonus_gold pseudo-items)
  for (const item of chest.items) {
    if (item.type === 'bonus_gold') continue;
    addItemToInventory(userId, { id: item.id, name: item.name, type: item.type });
  }

  pendingChests.delete(chestId);
  return { success: true, gold: totalGold, items: chest.items, rarity: chest.rarity };
}

/**
 * Look up a pending chest by ID.
 */
function getPendingChest(chestId, userId) {
  const chest = pendingChests.get(chestId);
  if (!chest || chest.userId !== userId) return null;
  return chest;
}

module.exports = {
  generateChest,
  claimChest,
  getPendingChest,
  // Exposed for testing
  rollRarity,
  RARITIES,
};

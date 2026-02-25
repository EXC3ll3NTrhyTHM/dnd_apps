/**
 * Shop Routes - Grumm's Shop
 *
 * GET  /api/shop/catalog       - Get the full shop catalog
 * POST /api/shop/buy           - Purchase an item
 * POST /api/shop/sell          - Sell an item from inventory
 * GET  /api/shop/sell-prices   - Get sell prices for inventory items
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { authRequired } = require('../middleware/auth');
const { loadCatalog, findItemInCatalog, getWallet, spendGold, awardGold, refundGold, addItemToInventory, getInventory, removeItemFromInventory, useItem } = require('../lib/economy');
const { loadFishCatalog } = require('../lib/fishing');

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

const router = express.Router();

// Get shop catalog
router.get('/catalog', (req, res) => {
  const catalog = loadCatalog();
  res.json(catalog);
});

// Purchase an item from the shop
router.post('/buy', authRequired, (req, res) => {
  const { item_id } = req.body;

  if (!item_id) {
    return res.status(400).json({ error: 'item_id is required' });
  }

  // Find item in catalog
  const found = findItemInCatalog(item_id);
  if (!found) {
    return res.status(404).json({ error: 'Item not found in shop catalog' });
  }

  const { item, categoryDisplay } = found;

  // Check balance and deduct gold
  const wallet = spendGold(
    req.user.id,
    req.user.username,
    item.price,
    'purchase',
    { item_id: item.id, item_name: item.name, source: 'web_app' }
  );

  if (!wallet) {
    const currentWallet = getWallet(req.user.id, req.user.username);
    return res.status(400).json({
      error: 'Not enough gold',
      balance: currentWallet.balance,
      price: item.price
    });
  }

  // Add item to inventory
  const inventory = addItemToInventory(req.user.id, item);

  // Handle dice_set purchases: add colorset to player's ownedDice
  if (item.type === 'dice_set' && item.colorset) {
    try {
      const players = loadPlayers();
      if (!players[req.user.id]) players[req.user.id] = {};
      const p = players[req.user.id];
      if (!p.ownedDice) p.ownedDice = ['default'];
      if (!p.ownedDice.includes(item.colorset)) {
        p.ownedDice.push(item.colorset);
      }
      // Auto-equip if this is their first non-default set
      if (!p.equippedDice || p.equippedDice === 'default') {
        p.equippedDice = item.colorset;
      }
      savePlayers(players);
    } catch (e) { console.error('[dice_set purchase]', e.message); }
  }

  let xpAwarded = 0;
  try {
    const xp = require('../lib/xp');
    const before = xp.getXpRecord(req.user.id, req.user.username).total_xp;
    xp.awardGoldSpendXp(req.user.id, req.user.username, item.price);
    xp.incrementLifetimeStat(req.user.id, req.user.username, 'shop_purchases');
    if (item.type === 'dice_set') {
      xp.incrementLifetimeStat(req.user.id, req.user.username, 'dice_sets_collected');
    }
    const after = xp.getXpRecord(req.user.id, req.user.username).total_xp;
    xpAwarded = after - before;
  } catch (e) { console.error('[xp]', e.message); }

  let newAchievements = [];
  try { newAchievements = require('../lib/achievements').checkAchievements(req.user.id, req.user.username, 'purchase_shop').newAchievements; } catch (e) { console.error('[achievements]', e.message); }

  res.json({
    success: true,
    message: `Purchased ${item.name} for ${item.price}G`,
    item: {
      id: item.id,
      name: item.name,
      price: item.price,
      category: categoryDisplay
    },
    balance: wallet.balance,
    inventory,
    xpAwarded,
    newAchievements
  });
});

// Use a consumable item from inventory
router.post('/use', authRequired, (req, res) => {
  const { item_id, locationId } = req.body;

  if (!item_id || !locationId) {
    return res.status(400).json({ error: 'item_id and locationId are required' });
  }

  // Check the item exists in inventory
  const inventory = getInventory(req.user.id);
  const invEntry = inventory.items.find(i => i.item_id === item_id);
  if (!invEntry || invEntry.quantity <= 0) {
    return res.status(400).json({ error: 'Item not found in inventory' });
  }

  // Verify item is consumable via catalog
  const catalogEntry = findItemInCatalog(item_id);
  if (!catalogEntry || catalogEntry.item.type !== 'consumable') {
    return res.status(400).json({ error: 'Item is not consumable' });
  }

  // Decrement quantity
  const result = useItem(req.user.id, item_id);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  const use_message = catalogEntry.item.use_message || `*uses ${catalogEntry.item.name}*`;
  const characterName = req.user.characterName || req.user.global_name || req.user.username;

  // Broadcast to all WS clients
  const wss = req.app.get('wss');
  if (wss) {
    const payload = JSON.stringify({
      type: 'item_used',
      item_id,
      locationId,
      userId: req.user.id,
      username: req.user.username,
      characterName,
      use_message,
      effect: 'smoke',
    });
    wss.clients.forEach(client => {
      if (client.readyState === 1) client.send(payload);
    });
  }

  res.json({
    success: true,
    use_message,
    inventory: result.inventory,
  });
});

// Helper: look up sell price for an inventory item
function getSellPrice(itemId) {
  // Check shop catalog first
  const catalogEntry = findItemInCatalog(itemId);
  if (catalogEntry) return catalogEntry.item.price;

  // Check fish catalog
  const fishCatalog = loadFishCatalog();
  const fish = (fishCatalog.fish || []).find(f => f.id === itemId);
  if (fish && fish.goldValue) return fish.goldValue;

  return null;
}

// Get sell prices for the player's inventory items
router.get('/sell-prices', authRequired, (req, res) => {
  const inventory = getInventory(req.user.id);
  const prices = {};
  for (const entry of inventory.items) {
    const price = getSellPrice(entry.item_id);
    if (price != null) prices[entry.item_id] = price;
  }
  res.json({ prices });
});

// Sell an item from inventory
router.post('/sell', authRequired, (req, res) => {
  const { item_id, quantity: rawQty } = req.body;
  const quantity = rawQty || 1;

  if (!item_id) {
    return res.status(400).json({ error: 'item_id is required' });
  }

  // Verify item is in inventory with enough quantity
  const inventory = getInventory(req.user.id);
  const invEntry = inventory.items.find(i => i.item_id === item_id);
  if (!invEntry || invEntry.quantity < quantity) {
    return res.status(400).json({ error: 'Not enough of that item in inventory' });
  }

  // Determine sell price
  const unitPrice = getSellPrice(item_id);
  if (unitPrice == null) {
    return res.status(400).json({ error: 'This item cannot be sold' });
  }

  const totalGold = unitPrice * quantity;
  const itemName = invEntry.name || item_id;

  // Remove from inventory
  const updatedInv = removeItemFromInventory(req.user.id, item_id, quantity);
  if (!updatedInv) {
    return res.status(400).json({ error: 'Failed to remove item from inventory' });
  }

  // Refund gold (decrements lifetime_spent instead of inflating lifetime_earned)
  const wallet = refundGold(req.user.id, req.user.username, totalGold, {
    source: 'shop_sale',
    item_id,
    item_name: itemName,
    quantity,
    unit_price: unitPrice
  });

  // Dice set special handling: remove colorset from ownedDice
  const catalogEntry = findItemInCatalog(item_id);
  if (catalogEntry && catalogEntry.item.type === 'dice_set' && catalogEntry.item.colorset) {
    try {
      const players = loadPlayers();
      const p = players[req.user.id];
      if (p && p.ownedDice) {
        p.ownedDice = p.ownedDice.filter(c => c !== catalogEntry.item.colorset);
        if (p.equippedDice === catalogEntry.item.colorset) {
          p.equippedDice = 'default';
        }
        savePlayers(players);
      }
    } catch (e) { console.error('[dice_set sell]', e.message); }
  }

  res.json({
    success: true,
    goldAwarded: totalGold,
    balance: wallet.balance,
    inventory: updatedInv
  });
});

module.exports = router;

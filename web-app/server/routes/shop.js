/**
 * Shop Routes - Grumm's Shop
 * 
 * GET  /api/shop/catalog  - Get the full shop catalog
 * POST /api/shop/buy      - Purchase an item
 */

const express = require('express');
const { authRequired } = require('../middleware/auth');
const { loadCatalog, findItemInCatalog, getWallet, spendGold, addItemToInventory, getInventory, useItem } = require('../lib/economy');

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

  let xpAwarded = 0;
  try {
    const xp = require('../lib/xp');
    const before = xp.getXpRecord(req.user.id, req.user.username).total_xp;
    xp.awardGoldSpendXp(req.user.id, req.user.username, item.price);
    xp.incrementLifetimeStat(req.user.id, req.user.username, 'shop_purchases');
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

module.exports = router;

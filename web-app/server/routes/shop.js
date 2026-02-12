/**
 * Shop Routes - Grumm's Shop
 * 
 * GET  /api/shop/catalog  - Get the full shop catalog
 * POST /api/shop/buy      - Purchase an item
 */

const express = require('express');
const { authRequired } = require('../middleware/auth');
const { loadCatalog, findItemInCatalog, getWallet, spendGold, addItemToInventory } = require('../lib/economy');

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

module.exports = router;

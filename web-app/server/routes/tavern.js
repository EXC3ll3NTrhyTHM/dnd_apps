/**
 * Tavern Routes - The Dragon's Hollow (Big Tam's place)
 * 
 * GET  /api/tavern/menu  - Get the tavern menu
 * POST /api/tavern/buy   - Buy a drink/food (uses currency signal system)
 * 
 * Tavern purchases go through the signal system so the shopkeeper bot
 * handles the actual gold deduction, keeping everything in sync.
 */

const express = require('express');
const { authRequired } = require('../middleware/auth');
const { loadTavernMenu, findItemInTavernMenu, getWallet, writeTavernPurchaseSignal, waitForSignalResult } = require('../lib/economy');

const router = express.Router();

// Get tavern menu
router.get('/menu', (req, res) => {
  const menu = loadTavernMenu();
  res.json(menu);
});

// Buy a drink/food from the tavern
router.post('/buy', authRequired, async (req, res) => {
  const { item_id } = req.body;

  if (!item_id) {
    return res.status(400).json({ error: 'item_id is required' });
  }

  // Find item in tavern menu
  const found = findItemInTavernMenu(item_id);
  if (!found) {
    return res.status(404).json({ error: 'Item not found on the menu' });
  }

  const { item } = found;

  // Pre-check balance (the shopkeeper will also check, but this gives fast feedback)
  const wallet = getWallet(req.user.id, req.user.username);
  if (wallet.balance < item.price) {
    return res.status(400).json({
      error: 'Not enough gold',
      balance: wallet.balance,
      price: item.price
    });
  }

  // Write signal file for the shopkeeper bot to process
  const { signalId } = writeTavernPurchaseSignal(req.user.id, req.user.username, item);

  // Wait for the shopkeeper to process and write result
  const result = await waitForSignalResult(signalId, 8000);

  if (result.success) {
    res.json({
      success: true,
      message: `You ordered ${item.name} from Tam!`,
      item: {
        id: item.id,
        name: item.name,
        price: item.price,
        flavor_text: item.flavor_text
      },
      balance: result.balance_after
    });
  } else {
    res.status(400).json({
      error: result.message || 'Purchase failed',
      balance: result.balance_after
    });
  }
});

module.exports = router;

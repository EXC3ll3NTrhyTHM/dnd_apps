/**
 * Wallet & Inventory Routes
 * 
 * GET /api/wallet     - Gold balance
 * GET /api/inventory  - Player inventory
 */

const express = require('express');
const { authRequired } = require('../middleware/auth');
const { getWallet, getInventory } = require('../lib/economy');

const router = express.Router();

// Get wallet balance
router.get('/wallet', authRequired, (req, res) => {
  const wallet = getWallet(req.user.id, req.user.username);
  res.json({
    balance: wallet.balance,
    lifetime_earned: wallet.lifetime_earned,
    lifetime_spent: wallet.lifetime_spent,
    last_updated: wallet.last_updated
  });
});

// Get inventory
router.get('/inventory', authRequired, (req, res) => {
  const inventory = getInventory(req.user.id);
  res.json(inventory);
});

module.exports = router;

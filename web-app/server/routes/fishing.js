/**
 * Fishing Routes
 *
 * POST /api/fishing/cast    — Consume bait, determine fish server-side, return cast token
 * POST /api/fishing/confirm — Validate token, award fish/XP on success or record escape
 * POST /api/fishing/sell    — Sell a fish from inventory for gold
 * GET  /api/fishing/catalog — Return fish catalog for collection display
 */

const express = require('express');
const { authRequired } = require('../middleware/auth');
const {
  getInventory,
  addItemToInventory,
  removeItemFromInventory,
  awardGold,
  logTransaction,
} = require('../lib/economy');
const fishing = require('../lib/fishing');
const xp = require('../lib/xp');
const { checkAchievements } = require('../lib/achievements');

const router = express.Router();

// ============================================
// PENDING CATCHES (in-memory, anti-cheat)
// ============================================

const pendingCatches = new Map();
const CAST_EXPIRE_MS = 60_000;
const CAST_COOLDOWN_MS = 5_000;
const lastCastTimes = new Map();

// Clean up expired tokens every 30s
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of pendingCatches) {
    if (now - data.createdAt > CAST_EXPIRE_MS) {
      pendingCatches.delete(token);
    }
  }
}, 30_000);

function generateToken() {
  return `fish_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ============================================
// POST /cast — Cast fishing line
// ============================================

router.post('/cast', authRequired, (req, res) => {
  const userId = req.user.id;
  const username = req.user.username;
  const { baitId } = req.body;

  if (!baitId) {
    return res.status(400).json({ error: 'baitId is required' });
  }

  // Cooldown check
  const lastCast = lastCastTimes.get(userId) || 0;
  const elapsed = Date.now() - lastCast;
  if (elapsed < CAST_COOLDOWN_MS) {
    return res.status(429).json({
      error: 'Casting too fast',
      retryAfter: Math.ceil((CAST_COOLDOWN_MS - elapsed) / 1000),
    });
  }

  // Validate bait in inventory
  const inv = getInventory(userId);
  const baitEntry = inv.items.find(i => i.item_id === baitId);
  if (!baitEntry || baitEntry.quantity < 1) {
    return res.status(400).json({ error: 'No bait! Visit the shop to stock up.' });
  }

  // Consume 1 bait
  const updatedInv = removeItemFromInventory(userId, baitId, 1);
  const baitRemaining = updatedInv
    ? (updatedInv.items.find(i => i.item_id === baitId)?.quantity || 0)
    : 0;

  // Check for best fishing rod in inventory
  const ROD_MULTIPLIERS = {
    dragonbone_rod: 3,
    mithril_rod: 2,
    iron_rod: 1.5,
  };
  let rodMultiplier = 1;
  let equippedRod = null;
  for (const [rodId, mult] of Object.entries(ROD_MULTIPLIERS)) {
    if (inv.items.find(i => i.item_id === rodId && i.quantity >= 1)) {
      rodMultiplier = mult;
      equippedRod = rodId;
      break; // already sorted best-first
    }
  }

  // Determine the catch server-side (rod passed for junk check)
  const result = fishing.determineCatch(baitId, equippedRod);
  if (!result) {
    return res.status(400).json({ error: 'Invalid bait type' });
  }

  const adjustedReelTaps = Math.max(3, Math.ceil(result.fish.reelTaps / rodMultiplier));

  // Store pending catch
  const castToken = generateToken();
  pendingCatches.set(castToken, {
    userId,
    username,
    fish: result.fish,
    rolledWeight: result.rolledWeight,
    baitId,
    createdAt: Date.now(),
  });

  lastCastTimes.set(userId, Date.now());

  res.json({
    castToken,
    biteDelay: result.biteDelay,
    fish: {
      biteWindow: result.fish.biteWindow,
      reelDifficulty: result.fish.reelDifficulty,
      reelTaps: adjustedReelTaps,
      name: result.fish.name,
      rarity: result.fish.rarity,
      icon: result.fish.icon,
    },
    baitRemaining,
    equippedRod,
  });
});

// ============================================
// POST /confirm — Confirm catch or report miss
// ============================================

router.post('/confirm', authRequired, (req, res) => {
  const userId = req.user.id;
  const username = req.user.username;
  const { castToken, success } = req.body;

  if (!castToken) {
    return res.status(400).json({ error: 'castToken is required' });
  }

  const pending = pendingCatches.get(castToken);
  if (!pending) {
    return res.status(400).json({ error: 'Invalid or expired cast token' });
  }

  if (pending.userId !== userId) {
    return res.status(403).json({ error: 'Token does not belong to you' });
  }

  // Remove used token
  pendingCatches.delete(castToken);

  // Check expiry
  if (Date.now() - pending.createdAt > CAST_EXPIRE_MS) {
    return res.status(400).json({ error: 'Cast token expired' });
  }

  if (!success) {
    // Fish escaped
    fishing.recordEscape(userId, username);
    xp.incrementLifetimeStat(userId, username, 'fish_escaped');
    return res.json({ success: false, message: 'The fish got away!' });
  }

  // Successful catch
  const fish = pending.fish;
  const weight = pending.rolledWeight;

  // Add fish to inventory
  addItemToInventory(userId, {
    id: fish.id,
    name: fish.name,
    type: 'fish',
    rarity: fish.rarity,
    goldValue: fish.goldValue,
    icon: fish.icon,
    weight,
  });

  // Award XP
  xp.dmAwardXp(userId, username, fish.xp, `fishing:${fish.id}`);

  // Update lifetime stats
  xp.incrementLifetimeStat(userId, username, 'fish_caught');
  xp.incrementLifetimeStat(userId, username, `fish_${fish.rarity}_caught`);

  // Record in fishing stats
  fishing.recordCatch(userId, username, fish.id, fish.rarity, weight);

  // Check achievements
  const { newAchievements } = checkAchievements(userId, username, 'fish_caught');

  res.json({
    success: true,
    fish: {
      id: fish.id,
      name: fish.name,
      rarity: fish.rarity,
      icon: fish.icon,
      goldValue: fish.goldValue,
      xp: fish.xp,
      weight,
    },
    newAchievements,
  });
});

// ============================================
// POST /sell — Sell a fish for gold
// ============================================

router.post('/sell', authRequired, (req, res) => {
  const userId = req.user.id;
  const username = req.user.username;
  const { fishId } = req.body;

  if (!fishId) {
    return res.status(400).json({ error: 'fishId is required' });
  }

  // Find fish in inventory
  const inv = getInventory(userId);
  const fishEntry = inv.items.find(i => i.item_id === fishId && i.type === 'fish');
  if (!fishEntry || fishEntry.quantity < 1) {
    return res.status(400).json({ error: 'Fish not found in inventory' });
  }

  // Look up gold value from catalog
  const catalog = fishing.loadFishCatalog();
  const catalogFish = catalog.fish.find(f => f.id === fishId);
  if (!catalogFish) {
    return res.status(400).json({ error: 'Unknown fish type' });
  }

  const goldValue = catalogFish.goldValue;

  // Remove fish from inventory
  removeItemFromInventory(userId, fishId, 1);

  // Award gold
  const wallet = awardGold(userId, username, goldValue, {
    source: 'fishing_sale',
    fish: fishId,
  });

  logTransaction(userId, username, 'fishing_sale', goldValue, wallet.balance, {
    fish: fishId,
    fish_name: catalogFish.name,
  });

  // Update stats
  xp.incrementLifetimeStat(userId, username, 'fish_sold');
  xp.incrementLifetimeStat(userId, username, 'fishing_gold_earned', goldValue);
  fishing.recordSale(userId, username, goldValue);

  // Check achievements
  const { newAchievements } = checkAchievements(userId, username, 'fish_sold');

  res.json({
    success: true,
    goldAwarded: goldValue,
    balance: wallet.balance,
    newAchievements,
  });
});

// ============================================
// GET /catalog — Fish catalog for collection
// ============================================

router.get('/catalog', (req, res) => {
  const catalog = fishing.loadFishCatalog();
  res.json(catalog);
});

// ============================================
// GET /leaderboard — Biggest catch leaderboard
// ============================================

router.get('/leaderboard', (req, res) => {
  const leaderboard = fishing.getBiggestCatchLeaderboard(5);
  res.json({ leaderboard });
});

module.exports = router;

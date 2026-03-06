const express = require('express');
const router = express.Router();
const { authRequired } = require('../middleware/auth');
const { claimChest } = require('../lib/chests');

/**
 * POST /api/chests/claim
 * Claim a pending treasure chest — awards gold and items.
 */
router.post('/claim', authRequired, (req, res) => {
  const { chestId } = req.body;
  if (!chestId) return res.status(400).json({ error: 'chestId required' });

  const result = claimChest(chestId, req.user.id);
  if (!result.success) {
    return res.status(404).json({ error: result.error });
  }

  res.json(result);
});

module.exports = router;

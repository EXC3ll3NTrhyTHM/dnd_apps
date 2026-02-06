/**
 * Admin API Routes
 * 
 * Protected routes for managing game data (scene placements, etc.)
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { authRequired } = require('../middleware/auth');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const LOCATIONS_FILE = path.join(DATA_DIR, 'locations.json');

// List of admin Discord user IDs
const ADMIN_IDS = [
  '424061511833747467' // Blake
];

function adminRequired(req, res, next) {
  if (!req.user || !ADMIN_IDS.includes(req.user.id)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/**
 * PUT /api/admin/locations/:locationId/scene
 * Update NPC placements for a location's scene
 */
router.put('/locations/:locationId/scene', authRequired, adminRequired, (req, res) => {
  const { locationId } = req.params;
  const { npcPlacements } = req.body;

  if (!npcPlacements || typeof npcPlacements !== 'object') {
    return res.status(400).json({ error: 'npcPlacements object required' });
  }

  try {
    // Load current locations
    const locations = JSON.parse(fs.readFileSync(LOCATIONS_FILE, 'utf-8'));

    if (!locations[locationId]) {
      return res.status(404).json({ error: 'Location not found' });
    }

    if (!locations[locationId].scene) {
      return res.status(400).json({ error: 'Location does not have a scene' });
    }

    // Update placements
    locations[locationId].scene.npcPlacements = npcPlacements;

    // Write back (atomic via temp file)
    const tmpPath = LOCATIONS_FILE + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(locations, null, 2));
    fs.renameSync(tmpPath, LOCATIONS_FILE);

    console.log(`[admin] Updated scene placements for ${locationId}`);
    res.json({ success: true, locationId, npcPlacements });
  } catch (err) {
    console.error('[admin] Failed to update scene:', err.message);
    res.status(500).json({ error: 'Failed to save placements' });
  }
});

module.exports = router;

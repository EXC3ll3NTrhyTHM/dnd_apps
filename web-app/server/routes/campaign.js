/**
 * Campaign State Routes
 *
 * Manages the campaign phase value used by the theme decay system.
 * DM-only write access.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { authRequired } = require('../middleware/auth');

const STATE_PATH = path.resolve(__dirname, '..', '..', 'data', 'campaign_state.json');
const LOCATIONS_PATH = path.resolve(__dirname, '..', '..', 'data', 'locations.json');

// DM Discord user IDs who can modify campaign state
const DM_USER_IDS = (process.env.DM_USER_IDS || '').split(',').filter(Boolean);

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return { phase: 1.0, updated_at: new Date().toISOString(), updated_by: 'system' };
  }
}

function saveState(state) {
  const tmpPath = STATE_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  fs.renameSync(tmpPath, STATE_PATH);
}

function loadLocations() {
  try {
    return JSON.parse(fs.readFileSync(LOCATIONS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveLocations(locations) {
  const tmpPath = LOCATIONS_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(locations, null, 2));
  fs.renameSync(tmpPath, LOCATIONS_PATH);
}

function isDM(userId) {
  return DM_USER_IDS.includes(userId);
}

/**
 * GET /api/campaign/state
 * Returns current campaign phase (public)
 */
router.get('/state', authRequired, (req, res) => {
  const state = loadState();
  res.json(state);
});

/**
 * POST /api/campaign/state
 * Update campaign phase (DM only)
 */
router.post('/state', authRequired, (req, res) => {
  if (!isDM(req.user.id)) {
    return res.status(403).json({ error: 'Only the DM can update campaign state' });
  }

  const { phase } = req.body;

  if (typeof phase !== 'number' || phase < 0 || phase > 3) {
    return res.status(400).json({ error: 'Phase must be a number between 0 and 3' });
  }

  const state = {
    phase: Math.round(phase * 100) / 100, // 2 decimal places
    updated_at: new Date().toISOString(),
    updated_by: req.user.id
  };

  saveState(state);
  res.json(state);
});

/**
 * POST /api/campaign/locations
 * Update NPC assignments at locations (DM only)
 */
router.post('/locations', authRequired, (req, res) => {
  if (!isDM(req.user.id)) {
    return res.status(403).json({ error: 'Only the DM can update locations' });
  }

  const { locationId, npcs } = req.body;

  if (!locationId || !Array.isArray(npcs)) {
    return res.status(400).json({ error: 'locationId and npcs array required' });
  }

  const locations = loadLocations();

  if (!locations[locationId]) {
    return res.status(404).json({ error: 'Location not found' });
  }

  locations[locationId].npcs = npcs;
  saveLocations(locations);

  res.json({ success: true, location: locations[locationId] });
});

module.exports = router;

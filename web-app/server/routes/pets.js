/**
 * Pet Routes
 *
 * GET  /api/pets/me                  — Own pet with computed hunger/happiness
 * GET  /api/pets/user/:userId        — Another player's pet (read-only)
 * GET  /api/pets/location/:locationId — All pets at current location
 * POST /api/pets/feed                — Feed your pet
 * POST /api/pets/play                — Play with your pet
 * POST /api/pets/name                — Name or rename your pet
 */

const express = require('express');
const { authRequired } = require('../middleware/auth');
const pets = require('../lib/pets');
const xp = require('../lib/xp');
const { checkAchievements } = require('../lib/achievements');
const presence = require('../lib/presence');

const router = express.Router();

const ARCHITECT_ID = '424061511833747467';

// ============================================
// GET /me — own pet
// ============================================

router.get('/me', authRequired, (req, res) => {
  const pet = pets.getPet(req.user.id);
  if (!pet) return res.json({ pet: null });
  res.json({ pet: pets.enrichPet(pet) });
});

// ============================================
// GET /user/:userId — another player's pet
// ============================================

router.get('/user/:userId', authRequired, (req, res) => {
  const pet = pets.getPet(req.params.userId);
  if (!pet) return res.json({ pet: null });
  res.json({ pet: pets.enrichPet(pet) });
});

// ============================================
// GET /location/:locationId — all pets at location
// ============================================

router.get('/location/:locationId', authRequired, (req, res) => {
  // Only the Architect can see pets on location scenes (feature in testing)
  if (req.user.id !== ARCHITECT_ID) {
    return res.json({ pets: [] });
  }
  const locationPets = pets.getPetsByLocation(req.params.locationId);
  res.json({ pets: locationPets });
});

// ============================================
// POST /feed — feed your pet
// ============================================

router.post('/feed', authRequired, (req, res) => {
  // Architect can feed any pet via targetUserId
  const targetId = req.body?.targetUserId;
  const isArchitect = req.user.id === ARCHITECT_ID;
  const userId = (isArchitect && targetId) ? targetId : req.user.id;
  const username = req.user.username;

  const result = pets.feedPet(userId, username);

  if (result.error === 'no_pet') {
    return res.status(404).json({ error: 'You do not have a pet' });
  }
  if (result.error === 'cooldown') {
    return res.status(429).json({ error: 'Too soon to feed again', retryAfter: result.retryAfter });
  }

  // Lifetime stats
  xp.incrementLifetimeStat(userId, username, 'pet_feeds');
  xp.incrementLifetimeStat(userId, username, 'pet_interactions');

  // Award player XP
  xp.dmAwardXp(userId, username, 5, 'pet:feed');

  // Achievements
  const { newAchievements } = checkAchievements(userId, username, 'pet_interactions');

  // WebSocket broadcast
  broadcastPetUpdate(req, userId);

  res.json({
    pet: pets.enrichPet(result.updatedPet),
    leveledUp: result.leveledUp,
    newAchievements,
  });
});

// ============================================
// POST /play — play with your pet
// ============================================

router.post('/play', authRequired, (req, res) => {
  // Architect can play with any pet via targetUserId
  const targetId = req.body?.targetUserId;
  const isArchitect = req.user.id === ARCHITECT_ID;
  const userId = (isArchitect && targetId) ? targetId : req.user.id;
  const username = req.user.username;

  const result = pets.playWithPet(userId, username);

  if (result.error === 'no_pet') {
    return res.status(404).json({ error: 'You do not have a pet' });
  }
  if (result.error === 'cooldown') {
    return res.status(429).json({ error: 'Too soon to play again', retryAfter: result.retryAfter });
  }

  // Lifetime stats
  xp.incrementLifetimeStat(userId, username, 'pet_plays');
  xp.incrementLifetimeStat(userId, username, 'pet_interactions');

  // Award player XP
  xp.dmAwardXp(userId, username, 5, 'pet:play');

  // Achievements
  const { newAchievements } = checkAchievements(userId, username, 'pet_interactions');

  // WebSocket broadcast
  broadcastPetUpdate(req, userId);

  res.json({
    pet: pets.enrichPet(result.updatedPet),
    leveledUp: result.leveledUp,
    newAchievements,
  });
});

// ============================================
// POST /name — name or rename your pet
// ============================================

router.post('/name', authRequired, (req, res) => {
  const userId = req.user.id;
  const username = req.user.username;
  const { name } = req.body || {};

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required' });
  }

  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 20) {
    return res.status(400).json({ error: 'Name must be 1-20 characters' });
  }

  const result = pets.namePet(userId, username, trimmed);

  if (result.error === 'no_pet') {
    return res.status(404).json({ error: 'You do not have a pet' });
  }

  // Lifetime stat
  xp.incrementLifetimeStat(userId, username, 'pet_names_given');

  // WebSocket broadcast
  broadcastPetUpdate(req, userId);

  res.json({ pet: pets.enrichPet(result.updatedPet) });
});

// ============================================
// WS BROADCAST HELPER
// ============================================

function broadcastPetUpdate(req, userId) {
  const wss = req.app.get('wss');
  if (!wss) return;

  const pet = pets.getPet(userId);
  const data = JSON.stringify({
    type: 'pet_update',
    userId,
    pet: pet ? {
      petName: pet.petName,
      petType: pet.petType,
      level: pet.level,
      stage: pets.getPetStage(pet),
      hunger: pets.computeHunger(pet),
      happiness: pets.computeHappiness(pet),
    } : null,
  });

  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(data);
  });
}

module.exports = router;

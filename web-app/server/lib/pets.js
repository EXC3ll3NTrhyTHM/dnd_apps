/**
 * Pet System - Core Logic
 *
 * Tamagotchi-style companion pets. One pet per player, earned through quests.
 * Hunger/happiness computed from timestamps (no background timers).
 */

const fs = require('fs');
const path = require('path');

const PETS_PATH = path.resolve(__dirname, '..', '..', 'data', 'pets.json');

// ============================================
// PET TYPE DEFINITIONS
// ============================================

const PET_TYPES = {
  cat: {
    name: 'Cat',
    icon: '\u{1F431}',
    stages: [
      { name: 'Kitten', minLevel: 1 },
      { name: 'Cat', minLevel: 3 },
      { name: 'Elder Cat', minLevel: 6 },
    ],
  },
  black_falcon: {
    name: 'Black Falcon',
    icon: '\u{1F985}',
    stages: [
      { name: 'Chick', minLevel: 1 },
      { name: 'Falcon', minLevel: 3 },
      { name: 'Elder Falcon', minLevel: 6 },
    ],
  },
  dragon_egg: {
    name: 'Dragon Egg',
    icon: '\u{1F525}',
    stages: [
      { name: 'Egg', minLevel: 1 },
      { name: 'Hatchling', minLevel: 3 },
      { name: 'Drake', minLevel: 6 },
    ],
  },
};

// ============================================
// CONSTANTS
// ============================================

const XP_PER_INTERACTION = 10;
const XP_PER_LEVEL = 100;
const MAX_PET_LEVEL = 10;
const FEED_COOLDOWN_MS = 60_000;  // 1 minute
const PLAY_COOLDOWN_MS = 60_000;  // 1 minute
const DECAY_MINUTES = 300;        // 5 hours to reach max hunger / min happiness

// ============================================
// ATOMIC I/O
// ============================================

function atomicWrite(filePath, data) {
  const tempPath = filePath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filePath);
}

function loadPets() {
  try {
    return JSON.parse(fs.readFileSync(PETS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function savePets(data) {
  atomicWrite(PETS_PATH, data);
}

// ============================================
// COMPUTED STATE
// ============================================

function computeHunger(pet) {
  const elapsed = (Date.now() - new Date(pet.lastFed).getTime()) / 60000;
  return Math.min(100, Math.floor((elapsed / DECAY_MINUTES) * 100));
}

function computeHappiness(pet) {
  const elapsed = (Date.now() - new Date(pet.lastPlayed).getTime()) / 60000;
  return Math.max(0, 100 - Math.floor((elapsed / DECAY_MINUTES) * 100));
}

function getPetStage(pet) {
  const typeDef = PET_TYPES[pet.petType];
  if (!typeDef) return 0;
  let stage = 0;
  for (let i = 0; i < typeDef.stages.length; i++) {
    if (pet.level >= typeDef.stages[i].minLevel) stage = i;
  }
  return stage;
}

function enrichPet(pet) {
  const typeDef = PET_TYPES[pet.petType] || PET_TYPES.cat;
  const stage = getPetStage(pet);
  return {
    ...pet,
    hunger: computeHunger(pet),
    happiness: computeHappiness(pet),
    stage,
    stageName: typeDef.stages[stage]?.name || 'Unknown',
    typeName: typeDef.name,
    typeIcon: typeDef.icon,
  };
}

// ============================================
// CRUD
// ============================================

function getPet(userId) {
  const pets = loadPets();
  return pets[userId] || null;
}

function createPet(userId, username, petType, location) {
  const pets = loadPets();
  if (pets[userId]) return pets[userId]; // already has a pet

  const now = new Date().toISOString();
  pets[userId] = {
    username,
    petType,
    petName: null,
    location: location || null,
    level: 1,
    xp: 0,
    lastFed: now,
    lastPlayed: now,
    createdAt: now,
    totalFeeds: 0,
    totalPlays: 0,
    totalInteractions: 0,
  };

  savePets(pets);
  return pets[userId];
}

// ============================================
// INTERACTIONS
// ============================================

function feedPet(userId, username) {
  const pets = loadPets();
  const pet = pets[userId];
  if (!pet) return { error: 'no_pet' };

  const elapsed = Date.now() - new Date(pet.lastFed).getTime();
  if (elapsed < FEED_COOLDOWN_MS) {
    return { error: 'cooldown', retryAfter: Math.ceil((FEED_COOLDOWN_MS - elapsed) / 1000) };
  }

  pet.username = username;
  pet.lastFed = new Date().toISOString();
  pet.totalFeeds += 1;
  pet.totalInteractions += 1;

  const leveledUp = addXp(pet);

  savePets(pets);
  return { updatedPet: pet, leveledUp };
}

function playWithPet(userId, username) {
  const pets = loadPets();
  const pet = pets[userId];
  if (!pet) return { error: 'no_pet' };

  const elapsed = Date.now() - new Date(pet.lastPlayed).getTime();
  if (elapsed < PLAY_COOLDOWN_MS) {
    return { error: 'cooldown', retryAfter: Math.ceil((PLAY_COOLDOWN_MS - elapsed) / 1000) };
  }

  pet.username = username;
  pet.lastPlayed = new Date().toISOString();
  pet.totalPlays += 1;
  pet.totalInteractions += 1;

  const leveledUp = addXp(pet);

  savePets(pets);
  return { updatedPet: pet, leveledUp };
}

function namePet(userId, username, newName) {
  const pets = loadPets();
  const pet = pets[userId];
  if (!pet) return { error: 'no_pet' };

  pet.username = username;
  pet.petName = newName;

  savePets(pets);
  return { updatedPet: pet };
}

function addXp(pet) {
  if (pet.level >= MAX_PET_LEVEL) return false;

  pet.xp += XP_PER_INTERACTION;
  if (pet.xp >= XP_PER_LEVEL) {
    pet.xp -= XP_PER_LEVEL;
    pet.level = Math.min(MAX_PET_LEVEL, pet.level + 1);
    return true;
  }
  return false;
}

// ============================================
// LOCATION QUERIES
// ============================================

function getPetsAtLocation(userIds) {
  const pets = loadPets();
  const result = [];
  for (const userId of userIds) {
    const pet = pets[userId];
    if (pet) {
      result.push({ userId, pet: enrichPet(pet) });
    }
  }
  return result;
}

function getAllPets() {
  const pets = loadPets();
  return Object.entries(pets).map(([userId, pet]) => ({
    userId,
    username: pet.username,
    pet: enrichPet(pet),
  }));
}

function getPetsByLocation(locationId) {
  const pets = loadPets();
  return Object.entries(pets)
    .filter(([, pet]) => pet.location === locationId)
    .map(([userId, pet]) => ({
      userId,
      username: pet.username,
      pet: enrichPet(pet),
    }));
}

function updatePetPlacements(placementsMap) {
  const pets = loadPets();
  for (const [userId, placement] of Object.entries(placementsMap)) {
    if (pets[userId]) {
      pets[userId].placement = placement;
    }
  }
  savePets(pets);
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  PET_TYPES,
  FEED_COOLDOWN_MS,
  PLAY_COOLDOWN_MS,
  getPet,
  createPet,
  feedPet,
  playWithPet,
  namePet,
  computeHunger,
  computeHappiness,
  getPetStage,
  enrichPet,
  getPetsAtLocation,
  getAllPets,
  getPetsByLocation,
  updatePetPlacements,
};

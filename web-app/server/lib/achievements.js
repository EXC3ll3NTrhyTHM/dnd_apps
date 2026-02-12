/**
 * Achievement System
 *
 * Definitions, storage, and check logic for player achievements.
 * Grants XP + gold on unlock. Stored in data/achievements.json.
 */

const fs = require('fs');
const path = require('path');

const ACHIEVEMENTS_PATH = path.resolve(__dirname, '..', '..', 'data', 'achievements.json');

// All 6 location IDs for the cartographer achievement
const ALL_LOCATIONS = [
  'the_collective', 'dragons_hollow', 'the_barracks',
  'the_veil', 'the_cottage', 'the_dojo'
];

// ============================================
// ACHIEVEMENT DEFINITIONS
// ============================================

const ACHIEVEMENTS = {
  // -- Discovery --
  first_words: {
    name: 'First Words',
    description: 'Send your first message',
    icon: '\u{1F4AC}',
    xp: 10,
    gold: 0,
    hidden: false,
    check: (lt) => lt.messages_sent >= 1,
  },
  first_reaction: {
    name: 'First Reaction',
    description: 'React to a message',
    icon: '\u{1F44D}',
    xp: 10,
    gold: 0,
    hidden: false,
    check: (lt) => lt.reactions_given >= 1,
  },
  first_purchase: {
    name: 'First Purchase',
    description: 'Make your first purchase',
    icon: '\u{1F6D2}',
    xp: 10,
    gold: 0,
    hidden: false,
    check: (lt) => (lt.shop_purchases + lt.tavern_purchases) >= 1,
  },
  marcels_pen_pal: {
    name: "Marcel's Pen Pal",
    description: 'Discover how to summon Marcel',
    icon: '\u{2709}\u{FE0F}',
    xp: 50,
    gold: 25,
    hidden: false,
    check: (lt, ctx) => ctx.event === 'marcel_dm_opened',
  },

  // -- Messages --
  chatterbox: {
    name: 'Chatterbox',
    description: 'Send 50 messages',
    icon: '\u{1F5E3}\u{FE0F}',
    xp: 25,
    gold: 0,
    hidden: false,
    check: (lt) => lt.messages_sent >= 50,
  },
  storyteller: {
    name: 'Storyteller',
    description: 'Send 250 messages',
    icon: '\u{1F4D6}',
    xp: 75,
    gold: 25,
    hidden: false,
    check: (lt) => lt.messages_sent >= 250,
  },
  legendary_bard: {
    name: 'Legendary Bard',
    description: 'Send 1,000 messages',
    icon: '\u{1F3AD}',
    xp: 150,
    gold: 50,
    hidden: false,
    check: (lt) => lt.messages_sent >= 1000,
  },

  // -- Reactions --
  expressive: {
    name: 'Expressive',
    description: 'React to 50 messages',
    icon: '\u{1F3A8}',
    xp: 25,
    gold: 0,
    hidden: false,
    check: (lt) => lt.reactions_given >= 50,
  },
  emoji_master: {
    name: 'Emoji Master',
    description: 'React to 200 messages',
    icon: '\u{2728}',
    xp: 75,
    gold: 25,
    hidden: false,
    check: (lt) => lt.reactions_given >= 200,
  },

  // -- Economy --
  big_spender: {
    name: 'Big Spender',
    description: 'Spend 500 gold',
    icon: '\u{1F4B0}',
    xp: 75,
    gold: 0,
    hidden: false,
    check: (lt) => lt.gold_spent >= 500,
  },
  patron: {
    name: 'Patron',
    description: 'Spend 2,000 gold',
    icon: '\u{1F451}',
    xp: 150,
    gold: 50,
    hidden: false,
    check: (lt) => lt.gold_spent >= 2000,
  },

  // -- Exploration --
  wanderer: {
    name: 'Wanderer',
    description: 'Visit 5 different locations',
    icon: '\u{1F5FA}\u{FE0F}',
    xp: 30,
    gold: 0,
    hidden: false,
    check: (lt) => lt.locations_visited.length >= 5,
  },
  cartographer: {
    name: 'Cartographer',
    description: 'Visit every location',
    icon: '\u{1F9ED}',
    xp: 100,
    gold: 50,
    hidden: false,
    check: (lt) => ALL_LOCATIONS.every(loc => lt.locations_visited.includes(loc)),
  },

  // -- Tavern --
  tams_regular: {
    name: "Tam's Regular",
    description: 'Buy 10 drinks from the tavern',
    icon: '\u{1F37A}',
    xp: 50,
    gold: 25,
    hidden: false,
    check: (lt) => lt.tavern_purchases >= 10,
  },

  // -- Levels --
  level_5: {
    name: 'Apprentice',
    description: 'Reach level 5',
    icon: '\u{2B50}',
    xp: 0,
    gold: 25,
    hidden: false,
    check: (lt, ctx) => ctx.level >= 5,
  },
  level_10: {
    name: 'Journeyman',
    description: 'Reach level 10',
    icon: '\u{1F31F}',
    xp: 0,
    gold: 50,
    hidden: false,
    check: (lt, ctx) => ctx.level >= 10,
  },
  level_15: {
    name: 'Master',
    description: 'Reach level 15',
    icon: '\u{1F4AB}',
    xp: 0,
    gold: 100,
    hidden: false,
    check: (lt, ctx) => ctx.level >= 15,
  },

  // -- Hidden --
  shutterfly: {
    name: 'Shutterfly',
    description: 'A picture is worth a thousand words',
    icon: '\u{1F4F8}',
    xp: 20,
    gold: 0,
    hidden: true,
    check: (lt) => lt.images_sent >= 1,
  },
  gif_lord: {
    name: 'Gif Lord',
    description: 'Sometimes words aren\'t enough',
    icon: '\u{1F39E}\u{FE0F}',
    xp: 20,
    gold: 0,
    hidden: true,
    check: (lt) => lt.gifs_sent >= 1,
  },
  night_owl: {
    name: 'Night Owl',
    description: 'The hollow doesn\'t sleep',
    icon: '\u{1F989}',
    xp: 30,
    gold: 10,
    hidden: true,
    check: (lt, ctx) => ctx.event === 'message_sent' && ctx.hour >= 0 && ctx.hour < 4,
  },
};

// ============================================
// STORAGE
// ============================================

function loadAchievements() {
  try {
    return JSON.parse(fs.readFileSync(ACHIEVEMENTS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveAchievements(data) {
  const tmpPath = ACHIEVEMENTS_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, ACHIEVEMENTS_PATH);
}

// ============================================
// CHECK & AWARD
// ============================================

/**
 * Check all achievements for a user and award any newly unlocked ones.
 *
 * @param {string} userId
 * @param {string} username
 * @param {string} event - event type (message_sent, reaction_added, etc.)
 * @param {object} ctx - extra context { hour, level, ... }
 * @returns {{ newAchievements: Array<{ id, name, icon, xp, gold }> }}
 */
function checkAchievements(userId, username, event, ctx = {}) {
  const xp = require('./xp');
  const { awardGold } = require('./economy');

  const record = xp.getXpRecord(userId, username);
  xp.ensureLifetime(record);
  const lt = record.lifetime;
  const levelInfo = xp.getLevelFromXp(record.total_xp);

  const fullCtx = {
    event,
    level: levelInfo.level,
    hour: new Date().getUTCHours(),
    ...ctx,
  };

  const allUnlocked = loadAchievements();
  const userUnlocked = allUnlocked[userId] || {};

  const newAchievements = [];

  for (const [id, def] of Object.entries(ACHIEVEMENTS)) {
    if (userUnlocked[id]) continue; // already unlocked

    try {
      if (!def.check(lt, fullCtx)) continue;
    } catch {
      continue;
    }

    // Unlock it
    userUnlocked[id] = new Date().toISOString();

    // Award XP
    if (def.xp > 0) {
      xp.dmAwardXp(userId, username, def.xp, `achievement:${id}`);
    }

    // Award gold
    if (def.gold > 0) {
      awardGold(userId, username, def.gold, { source: 'achievement', achievement: id });
    }

    newAchievements.push({
      id,
      name: def.name,
      icon: def.icon,
      xp: def.xp,
      gold: def.gold,
    });
  }

  if (newAchievements.length > 0) {
    allUnlocked[userId] = userUnlocked;
    saveAchievements(allUnlocked);
  }

  return { newAchievements };
}

/**
 * Get all achievements for a user with unlock status.
 * Hidden locked achievements are masked.
 */
function getUserAchievements(userId) {
  const allUnlocked = loadAchievements();
  const userUnlocked = allUnlocked[userId] || {};

  const achievements = Object.entries(ACHIEVEMENTS).map(([id, def]) => {
    const unlockedAt = userUnlocked[id] || null;
    const isLocked = !unlockedAt;

    if (def.hidden && isLocked) {
      return {
        id,
        name: '???',
        description: def.description, // show hint
        icon: '\u{2753}',
        xp: def.xp,
        gold: def.gold,
        hidden: true,
        unlockedAt: null,
      };
    }

    return {
      id,
      name: def.name,
      description: def.description,
      icon: def.icon,
      xp: def.xp,
      gold: def.gold,
      hidden: def.hidden,
      unlockedAt,
    };
  });

  const total = Object.keys(ACHIEVEMENTS).length;
  const unlocked = Object.keys(userUnlocked).length;

  return { achievements, stats: { unlocked, total } };
}

module.exports = {
  ACHIEVEMENTS,
  checkAchievements,
  getUserAchievements,
  loadAchievements,
};

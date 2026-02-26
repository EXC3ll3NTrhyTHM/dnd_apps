/**
 * Achievement System
 *
 * Definitions, storage, and check logic for player achievements.
 * Achievements unlock → player claims rewards via Profile page.
 * Stored in data/achievements.json.
 */

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./dataPaths');

const ACHIEVEMENTS_PATH = path.join(DATA_DIR, 'achievements.json');
const LOCATIONS_PATH = path.join(DATA_DIR, 'locations.json');

function getAccessibleLocations(userId) {
  let locations;
  try { locations = JSON.parse(fs.readFileSync(LOCATIONS_PATH, 'utf-8')); }
  catch { return []; }
  return Object.entries(locations)
    .filter(([, loc]) => {
      if (loc.locked) return false;
      if (Array.isArray(loc.lockedFor) && loc.lockedFor.includes(userId)) return false;
      return true;
    })
    .map(([id]) => id);
}

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
    description: 'Visit every location you have access to',
    icon: '\u{1F9ED}',
    xp: 100,
    gold: 50,
    hidden: false,
    check: (lt, ctx) => {
      const accessible = getAccessibleLocations(ctx.userId);
      return accessible.length > 0 && accessible.every(loc => lt.locations_visited.includes(loc));
    },
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

  // -- Dice --
  roll_initiative: {
    name: 'Roll Initiative',
    description: 'Roll dice for the first time',
    icon: '\u{1F3B2}',
    xp: 10,
    gold: 0,
    hidden: false,
    check: (lt) => lt.dice_rolls >= 1,
  },
  dice_goblin: {
    name: 'Dice Goblin',
    description: 'Roll dice 50 times',
    icon: '\u{1F3B2}',
    xp: 50,
    gold: 25,
    hidden: false,
    check: (lt) => lt.dice_rolls >= 50,
  },
  high_roller: {
    name: 'High Roller',
    description: 'Roll dice 200 times',
    icon: '\u{1F3B2}',
    xp: 100,
    gold: 50,
    hidden: false,
    check: (lt) => lt.dice_rolls >= 200,
  },
  natural_twenty: {
    name: 'Natural Twenty!',
    description: 'Roll a natural 20',
    icon: '\u{1F3AF}',
    xp: 30,
    gold: 15,
    hidden: true,
    check: (lt, ctx) => ctx.event === 'dice_rolled' && ctx.has_nat_20,
  },
  critical_fail: {
    name: 'Critical Fail',
    description: 'The dice gods frown upon you',
    icon: '\u{1F480}',
    xp: 15,
    gold: 0,
    hidden: true,
    check: (lt, ctx) => ctx.event === 'dice_rolled' && ctx.has_nat_1,
  },
  jackpot: {
    name: 'Jackpot!',
    description: 'Fortune smiles on the bold',
    icon: '\u{1F48E}',
    xp: 50,
    gold: 50,
    hidden: true,
    check: (lt, ctx) => ctx.event === 'dice_rolled' && ctx.has_100,
  },

  // -- Social --
  curious_eye: {
    name: 'Curious Eye',
    description: "Check out another adventurer's profile",
    icon: '\u{1F50D}',
    xp: 10,
    gold: 0,
    hidden: false,
    check: (lt) => lt.profiles_viewed >= 1,
  },
  know_thyself: {
    name: 'Know Thyself',
    description: 'Inspect a stat to learn what it does',
    icon: '\u{1F4DA}',
    xp: 10,
    gold: 0,
    hidden: false,
    check: (lt) => lt.stats_inspected >= 1,
  },

  // -- Combat --
  first_blood: {
    name: 'First Blood',
    description: 'Participate in your first combat encounter',
    icon: '\u{2694}\u{FE0F}',
    xp: 15,
    gold: 0,
    hidden: false,
    check: (lt) => lt.encounters_joined >= 1,
  },
  monster_slayer: {
    name: 'Monster Slayer',
    description: 'Win 10 combat encounters',
    icon: '\u{1F5E1}\u{FE0F}',
    xp: 50,
    gold: 25,
    hidden: false,
    check: (lt) => lt.encounters_won >= 10,
  },
  critical_strike: {
    name: 'Critical Strike',
    description: 'Land a critical hit in combat',
    icon: '\u{1F4A5}',
    xp: 25,
    gold: 10,
    hidden: true,
    check: (lt) => lt.combat_crits >= 1,
  },
  untouchable: {
    name: 'Untouchable',
    description: 'Win an encounter without taking damage',
    icon: '\u{1F6E1}\u{FE0F}',
    xp: 30,
    gold: 15,
    hidden: true,
    check: (lt, ctx) => ctx.untouchable === true,
  },
  dragon_slayer: {
    name: 'Dragon Slayer',
    description: 'Defeat a CR 5+ monster',
    icon: '\u{1F409}',
    xp: 100,
    gold: 50,
    hidden: true,
    check: (lt, ctx) => ctx.monster_cr >= 5 && ctx.encounters_won,
  },
  gladiator: {
    name: 'Gladiator',
    description: 'Win 5 arena battles',
    icon: '\u{1F3DF}\u{FE0F}',
    xp: 40,
    gold: 20,
    hidden: false,
    check: (lt) => lt.encounters_won >= 5,
  },
  arena_champion: {
    name: 'Arena Champion',
    description: 'Win 25 arena battles',
    icon: '\u{1F3C6}',
    xp: 100,
    gold: 50,
    hidden: false,
    check: (lt) => lt.encounters_won >= 25,
  },
  finishing_blow: {
    name: 'Finishing Blow',
    description: 'Land the killing blow on a monster',
    icon: '\u{1F4A2}',
    xp: 20,
    gold: 10,
    hidden: true,
    check: (lt, ctx) => ctx.combat_kill === true,
  },
  serial_killer: {
    name: 'Serial Killer',
    description: 'Land 10 killing blows',
    icon: '\u{1F5E1}\u{FE0F}',
    xp: 75,
    gold: 35,
    hidden: false,
    check: (lt) => lt.monsters_killed >= 10,
  },
  fumble_king: {
    name: 'Fumble King',
    description: 'Fumble 5 times in combat',
    icon: '\u{1F92E}',
    xp: 15,
    gold: 0,
    hidden: true,
    check: (lt) => lt.combat_fumbles >= 5,
  },
  knocked_around: {
    name: 'Knocked Around',
    description: 'Get knocked out 3 times',
    icon: '\u{1F4AB}',
    xp: 20,
    gold: 0,
    hidden: true,
    check: (lt) => lt.times_knocked_out >= 3,
  },
  punching_bag: {
    name: 'Punching Bag',
    description: 'Get knocked out 10 times',
    icon: '\u{1F915}',
    xp: 40,
    gold: 15,
    hidden: true,
    check: (lt) => lt.times_knocked_out >= 10,
  },
  veteran: {
    name: 'Veteran',
    description: 'Join 50 combat encounters',
    icon: '\u{1F396}\u{FE0F}',
    xp: 75,
    gold: 40,
    hidden: false,
    check: (lt) => lt.encounters_joined >= 50,
  },
  crit_machine: {
    name: 'Crit Machine',
    description: 'Land 10 critical hits',
    icon: '\u{26A1}',
    xp: 60,
    gold: 30,
    hidden: false,
    check: (lt) => lt.combat_crits >= 10,
  },

  // -- Bestiary (defeat each monster type) --
  goblin_slayer: {
    name: 'Goblin Slayer',
    description: 'Defeat a Goblin',
    icon: '\u{1F47A}',
    xp: 15,
    gold: 5,
    hidden: false,
    check: (lt) => lt.defeated_goblin >= 1,
  },
  wolf_hunter: {
    name: 'Wolf Hunter',
    description: 'Defeat a Wolf',
    icon: '\u{1F43A}',
    xp: 15,
    gold: 5,
    hidden: false,
    check: (lt) => lt.defeated_wolf >= 1,
  },
  bone_breaker: {
    name: 'Bone Breaker',
    description: 'Defeat a Skeleton',
    icon: '\u{1F480}',
    xp: 15,
    gold: 5,
    hidden: false,
    check: (lt) => lt.defeated_skeleton >= 1,
  },
  alpha_predator: {
    name: 'Alpha Predator',
    description: 'Defeat a Dire Wolf',
    icon: '\u{1F43B}',
    xp: 30,
    gold: 15,
    hidden: false,
    check: (lt) => lt.defeated_dire_wolf >= 1,
  },
  giant_killer: {
    name: 'Giant Killer',
    description: 'Defeat an Ogre',
    icon: '\u{1F44A}',
    xp: 40,
    gold: 20,
    hidden: false,
    check: (lt) => lt.defeated_ogre >= 1,
  },
  beast_tamer: {
    name: 'Beast Tamer',
    description: 'Defeat an Owlbear',
    icon: '\u{1F989}',
    xp: 50,
    gold: 30,
    hidden: false,
    check: (lt) => lt.defeated_owlbear >= 1,
  },
  troll_bane: {
    name: 'Troll Bane',
    description: 'Defeat a Troll',
    icon: '\u{1F9CC}',
    xp: 75,
    gold: 50,
    hidden: false,
    check: (lt) => lt.defeated_troll >= 1,
  },
  monster_compendium: {
    name: 'Monster Compendium',
    description: 'Defeat every type of monster',
    icon: '\u{1F4D5}',
    xp: 200,
    gold: 100,
    hidden: true,
    check: (lt) =>
      lt.defeated_goblin >= 1 &&
      lt.defeated_wolf >= 1 &&
      lt.defeated_skeleton >= 1 &&
      lt.defeated_dire_wolf >= 1 &&
      lt.defeated_ogre >= 1 &&
      lt.defeated_owlbear >= 1 &&
      lt.defeated_troll >= 1,
  },

  // -- Fishing --
  first_catch: {
    name: 'First Catch',
    description: 'Catch your first fish',
    icon: '\ud83c\udfa3',
    xp: 15,
    gold: 5,
    hidden: false,
    check: (lt) => lt.fish_caught >= 1,
  },
  angler: {
    name: 'Angler',
    description: 'Catch 25 fish',
    icon: '\ud83d\udc1f',
    xp: 50,
    gold: 25,
    hidden: false,
    check: (lt) => lt.fish_caught >= 25,
  },
  master_fisher: {
    name: 'Master Fisher',
    description: 'Catch 100 fish',
    icon: '\ud83e\udddc',
    xp: 150,
    gold: 75,
    hidden: false,
    check: (lt) => lt.fish_caught >= 100,
  },
  rare_catch: {
    name: 'Rare Catch',
    description: 'Reel in a rare fish',
    icon: '\ud83d\udc20',
    xp: 30,
    gold: 15,
    hidden: true,
    check: (lt) => lt.fish_rare_caught >= 1,
  },
  epic_catch: {
    name: 'Epic Catch',
    description: 'Reel in an epic fish',
    icon: '\ud83d\udc7e',
    xp: 75,
    gold: 40,
    hidden: true,
    check: (lt) => lt.fish_epic_caught >= 1,
  },
  leviathan_hunter: {
    name: 'Leviathan Hunter',
    description: 'Catch a legendary fish',
    icon: '\ud83d\udc09',
    xp: 200,
    gold: 100,
    hidden: true,
    check: (lt) => lt.fish_legendary_caught >= 1,
  },
  fish_merchant: {
    name: 'Fish Merchant',
    description: 'Earn 500 gold from selling fish',
    icon: '\ud83d\udcb0',
    xp: 50,
    gold: 0,
    hidden: false,
    check: (lt) => lt.fishing_gold_earned >= 500,
  },
  the_one_that_got_away: {
    name: 'The One That Got Away',
    description: 'Let a fish escape',
    icon: '\ud83d\udca8',
    xp: 5,
    gold: 0,
    hidden: true,
    check: (lt) => lt.fish_escaped >= 1,
  },
  butterfingers: {
    name: 'Butterfingers',
    description: 'Let 10 fish escape',
    icon: '\ud83e\udee3',
    xp: 15,
    gold: 0,
    hidden: true,
    check: (lt) => lt.fish_escaped >= 10,
  },
  fish_monger: {
    name: 'Fish Monger',
    description: 'Sell 50 fish',
    icon: '\ud83d\udeD2',
    xp: 75,
    gold: 50,
    hidden: false,
    check: (lt) => lt.fish_sold >= 50,
  },
  reel_deal: {
    name: 'Reel Deal',
    description: 'Earn 2,000 gold from selling fish',
    icon: '\ud83d\udcb0',
    xp: 100,
    gold: 0,
    hidden: false,
    check: (lt) => lt.fishing_gold_earned >= 2000,
  },
  deep_sea_collector: {
    name: 'Deep Sea Collector',
    description: 'Catch 10 rare or better fish',
    icon: '\ud83c\udf0a',
    xp: 60,
    gold: 30,
    hidden: false,
    check: (lt) => (lt.fish_rare_caught + lt.fish_epic_caught + lt.fish_legendary_caught) >= 10,
  },
  void_touched: {
    name: 'Void Touched',
    description: 'Catch 5 epic fish',
    icon: '\ud83d\udd6e',
    xp: 100,
    gold: 50,
    hidden: true,
    check: (lt) => lt.fish_epic_caught >= 5,
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

  // -- Pets --
  companion: {
    name: 'Companion',
    description: 'Interact with your pet for the first time',
    icon: '\u{1F43E}',
    xp: 25,
    gold: 10,
    hidden: false,
    check: (lt) => lt.pet_interactions >= 1,
  },
  devoted_caretaker: {
    name: 'Devoted Caretaker',
    description: 'Feed or play with your pet 50 times',
    icon: '\u{2764}\u{FE0F}',
    xp: 50,
    gold: 25,
    hidden: false,
    check: (lt) => lt.pet_interactions >= 50,
  },
  best_friends: {
    name: 'Best Friends',
    description: 'Feed or play with your pet 200 times',
    icon: '\u{1F496}',
    xp: 100,
    gold: 50,
    hidden: false,
    check: (lt) => lt.pet_interactions >= 200,
  },

  // -- Dice Collection --
  new_set: {
    name: 'New Set',
    description: 'Buy your first dice set',
    icon: '\u{1F3B2}',
    xp: 15,
    gold: 0,
    hidden: false,
    check: (lt) => lt.dice_sets_collected >= 1,
  },
  dice_hoarder: {
    name: 'Dice Hoarder',
    description: 'Collect 5 dice sets',
    icon: '\u{1F9F0}',
    xp: 40,
    gold: 20,
    hidden: false,
    check: (lt) => lt.dice_sets_collected >= 5,
  },
  dice_collector: {
    name: 'Dice Collector',
    description: 'Collect 15 dice sets',
    icon: '\u{2728}',
    xp: 75,
    gold: 40,
    hidden: false,
    check: (lt) => lt.dice_sets_collected >= 15,
  },
  dice_fanatic: {
    name: 'Dice Fanatic',
    description: 'Collect every dice set',
    icon: '\u{1F48E}',
    xp: 200,
    gold: 100,
    hidden: true,
    check: (lt) => lt.dice_sets_collected >= 29,
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
// HELPERS
// ============================================

/**
 * Check if an achievement value represents a claimed achievement.
 * Legacy string timestamps = auto-awarded before claimable system = treated as claimed.
 * New object format: { at, claimed } where claimed is false or an ISO timestamp.
 */
function isClaimed(val) {
  if (val == null) return false;
  if (typeof val === 'string') return true; // legacy: auto-awarded
  return !!val.claimed;
}

/** Extract the unlock timestamp regardless of format */
function getUnlockedAt(val) {
  if (val == null) return null;
  if (typeof val === 'string') return val;
  return val.at || null;
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

  const record = xp.getXpRecord(userId, username);
  xp.ensureLifetime(record);
  const lt = record.lifetime;
  const levelInfo = xp.getLevelFromXp(record.total_xp);

  const fullCtx = {
    userId,
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

    // Unlock it (unclaimed — player must claim on Profile page)
    userUnlocked[id] = { at: new Date().toISOString(), claimed: false };

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
 * Hidden achievements are masked if the viewer hasn't unlocked them.
 * @param {string} userId - The player whose achievements to retrieve
 * @param {string} [viewerId] - The player viewing the profile (defaults to userId)
 */
function getUserAchievements(userId, viewerId) {
  const allUnlocked = loadAchievements();
  const userUnlocked = allUnlocked[userId] || {};
  const viewerUnlocked = viewerId ? (allUnlocked[viewerId] || {}) : userUnlocked;

  const achievements = Object.entries(ACHIEVEMENTS).map(([id, def]) => {
    const raw = userUnlocked[id] || null;
    const unlockedAt = getUnlockedAt(raw);
    const claimed = isClaimed(raw);
    const viewerHas = !!viewerUnlocked[id];

    // Mask hidden achievements the viewer hasn't unlocked
    if (def.hidden && !viewerHas) {
      return {
        id,
        name: '???',
        description: def.description, // show hint
        icon: '\u{2753}',
        xp: def.xp,
        gold: def.gold,
        hidden: true,
        unlockedAt: null,
        claimed: false,
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
      claimed,
    };
  });

  const total = Object.keys(ACHIEVEMENTS).length;
  const unlocked = Object.keys(userUnlocked).length;

  return { achievements, stats: { unlocked, total } };
}

/**
 * Claim an unlocked achievement — awards XP + gold.
 * @returns {{ xpAwarded: number, goldAwarded: number }}
 */
function claimAchievement(userId, username, achievementId) {
  const xp = require('./xp');
  const { awardGold } = require('./economy');

  const def = ACHIEVEMENTS[achievementId];
  if (!def) throw new Error('Unknown achievement');

  const allUnlocked = loadAchievements();
  const userUnlocked = allUnlocked[userId] || {};
  const raw = userUnlocked[achievementId];

  if (!raw) throw new Error('Achievement not unlocked');
  if (isClaimed(raw)) throw new Error('Achievement already claimed');

  // Award rewards
  let xpAwarded = 0;
  let goldAwarded = 0;

  if (def.xp > 0) {
    xp.dmAwardXp(userId, username, def.xp, `achievement:${achievementId}`);
    xpAwarded = def.xp;
  }

  if (def.gold > 0) {
    awardGold(userId, username, def.gold, { source: 'achievement', achievement: achievementId });
    goldAwarded = def.gold;
  }

  // Mark as claimed
  userUnlocked[achievementId] = { at: raw.at, claimed: new Date().toISOString() };
  allUnlocked[userId] = userUnlocked;
  saveAchievements(allUnlocked);

  return { xpAwarded, goldAwarded };
}

module.exports = {
  ACHIEVEMENTS,
  checkAchievements,
  getUserAchievements,
  claimAchievement,
  loadAchievements,
};

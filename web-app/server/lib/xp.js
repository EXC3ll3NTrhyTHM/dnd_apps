/**
 * XP System Data Layer
 *
 * Tracks player XP, levels, and daily activity.
 * Uses atomic writes (write .tmp then rename) to avoid corruption.
 * XP data is web-app only (not shared with Discord bots).
 */

const fs = require('fs');
const path = require('path');

const XP_PATH = path.resolve(__dirname, '..', '..', 'data', 'xp.json');
const PLAYERS_PATH = path.resolve(__dirname, '..', '..', 'data', 'players.json');

// ============================================
// XP CONSTANTS
// ============================================

const XP_PER_MESSAGE = 5;
const XP_PER_REACTION = 2;
const XP_PER_LOCATION_VISIT = 15;
const XP_DAILY_LOGIN = 25;
const XP_PER_GOLD_SPENT = 1;

const MAX_DAILY_MESSAGES = 50;
const MAX_DAILY_REACTIONS = 50;
const MAX_DAILY_GOLD_SPEND_XP = 200;

const GOLD_TO_XP_RATIO = 0.5;

const BASE_XP = 5000;
const LEVEL_MULTIPLIER = 1.3;
const MIN_LEVEL = 1;
const MAX_LEVEL = 20;

// Gentler XP requirements for early levels (1-3)
const EARLY_LEVEL_XP = { 1: 500, 2: 1000, 3: 2000 };

// Pre-compute level thresholds (cumulative XP needed for each level)
const LEVEL_THRESHOLDS = [];
(function buildThresholds() {
  let cumulative = 0;
  for (let lvl = MIN_LEVEL; lvl <= MAX_LEVEL; lvl++) {
    const xpForThisLevel = EARLY_LEVEL_XP[lvl]
      || Math.round(BASE_XP * Math.pow(LEVEL_MULTIPLIER, lvl - 4));
    cumulative += xpForThisLevel;
    LEVEL_THRESHOLDS.push({ level: lvl, cumulativeXp: cumulative, xpForLevel: xpForThisLevel });
  }
})();

// ============================================
// ATOMIC I/O
// ============================================

function atomicWrite(filePath, data) {
  const tempPath = filePath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filePath);
}

function loadXpData() {
  try {
    return JSON.parse(fs.readFileSync(XP_PATH, 'utf-8'));
  } catch (err) {
    return {};
  }
}

function saveXpData(data) {
  atomicWrite(XP_PATH, data);
}

// ============================================
// DAILY RESET
// ============================================

function getTodayDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); // YYYY-MM-DD in Central Time
}

function ensureFreshDaily(record) {
  const today = getTodayDate();
  if (!record.daily || record.daily.date !== today) {
    record.daily = {
      date: today,
      messages_sent: 0,
      reactions_given: 0,
      locations_visited: [],
      login_claimed: false,
      // Arena daily counters
      arena_wins: 0,
      arena_kills: 0,
      arena_crits: 0,
      arena_untouchable: 0,
      arena_potions: 0,
      arena_goals_claimed: [],
      gold_spend_xp: 0,
    };
  }
  return record;
}

const LIFETIME_DEFAULTS = {
  messages_sent: 0,
  reactions_given: 0,
  locations_visited: [],
  gold_spent: 0,
  tavern_purchases: 0,
  shop_purchases: 0,
  gifs_sent: 0,
  images_sent: 0,
  dice_rolls: 0,
  profiles_viewed: 0,
  stats_inspected: 0,
  encounters_joined: 0,
  encounters_won: 0,
  monsters_killed: 0,
  total_combat_damage: 0,
  combat_crits: 0,
  combat_fumbles: 0,
  times_knocked_out: 0,
  potions_used: 0,
  fish_caught: 0,
  fish_escaped: 0,
  fish_sold: 0,
  fish_junk_caught: 0,
  fish_common_caught: 0,
  fish_uncommon_caught: 0,
  fish_rare_caught: 0,
  fish_epic_caught: 0,
  fish_legendary_caught: 0,
  fishing_gold_earned: 0,
  defeated_goblin: 0,
  defeated_wolf: 0,
  defeated_skeleton: 0,
  defeated_dire_wolf: 0,
  defeated_ogre: 0,
  defeated_owlbear: 0,
  defeated_troll: 0,
  pet_feeds: 0,
  pet_plays: 0,
  pet_interactions: 0,
  pet_names_given: 0,
  dice_sets_collected: 0,
};

function ensureLifetime(record) {
  if (!record.lifetime) {
    record.lifetime = { ...LIFETIME_DEFAULTS };
  } else {
    // Backfill fields added after the record was created
    for (const [key, val] of Object.entries(LIFETIME_DEFAULTS)) {
      if (record.lifetime[key] === undefined) {
        record.lifetime[key] = val;
      }
    }
  }
  return record;
}

// ============================================
// GET OR CREATE
// ============================================

function getXpRecord(userId, username) {
  const data = loadXpData();
  if (!data[userId]) {
    data[userId] = {
      user_id: userId,
      username: username || 'Unknown',
      total_xp: 0,
      last_updated: new Date().toISOString(),
      daily: {
        date: getTodayDate(),
        messages_sent: 0,
        reactions_given: 0,
        locations_visited: [],
        login_claimed: false,
        arena_wins: 0,
        arena_kills: 0,
        arena_crits: 0,
        arena_untouchable: 0,
        arena_potions: 0,
        arena_goals_claimed: [],
        gold_spend_xp: 0,
      },
      gold_conversion_done: false
    };
    saveXpData(data);
  }
  const record = data[userId];
  if (username && record.username !== username) {
    record.username = username;
  }
  ensureFreshDaily(record);
  return record;
}

// ============================================
// LEVEL CALCULATION
// ============================================

function getLevelFromXp(totalXp) {
  let level = MIN_LEVEL;
  let prevCumulative = 0;

  for (const threshold of LEVEL_THRESHOLDS) {
    if (totalXp < threshold.cumulativeXp) {
      return {
        level,
        xpForNextLevel: threshold.xpForLevel,
        xpInCurrentLevel: totalXp - prevCumulative,
        xpToNextLevel: threshold.cumulativeXp - totalXp
      };
    }
    level = threshold.level + 1;
    prevCumulative = threshold.cumulativeXp;
  }

  // Max level reached
  const lastThreshold = LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
  return {
    level: MAX_LEVEL,
    xpForNextLevel: 0,
    xpInCurrentLevel: totalXp - (lastThreshold.cumulativeXp - lastThreshold.xpForLevel),
    xpToNextLevel: 0
  };
}

function getLevel(userId, username) {
  const record = getXpRecord(userId, username);
  return getLevelFromXp(record.total_xp).level;
}

// ============================================
// XP AWARD FUNCTIONS
// ============================================

function awardMessageXp(userId, username) {
  const data = loadXpData();
  if (!data[userId]) {
    getXpRecord(userId, username); // creates it
    return awardMessageXp(userId, username); // retry with fresh data
  }
  const record = data[userId];
  ensureFreshDaily(record);
  ensureLifetime(record);

  record.lifetime.messages_sent += 1;

  if (record.daily.messages_sent >= MAX_DAILY_MESSAGES) {
    saveXpData(data); // save lifetime even if daily capped
    return record;
  }

  record.daily.messages_sent += 1;
  record.total_xp += XP_PER_MESSAGE;
  record.last_updated = new Date().toISOString();
  saveXpData(data);
  return record;
}

function awardReactionXp(userId, username) {
  const data = loadXpData();
  if (!data[userId]) {
    getXpRecord(userId, username);
    return awardReactionXp(userId, username);
  }
  const record = data[userId];
  ensureFreshDaily(record);
  ensureLifetime(record);

  record.lifetime.reactions_given += 1;

  if (record.daily.reactions_given >= MAX_DAILY_REACTIONS) {
    saveXpData(data);
    return record;
  }

  record.daily.reactions_given += 1;
  record.total_xp += XP_PER_REACTION;
  record.last_updated = new Date().toISOString();
  saveXpData(data);
  return record;
}

function awardLocationVisitXp(userId, username, locationId) {
  const data = loadXpData();
  if (!data[userId]) {
    getXpRecord(userId, username);
    return awardLocationVisitXp(userId, username, locationId);
  }
  const record = data[userId];
  ensureFreshDaily(record);
  ensureLifetime(record);

  // Track unique lifetime visits
  if (!record.lifetime.locations_visited.includes(locationId)) {
    record.lifetime.locations_visited.push(locationId);
  }

  if (record.daily.locations_visited.includes(locationId)) {
    saveXpData(data);
    return record; // already visited today
  }

  record.daily.locations_visited.push(locationId);
  record.total_xp += XP_PER_LOCATION_VISIT;
  record.last_updated = new Date().toISOString();
  saveXpData(data);
  return record;
}

function awardDailyLoginXp(userId, username) {
  const data = loadXpData();
  if (!data[userId]) {
    getXpRecord(userId, username);
    return awardDailyLoginXp(userId, username);
  }
  const record = data[userId];
  ensureFreshDaily(record);

  if (record.daily.login_claimed) {
    return record; // already claimed today
  }

  record.daily.login_claimed = true;
  record.total_xp += XP_DAILY_LOGIN;
  record.last_updated = new Date().toISOString();
  saveXpData(data);
  return record;
}

function awardGoldSpendXp(userId, username, goldAmount) {
  const data = loadXpData();
  if (!data[userId]) {
    getXpRecord(userId, username);
    return awardGoldSpendXp(userId, username, goldAmount);
  }
  const record = data[userId];
  ensureFreshDaily(record);
  ensureLifetime(record);

  record.lifetime.gold_spent += goldAmount;

  const xpGained = Math.floor(goldAmount * XP_PER_GOLD_SPENT);
  if (xpGained <= 0) {
    saveXpData(data);
    return record;
  }

  const remaining = MAX_DAILY_GOLD_SPEND_XP - (record.daily.gold_spend_xp || 0);
  const capped = Math.min(xpGained, remaining);
  if (capped <= 0) {
    saveXpData(data);
    return record;
  }

  record.daily.gold_spend_xp = (record.daily.gold_spend_xp || 0) + capped;
  record.total_xp += capped;
  record.last_updated = new Date().toISOString();
  saveXpData(data);
  return record;
}

function awardQuestXp(userId, username, questId, amount) {
  const data = loadXpData();
  if (!data[userId]) {
    getXpRecord(userId, username);
    return awardQuestXp(userId, username, questId, amount);
  }
  const record = data[userId];
  ensureFreshDaily(record);

  record.total_xp += amount;
  record.last_updated = new Date().toISOString();
  saveXpData(data);
  return record;
}

function dmAwardXp(userId, username, amount, reason) {
  const data = loadXpData();
  if (!data[userId]) {
    getXpRecord(userId, username);
    return dmAwardXp(userId, username, amount, reason);
  }
  const record = data[userId];
  ensureFreshDaily(record);

  record.total_xp += amount;
  record.last_updated = new Date().toISOString();
  saveXpData(data);
  return record;
}

function incrementLifetimeStat(userId, username, stat, amount = 1) {
  const data = loadXpData();
  if (!data[userId]) {
    getXpRecord(userId, username);
    return incrementLifetimeStat(userId, username, stat, amount);
  }
  const record = data[userId];
  ensureLifetime(record);
  if (typeof record.lifetime[stat] === 'number') {
    record.lifetime[stat] += amount;
  }
  saveXpData(data);
  return record;
}

function incrementDailyStat(userId, username, stat, amount = 1) {
  const data = loadXpData();
  if (!data[userId]) {
    getXpRecord(userId, username);
    return incrementDailyStat(userId, username, stat, amount);
  }
  const record = data[userId];
  ensureFreshDaily(record);
  if (typeof record.daily[stat] === 'number') {
    record.daily[stat] += amount;
  }
  saveXpData(data);
  return record;
}

function convertGoldToXp(userId, username, goldBalance) {
  const data = loadXpData();
  if (!data[userId]) {
    getXpRecord(userId, username);
    return convertGoldToXp(userId, username, goldBalance);
  }
  const record = data[userId];

  if (record.gold_conversion_done) {
    return { success: false, message: 'Gold conversion already done for this player.' };
  }

  const xpGained = Math.floor(goldBalance * GOLD_TO_XP_RATIO);
  record.total_xp += xpGained;
  record.gold_conversion_done = true;
  record.last_updated = new Date().toISOString();
  saveXpData(data);
  return { success: true, xp_gained: xpGained, total_xp: record.total_xp };
}

// ============================================
// LEADERBOARD
// ============================================

const LEADERBOARD_EXCLUDED = ['424061511833747467', '1472286665417560167'];

function getXpLeaderboard(limit = 10) {
  const xpData = loadXpData();
  let players = {};
  try { players = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf-8')); }
  catch { /* ignore */ }

  return Object.values(xpData)
    .filter(r => !LEADERBOARD_EXCLUDED.includes(r.user_id))
    .sort((a, b) => b.total_xp - a.total_xp)
    .slice(0, limit)
    .map((record, i) => {
      const levelInfo = getLevelFromXp(record.total_xp);
      return {
        rank: i + 1,
        user_id: record.user_id,
        username: players[record.user_id]?.characterName || record.username,
        total_xp: record.total_xp,
        level: levelInfo.level
      };
    });
}

module.exports = {
  // I/O
  loadXpData,
  saveXpData,

  // Core
  getXpRecord,
  getLevelFromXp,
  getLevel,
  ensureFreshDaily,
  ensureLifetime,
  incrementLifetimeStat,
  incrementDailyStat,

  // Awards
  awardMessageXp,
  awardReactionXp,
  awardLocationVisitXp,
  awardDailyLoginXp,
  awardGoldSpendXp,
  awardQuestXp,
  dmAwardXp,
  convertGoldToXp,

  // Leaderboard
  getXpLeaderboard,

  // Constants
  XP_PER_MESSAGE,
  XP_PER_REACTION,
  XP_PER_LOCATION_VISIT,
  XP_DAILY_LOGIN,
  XP_PER_GOLD_SPENT,
  MAX_DAILY_MESSAGES,
  MAX_DAILY_REACTIONS,
  MAX_DAILY_GOLD_SPEND_XP,
  GOLD_TO_XP_RATIO,
  BASE_XP,
  LEVEL_MULTIPLIER,
  MIN_LEVEL,
  MAX_LEVEL,
  LEVEL_THRESHOLDS
};

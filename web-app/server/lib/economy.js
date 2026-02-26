/**
 * Economy Data Layer
 * 
 * Reads/writes the SAME JSON files the bots use.
 * Uses atomic writes (write .tmp then rename) to avoid corruption.
 * DO NOT copy data — this operates on the live files.
 */

const fs = require('fs');
const path = require('path');
const { PLAYERS_PATH, ECONOMY_DIR, CHARACTERS_DIR, QUESTMASTER_DIR } = require('./dataPaths');

const ENV = process.env.NODE_ENV === 'production' ? 'prod' : 'prod'; // Always use prod data

const WALLETS_PATH = path.join(ECONOMY_DIR, `wallets.${ENV}.json`);
const INVENTORIES_PATH = path.join(ECONOMY_DIR, `inventories.${ENV}.json`);
const TRANSACTIONS_PATH = path.join(ECONOMY_DIR, `transactions.${ENV}.json`);
const CATALOG_PATH = path.join(ECONOMY_DIR, 'shop_catalog.json');
const CURRENCY_SIGNALS_DIR = path.join(ECONOMY_DIR, 'currency_signals');
const TAVERN_MENU_PATH = path.join(CHARACTERS_DIR, 'bigtam', 'tavern_menu.json');
const PARTY_QUESTS_PATH = path.join(QUESTMASTER_DIR, `party_quests.${ENV}.json`);

// ============================================
// ATOMIC WRITE (matches bot pattern exactly)
// ============================================

function atomicWrite(filePath, data) {
  const tempPath = filePath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filePath);
}

// ============================================
// LOADERS
// ============================================

function loadWallets() {
  try {
    return JSON.parse(fs.readFileSync(WALLETS_PATH, 'utf-8'));
  } catch (err) {
    return {};
  }
}

function saveWallets(wallets) {
  atomicWrite(WALLETS_PATH, wallets);
}

function loadInventories() {
  try {
    return JSON.parse(fs.readFileSync(INVENTORIES_PATH, 'utf-8'));
  } catch (err) {
    return {};
  }
}

function saveInventories(inventories) {
  atomicWrite(INVENTORIES_PATH, inventories);
}

function loadTransactions() {
  try {
    return JSON.parse(fs.readFileSync(TRANSACTIONS_PATH, 'utf-8'));
  } catch (err) {
    return { transactions: [] };
  }
}

function saveTransactions(txData) {
  atomicWrite(TRANSACTIONS_PATH, txData);
}

function loadCatalog() {
  try {
    return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'));
  } catch (err) {
    return { currency_name: 'Gold', currency_symbol: 'G', categories: {} };
  }
}

function loadTavernMenu() {
  try {
    return JSON.parse(fs.readFileSync(TAVERN_MENU_PATH, 'utf-8'));
  } catch (err) {
    return { tavern_name: "The Dragon's Hollow", currency_symbol: 'G', categories: {} };
  }
}

function loadPartyQuests() {
  try {
    return JSON.parse(fs.readFileSync(PARTY_QUESTS_PATH, 'utf-8'));
  } catch (err) {
    return { quests: [], completed: [], failed: [] };
  }
}

function loadNpcQuestState(npcName) {
  try {
    const questPath = path.join(CHARACTERS_DIR, npcName, 'quest_state.json');
    return JSON.parse(fs.readFileSync(questPath, 'utf-8'));
  } catch (err) {
    return null;
  }
}

// ============================================
// WALLET OPERATIONS (matches shopkeeper exactly)
// ============================================

function getWallet(userId, username) {
  const wallets = loadWallets();
  if (!wallets[userId]) {
    wallets[userId] = {
      user_id: userId,
      username: username || 'Unknown',
      balance: 0,
      lifetime_earned: 0,
      lifetime_spent: 0,
      last_updated: new Date().toISOString()
    };
    saveWallets(wallets);
  }
  return wallets[userId];
}

function spendGold(userId, username, amount, type, metadata = {}) {
  const wallets = loadWallets();
  if (!wallets[userId] || wallets[userId].balance < amount) {
    return null;
  }

  wallets[userId].balance -= amount;
  wallets[userId].lifetime_spent += amount;
  wallets[userId].username = username || wallets[userId].username;
  wallets[userId].last_updated = new Date().toISOString();
  saveWallets(wallets);

  logTransaction(userId, username, type, -amount, wallets[userId].balance, metadata);
  return wallets[userId];
}

function awardGold(userId, username, amount, metadata = {}) {
  const wallets = loadWallets();
  if (!wallets[userId]) {
    getWallet(userId, username); // creates it
    return awardGold(userId, username, amount, metadata);
  }
  wallets[userId].balance += amount;
  wallets[userId].lifetime_earned += amount;
  wallets[userId].username = username || wallets[userId].username;
  wallets[userId].last_updated = new Date().toISOString();
  saveWallets(wallets);

  logTransaction(userId, username, 'achievement_reward', amount, wallets[userId].balance, metadata);
  return wallets[userId];
}

function refundGold(userId, username, amount, metadata = {}) {
  const wallets = loadWallets();
  if (!wallets[userId]) {
    getWallet(userId, username);
    return refundGold(userId, username, amount, metadata);
  }
  wallets[userId].balance += amount;
  wallets[userId].lifetime_spent = Math.max(0, wallets[userId].lifetime_spent - amount);
  wallets[userId].username = username || wallets[userId].username;
  wallets[userId].last_updated = new Date().toISOString();
  saveWallets(wallets);

  logTransaction(userId, username, 'shop_sale', amount, wallets[userId].balance, metadata);
  return wallets[userId];
}

function logTransaction(userId, username, type, amount, balanceAfter, metadata = {}) {
  const txData = loadTransactions();
  txData.transactions.push({
    id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    user_id: userId,
    username: username || 'Unknown',
    type,
    amount,
    balance_after: balanceAfter,
    metadata,
    timestamp: new Date().toISOString()
  });

  // Keep last 1000 transactions (same as shopkeeper)
  if (txData.transactions.length > 1000) {
    txData.transactions = txData.transactions.slice(-1000);
  }

  saveTransactions(txData);
}

// ============================================
// INVENTORY OPERATIONS (matches shopkeeper exactly)
// ============================================

function getInventory(userId) {
  const inventories = loadInventories();
  if (!inventories[userId]) {
    return {
      items: [],
      badges: [],
      roles_purchased: [],
      quests_unlocked: []
    };
  }
  return inventories[userId];
}

function addItemToInventory(userId, item) {
  const inventories = loadInventories();
  if (!inventories[userId]) {
    inventories[userId] = { items: [], badges: [], roles_purchased: [], quests_unlocked: [] };
  }

  const inv = inventories[userId];

  if (item.type === 'badge') {
    if (!inv.badges.includes(item.id)) {
      inv.badges.push(item.id);
    }
  } else if (item.type === 'role') {
    if (!inv.roles_purchased.includes(item.id)) {
      inv.roles_purchased.push(item.id);
    }
  } else if (item.type === 'quest_unlock') {
    const questId = item.quest_id || item.id.replace('unlock_', '');
    if (!inv.quests_unlocked.includes(questId)) {
      inv.quests_unlocked.push(questId);
    }
  } else {
    // consumable / tool / weapon
    const existing = inv.items.find(i => i.item_id === item.id);
    if (existing) {
      existing.quantity += 1;
    } else {
      inv.items.push({
        item_id: item.id,
        name: item.name,
        type: item.type,
        quantity: 1,
        acquired_at: new Date().toISOString()
      });
    }
  }

  saveInventories(inventories);
  return inv;
}

// ============================================
// ITEM LOOKUP
// ============================================

function useItem(userId, itemId) {
  const inventories = loadInventories();
  const inv = inventories[userId];
  if (!inv) return { error: 'No inventory found' };

  const entry = inv.items.find(i => i.item_id === itemId);
  if (!entry || entry.quantity <= 0) return { error: 'Item not found in inventory' };

  entry.quantity -= 1;
  if (entry.quantity <= 0) {
    inv.items = inv.items.filter(i => i.item_id !== itemId);
  }

  saveInventories(inventories);
  return { success: true, item: entry, inventory: inv };
}

function removeItemFromInventory(userId, itemId, quantity = 1) {
  const inventories = loadInventories();
  if (!inventories[userId]) return null;

  const inv = inventories[userId];
  const existing = inv.items.find(i => i.item_id === itemId);
  if (!existing || existing.quantity < quantity) return null;

  existing.quantity -= quantity;
  if (existing.quantity <= 0) {
    inv.items = inv.items.filter(i => i.item_id !== itemId);
  }

  saveInventories(inventories);
  return inv;
}

function findItemInCatalog(itemId) {
  const catalog = loadCatalog();
  for (const [catKey, category] of Object.entries(catalog.categories)) {
    const item = category.items.find(i => i.id === itemId);
    if (item) return { item, category: catKey, categoryDisplay: category.display_name };
  }
  return null;
}

function findItemInTavernMenu(itemId) {
  const menu = loadTavernMenu();
  for (const [catKey, category] of Object.entries(menu.categories)) {
    const item = category.items.find(i => i.id === itemId);
    if (item) return { item, category: catKey, categoryDisplay: category.display_name };
  }
  return null;
}

// ============================================
// CURRENCY SIGNALS (for tavern purchases)
// ============================================

function writeTavernPurchaseSignal(userId, username, item) {
  if (!fs.existsSync(CURRENCY_SIGNALS_DIR)) {
    fs.mkdirSync(CURRENCY_SIGNALS_DIR, { recursive: true });
  }

  const signalId = `tavern_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const signal = {
    type: 'tavern_purchase',
    signal_id: signalId,
    user_id: userId,
    username: username,
    item_id: item.id,
    item_name: item.name,
    amount: item.price,
    npc: 'bigtam',
    timestamp: new Date().toISOString()
  };

  const signalPath = path.join(CURRENCY_SIGNALS_DIR, `${signalId}.json`);
  atomicWrite(signalPath, signal);

  return { signalId, signalPath };
}

// Wait for the shopkeeper bot to process the signal and write a result
function waitForSignalResult(signalId, timeoutMs = 5000) {
  const resultPath = path.join(CURRENCY_SIGNALS_DIR, `${signalId}_result.json`);
  const start = Date.now();

  return new Promise((resolve) => {
    const check = () => {
      if (fs.existsSync(resultPath)) {
        try {
          const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
          // Clean up result file
          try { fs.unlinkSync(resultPath); } catch (e) {}
          resolve(result);
        } catch (err) {
          resolve({ success: false, message: 'Failed to read result.' });
        }
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve({ success: false, message: 'Purchase timed out. The shopkeeper may be offline.' });
        return;
      }
      setTimeout(check, 200);
    };
    check();
  });
}

// ============================================
// LEADERBOARD
// ============================================

function getLeaderboard(limit = 10) {
  const wallets = loadWallets();
  let players = {};
  try { players = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf-8')); }
  catch { /* ignore */ }

  return Object.values(wallets)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, limit)
    .map((w, i) => ({
      rank: i + 1,
      user_id: w.user_id,
      username: players[w.user_id]?.characterName || w.username,
      balance: w.balance,
      lifetime_earned: w.lifetime_earned
    }));
}

// ============================================
// QUEST AGGREGATION
// ============================================

const NPC_NAMES = [
  'aurelia', 'bigtam', 'bonesy', 'brynleaf', 'cena', 'djinn', 'edgar',
  'ember', 'grumm', 'ithrae', 'jonah', 'kai', 'kumo', 'mai', 'mira',
  'nibby', 'reah', 'ximena'
];

function getAllQuests() {
  const partyQuests = loadPartyQuests();
  return partyQuests;
}

function getAvailableQuests() {
  const partyQuests = loadPartyQuests();
  return partyQuests.quests.filter(q => q.status !== 'completed' && q.status !== 'failed');
}

function getActiveQuests() {
  const partyQuests = loadPartyQuests();
  return partyQuests.quests.filter(q => q.status === 'active' || q.status === 'in_progress');
}

function getCompletedQuests() {
  const partyQuests = loadPartyQuests();
  const completed = partyQuests.quests.filter(q => q.status === 'completed');
  return completed;
}

module.exports = {
  // Loaders
  loadWallets,
  loadInventories,
  loadTransactions,
  loadCatalog,
  loadTavernMenu,
  loadPartyQuests,
  loadNpcQuestState,

  // Wallet
  getWallet,
  spendGold,
  awardGold,
  refundGold,
  logTransaction,

  // Inventory
  getInventory,
  addItemToInventory,
  removeItemFromInventory,
  useItem,

  // Items
  findItemInCatalog,
  findItemInTavernMenu,

  // Signals
  writeTavernPurchaseSignal,
  waitForSignalResult,

  // Leaderboard
  getLeaderboard,

  // Quests
  getAllQuests,
  getAvailableQuests,
  getActiveQuests,
  getCompletedQuests,
  NPC_NAMES,

  // Constants
  ECONOMY_DIR,
  CHARACTERS_DIR,
  CURRENCY_SIGNALS_DIR
};

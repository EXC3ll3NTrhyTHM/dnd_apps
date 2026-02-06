const fs = require('fs');
const path = require('path');

// ============================================
// ENVIRONMENT SETUP
// ============================================

const ENV = process.argv[2] || 'prod';
if (!['dev', 'prod'].includes(ENV)) {
  console.error('[Shopkeeper] Invalid environment. Use: node bot.js [dev|prod]');
  process.exit(1);
}

const envPath = path.join(__dirname, `.env.shopkeeper.${ENV}`);
if (!fs.existsSync(envPath)) {
  console.error(`[Shopkeeper] Missing env file: ${envPath}`);
  process.exit(1);
}
require('dotenv').config({ path: envPath });

console.log(`[Shopkeeper] Starting in ${ENV.toUpperCase()} mode`);

const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder
} = require('discord.js');
const OpenAI = require('openai');

// ============================================
// CHARACTER (Grumm)
// ============================================

const CHARACTER = 'grumm';
const CHARACTER_DIR = path.join(__dirname, '..', 'characters', CHARACTER);

function loadCharacterFile(filename) {
  const filePath = path.join(CHARACTER_DIR, filename);
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    return '';
  }
}

function buildSystemPrompt() {
  const soul = loadCharacterFile('SOUL.md');
  const context = loadCharacterFile('CONTEXT.md');
  const memory = loadCharacterFile('MEMORY.md');
  const journal = loadCharacterFile('journal.md');

  let prompt = `You are Grumm, a shopkeeper NPC in a D&D campaign, speaking in Discord.

## YOUR CHARACTER
${soul}

## CAMPAIGN CONTEXT
${context}

## YOUR MEMORIES
${memory}`;

  if (journal.trim()) {
    prompt += `\n\n## RECENT EVENTS\n${journal}`;
  }

  prompt += `

## INSTRUCTIONS
- Stay in character as Grumm at all times
- You are responding to shop interactions (purchases, browsing, balance checks, etc.)
- Keep responses SHORT — 1-2 sentences max. You're a bear of few words.
- Use *asterisks* for actions/emotes
- Don't break character
- NEVER wrap your response in quotation marks
- Don't repeat the transaction details (price, balance, item name) — that info is already shown in the embed. Just react in character.`;

  return prompt;
}

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

async function grummSpeak(situation) {
  if (!openai) return null;

  try {
    const response = await openai.chat.completions.create({
      model: process.env.MODEL || 'gpt-4o-mini',
      max_tokens: 150,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: situation }
      ]
    });
    const content = response.choices[0]?.message?.content?.trim();
    return content || null;
  } catch (err) {
    console.error('[Shopkeeper] Grumm speech error:', err.message);
    return null;
  }
}

// ============================================
// CONFIGURATION
// ============================================

const CONFIG_PATH = path.join(__dirname, `config.${ENV}.json`);
const ECONOMY_DIR = path.join(__dirname, '..', 'economy');
const WALLETS_PATH = path.join(ECONOMY_DIR, `wallets.${ENV}.json`);
const INVENTORIES_PATH = path.join(ECONOMY_DIR, `inventories.${ENV}.json`);
const TRANSACTIONS_PATH = path.join(ECONOMY_DIR, `transactions.${ENV}.json`);
const CATALOG_PATH = path.join(ECONOMY_DIR, 'shop_catalog.json');
const CURRENCY_SIGNALS_DIR = path.join(ECONOMY_DIR, 'currency_signals');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (err) {
    return { shop_channel_id: null, announce_channel_id: null, admin_role_id: '', command_prefix: '!shop' };
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ============================================
// ECONOMY DATA LAYER (Atomic writes)
// ============================================

function atomicWrite(filePath, data) {
  const tempPath = filePath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filePath);
}

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
    console.error('[Shopkeeper] Failed to load catalog:', err.message);
    return { currency_name: 'Gold', currency_symbol: 'G', categories: {} };
  }
}

// ============================================
// WALLET OPERATIONS
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

function addGold(userId, username, amount, type, metadata = {}) {
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
  }

  wallets[userId].balance += amount;
  wallets[userId].lifetime_earned += amount;
  wallets[userId].username = username || wallets[userId].username;
  wallets[userId].last_updated = new Date().toISOString();
  saveWallets(wallets);

  logTransaction(userId, username, type, amount, wallets[userId].balance, metadata);
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

function deductGold(userId, username, amount, type, metadata = {}) {
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
  }

  wallets[userId].balance = Math.max(0, wallets[userId].balance - amount);
  wallets[userId].username = username || wallets[userId].username;
  wallets[userId].last_updated = new Date().toISOString();
  saveWallets(wallets);

  logTransaction(userId, username, type, -amount, wallets[userId].balance, metadata);
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

  // Keep last 1000 transactions
  if (txData.transactions.length > 1000) {
    txData.transactions = txData.transactions.slice(-1000);
  }

  saveTransactions(txData);
}

// ============================================
// INVENTORY OPERATIONS
// ============================================

function getInventory(userId) {
  const inventories = loadInventories();
  if (!inventories[userId]) {
    inventories[userId] = {
      items: [],
      badges: [],
      roles_purchased: [],
      quests_unlocked: []
    };
    saveInventories(inventories);
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

function useConsumable(userId, itemId) {
  const inventories = loadInventories();
  if (!inventories[userId]) return { success: false, message: 'No inventory found.' };

  const inv = inventories[userId];
  const item = inv.items.find(i => i.item_id === itemId);
  if (!item) return { success: false, message: 'You don\'t have that item.' };
  if (item.quantity <= 0) return { success: false, message: 'You\'re out of that item.' };

  item.quantity -= 1;
  if (item.quantity <= 0) {
    inv.items = inv.items.filter(i => i.item_id !== itemId);
  }

  saveInventories(inventories);
  return { success: true, item };
}

function hasItem(userId, itemId) {
  const inv = getInventory(userId);
  if (inv.badges.includes(itemId)) return true;
  if (inv.roles_purchased.includes(itemId)) return true;
  if (inv.quests_unlocked.includes(itemId) || inv.quests_unlocked.includes(itemId.replace('unlock_', ''))) return true;
  if (inv.items.find(i => i.item_id === itemId && i.quantity > 0)) return true;
  return false;
}

// ============================================
// ITEM LOOKUP
// ============================================

function findItemInCatalog(itemId) {
  const catalog = loadCatalog();
  for (const [catKey, category] of Object.entries(catalog.categories)) {
    const item = category.items.find(i => i.id === itemId);
    if (item) return { item, category: catKey, categoryDisplay: category.display_name };
  }
  return null;
}

// ============================================
// INITIALIZE DISCORD CLIENT
// ============================================

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

// ============================================
// ERROR HANDLING
// ============================================

process.on('uncaughtException', (error) => {
  console.error('[Shopkeeper] Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Shopkeeper] Unhandled Rejection:', reason);
});

// ============================================
// ADMIN CHECK
// ============================================

function isAdmin(member) {
  const config = loadConfig();
  if (member.permissions.has('Administrator')) return true;
  if (config.admin_role_id && member.roles.cache.has(config.admin_role_id)) return true;
  return false;
}

// ============================================
// CURRENCY SIGNAL WATCHER (Quest Master -> Shopkeeper)
// ============================================

async function processCurrencySignal(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const signal = JSON.parse(raw);

    // Validate timestamp (ignore if older than 5 minutes)
    const age = Date.now() - signal.timestamp;
    if (age > 300000) {
      console.log(`[Shopkeeper] Ignoring stale currency signal (${Math.round(age / 1000)}s old)`);
      fs.unlinkSync(filePath);
      return;
    }

    console.log(`[Shopkeeper] Processing currency signal: ${signal.type} for quest ${signal.quest_id}`);

    if (signal.type === 'quest_reward' && signal.recipients && signal.reward_amount) {
      const catalog = loadCatalog();
      const currencyName = catalog.currency_name || 'Gold';
      const currencySymbol = catalog.currency_symbol || 'G';

      for (const recipient of signal.recipients) {
        addGold(
          recipient.user_id,
          recipient.username,
          signal.reward_amount,
          'quest_reward',
          { quest_id: signal.quest_id, quest_name: signal.quest_name }
        );
        console.log(`[Shopkeeper] Credited ${signal.reward_amount}${currencySymbol} to ${recipient.username} (${recipient.user_id})`);
      }

      // Post announcement
      const config = loadConfig();
      const announceChannelId = config.announce_channel_id || config.shop_channel_id;
      if (announceChannelId) {
        try {
          const channel = await discord.channels.fetch(announceChannelId);
          if (channel) {
            const recipientList = signal.recipients.map(r => `<@${r.user_id}>`).join(', ');
            const embed = new EmbedBuilder()
              .setColor(0xF1C40F)
              .setTitle(`${currencyName} Reward!`)
              .setDescription(
                `The party completed **${signal.quest_name || signal.quest_id}**!\n\n` +
                `${recipientList} earned **${signal.reward_amount}${currencySymbol}** each!`
              )
              .setFooter({ text: `Use !shop balance to check your ${currencyName.toLowerCase()}` });
            await channel.send({ embeds: [embed] });
          }
        } catch (err) {
          console.error('[Shopkeeper] Failed to send reward announcement:', err.message);
        }
      }
    }

    // ---- Tavern Purchase Signal ----
    if (signal.type === 'tavern_purchase' && signal.user_id && signal.amount) {
      const catalog = loadCatalog();
      const currencySymbol = catalog.currency_symbol || 'G';
      const resultPath = path.join(CURRENCY_SIGNALS_DIR, `${signal.signal_id}_result.json`);
      
      const wallet = getWallet(signal.user_id, signal.username);
      
      if (wallet.balance < signal.amount) {
        // Not enough gold
        const result = {
          success: false,
          message: `Not enough ${currencySymbol}. Need ${signal.amount}${currencySymbol}, have ${wallet.balance}${currencySymbol}.`,
          balance_after: wallet.balance
        };
        atomicWrite(resultPath, result);
        console.log(`[Shopkeeper] Tavern purchase DENIED: ${signal.username} can't afford ${signal.item_name} (${signal.amount}${currencySymbol})`);
      } else {
        // Deduct gold
        const updated = spendGold(
          signal.user_id,
          signal.username,
          signal.amount,
          'tavern_purchase',
          { item_id: signal.item_id, item_name: signal.item_name, npc: signal.npc }
        );
        
        const result = {
          success: true,
          balance_after: updated.balance,
          item_name: signal.item_name
        };
        atomicWrite(resultPath, result);
        console.log(`[Shopkeeper] Tavern purchase OK: ${signal.username} bought ${signal.item_name} for ${signal.amount}${currencySymbol} (balance: ${updated.balance}${currencySymbol})`);
      }
    }

    // Delete signal file
    try { fs.unlinkSync(filePath); } catch (e) {}
    console.log(`[Shopkeeper] Signal processed: ${signal.type} / ${signal.quest_id || signal.signal_id}`);
  } catch (err) {
    console.error('[Shopkeeper] Error processing currency signal:', err.message);
    try { fs.unlinkSync(filePath); } catch (e) {}
  }
}

function startCurrencySignalWatcher() {
  if (!fs.existsSync(CURRENCY_SIGNALS_DIR)) {
    fs.mkdirSync(CURRENCY_SIGNALS_DIR, { recursive: true });
  }

  // Process existing signal files on startup
  const existing = fs.readdirSync(CURRENCY_SIGNALS_DIR).filter(f => f.endsWith('.json'));
  for (const file of existing) {
    processCurrencySignal(path.join(CURRENCY_SIGNALS_DIR, file));
  }

  // Watch for new signal files
  try {
    fs.watch(CURRENCY_SIGNALS_DIR, (eventType, filename) => {
      if (filename && filename.endsWith('.json') && eventType === 'rename') {
        const filePath = path.join(CURRENCY_SIGNALS_DIR, filename);
        setTimeout(() => {
          if (fs.existsSync(filePath)) {
            processCurrencySignal(filePath);
          }
        }, 100);
      }
    });
    console.log('[Shopkeeper] Currency signal watcher active on', CURRENCY_SIGNALS_DIR);
  } catch (err) {
    console.error('[Shopkeeper] Failed to start signal watcher:', err.message);
    console.log('[Shopkeeper] Falling back to polling for currency signals');
    setInterval(() => {
      try {
        const files = fs.readdirSync(CURRENCY_SIGNALS_DIR).filter(f => f.endsWith('.json'));
        for (const file of files) {
          processCurrencySignal(path.join(CURRENCY_SIGNALS_DIR, file));
        }
      } catch (e) {}
    }, 2000);
  }
}

// ============================================
// PURCHASE / FULFILLMENT
// ============================================

async function fulfillPurchase(userId, username, item, member) {
  const catalog = loadCatalog();
  const currencySymbol = catalog.currency_symbol || 'G';

  // Check if one-time item already owned
  if (item.one_time && hasItem(userId, item.id)) {
    return { success: false, message: 'You already own this item.' };
  }

  // Check consumable max stack
  if (item.consumable && item.max_stack) {
    const inv = getInventory(userId);
    const existing = inv.items.find(i => i.item_id === item.id);
    if (existing && existing.quantity >= item.max_stack) {
      return { success: false, message: `You already have the max of ${item.max_stack}. Use some first!` };
    }
  }

  // Deduct gold
  const wallet = spendGold(userId, username, item.price, 'purchase', { item_id: item.id, item_name: item.name });
  if (!wallet) {
    return { success: false, message: `Not enough ${currencySymbol}! You need **${item.price}${currencySymbol}**.` };
  }

  // Fulfill by type
  if (item.type === 'role' && item.role_id && member) {
    try {
      await member.roles.add(item.role_id);
    } catch (err) {
      console.error(`[Shopkeeper] Failed to add role ${item.role_id}:`, err.message);
      // Refund
      addGold(userId, username, item.price, 'refund', { item_id: item.id, reason: 'role_add_failed' });
      return { success: false, message: 'Failed to add the role. You\'ve been refunded.' };
    }
  }

  if (!item.no_inventory) {
    addItemToInventory(userId, item);
  }
  return { success: true, wallet };
}

// ============================================
// EMBED BUILDERS
// ============================================

function buildBalanceEmbed(userId, username) {
  const wallet = getWallet(userId, username);
  const catalog = loadCatalog();
  const sym = catalog.currency_symbol || 'G';
  const name = catalog.currency_name || 'Gold';

  return new EmbedBuilder()
    .setColor(0xF1C40F)
    .setTitle(`${name} Balance`)
    .setDescription(`**${wallet.balance}${sym}**`)
    .addFields(
      { name: 'Lifetime Earned', value: `${wallet.lifetime_earned}${sym}`, inline: true },
      { name: 'Lifetime Spent', value: `${wallet.lifetime_spent}${sym}`, inline: true }
    )
    .setFooter({ text: `${username}` });
}

function buildProfileEmbed(userId, username) {
  const wallet = getWallet(userId, username);
  const inv = getInventory(userId);
  const catalog = loadCatalog();
  const sym = catalog.currency_symbol || 'G';
  const name = catalog.currency_name || 'Gold';

  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle(`${username}'s Profile`)
    .addFields(
      { name: `${name}`, value: `**${wallet.balance}${sym}**`, inline: true },
      { name: 'Earned', value: `${wallet.lifetime_earned}${sym}`, inline: true },
      { name: 'Spent', value: `${wallet.lifetime_spent}${sym}`, inline: true }
    );

  if (inv.badges.length > 0) {
    const catalog = loadCatalog();
    const badgeNames = inv.badges.map(bId => {
      const found = findItemInCatalog(bId);
      return found ? found.item.name : bId;
    });
    embed.addFields({ name: 'Badges', value: badgeNames.join(', ') });
  }

  if (inv.roles_purchased.length > 0) {
    const roleNames = inv.roles_purchased.map(rId => {
      const found = findItemInCatalog(rId);
      return found ? found.item.name : rId;
    });
    embed.addFields({ name: 'Titles', value: roleNames.join(', ') });
  }

  const itemList = inv.items.filter(i => i.quantity > 0);
  if (itemList.length > 0) {
    embed.addFields({
      name: 'Items',
      value: itemList.map(i => `${i.name} x${i.quantity}`).join(', ')
    });
  }

  if (inv.quests_unlocked.length > 0) {
    embed.addFields({ name: 'Quests Unlocked', value: inv.quests_unlocked.join(', ') });
  }

  return embed;
}

function buildInventoryEmbed(userId, username) {
  const inv = getInventory(userId);
  const catalog = loadCatalog();

  const embed = new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle(`${username}'s Inventory`);

  const itemList = inv.items.filter(i => i.quantity > 0);
  if (itemList.length > 0) {
    embed.addFields({
      name: 'Items',
      value: itemList.map(i => {
        const found = findItemInCatalog(i.item_id);
        const emoji = found ? (found.item.consumable ? '\ud83c\udf3f' : '\u2699\ufe0f') : '\ud83d\udce6';
        return `${emoji} **${i.name}** x${i.quantity}`;
      }).join('\n')
    });
  }

  if (inv.badges.length > 0) {
    const badgeNames = inv.badges.map(bId => {
      const found = findItemInCatalog(bId);
      return found ? `\ud83c\udfc6 ${found.item.name}` : `\ud83c\udfc6 ${bId}`;
    });
    embed.addFields({ name: 'Badges', value: badgeNames.join('\n') });
  }

  if (inv.roles_purchased.length > 0) {
    const roleNames = inv.roles_purchased.map(rId => {
      const found = findItemInCatalog(rId);
      return found ? `\ud83c\udfa8 ${found.item.name}` : `\ud83c\udfa8 ${rId}`;
    });
    embed.addFields({ name: 'Titles & Colors', value: roleNames.join('\n') });
  }

  if (inv.quests_unlocked.length > 0) {
    embed.addFields({
      name: 'Quest Unlocks',
      value: inv.quests_unlocked.map(q => `\ud83d\udd13 ${q}`).join('\n')
    });
  }

  if (itemList.length === 0 && inv.badges.length === 0 && inv.roles_purchased.length === 0 && inv.quests_unlocked.length === 0) {
    embed.setDescription('*Your inventory is empty. Visit the shop!*');
  }

  return embed;
}

function buildLeaderboardEmbed() {
  const wallets = loadWallets();
  const catalog = loadCatalog();
  const sym = catalog.currency_symbol || 'G';

  const sorted = Object.values(wallets)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 10);

  if (sorted.length === 0) {
    return new EmbedBuilder()
      .setColor(0xF1C40F)
      .setTitle('Leaderboard')
      .setDescription('*No players yet.*');
  }

  const medals = ['', '', ''];
  const lines = sorted.map((w, i) => {
    const prefix = medals[i] || `**${i + 1}.**`;
    return `${prefix} ${w.username} — **${w.balance}${sym}**`;
  });

  return new EmbedBuilder()
    .setColor(0xF1C40F)
    .setTitle('Richest Adventurers')
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Top 10 by balance' });
}

// ============================================
// INTERACTIVE SHOP FLOW
// ============================================

function buildCategorySelectMenu() {
  const catalog = loadCatalog();
  const options = Object.entries(catalog.categories).map(([key, cat]) => ({
    label: cat.display_name,
    value: key,
    emoji: cat.emoji,
    description: `${cat.items.length} item${cat.items.length !== 1 ? 's' : ''}`
  }));

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('shop_category')
      .setPlaceholder('Choose a category...')
      .addOptions(options)
  );

  const embed = new EmbedBuilder()
    .setColor(0xE67E22)
    .setTitle('Shop')
    .setDescription('Browse the wares! Select a category below.')
    .setFooter({ text: 'Use !shop balance to check your gold' });

  return { embed, row };
}

function buildItemSelectMenu(categoryKey, userId) {
  const catalog = loadCatalog();
  const category = catalog.categories[categoryKey];
  if (!category) return null;

  const sym = catalog.currency_symbol || 'G';
  const inv = getInventory(userId);

  const options = category.items.map(item => {
    const owned = hasItem(userId, item.id);
    let desc = `${item.price}${sym}`;
    if (item.description) desc += ` - ${item.description.substring(0, 70)}`;
    if (owned && item.one_time) desc = `OWNED - ${desc}`;

    return {
      label: `${owned && item.one_time ? '\u2714 ' : ''}${item.name}`,
      value: item.id,
      description: desc.substring(0, 100)
    };
  });

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`shop_item_${categoryKey}`)
      .setPlaceholder('Choose an item...')
      .addOptions(options)
  );

  const embed = new EmbedBuilder()
    .setColor(0xE67E22)
    .setTitle(`${category.emoji} ${category.display_name}`)
    .setDescription(
      category.items.map(item => {
        const owned = hasItem(userId, item.id);
        const mark = owned && item.one_time ? ' \u2714' : '';
        return `**${item.name}**${mark} — ${item.price}${sym}\n${item.description || ''}`;
      }).join('\n\n')
    )
    .setFooter({ text: 'Select an item to purchase' });

  return { embed, row };
}

function buildConfirmEmbed(item, userId, username) {
  const wallet = getWallet(userId, username);
  const catalog = loadCatalog();
  const sym = catalog.currency_symbol || 'G';
  const balanceAfter = wallet.balance - item.price;

  const embed = new EmbedBuilder()
    .setColor(balanceAfter >= 0 ? 0x2ECC71 : 0xE74C3C)
    .setTitle(`Buy ${item.name}?`)
    .setDescription(item.description || '')
    .addFields(
      { name: 'Price', value: `${item.price}${sym}`, inline: true },
      { name: 'Your Balance', value: `${wallet.balance}${sym}`, inline: true },
      { name: 'After Purchase', value: balanceAfter >= 0 ? `${balanceAfter}${sym}` : 'Not enough!', inline: true }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`shop_buy_${item.id}`)
      .setLabel('Buy')
      .setStyle(ButtonStyle.Success)
      .setDisabled(balanceAfter < 0),
    new ButtonBuilder()
      .setCustomId('shop_cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embed, row };
}

// ============================================
// DISCORD EVENTS
// ============================================

// ============================================
// HUB PANEL (Persistent shop panel)
// ============================================

const HUB_PANEL_PATH = path.join(CHARACTER_DIR, 'hub_panel.json');

function loadHubPanel() {
  if (!fs.existsSync(HUB_PANEL_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(HUB_PANEL_PATH, 'utf-8')); } catch { return null; }
}

function saveHubPanel(data) {
  fs.writeFileSync(HUB_PANEL_PATH, JSON.stringify(data, null, 2));
}

function buildShopHubPanel() {
  const catalog = loadCatalog();
  const sym = catalog.currency_symbol || 'G';
  
  const embed = new EmbedBuilder()
    .setColor(0xE67E22)
    .setTitle(`🏪 Grumm's Shop`)
    .setDescription(
      `*...The shop is open. What do you need.*\n\n` +
      `Browse the wares, check your balance, or view your inventory.`
    )
    .setFooter({ text: 'grumm | The shop has hours and he keeps them' });
  
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('hub_shop_browse')
      .setLabel('Browse Shop')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🛒'),
    new ButtonBuilder()
      .setCustomId('hub_shop_balance')
      .setLabel('Check Gold')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('💰'),
    new ButtonBuilder()
      .setCustomId('hub_shop_inventory')
      .setLabel('Inventory')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🎒'),
    new ButtonBuilder()
      .setCustomId('hub_shop_profile')
      .setLabel('Profile')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📋'),
  );
  
  return { embeds: [embed], components: [row] };
}

async function ensureShopHubPanel() {
  const config = loadConfig();
  const channelId = config.shop_channel_id;
  if (!channelId) return;
  
  const hub = loadHubPanel();
  const channel = await discord.channels.fetch(channelId).catch(() => null);
  if (!channel) return;
  
  const panelContent = buildShopHubPanel();
  
  if (hub && hub.message_id) {
    try {
      const existingMsg = await channel.messages.fetch(hub.message_id);
      await existingMsg.edit(panelContent);
      console.log(`[Shopkeeper] Hub panel updated (message ${hub.message_id})`);
      return;
    } catch {
      console.log('[Shopkeeper] Hub panel message not found, posting new one');
    }
  }
  
  const msg = await channel.send(panelContent);
  saveHubPanel({ message_id: msg.id, channel_id: channel.id, posted_at: new Date().toISOString() });
  console.log(`[Shopkeeper] Hub panel posted (message ${msg.id})`);
}

discord.once('ready', async () => {
  console.log('[Shopkeeper] Logged in as', discord.user.tag);

  startCurrencySignalWatcher();
  
  // Post/update persistent shop hub panel
  await ensureShopHubPanel();

  console.log('[Shopkeeper] Shop is open for business!');
});

// ============================================
// INTERACTION HANDLER (Buttons + Select Menus)
// ============================================

discord.on('interactionCreate', async (interaction) => {
  try {
    // ---- HUB PANEL BUTTONS ----
    
    if (interaction.isButton() && interaction.customId === 'hub_shop_browse') {
      const { embed, row } = buildCategorySelectMenu();
      const username = interaction.member?.displayName || interaction.user.username;
      const flavor = await grummSpeak(`A customer named ${username} just walked into the shop and is browsing. Greet them briefly in character.`);
      if (flavor) embed.setDescription(flavor);
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      return;
    }
    
    if (interaction.isButton() && interaction.customId === 'hub_shop_balance') {
      const username = interaction.member?.displayName || interaction.user.username;
      const embed = buildBalanceEmbed(interaction.user.id, username);
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    
    if (interaction.isButton() && interaction.customId === 'hub_shop_inventory') {
      const username = interaction.member?.displayName || interaction.user.username;
      const embed = buildInventoryEmbed(interaction.user.id, username);
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    
    if (interaction.isButton() && interaction.customId === 'hub_shop_profile') {
      const username = interaction.member?.displayName || interaction.user.username;
      const embed = buildProfileEmbed(interaction.user.id, username);
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    
    // Category select menu
    if (interaction.isStringSelectMenu() && interaction.customId === 'shop_category') {
      const categoryKey = interaction.values[0];
      const result = buildItemSelectMenu(categoryKey, interaction.user.id);
      if (!result) {
        await interaction.reply({ content: 'Category not found.', ephemeral: true });
        return;
      }
      await interaction.reply({
        embeds: [result.embed],
        components: [result.row],
        ephemeral: true
      });
      return;
    }

    // Item select menu
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('shop_item_')) {
      const itemId = interaction.values[0];
      const found = findItemInCatalog(itemId);
      if (!found) {
        await interaction.reply({ content: 'Item not found.', ephemeral: true });
        return;
      }
      const { embed, row } = buildConfirmEmbed(
        found.item,
        interaction.user.id,
        interaction.member?.displayName || interaction.user.username
      );
      await interaction.reply({
        embeds: [embed],
        components: [row],
        ephemeral: true
      });
      return;
    }

    // Buy button
    if (interaction.isButton() && interaction.customId.startsWith('shop_buy_')) {
      const itemId = interaction.customId.replace('shop_buy_', '');
      const found = findItemInCatalog(itemId);
      if (!found) {
        await interaction.reply({ content: 'Item not found.', ephemeral: true });
        return;
      }

      const catalog = loadCatalog();
      const sym = catalog.currency_symbol || 'G';
      const username = interaction.member?.displayName || interaction.user.username;

      const result = await fulfillPurchase(
        interaction.user.id,
        username,
        found.item,
        interaction.member
      );

      if (result.success) {
        const flavor = await grummSpeak(`A customer named ${username} just bought "${found.item.name}" (a ${found.item.type}). React to the sale in character.`);
        const embed = new EmbedBuilder()
          .setColor(0x2ECC71)
          .setTitle('Purchase Successful!')
          .setDescription(
            (flavor ? `${flavor}\n\n` : '') +
            `You bought **${found.item.name}** for **${found.item.price}${sym}**.\nRemaining balance: **${result.wallet.balance}${sym}**`
          );

        await interaction.update({
          embeds: [embed],
          components: []
        });
      } else {
        const flavor = await grummSpeak(`A customer named ${username} tried to buy "${found.item.name}" but couldn't afford it or already owns it. React in character.`);
        const embed = new EmbedBuilder()
          .setColor(0xE74C3C)
          .setTitle('Purchase Failed')
          .setDescription((flavor ? `${flavor}\n\n` : '') + result.message);

        await interaction.update({
          embeds: [embed],
          components: []
        });
      }
      return;
    }

    // Cancel button
    if (interaction.isButton() && interaction.customId === 'shop_cancel') {
      const flavor = await grummSpeak('A customer was about to buy something but changed their mind and cancelled. React briefly in character.');
      await interaction.update({
        embeds: [new EmbedBuilder().setColor(0x95A5A6).setDescription(flavor || '*Grumm grunts and puts the item back on the shelf.*')],
        components: []
      });
      return;
    }

  } catch (err) {
    console.error('[Shopkeeper] Interaction error:', err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: 'An error occurred.', ephemeral: true });
      } else {
        await interaction.reply({ content: 'An error occurred.', ephemeral: true });
      }
    } catch (e) {}
  }
});

// ============================================
// ITEM SHORTCUT COMMANDS
// ============================================

/**
 * Find a catalog item whose shortcuts match the incoming message.
 * Shortcuts are defined per-item in shop_catalog.json, e.g. ["!smoke", "!spark", "!hit blunt"]
 * Returns the catalog item if matched, null otherwise.
 */
function matchItemShortcut(content) {
  const lower = content.toLowerCase().trim();
  const catalog = loadCatalog();
  for (const [catKey, category] of Object.entries(catalog.categories)) {
    for (const item of category.items) {
      if (!item.shortcuts || !item.consumable) continue;
      for (const sc of item.shortcuts) {
        // Match exact shortcut or shortcut as prefix (e.g. "!smoke" matches "!smoke something")
        if (lower === sc.toLowerCase() || lower.startsWith(sc.toLowerCase() + ' ')) {
          return item;
        }
      }
    }
  }
  return null;
}

discord.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const content = message.content.toLowerCase().trim();
  if (!content.startsWith('!')) return;

  const matched = matchItemShortcut(content);
  if (!matched) return; // Not a shortcut, ignore (the !shop handler below will catch !shop commands)

  const userId = message.author.id;
  const username = message.member?.displayName || message.author.username;

  const inv = getInventory(userId);
  const invItem = inv.items.find(i => i.item_id === matched.id);

  if (!invItem || invItem.quantity <= 0) {
    const flavor = await grummSpeak(`${username} tried to use a "${matched.name}" but doesn't have any. React in character — maybe suggest they buy one.`);
    await message.reply(flavor || `You don't have any **${matched.name}**. Check \`!shop browse\` to buy some.`);
    return;
  }

  const result = useConsumable(userId, matched.id);
  if (result.success) {
    const flavor = await grummSpeak(`${username} just used a "${matched.name}" (consumable). React in character — keep it brief and fun.`);
    const useMsg = matched.use_message || `You use the ${matched.name}.`;
    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setDescription(`${useMsg}\n\n*${matched.name} remaining: ${result.item.quantity || 0}*` + (flavor ? `\n\n${flavor}` : ''));
    await message.reply({ embeds: [embed] });
  } else {
    await message.reply(result.message);
  }
});

// ============================================
// MESSAGE COMMANDS
// ============================================

discord.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  // Hub panel command
  if (message.content.toLowerCase().trim() === '!hub' || message.content.toLowerCase().trim() === '!hub post') {
    if (!isAdmin(message.member)) {
      await message.reply("You don't have permission to do that.");
      return;
    }
    saveHubPanel({});
    await ensureShopHubPanel();
    await message.reply('(Shop hub panel posted/refreshed)');
    return;
  }
  
  if (!message.content.toLowerCase().startsWith('!shop')) return;

  const args = message.content.slice(5).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();

  const username = message.member?.displayName || message.author.username;
  const userId = message.author.id;

  // ---- !shop browse ----
  if (command === 'browse' || command === 'shop' || !command) {
    const { embed, row } = buildCategorySelectMenu();
    const flavor = await grummSpeak(`A customer named ${username} just walked into the shop and is browsing. Greet them in character.`);
    if (flavor) embed.setDescription(flavor);
    await message.reply({ embeds: [embed], components: [row] });
    return;
  }

  // ---- !shop balance ----
  if (command === 'balance' || command === 'bal' || command === 'gold') {
    const embed = buildBalanceEmbed(userId, username);
    const wallet = getWallet(userId, username);
    const flavor = await grummSpeak(`${username} is checking their gold balance. They have ${wallet.balance}G. React briefly in character.`);
    if (flavor) embed.setFooter({ text: flavor });
    await message.reply({ embeds: [embed] });
    return;
  }

  // ---- !shop inventory / inv ----
  if (command === 'inventory' || command === 'inv') {
    const embed = buildInventoryEmbed(userId, username);
    await message.reply({ embeds: [embed] });
    return;
  }

  // ---- !shop use <item> ----
  if (command === 'use') {
    const itemQuery = args.join(' ').toLowerCase();
    if (!itemQuery) {
      await message.reply('Usage: `!shop use <item name>`');
      return;
    }

    // Find item by name or id
    const inv = getInventory(userId);
    const invItem = inv.items.find(i =>
      i.item_id.toLowerCase() === itemQuery ||
      i.name.toLowerCase() === itemQuery ||
      i.name.toLowerCase().includes(itemQuery)
    );

    if (!invItem) {
      await message.reply('You don\'t have that item. Check `!shop inventory`.');
      return;
    }

    // Look up catalog for use_message
    const found = findItemInCatalog(invItem.item_id);
    if (!found || !found.item.consumable) {
      await message.reply('That item can\'t be used.');
      return;
    }

    const result = useConsumable(userId, invItem.item_id);
    if (result.success) {
      const flavor = await grummSpeak(`${username} just used a "${invItem.name}" (consumable) in the shop. React in character.`);
      const useMsg = found.item.use_message || `You use the ${invItem.name}.`;
      const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setDescription(`${useMsg}\n\n*${invItem.name} remaining: ${result.item.quantity || 0}*` + (flavor ? `\n\n${flavor}` : ''));
      await message.reply({ embeds: [embed] });
    } else {
      await message.reply(result.message);
    }
    return;
  }

  // ---- !shop profile ----
  if (command === 'profile') {
    const embed = buildProfileEmbed(userId, username);
    await message.reply({ embeds: [embed] });
    return;
  }

  // ---- !shop leaderboard / lb ----
  if (command === 'leaderboard' || command === 'lb') {
    const embed = buildLeaderboardEmbed();
    await message.reply({ embeds: [embed] });
    return;
  }

  // ---- ADMIN: !shop give @user amount ----
  if (command === 'give') {
    if (!isAdmin(message.member)) {
      await message.reply('You don\'t have permission to do that.');
      return;
    }

    const target = message.mentions.users.first();
    const amount = parseInt(args.find(a => /^\d+$/.test(a)));

    if (!target || !amount || amount <= 0) {
      await message.reply('Usage: `!shop give @user <amount>`');
      return;
    }

    const catalog = loadCatalog();
    const sym = catalog.currency_symbol || 'G';
    const targetName = message.guild?.members.cache.get(target.id)?.displayName || target.username;

    const wallet = addGold(target.id, targetName, amount, 'admin_grant', { granted_by: userId });

    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setDescription(`Granted **${amount}${sym}** to **${targetName}**.\n\nTheir balance: **${wallet.balance}${sym}**`);
    await message.reply({ embeds: [embed] });
    return;
  }

  // ---- ADMIN: !shop take @user amount ----
  if (command === 'take') {
    if (!isAdmin(message.member)) {
      await message.reply('You don\'t have permission to do that.');
      return;
    }

    const target = message.mentions.users.first();
    const amount = parseInt(args.find(a => /^\d+$/.test(a)));

    if (!target || !amount || amount <= 0) {
      await message.reply('Usage: `!shop take @user <amount>`');
      return;
    }

    const catalog = loadCatalog();
    const sym = catalog.currency_symbol || 'G';
    const targetName = message.guild?.members.cache.get(target.id)?.displayName || target.username;

    const wallet = deductGold(target.id, targetName, amount, 'admin_deduct', { deducted_by: userId });

    const embed = new EmbedBuilder()
      .setColor(0xE74C3C)
      .setDescription(`Deducted **${amount}${sym}** from **${targetName}**.\n\nTheir balance: **${wallet.balance}${sym}**`);
    await message.reply({ embeds: [embed] });
    return;
  }

  // ---- ADMIN: !shop config ----
  if (command === 'config') {
    if (!isAdmin(message.member)) {
      await message.reply('You don\'t have permission to do that.');
      return;
    }

    const subcommand = args[0]?.toLowerCase();
    const config = loadConfig();

    if (subcommand === 'shop_channel') {
      config.shop_channel_id = message.channel.id;
      saveConfig(config);
      await message.reply(`Shop channel set to <#${message.channel.id}>.`);
      return;
    }

    if (subcommand === 'announce_channel') {
      config.announce_channel_id = message.channel.id;
      saveConfig(config);
      await message.reply(`Announce channel set to <#${message.channel.id}>.`);
      return;
    }

    if (subcommand === 'admin_role') {
      const roleId = args[1];
      if (!roleId) {
        await message.reply('Usage: `!shop config admin_role <role_id>`');
        return;
      }
      config.admin_role_id = roleId;
      saveConfig(config);
      await message.reply(`Admin role set to \`${roleId}\`.`);
      return;
    }

    await message.reply(
      '**Shop Config:**\n' +
      `\`!shop config shop_channel\` — Set this channel as the shop channel\n` +
      `\`!shop config announce_channel\` — Set this channel for reward announcements\n` +
      `\`!shop config admin_role <role_id>\` — Set admin role`
    );
    return;
  }

  // ---- !shop help ----
  if (command === 'help') {
    // Build shortcut list dynamically from catalog
    const catalog = loadCatalog();
    const shortcutLines = [];
    for (const category of Object.values(catalog.categories)) {
      for (const item of category.items) {
        if (item.shortcuts && item.shortcuts.length > 0) {
          shortcutLines.push(`${item.name}: ${item.shortcuts.map(s => `\`${s}\``).join(', ')}`);
        }
      }
    }
    const shortcutSection = shortcutLines.length > 0
      ? `\n\n**Quick Use (shortcuts):**\n${shortcutLines.join('\n')}`
      : '';

    const help = `**Shop Commands**

**Player:**
\`!shop\` or \`!shop browse\` — Browse the shop
\`!shop balance\` — Check your gold
\`!shop inventory\` — View your items
\`!shop use <item>\` — Use a consumable
\`!shop profile\` — View your full profile
\`!shop leaderboard\` — Top 10 richest${shortcutSection}

**Admin:**
\`!shop give @user <amount>\` — Grant gold
\`!shop take @user <amount>\` — Deduct gold
\`!shop config\` — Configure channels & roles`;

    await message.reply(help);
    return;
  }

  // Unknown
  await message.reply('Unknown command. Use `!shop help` for available commands.');
});

// Start the bot
discord.login(process.env.DISCORD_TOKEN);

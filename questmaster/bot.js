const fs = require('fs');
const path = require('path');

// Chat mode module for free-form chat instead of buttons
const chatMode = require('./chat_mode');

// ============================================
// ENVIRONMENT SETUP
// ============================================

// Parse environment argument (dev or prod, defaults to prod)
const ENV = process.argv[2] || 'prod';
if (!['dev', 'prod'].includes(ENV)) {
  console.error('[QuestMaster] Invalid environment. Use: node bot.js [dev|prod]');
  process.exit(1);
}

// Load environment-specific .env file
const envPath = path.join(__dirname, `.env.questmaster.${ENV}`);
if (!fs.existsSync(envPath)) {
  console.error(`[QuestMaster] Missing env file: ${envPath}`);
  process.exit(1);
}
require('dotenv').config({ path: envPath });

console.log(`[QuestMaster] Starting in ${ENV.toUpperCase()} mode`);

const { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  EmbedBuilder,
  AttachmentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const OpenAI = require('openai');

// ============================================
// CONFIGURATION
// ============================================

const CONFIG_PATH = path.join(__dirname, `config.${ENV}.json`);
const QUESTS_PATH = path.join(__dirname, `party_quests.${ENV}.json`);
const NPC_CHARACTERS_PATH = path.join(__dirname, '..', 'characters');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (err) {
    return { announce_channel_id: null, narration_style: 'dramatic but concise' };
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ============================================
// BUTTON BUILDERS
// ============================================

function createQuestListButtons(quests) {
  if (quests.length === 0) return [];
  
  const rows = [];
  
  // Create buttons for each quest (max 5 per row, max 5 rows)
  for (let i = 0; i < Math.min(quests.length, 5); i++) {
    const quest = quests[i];
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`quest_start_${quest.id}`)
        .setLabel('▶️ Start')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`quest_info_${quest.id}`)
        .setLabel('ℹ️ Info')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`quest_remove_${quest.id}`)
        .setLabel('🗑️')
        .setStyle(ButtonStyle.Danger)
    );
    rows.push(row);
  }
  
  return rows;
}

function createAvailableQuestButtons(quests) {
  if (quests.length === 0) return [];
  
  const rows = [];
  
  // Discord allows max 5 action rows, each can hold up to 5 buttons
  // Pack multiple quest buttons per row to fit more quests
  let currentRow = new ActionRowBuilder();
  let buttonsInRow = 0;
  
  for (let i = 0; i < quests.length; i++) {
    const quest = quests[i];
    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`quest_track_${quest.id}`)
        .setLabel(`📜 ${quest.name.substring(0, 25)}`)
        .setStyle(ButtonStyle.Primary)
    );
    buttonsInRow++;
    
    if (buttonsInRow === 5 || i === quests.length - 1) {
      rows.push(currentRow);
      if (rows.length >= 5) break; // Discord max 5 rows
      currentRow = new ActionRowBuilder();
      buttonsInRow = 0;
    }
  }
  
  return rows;
}

function createGameplayButtons() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('gp_scene')
      .setLabel('👁️ Look Around')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('gp_listen')
      .setLabel('👂 Listen')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('gp_search')
      .setLabel('🔍 Search')
      .setStyle(ButtonStyle.Primary)
  );
  
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('gp_forward')
      .setLabel('🚶 Move Forward')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('gp_back')
      .setLabel('🔙 Go Back')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('gp_advance')
      .setLabel('⏭️ Advance Stage')
      .setStyle(ButtonStyle.Success)
  );
  
  return [row1, row2];
}

function createStageButtons(questDefinition, stageName) {
  if (!questDefinition.stages || !questDefinition.stages[stageName]) {
    console.log('[QuestMaster] No stage found:', stageName);
    return createGameplayButtons(); // Fallback to generic buttons
  }
  
  const stage = questDefinition.stages[stageName];
  const actions = stage.actions || [];
  
  if (actions.length === 0) {
    return createGameplayButtons(); // Fallback if no actions defined
  }
  
  const rows = [];
  let currentRow = [];
  
  for (const action of actions) {
    const style = action.advances 
      ? (action.completes_quest ? ButtonStyle.Danger : ButtonStyle.Success)
      : (action.cue_npc ? ButtonStyle.Secondary : ButtonStyle.Primary);
    
    const button = new ButtonBuilder()
      .setCustomId(`stage_action_${action.id}`)
      .setLabel(action.label)
      .setStyle(style);
    
    currentRow.push(button);
    
    // Max 5 buttons per row
    if (currentRow.length >= 5) {
      rows.push(new ActionRowBuilder().addComponents(currentRow));
      currentRow = [];
    }
  }
  
  // Add remaining buttons
  if (currentRow.length > 0) {
    rows.push(new ActionRowBuilder().addComponents(currentRow));
  }
  
  // Add "Say Something" button if there are NPCs present to talk to
  const dialogueNpcs = getStageDialogueNpcs(questDefinition, stageName);
  if (dialogueNpcs.length > 0 && rows.length < 5) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('quest_speak')
        .setLabel('💬 Say Something')
        .setStyle(ButtonStyle.Primary)
    ));
  }
  
  return rows;
}

function findActionInStage(questDefinition, stageName, actionId) {
  if (!questDefinition.stages || !questDefinition.stages[stageName]) {
    return null;
  }
  
  const stage = questDefinition.stages[stageName];
  return stage.actions?.find(a => a.id === actionId) || null;
}

function getStageInfo(questDefinition, stageName) {
  if (!questDefinition.stages || !questDefinition.stages[stageName]) {
    return null;
  }
  return questDefinition.stages[stageName];
}

/**
 * Get NPCs present in a stage (for free-text dialogue).
 * Returns array of NPC names in priority order (stage-level cues first, then action cues).
 */
function getStageDialogueNpcs(questDefinition, stageName) {
  const npcs = [];
  const seen = new Set();
  const stage = questDefinition.stages?.[stageName];
  if (!stage) return npcs;
  
  // Stage-level cue NPCs are the "primary" NPCs for the scene
  if (stage.stage_cue_npc) {
    const name = stage.stage_cue_npc.toLowerCase();
    if (!seen.has(name)) { seen.add(name); npcs.push(name); }
  }
  if (stage.stage_cue_npcs && Array.isArray(stage.stage_cue_npcs)) {
    for (const cue of stage.stage_cue_npcs) {
      const name = cue.npc.toLowerCase();
      if (!seen.has(name)) { seen.add(name); npcs.push(name); }
    }
  }
  
  // Then action-level cue NPCs
  if (stage.actions) {
    for (const action of stage.actions) {
      if (action.cue_npc) {
        const name = action.cue_npc.toLowerCase();
        if (!seen.has(name)) { seen.add(name); npcs.push(name); }
      }
    }
  }
  
  return npcs;
}


// ============================================
// QUEST BOARD (Persistent board with status updates)
// ============================================

function getStatusDisplay(status) {
  switch (status) {
    case 'available': return { emoji: '🟢', text: 'Available', color: 0x2ECC71 };
    case 'in_progress': return { emoji: '🟡', text: 'In Progress', color: 0xF1C40F };
    case 'completed': return { emoji: '✅', text: 'Completed', color: 0x3498DB };
    case 'failed': return { emoji: '❌', text: 'Failed', color: 0xE74C3C };
    default: return { emoji: '🟢', text: 'Available', color: 0x2ECC71 };
  }
}

function buildQuestEmbed(quest, definition) {
  const statusInfo = getStatusDisplay(quest.status);
  
  const embed = new EmbedBuilder()
    .setColor(statusInfo.color)
    .setTitle(quest.name || definition?.name || 'Unknown Quest')
    .setDescription(quest.description || definition?.description || '*No description*');
  
  // Add status
  embed.addFields({ name: 'Status', value: `${statusInfo.emoji} ${statusInfo.text}`, inline: true });
  
  // Add location if available
  if (quest.location) {
    embed.addFields({ name: '📍 Location', value: quest.location, inline: true });
  }
  
  // Add quest giver
  const questGiver = quest.given_by || quest.quest_giver || definition?._source_npc || 'Unknown';
  embed.addFields({ name: '🗣️ From', value: questGiver.charAt(0).toUpperCase() + questGiver.slice(1), inline: true });
  
  return embed;
}

function createQuestButtons(quest) {
  // Show Start button for available or tracked quests
  if (quest.status === 'available' || quest.status === 'tracked') {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`quest_start_${quest.id}`)
        .setLabel('▶️ Start Quest')
        .setStyle(ButtonStyle.Success)
    )];
  }
  // No buttons for other statuses
  return [];
}

async function postQuestToBoard(quest) {
  const config = loadConfig();
  
  if (!config.board_channel_id) {
    return { success: false, reason: 'no_board_configured' };
  }
  
  try {
    const channel = await discord.channels.fetch(config.board_channel_id);
    if (!channel) {
      return { success: false, reason: 'channel_not_found' };
    }
    
    const definition = findQuestDefinition(quest.id);
    const embed = buildQuestEmbed(quest, definition);
    const buttons = createQuestButtons(quest);
    
    const messageData = { embeds: [embed] };
    if (buttons.length > 0) {
      messageData.components = buttons;
    }
    
    const message = await channel.send(messageData);
    
    console.log('[QuestMaster] Quest posted to board:', quest.id, '->', message.id);
    return { success: true, messageId: message.id };
  } catch (err) {
    console.error('[QuestMaster] Failed to post quest to board:', err.message);
    return { success: false, reason: err.message };
  }
}

async function updateQuestOnBoard(quest) {
  const config = loadConfig();
  
  if (!config.board_channel_id || !quest.board_message_id) {
    return { success: false, reason: 'no_message_to_update' };
  }
  
  try {
    const channel = await discord.channels.fetch(config.board_channel_id);
    if (!channel) return { success: false, reason: 'channel_not_found' };
    
    const message = await channel.messages.fetch(quest.board_message_id);
    if (!message) return { success: false, reason: 'message_not_found' };
    
    const definition = findQuestDefinition(quest.id);
    const embed = buildQuestEmbed(quest, definition);
    const buttons = createQuestButtons(quest);
    
    const editData = { embeds: [embed] };
    editData.components = buttons.length > 0 ? buttons : [];
    
    await message.edit(editData);
    
    console.log('[QuestMaster] Quest updated on board:', quest.id);
    return { success: true };
  } catch (err) {
    console.error('[QuestMaster] Failed to update quest on board:', err.message);
    return { success: false, reason: err.message };
  }
}

async function removeQuestFromBoard(quest) {
  const config = loadConfig();
  
  if (!config.board_channel_id || !quest.board_message_id) {
    return { success: false, reason: 'no_message_to_remove' };
  }
  
  try {
    const channel = await discord.channels.fetch(config.board_channel_id);
    if (!channel) return { success: false, reason: 'channel_not_found' };
    
    const message = await channel.messages.fetch(quest.board_message_id);
    if (message) {
      await message.delete();
      console.log('[QuestMaster] Quest removed from board:', quest.id);
    }
    
    return { success: true };
  } catch (err) {
    console.error('[QuestMaster] Failed to remove quest from board:', err.message);
    return { success: false, reason: err.message };
  }
}

async function updateQuestBoard() {
  const config = loadConfig();
  const data = loadPartyQuests();
  
  if (!config.board_channel_id) {
    return { success: false, reason: 'no_board_configured' };
  }
  
  let updated = false;
  for (const quest of data.quests) {
    if (!quest.board_message_id) {
      // New quest - post it
      const result = await postQuestToBoard(quest);
      if (result.success) {
        quest.board_message_id = result.messageId;
        updated = true;
      }
    } else {
      // Existing quest - update it
      await updateQuestOnBoard(quest);
    }
  }
  
  if (updated) {
    savePartyQuests(data);
  }
  
  console.log('[QuestMaster] Quest board updated');
  return { success: true };
}

async function setupQuestBoard(channel) {
  try {
    // Post title message
    const titleMessage = await channel.send('## 📜 QUEST BOARD');
    
    // Save to config
    const config = loadConfig();
    config.board_channel_id = channel.id;
    config.board_title_message_id = titleMessage.id;
    saveConfig(config);
    
    // Post existing quests
    const data = loadPartyQuests();
    for (const quest of data.quests) {
      const result = await postQuestToBoard(quest);
      if (result.success) {
        quest.board_message_id = result.messageId;
      }
    }
    savePartyQuests(data);
    
    console.log('[QuestMaster] Quest board setup complete');
    return { success: true, messageId: titleMessage.id };
  } catch (err) {
    console.error('[QuestMaster] Failed to setup quest board:', err.message);
    return { success: false, reason: err.message };
  }
}

// ============================================
// INITIALIZE CLIENTS
// ============================================

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ============================================
// ERROR HANDLING
// ============================================

process.on('uncaughtException', (error) => {
  console.error('[QuestMaster] Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[QuestMaster] Unhandled Rejection:', reason);
});

// ============================================
// QUEST DATA MANAGEMENT
// ============================================

function loadPartyQuests() {
  try {
    return JSON.parse(fs.readFileSync(QUESTS_PATH, 'utf-8'));
  } catch (err) {
    return { quests: [], completed: [], failed: [] };
  }
}

function savePartyQuests(data) {
  fs.writeFileSync(QUESTS_PATH, JSON.stringify(data, null, 2));
}

/**
 * Resolve a quest image filename to an absolute path.
 * Images live in characters/<npc>/quests/images/<filename>
 * Returns the path if the file exists, otherwise null.
 */
function resolveQuestImage(sourceNpc, imageName) {
  if (!imageName || !sourceNpc) return null;
  const imagePath = path.join(NPC_CHARACTERS_PATH, sourceNpc, 'quests', 'images', imageName);
  if (fs.existsSync(imagePath)) {
    return imagePath;
  }
  console.log(`[QuestMaster] Image not found: ${imagePath}`);
  return null;
}

// ============================================
// WEBHOOK MANAGEMENT (for quest NPC dialogue)
// ============================================

// Per-NPC webhook cache: "channelId:npcName" -> webhook
const npcWebhookCache = new Map();

/**
 * Get or create a dedicated webhook for an NPC in a channel.
 * Each quest NPC gets its own webhook with their name and avatar baked in.
 * This avoids CDN URL expiration issues with per-message avatarURL overrides.
 */
async function getOrCreateNpcWebhook(channel, npcName, questDef) {
  const cacheKey = `${channel.id}:${npcName}`;
  if (npcWebhookCache.has(cacheKey)) {
    return npcWebhookCache.get(cacheKey);
  }
  
  const npcInfo = questDef.key_npcs?.[npcName];
  const displayName = npcInfo?.name || npcName.charAt(0).toUpperCase() + npcName.slice(1);
  const webhookName = `Quest NPC: ${displayName}`;
  
  try {
    // Check for existing webhook for this NPC
    const webhooks = await channel.fetchWebhooks();
    let webhook = webhooks.find(w => w.name === webhookName && w.owner?.id === discord.user.id);
    
    // Load avatar as base64 data URI if available
    let avatarData = null;
    const sourceNpc = questDef._source_npc;
    if (sourceNpc) {
      const imagesDir = path.join(NPC_CHARACTERS_PATH, sourceNpc, 'quests', 'images');
      const candidates = [`${npcName}_avatar.png`, `${npcName}.png`];
      
      for (const filename of candidates) {
        const avatarPath = path.join(imagesDir, filename);
        if (fs.existsSync(avatarPath)) {
          const buffer = fs.readFileSync(avatarPath);
          const ext = filename.endsWith('.png') ? 'png' : 'jpeg';
          avatarData = `data:image/${ext};base64,${buffer.toString('base64')}`;
          break;
        }
      }
    }
    
    if (!webhook) {
      // Create new webhook with name and avatar baked in
      const createOptions = { name: webhookName, reason: `Quest NPC dialogue: ${displayName}` };
      if (avatarData) createOptions.avatar = avatarData;
      
      webhook = await channel.createWebhook(createOptions);
      console.log(`[QuestMaster] Created webhook for ${displayName} in channel ${channel.id}`);
    } else if (avatarData && !webhook.avatar) {
      // Webhook exists but has no avatar — update it
      webhook = await webhook.edit({ avatar: avatarData });
      console.log(`[QuestMaster] Updated avatar for ${displayName} webhook`);
    }
    
    npcWebhookCache.set(cacheKey, webhook);
    return webhook;
  } catch (err) {
    console.error(`[QuestMaster] Failed to get/create NPC webhook for ${npcName}:`, err.message);
    return null;
  }
}

/**
 * Legacy shared webhook getter (for non-NPC webhook uses if any)
 */
async function getOrCreateWebhook(channel) {
  return getOrCreateNpcWebhook(channel, '_shared', { key_npcs: {} });
}

/**
 * Check if cue_npc refers to a quest NPC (defined in key_npcs) rather than a bot character.
 */
function isQuestNpc(npcName, questDef) {
  // If there's a character folder with a bot, it's a bot NPC
  const npcCharDir = path.join(NPC_CHARACTERS_PATH, npcName);
  if (fs.existsSync(npcCharDir)) {
    return false; // Bot NPC — use the cue file system
  }
  // If defined in key_npcs, it's a quest NPC — QM handles dialogue
  return !!(questDef.key_npcs?.[npcName]);
}

/**
 * Wait for an NPC bot to finish processing a cue by watching for the cue file to be deleted.
 * The NPC bot deletes quest_cue.json after it sends its response, so we poll for that.
 * Returns true if NPC responded (file deleted), false if timed out.
 */
function waitForNpcResponse(npcName, maxWaitMs = 30000) {
  const cueFilePath = path.join(NPC_CHARACTERS_PATH, npcName, 'quest_cue.json');
  const pollInterval = 500; // Check every 500ms
  
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    const check = () => {
      // File gone = NPC processed and responded
      if (!fs.existsSync(cueFilePath)) {
        // Small buffer to let Discord deliver the message
        setTimeout(() => resolve(true), 800);
        return;
      }
      
      // Timed out
      if (Date.now() - startTime >= maxWaitMs) {
        console.log(`[QuestMaster] Timed out waiting for ${npcName} to respond (${maxWaitMs}ms)`);
        resolve(false);
        return;
      }
      
      setTimeout(check, pollInterval);
    };
    
    // Start polling after a brief initial delay (give NPC bot time to detect the file)
    setTimeout(check, 300);
  });
}

/**
 * Generate dialogue as a quest NPC using their voice profile from key_npcs.
 */
async function generateQuestNpcDialogue(npcName, questDef, instruction, context) {
  const npcInfo = questDef.key_npcs[npcName];
  if (!npcInfo) return null;
  
  const config = loadConfig();
  
  try {
    const response = await openai.chat.completions.create({
      model: process.env.MODEL || 'gpt-4o-mini',
      max_completion_tokens: 400,
      messages: [
        {
          role: 'system',
          content: `You are ${npcInfo.name}, a character in a D&D quest.

**About you:**
- Race: ${npcInfo.race || 'Unknown'}
- Age: ${npcInfo.age || 'Unknown'}
- Description: ${npcInfo.description || ''}
- Personality: ${npcInfo.personality || ''}

**Rules:**
- Speak in first person AS this character
- Stay in character at all times
- Use *asterisks* for actions and body language
- Keep it SHORT. 2-3 sentences max. This is Discord.
- Don't narrate what other characters do — only speak and act as yourself
- Don't break character or reference game mechanics
- NEVER use @mentions or tag other characters/NPCs — just use their name naturally in dialogue`
        },
        {
          role: 'user',
          content: `Scene context: ${context}\n\nDirection: ${instruction}`
        }
      ]
    });
    
    const content = response.choices[0]?.message?.content;
    return content?.trim() || null;
  } catch (err) {
    console.error(`[QuestMaster] Quest NPC dialogue error for ${npcName}:`, err.message);
    return null;
  }
}

/**
 * Send a message via webhook as a quest NPC.
 * Uses a dedicated per-NPC webhook with name and avatar baked in.
 */
async function sendAsQuestNpc(channel, npcName, questDef, content) {
  const webhook = await getOrCreateNpcWebhook(channel, npcName, questDef);
  if (!webhook) {
    // Fallback: send as QM with name tag
    const npcInfo = questDef.key_npcs?.[npcName];
    await channel.send(`**${npcInfo?.name || npcName}:** ${content}`);
    return;
  }
  
  try {
    // Name and avatar are baked into the webhook itself — just send content
    await webhook.send({ content });
  } catch (err) {
    console.error(`[QuestMaster] Webhook send failed for ${npcName}:`, err.message);
    const npcInfo = questDef.key_npcs?.[npcName];
    await channel.send(`**${npcInfo?.name || npcName}:** ${content}`);
  }
}

/**
 * Collect all NPC names that will be cued for a stage (for dialog exclusion from narration).
 */
function getStageCueNpcNames(stageInfo) {
  const names = [];
  if (!stageInfo) return names;
  if (stageInfo.stage_cue_npc) names.push(stageInfo.stage_cue_npc.toLowerCase());
  if (stageInfo.stage_cue_npcs && Array.isArray(stageInfo.stage_cue_npcs)) {
    for (const cue of stageInfo.stage_cue_npcs) {
      const name = cue.npc.toLowerCase();
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

/**
 * Collect all NPC names that will be cued for an action (for dialog exclusion from narration).
 */
function getActionCueNpcNames(actionDef) {
  const names = [];
  if (!actionDef) return names;
  if (actionDef.cue_npc) names.push(actionDef.cue_npc.toLowerCase());
  if (actionDef.cue_npcs && Array.isArray(actionDef.cue_npcs)) {
    for (const cue of actionDef.cue_npcs) {
      const name = (typeof cue === 'string' ? cue : cue.npc).toLowerCase();
      if (!names.includes(name)) names.push(name);
    }
  }
  // Also support stage_cue_npcs at action level (multi-NPC cues)
  if (actionDef.stage_cue_npcs && Array.isArray(actionDef.stage_cue_npcs)) {
    for (const cue of actionDef.stage_cue_npcs) {
      const name = cue.npc.toLowerCase();
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

/**
 * Check if a stage has any NPC cues defined.
 */
function stageHasCues(stageInfo) {
  if (!stageInfo) return false;
  if (stageInfo.stage_cue_npc) return true;
  if (stageInfo.stage_cue_npcs && Array.isArray(stageInfo.stage_cue_npcs) && stageInfo.stage_cue_npcs.length > 0) return true;
  return false;
}

/**
 * Handle stage-level NPC cues (stage_cue_npc / stage_cue_npcs).
 * Called after a stage narration is sent. Fires NPC dialogue via webhook or cue file.
 * If postComponents is provided, sends buttons AFTER all NPC cues finish.
 */
async function handleStageCues(channel, stageInfo, questDef, stageName, postComponents) {
  if (!stageInfo) {
    // No stage info but we still need to send buttons if provided
    if (postComponents && postComponents.length > 0) {
      await channel.send({ content: '*What do you do next?*', components: postComponents });
    }
    return;
  }
  
  const cues = [];
  
  // Single NPC cue
  if (stageInfo.stage_cue_npc) {
    cues.push({
      npc: stageInfo.stage_cue_npc.toLowerCase(),
      instruction: stageInfo.stage_npc_instruction || 'Respond in character.'
    });
  }
  
  // Multiple NPC cues (in order)
  if (stageInfo.stage_cue_npcs && Array.isArray(stageInfo.stage_cue_npcs)) {
    for (const cue of stageInfo.stage_cue_npcs) {
      cues.push({
        npc: cue.npc.toLowerCase(),
        instruction: cue.instruction || 'Respond in character.'
      });
    }
  }
  
  for (const cue of cues) {
    const context = `Quest: ${questDef.name}. Stage: ${stageInfo.description || stageName}. ${questDef.description}`;
    
    if (isQuestNpc(cue.npc, questDef)) {
      // Quest NPC — generate dialogue and send via webhook
      const dialogue = await generateQuestNpcDialogue(cue.npc, questDef, cue.instruction, context);
      if (dialogue) {
        await sendAsQuestNpc(channel, cue.npc, questDef, dialogue);
      }
    } else {
      // Bot NPC — write cue file for the bot to pick up, then wait for response
      const cueFilePath = path.join(NPC_CHARACTERS_PATH, cue.npc, 'quest_cue.json');
      try {
        const cueData = {
          channel_id: channel.id,
          quest_id: questDef.id,
          instruction: cue.instruction,
          timestamp: Date.now()
        };
        fs.writeFileSync(cueFilePath, JSON.stringify(cueData, null, 2));
        console.log(`[QuestMaster] Wrote stage cue file for ${cue.npc}`);
        // Wait for bot NPC to respond before continuing
        await waitForNpcResponse(cue.npc);
      } catch (err) {
        console.error(`[QuestMaster] Failed to write stage cue for ${cue.npc}:`, err.message);
      }
    }
  }
  
  // Send buttons AFTER all NPC cues have been processed
  if (postComponents && postComponents.length > 0) {
    await channel.send({ content: '*What do you do next?*', components: postComponents });
  }
}

function findQuestDefinition(questId) {
  // Search all NPC character folders for this quest
  const characters = fs.readdirSync(NPC_CHARACTERS_PATH);
  
  for (const char of characters) {
    const questPath = path.join(NPC_CHARACTERS_PATH, char, 'quests', `${questId}.json`);
    if (fs.existsSync(questPath)) {
      try {
        const quest = JSON.parse(fs.readFileSync(questPath, 'utf-8'));
        quest._source_npc = char;
        return quest;
      } catch (err) {
        continue;
      }
    }
  }
  return null;
}

function listAvailableQuests() {
  const quests = [];
  const characters = fs.readdirSync(NPC_CHARACTERS_PATH);
  
  for (const char of characters) {
    const questsDir = path.join(NPC_CHARACTERS_PATH, char, 'quests');
    if (fs.existsSync(questsDir)) {
      const files = fs.readdirSync(questsDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const quest = JSON.parse(fs.readFileSync(path.join(questsDir, file), 'utf-8'));
          quests.push({
            id: quest.id,
            name: quest.name,
            npc: char,
            description: quest.description
          });
        } catch (err) {
          continue;
        }
      }
    }
  }
  return quests;
}

// ============================================
// NARRATION
// ============================================

async function generateNarration(context, instruction, npcNames = [], negativePrompts = []) {
  const config = loadConfig();
  
  console.log('[QuestMaster] Generating scene narration...');
  
  // Build NPC dialog exclusion rule if NPCs are present
  let npcDialogRule = '';
  if (npcNames.length > 0) {
    const names = npcNames.map(n => n.charAt(0).toUpperCase() + n.slice(1)).join(', ');
    npcDialogRule = `\n- DO NOT include any dialog from NPCs (${names}). They will speak for themselves after your narration. Only describe the scene, atmosphere, and what the player character sees and does. You may describe an NPC's body language or presence but NEVER write their spoken words.`;
  }
  
  try {
    const response = await openai.chat.completions.create({
      model: process.env.MODEL || 'gpt-4o-mini',
      max_completion_tokens: 800,
      messages: [
        {
          role: 'system',
          content: `You are a Quest Master narrating a D&D adventure in Discord.

Style: ${config.narration_style}

You will receive a narration prompt — this is the CORE CONTENT of the scene. Your job is to bring it to life.

Rules:
- Narrate in second person ("You walk into the forest...")
- Set atmosphere and describe surroundings
- Don't make decisions for the players
- NEVER end with a question like "What will you do?" or "What do you do next?" — just describe the scene and stop. The player knows they can act.
- Use *asterisks* for emphasis on key details
- Don't use quotation marks around your narration (except for the player character's own words)
- NEVER ask players to roll dice or make skill checks - there is no dice rolling in this game
- NEVER reference meta-game terms like "path A", "path B", "branch point", or any behind-the-scenes quest structure. Narrate purely in-world.
- If the prompt is already rich and detailed, deliver it nearly verbatim with light atmospheric polish — BUT strip out any quoted NPC dialogue. NPC dialogue in the prompt is reference material only; those NPCs will speak for themselves separately.${npcDialogRule}${negativePrompts.length > 0 ? `\n\nRESTRICTIONS — Do NOT do any of the following:\n${negativePrompts.map(p => `- ${p}`).join('\n')}` : ''}

THIS IS DISCORD. Keep it short. 3-5 sentences max for scene narration. No flowery padding.`
        },
        {
          role: 'user',
          content: `Context: ${context}\n\nNarration prompt:\n${instruction}\n\nBring this scene to life:`
        }
      ]
    });
    
    const content = response.choices[0]?.message?.content;
    console.log('[QuestMaster] Scene narration received, length:', content?.length || 0);
    
    // Debug: log full response structure if content is empty
    if (!content || content.trim().length === 0) {
      console.error('[QuestMaster] Empty scene narration from OpenAI');
      console.error('[QuestMaster] Full response:', JSON.stringify(response, null, 2));
      return '*The scene unfolds before you...* (The Quest Master is preparing the next passage)';
    }
    
    return content.trim();
  } catch (err) {
    console.error('[QuestMaster] Narration error:', err.message);
    console.error('[QuestMaster] Full error:', err);
    return '*The Quest Master fumbles with their notes...* (Error generating narration)';
  }
}

async function narrateAction(questContext, playerAction, npcNames = []) {
  const config = loadConfig();
  
  console.log('[QuestMaster] Generating narration for action:', playerAction?.substring(0, 50));
  
  // Build NPC dialog exclusion rule if NPCs are present
  let npcDialogRule = '';
  if (npcNames.length > 0) {
    const names = npcNames.map(n => n.charAt(0).toUpperCase() + n.slice(1)).join(', ');
    npcDialogRule = `\n- DO NOT include any dialog from NPCs (${names}). They will speak for themselves after your narration. Only describe the scene, atmosphere, and what the player character sees and does. You may describe an NPC's body language or presence but NEVER write their spoken words.`;
  }
  
  try {
    const response = await openai.chat.completions.create({
      model: process.env.MODEL || 'gpt-4o-mini',
      max_completion_tokens: 600,
      messages: [
        {
          role: 'system',
          content: `You are a Quest Master narrating a D&D adventure.

Style: ${config.narration_style}

You will receive a narration prompt — this is the CORE CONTENT of the scene. Your job is to bring it to life.

Rules:
- You may add sensory details, atmosphere, and brief descriptive touches
- NEVER ask players to roll dice or make skill checks
- NEVER reference meta-game terms like "path A", "path B", or behind-the-scenes quest structure${npcDialogRule}

THIS IS DISCORD. Keep it punchy. 2-3 sentences of atmosphere max. No walls of text.`
        },
        {
          role: 'user',
          content: `Quest context: ${questContext}\n\nNarration prompt:\n${playerAction}\n\nBring this scene to life:`
        }
      ]
    });
    
    const content = response.choices[0]?.message?.content;
    console.log('[QuestMaster] OpenAI response received, length:', content?.length || 0);
    
    // Debug: log full response structure if content is empty
    if (!content || content.trim().length === 0) {
      console.error('[QuestMaster] Empty response from OpenAI');
      console.error('[QuestMaster] Full response:', JSON.stringify(response, null, 2));
      return '*You attempt this action...* (The Quest Master is gathering their thoughts)';
    }
    
    return content.trim();
  } catch (err) {
    console.error('[QuestMaster] Action narration error:', err.message);
    console.error('[QuestMaster] Full error:', err);
    return '*The Quest Master pauses...* (Error processing action)';
  }
}

// ============================================
// QUEST TRACKING
// ============================================

async function trackQuest(questId) {
  const definition = findQuestDefinition(questId);
  if (!definition) {
    return { success: false, message: `Quest '${questId}' not found` };
  }
  
  const data = loadPartyQuests();
  
  // Check if already tracked
  if (data.quests.find(q => q.id === questId)) {
    return { success: false, message: `Quest '${questId}' is already being tracked` };
  }
  
  const quest = {
    id: questId,
    name: definition.name,
    description: definition.description,
    location: definition.location || null,
    given_by: definition._source_npc,
    status: 'available',
    current_stage: null,
    stages_completed: [],
    started_at: null,
    added_at: new Date().toISOString(),
    notes: [],
    board_message_id: null
  };
  
  data.quests.push(quest);
  
  // Auto-post to board if configured
  const config = loadConfig();
  if (config.board_channel_id) {
    const result = await postQuestToBoard(quest);
    if (result.success) {
      quest.board_message_id = result.messageId;
    }
  }
  
  savePartyQuests(data);
  
  return { success: true, quest };
}

async function startQuest(questId) {
  const data = loadPartyQuests();
  const quest = data.quests.find(q => q.id === questId);
  
  if (!quest) {
    return { success: false, message: `Quest '${questId}' not found. Use !qm add ${questId} first.` };
  }
  
  const definition = findQuestDefinition(questId);
  if (!definition) {
    return { success: false, message: `Quest definition not found` };
  }
  
  quest.status = 'in_progress';
  quest.current_stage = 'started';
  quest.started_at = new Date().toISOString();
  savePartyQuests(data);
  
  // Update board to show new status
  if (quest.board_message_id) {
    await updateQuestOnBoard(quest);
  }
  
  return { success: true, quest, definition };
}

function advanceQuest(questId, stageName = null) {
  const data = loadPartyQuests();
  const quest = data.quests.find(q => q.id === questId);
  
  if (!quest) {
    return { success: false, message: `Quest '${questId}' not found` };
  }
  
  if (quest.current_stage) {
    quest.stages_completed.push(quest.current_stage);
  }
  quest.current_stage = stageName || `stage_${quest.stages_completed.length + 1}`;
  savePartyQuests(data);
  
  return { success: true, quest };
}

function addQuestNote(questId, note) {
  const data = loadPartyQuests();
  const quest = data.quests.find(q => q.id === questId);
  
  if (!quest) {
    return { success: false, message: `Quest '${questId}' not found` };
  }
  
  quest.notes.push({
    text: note,
    timestamp: new Date().toISOString()
  });
  savePartyQuests(data);
  
  return { success: true };
}

async function completeQuest(questId) {
  const data = loadPartyQuests();
  const quest = data.quests.find(q => q.id === questId);

  if (!quest) {
    return { success: false, message: `Quest '${questId}' not found` };
  }

  quest.status = 'completed';
  quest.completed_at = new Date().toISOString();
  savePartyQuests(data);

  // Update board to show completed status
  if (quest.board_message_id) {
    await updateQuestOnBoard(quest);
  }

  // Award gold to quest participants via currency signal
  await writeCurrencyRewardSignal(quest);

  return { success: true, quest };
}

async function writeCurrencyRewardSignal(quest) {
  try {
    // Read reward_gold from quest definition (default 100)
    const definition = findQuestDefinition(quest.id);
    const rewardGold = definition?.reward_gold || 100;

    // Find participants from quest channel messages
    const recipients = [];
    if (quest.channel_id) {
      try {
        const channel = await discord.channels.fetch(quest.channel_id);
        if (channel) {
          const messages = await channel.messages.fetch({ limit: 100 });
          const seen = new Set();
          messages.forEach(msg => {
            if (!msg.author.bot && !seen.has(msg.author.id)) {
              seen.add(msg.author.id);
              recipients.push({
                user_id: msg.author.id,
                username: msg.member?.displayName || msg.author.username
              });
            }
          });
        }
      } catch (err) {
        console.error('[QuestMaster] Failed to fetch quest channel messages:', err.message);
      }
    }

    if (recipients.length === 0) {
      console.log('[QuestMaster] No participants found for currency reward, skipping signal');
      return;
    }

    const signalData = {
      type: 'quest_reward',
      quest_id: quest.id,
      quest_name: quest.name,
      reward_amount: rewardGold,
      recipients,
      timestamp: Date.now()
    };

    const CURRENCY_SIGNALS_DIR = path.join(__dirname, '..', 'economy', 'currency_signals');
    if (!fs.existsSync(CURRENCY_SIGNALS_DIR)) {
      fs.mkdirSync(CURRENCY_SIGNALS_DIR, { recursive: true });
    }

    const filename = `reward_${quest.id}_${Date.now()}`;
    const signalPath = path.join(CURRENCY_SIGNALS_DIR, `${filename}.json`);
    const tempPath = path.join(CURRENCY_SIGNALS_DIR, `${filename}.tmp`);
    fs.writeFileSync(tempPath, JSON.stringify(signalData, null, 2));
    fs.renameSync(tempPath, signalPath);

    console.log(`[QuestMaster] Currency reward signal written: ${rewardGold}G to ${recipients.length} player(s) for ${quest.id}`);
  } catch (err) {
    console.error('[QuestMaster] Failed to write currency reward signal:', err.message);
  }
}

async function failQuest(questId) {
  const data = loadPartyQuests();
  const quest = data.quests.find(q => q.id === questId);
  
  if (!quest) {
    return { success: false, message: `Quest '${questId}' not found` };
  }
  
  quest.status = 'failed';
  quest.failed_at = new Date().toISOString();
  savePartyQuests(data);
  
  // Update board to show failed status
  if (quest.board_message_id) {
    await updateQuestOnBoard(quest);
  }
  
  return { success: true, quest };
}

async function removeQuest(questId) {
  const data = loadPartyQuests();
  const index = data.quests.findIndex(q => q.id === questId);
  
  if (index === -1) {
    return { success: false, message: `Quest '${questId}' not found` };
  }
  
  const quest = data.quests[index];
  
  // Remove from board if present
  if (quest.board_message_id) {
    await removeQuestFromBoard(quest);
  }
  
  data.quests.splice(index, 1);
  savePartyQuests(data);
  
  return { success: true };
}

// ============================================
// QUEST SIGNAL WATCHER (NPC → Quest Master)
// ============================================

const QUEST_SIGNALS_DIR = path.join(__dirname, 'quest_signals');

async function processQuestSignal(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const signal = JSON.parse(raw);

    // Validate timestamp (ignore if older than 60 seconds)
    const age = Date.now() - signal.timestamp;
    if (age > 60000) {
      console.log(`[QuestMaster] Ignoring stale quest signal (${Math.round(age / 1000)}s old):`, signal.quest_id);
      fs.unlinkSync(filePath);
      return;
    }

    const signalType = signal.type || 'quest_given';
    console.log(`[QuestMaster] Processing ${signalType} signal: ${signal.quest_id} from ${signal.npc}`);

    if (signalType === 'dialog_started') {
      await handleDialogStartedSignal(signal);
    } else {
      await handleQuestGivenSignal(signal);
    }

    // Delete signal file after processing (may already be gone from watcher double-fire)
    try { fs.unlinkSync(filePath); } catch (e) {}
    console.log(`[QuestMaster] Signal processed: ${signalType} / ${signal.quest_id}`);
  } catch (err) {
    console.error('[QuestMaster] Error processing quest signal:', err.message);
    try { fs.unlinkSync(filePath); } catch (e) {}
  }
}

async function handleDialogStartedSignal(signal) {
  if (!signal.channel_id) return;

  try {
    const channel = await discord.channels.fetch(signal.channel_id);
    if (channel) {
      const npcName = signal.npc.charAt(0).toUpperCase() + signal.npc.slice(1);
      await channel.send(`📜 *${npcName} seems to have something on their mind...*`);
      console.log(`[QuestMaster] Dialog started announcement sent for: ${signal.quest_id}`);
    }
  } catch (err) {
    console.error('[QuestMaster] Failed to send dialog started announcement:', err.message);
  }
}

async function handleQuestGivenSignal(signal) {
  // Track the quest (adds to party quests + posts to board)
  const result = await trackQuest(signal.quest_id);
  if (!result.success) {
    console.log(`[QuestMaster] Quest already tracked: ${result.message}`);
  }

  // Always announce in the channel where the conversation happened
  const definition = findQuestDefinition(signal.quest_id);
  const config = loadConfig();
  if (signal.channel_id && definition) {
    try {
      const channel = await discord.channels.fetch(signal.channel_id);
      if (channel) {
        const npcName = signal.npc.charAt(0).toUpperCase() + signal.npc.slice(1);
        const boardRef = config.board_channel_id ? `\n\nCheck the quest board: <#${config.board_channel_id}>` : '';
        await channel.send(
          `📜 **New Quest Acquired!** *${definition.name}*\n*${definition.description}*\nFrom: **${npcName}**${boardRef}`
        );
        console.log(`[QuestMaster] Quest announcement sent for: ${signal.quest_id}`);
      }
    } catch (err) {
      console.error('[QuestMaster] Failed to send quest announcement:', err.message);
    }
  }
}

function startQuestSignalWatcher() {
  // Ensure signals directory exists
  if (!fs.existsSync(QUEST_SIGNALS_DIR)) {
    fs.mkdirSync(QUEST_SIGNALS_DIR, { recursive: true });
  }

  // Process any existing signal files on startup
  const existing = fs.readdirSync(QUEST_SIGNALS_DIR).filter(f => f.endsWith('.json'));
  for (const file of existing) {
    processQuestSignal(path.join(QUEST_SIGNALS_DIR, file));
  }

  // Watch for new signal files
  try {
    fs.watch(QUEST_SIGNALS_DIR, (eventType, filename) => {
      if (filename && filename.endsWith('.json') && eventType === 'rename') {
        const filePath = path.join(QUEST_SIGNALS_DIR, filename);
        // Small delay to ensure file is fully written
        setTimeout(() => {
          if (fs.existsSync(filePath)) {
            processQuestSignal(filePath);
          }
        }, 100);
      }
    });
    console.log('[QuestMaster] Quest signal watcher active on', QUEST_SIGNALS_DIR);
  } catch (err) {
    console.error('[QuestMaster] Failed to start signal watcher:', err.message);
    // Fallback to polling
    console.log('[QuestMaster] Falling back to polling for quest signals');
    setInterval(() => {
      try {
        const files = fs.readdirSync(QUEST_SIGNALS_DIR).filter(f => f.endsWith('.json'));
        for (const file of files) {
          processQuestSignal(path.join(QUEST_SIGNALS_DIR, file));
        }
      } catch (e) {}
    }, 2000);
  }
}

// ============================================
// ACTIVE QUEST STATE
// ============================================

let activeQuest = null;  // Currently running quest for narration

// Restore active quest from channel (for when bot restarts)
function getActiveQuestForChannel(channelId) {
  const data = loadPartyQuests();
  console.log('[QuestMaster] Looking for quest in channel:', channelId);
  console.log('[QuestMaster] Available quests:', data.quests.map(q => ({ id: q.id, channel_id: q.channel_id, status: q.status })));
  
  const quest = data.quests.find(q => q.channel_id === channelId && q.status === 'in_progress');
  
  if (!quest) {
    console.log('[QuestMaster] No in_progress quest found for channel');
    return null;
  }
  
  console.log('[QuestMaster] Found quest:', quest.id);
  const definition = findQuestDefinition(quest.id);
  if (!definition) {
    console.log('[QuestMaster] Quest definition not found for:', quest.id);
    return null;
  }
  
  return {
    id: quest.id,
    definition: definition,
    quest: quest,
    channelId: channelId
  };
}

// ============================================
// DISCORD EVENTS
// ============================================

discord.once('ready', async () => {
  console.log('[QuestMaster] Logged in as', discord.user.tag);

  // Start watching for quest signals from NPC bots
  console.log('[QuestMaster] Starting quest signal watcher');
  startQuestSignalWatcher();

  // Restore chat mode sessions for in-progress chat_mode quests
  try {
    const data = loadPartyQuests();
    const inProgressQuests = data.quests.filter(q => q.status === 'in_progress' && q.channel_id);
    
    for (const quest of inProgressQuests) {
      const definition = findQuestDefinition(quest.id);
      if (definition && definition.chat_mode === true) {
        chatMode.startChatMode(quest.channel_id, quest.id, definition, quest);
        console.log(`[QuestMaster] Restored chat mode session for quest ${quest.id} in channel ${quest.channel_id}`);
      }
    }
  } catch (err) {
    console.error('[QuestMaster] Error restoring chat mode sessions:', err.message);
  }

  console.log('[QuestMaster] Quest Manager is ready!');
});

// ============================================
// BUTTON/SELECT INTERACTION HANDLER
// ============================================

discord.on('interactionCreate', async (interaction) => {
  console.log('[QuestMaster] Interaction received:', interaction.type, interaction.isButton() ? interaction.customId : '(not a button)');
  
  try {
    // Handle modal submissions (free-text NPC dialogue)
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'quest_speak_modal') {
        const playerText = interaction.fields.getTextInputValue('quest_speak_text');
        
        await interaction.deferReply();
        
        let currentQuest = activeQuest;
        if (!currentQuest || currentQuest.channelId !== interaction.channelId) {
          currentQuest = getActiveQuestForChannel(interaction.channelId);
          if (currentQuest) activeQuest = currentQuest;
        }
        
        if (!currentQuest) {
          await interaction.editReply({ content: '*No quest is active.*' });
          return;
        }
        
        // Refresh definition from disk
        const freshDef = findQuestDefinition(currentQuest.id);
        if (freshDef) currentQuest.definition = freshDef;
        
        const stageName = currentQuest.quest.current_stage;
        const stageInfo = getStageInfo(currentQuest.definition, stageName);
        const npcs = getStageDialogueNpcs(currentQuest.definition, stageName);
        
        if (npcs.length === 0) {
          await interaction.editReply({ content: '*No one is around to hear you...*' });
          return;
        }
        
        // Show what the player said
        await interaction.editReply({ content: `🗣️ *You say:* "${playerText}"` });
        
        // Show typing indicator
        await interaction.channel.sendTyping();
        
        const primaryNpc = npcs[0];
        const context = `Quest: ${currentQuest.definition.name}. Stage: ${stageInfo?.description || stageName}. ${currentQuest.definition.description}`;
        const instruction = `The player (Grand Master Nalyd) just said to you: "${playerText}". Respond naturally in character to what they said. Stay true to the current scene and your emotional state.`;
        
        if (isQuestNpc(primaryNpc, currentQuest.definition)) {
          // Quest NPC (key_npcs) — generate dialogue via OpenAI + webhook
          const dialogue = await generateQuestNpcDialogue(primaryNpc, currentQuest.definition, instruction, context);
          if (dialogue) {
            await sendAsQuestNpc(interaction.channel, primaryNpc, currentQuest.definition, dialogue);
          } else {
            await interaction.channel.send(`*${primaryNpc} remains silent...*`);
          }
          
          // Re-send stage buttons
          const components = createStageButtons(currentQuest.definition, stageName);
          if (components.length > 0) {
            await interaction.channel.send({ content: '*What do you do next?*', components });
          }
        } else {
          // Bot NPC — write cue file with player's dialogue
          const npcCharDir = path.join(NPC_CHARACTERS_PATH, primaryNpc);
          if (fs.existsSync(npcCharDir)) {
            const cueData = {
              channel_id: interaction.channel.id,
              instruction: instruction,
              context: stageInfo?.description || stageName,
              timestamp: Date.now()
            };
            const cueFilePath = path.join(npcCharDir, 'quest_cue.json');
            const tempFilePath = path.join(npcCharDir, 'quest_cue.tmp');
            fs.writeFileSync(tempFilePath, JSON.stringify(cueData, null, 2));
            fs.renameSync(tempFilePath, cueFilePath);
            console.log(`[QuestMaster] Wrote free-text cue for bot NPC ${primaryNpc}`);
            
            // Wait for bot to respond, then re-send buttons
            waitForNpcResponse(primaryNpc).then(async () => {
              try {
                const components = createStageButtons(currentQuest.definition, stageName);
                if (components.length > 0) {
                  await interaction.channel.send({ content: '*What do you do next?*', components });
                }
              } catch (e) {
                console.error(`[QuestMaster] Failed to re-send buttons after free-text cue:`, e.message);
              }
            });
          } else {
            await interaction.channel.send(`*(NPC '${primaryNpc}' not available)*`);
          }
        }
        
        return;
      }
    }
    
    // Handle button clicks
    if (interaction.isButton()) {
      const parts = interaction.customId.split('_');
      const action = parts[0];
      const type = parts[1];
      const questId = parts.slice(2).join('_'); // Rejoin in case quest ID has underscores
      console.log('[QuestMaster] Button parsed:', { action, type, questId });
      
      // Quest management buttons
      if (action === 'quest') {
        if (type === 'start') {
          // Defer reply since channel creation + narration takes time
          // Not ephemeral so everyone can see the channel link
          await interaction.deferReply();
          
          const result = await startQuest(questId);
          if (!result.success) {
            await interaction.editReply({ content: result.message });
            return;
          }
          
          const config = loadConfig();
          
          // Create a new channel for this quest under the side-quests category
          let questChannel;
          try {
            const guild = interaction.guild;
            const channelName = result.definition.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 90);
            questChannel = await guild.channels.create({
              name: channelName,
              type: 0, // Text channel
              parent: config.quest_category_id,
              topic: `Quest: ${result.definition.name} | From: ${result.definition._source_npc}`
            });
            
            // Save channel ID to quest data
            const data = loadPartyQuests();
            const quest = data.quests.find(q => q.id === questId);
            if (quest) {
              quest.channel_id = questChannel.id;
              savePartyQuests(data);
            }
          } catch (err) {
            console.error('[QuestMaster] Failed to create quest channel:', err.message);
            await interaction.editReply({ content: `Failed to create quest channel: ${err.message}` });
            return;
          }
          
          // Determine initial stage
          let initialStage = 'started';
          if (result.definition.stages) {
            const stageNames = Object.keys(result.definition.stages);
            if (stageNames.length > 0) {
              initialStage = stageNames[0]; // Use first defined stage
            }
          }
          
          // Update quest with initial stage
          const data = loadPartyQuests();
          const questData = data.quests.find(q => q.id === questId);
          if (questData) {
            questData.current_stage = initialStage;
            savePartyQuests(data);
            result.quest.current_stage = initialStage;
          }
          
          activeQuest = {
            id: questId,
            definition: result.definition,
            quest: result.quest,
            channelId: questChannel.id
          };
          
          // Check if this quest uses chat mode (no buttons, free-form chat)
          const isChatMode = result.definition.chat_mode === true;
          if (isChatMode) {
            chatMode.startChatMode(questChannel.id, questId, result.definition, result.quest);
            console.log(`[QuestMaster] Started chat mode for quest ${questId}`);
          }
          
          // Generate narration - use stage prompt if available
          // Show typing indicator while generating
          await questChannel.sendTyping();
          
          let narration;
          const stageInfo = getStageInfo(result.definition, initialStage);
          const stageNpcNames = getStageCueNpcNames(stageInfo);
          if (stageInfo?.narration_prompt) {
            narration = await generateNarration(
              `Quest: ${result.definition.name}. ${result.definition.description}. Given by: ${result.definition._source_npc}.`,
              stageInfo.narration_prompt,
              stageNpcNames,
              stageInfo.negative_prompts
            );
          } else {
            narration = await generateNarration(
              `Quest: ${result.definition.name}. ${result.definition.description}. Given by: ${result.definition._source_npc}.`,
              'Set the scene for the beginning of this quest. The adventurers are about to embark.',
              stageNpcNames
            );
          }
          
          // Get stage-specific buttons if available (skip if chat mode)
          let components = [];
          if (!isChatMode) {
            if (result.definition.stages && result.definition.stages[initialStage]) {
              components = createStageButtons(result.definition, initialStage);
            } else {
              components = [...createGameplayButtons()];
            }
          }
          
          // Post narration in the new quest channel
          // If stage has NPC cues, send narration WITHOUT buttons, then buttons come after NPC dialogue
          const hasCues = stageHasCues(stageInfo);
          const startMsg = {
            content: `📖 **${result.definition.name}** begins...\n\n📍 **${initialStage.charAt(0).toUpperCase() + initialStage.slice(1)}**\n\n${narration}${isChatMode ? '\n\n*Type your actions and dialogue freely.*' : ''}`,
            components: (hasCues || isChatMode) ? [] : components
          };
          const startImage = resolveQuestImage(result.definition._source_npc, stageInfo?.image);
          if (startImage) startMsg.files = [startImage];
          await questChannel.send(startMsg);
          
          // Handle stage-level NPC cues for the initial stage, send buttons after (skip buttons if chat mode)
          if (stageInfo) {
            await handleStageCues(questChannel, stageInfo, result.definition, initialStage, (hasCues && !isChatMode) ? components : null);
          }
          
          // Reply to interaction with link to the new channel, with replay button
          const replayRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`quest_replay_${questId}`)
              .setLabel('🔄 Replay Quest')
              .setStyle(ButtonStyle.Secondary)
          );
          await interaction.editReply({
            content: `🎮 Quest started! Head to <#${questChannel.id}> to play.`,
            components: [replayRow]
          });
          return;
        }
        
        if (type === 'info') {
          const definition = findQuestDefinition(questId);
          const data = loadPartyQuests();
          const tracked = data.quests.find(q => q.id === questId);
          
          if (!definition) {
            await interaction.reply({ content: `Quest '${questId}' not found.`, ephemeral: true });
            return;
          }
          
          let info = `📜 **${definition.name}**\n*${definition.description}*\n\nFrom: ${definition._source_npc}`;
          if (tracked) {
            info += `\nStatus: ${tracked.status}\nStage: ${tracked.current_stage || 'not started'}`;
          }
          
          await interaction.reply({ content: info, ephemeral: true });
          return;
        }
        
        if (type === 'remove') {
          const result = await removeQuest(questId);
          if (result.success) {
            if (activeQuest?.id === questId) activeQuest = null;
            await interaction.reply({ content: `🗑️ Quest removed.`, ephemeral: true });
          } else {
            await interaction.reply({ content: result.message, ephemeral: true });
          }
          return;
        }
        
        if (type === 'track') {
          const result = await trackQuest(questId);
          if (result.success) {
            await interaction.reply({
              content: `📜 **Quest Tracked:** ${result.quest.name}\n*${result.quest.description}*\n\nThe quest has been added to the quest board!`,
              ephemeral: true
            });
          } else {
            await interaction.reply({ content: result.message, ephemeral: true });
          }
          return;
        }
        
        if (type === 'replay') {
          // Reset quest back to tracked/available so it reappears on the board
          const data = loadPartyQuests();
          const quest = data.quests.find(q => q.id === questId);
          
          if (!quest) {
            await interaction.reply({ content: `Quest '${questId}' not found in tracker.`, ephemeral: true });
            return;
          }
          
          // Reset quest state
          quest.status = 'available';
          quest.current_stage = null;
          quest.stages_completed = [];
          quest.started_at = null;
          quest.channel_id = null;
          if (quest.flags) quest.flags = [];
          savePartyQuests(data);
          
          // Update board to show available status with Start button
          if (quest.board_message_id) {
            await updateQuestOnBoard(quest);
          }
          
          // Clear active quest if this was it
          if (activeQuest?.id === questId) {
            activeQuest = null;
          }
          
          // Delete the message the replay button was on
          try {
            await interaction.message.delete();
          } catch (delErr) {
            console.log('[QuestMaster] Could not delete replay message:', delErr.message);
          }
          
          // Ephemeral notification
          const config = loadConfig();
          const boardRef = config.board_channel_id ? ` Check <#${config.board_channel_id}> to start it again!` : '';
          await interaction.reply({
            content: `🔄 **${quest.name}** has been reset.${boardRef}`,
            ephemeral: true
          });
          return;
        }
      }
      
      // "Say Something" button — opens a modal for free-text NPC dialogue
      if (interaction.customId === 'quest_speak') {
        let currentQuest = activeQuest;
        if (!currentQuest || currentQuest.channelId !== interaction.channelId) {
          currentQuest = getActiveQuestForChannel(interaction.channelId);
          if (currentQuest) activeQuest = currentQuest;
        }
        
        if (!currentQuest) {
          await interaction.reply({ content: 'No quest is active in this channel.', ephemeral: true });
          return;
        }
        
        // Refresh definition from disk
        const freshDef = findQuestDefinition(currentQuest.id);
        if (freshDef) currentQuest.definition = freshDef;
        
        const stageName = currentQuest.quest.current_stage;
        const npcs = getStageDialogueNpcs(currentQuest.definition, stageName);
        
        if (npcs.length === 0) {
          await interaction.reply({ content: '*No one is around to hear you...*', ephemeral: true });
          return;
        }
        
        // Build NPC display name for modal title
        const primaryNpc = npcs[0];
        const npcInfo = currentQuest.definition.key_npcs?.[primaryNpc];
        const npcDisplayName = npcInfo?.name || primaryNpc.charAt(0).toUpperCase() + primaryNpc.slice(1);
        
        const modal = new ModalBuilder()
          .setCustomId('quest_speak_modal')
          .setTitle(`Speak to ${npcDisplayName}`);
        
        const textInput = new TextInputBuilder()
          .setCustomId('quest_speak_text')
          .setLabel('What do you say?')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Type what you want to say...')
          .setRequired(true)
          .setMaxLength(500);
        
        modal.addComponents(new ActionRowBuilder().addComponents(textInput));
        await interaction.showModal(modal);
        return;
      }
      
      // Stage action buttons (new stage-based system)
      if (action === 'stage' && type === 'action') {
        const actionId = parts.slice(2).join('_'); // Rejoin in case action ID has underscores
        console.log('[QuestMaster] Stage action button clicked:', actionId, 'in channel:', interaction.channelId);
        
        // Try to get active quest from channel - always refresh definition from disk
        let currentQuest = activeQuest;
        if (!currentQuest || currentQuest.channelId !== interaction.channelId) {
          currentQuest = getActiveQuestForChannel(interaction.channelId);
          if (currentQuest) {
            activeQuest = currentQuest;
          }
        } else {
          // Refresh definition from disk in case quest files were edited
          const freshDef = findQuestDefinition(currentQuest.id);
          if (freshDef) {
            currentQuest.definition = freshDef;
          }
        }
        
        if (!currentQuest) {
          await interaction.reply({ content: 'No quest is currently active in this channel.', ephemeral: true });
          return;
        }
        
        const stageName = currentQuest.quest.current_stage;
        const actionDef = findActionInStage(currentQuest.definition, stageName, actionId);
        
        if (!actionDef) {
          await interaction.reply({ 
            content: `⚠️ This button is from a previous stage. The quest has moved on!\n\nCurrent stage: **${stageName}**\n\nCheck the latest message for current actions.`, 
            ephemeral: true 
          });
          return;
        }
        
        await interaction.deferReply();
        
        // Show typing indicator while generating narration
        await interaction.channel.sendTyping();
        
        // Check if this action cues an NPC
        console.log('[QuestMaster] Action found:', actionDef.id);
        console.log('[QuestMaster] Action details:', JSON.stringify({ 
          id: actionDef.id, 
          label: actionDef.label,
          cue_npc: actionDef.cue_npc,
          advances: actionDef.advances,
          has_narration_prompt: !!actionDef.narration_prompt
        }));
        if (actionDef.cue_npc) {
          const npcName = actionDef.cue_npc.toLowerCase();
          console.log('[QuestMaster] Cueing NPC:', npcName);
          
          // Check if this is a quest NPC (defined in key_npcs) or a bot NPC (has character folder)
          if (isQuestNpc(npcName, currentQuest.definition)) {
            // --- QUEST NPC: QM generates dialogue via webhook ---
            console.log(`[QuestMaster] Quest NPC detected: ${npcName}, generating dialogue...`);
            
            // Post the narration first (as QM)
            const narration = actionDef.narration_prompt || `The party looks to ${npcName}...`;
            const cueReply = { content: `📖 *${narration}*` };
            const cueImage = resolveQuestImage(currentQuest.definition._source_npc, actionDef.image);
            if (cueImage) cueReply.files = [cueImage];
            await interaction.editReply(cueReply);
            
            // Generate NPC dialogue
            const stageInfo = getStageInfo(currentQuest.definition, stageName);
            const dialogueContext = `Quest: ${currentQuest.definition.name}. Stage: ${stageInfo?.description || stageName}. ${narration}`;
            const dialogue = await generateQuestNpcDialogue(
              npcName, 
              currentQuest.definition,
              actionDef.npc_instruction || 'Respond in character.',
              dialogueContext
            );
            
            if (dialogue) {
              // Send dialogue via webhook with NPC's name and avatar
              await sendAsQuestNpc(interaction.channel, npcName, currentQuest.definition, dialogue);
            } else {
              await interaction.followUp({ content: `*(${npcName} remains silent...)*` });
            }
            
            // Re-send stage buttons if action doesn't advance (so player can keep exploring)
            if (!actionDef.advances) {
              const components = createStageButtons(currentQuest.definition, stageName);
              if (components.length > 0) {
                await interaction.channel.send({ content: '*What do you do next?*', components });
              }
            }
            
            // Handle stage advancement for quest NPC actions
            if (actionDef.advances) {
              if (actionDef.sets_flag) {
                const data = loadPartyQuests();
                const quest = data.quests.find(q => q.id === currentQuest.id);
                if (quest) {
                  if (!quest.flags) quest.flags = [];
                  quest.flags.push(actionDef.sets_flag);
                  savePartyQuests(data);
                  console.log(`[QuestMaster] Set flag: ${actionDef.sets_flag}`);
                }
              }
              
              if (actionDef.completes_quest) {
                await completeQuest(currentQuest.id);
                await interaction.channel.send({
                  content: `✅ **Quest Complete!** *${currentQuest.definition.name}* has been resolved.`,
                  components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                      .setCustomId(`quest_replay_${currentQuest.id}`)
                      .setLabel('🔄 Replay Quest')
                      .setStyle(ButtonStyle.Secondary)
                  )]
                });
                activeQuest = null;
              } else if (actionDef.next_stage) {
                const newStageName = actionDef.next_stage;
                const result = advanceQuest(currentQuest.id, newStageName);
                currentQuest.quest = result.quest;
                activeQuest = currentQuest;
                
                // Generate and send new stage narration
                const newStageInfo = getStageInfo(currentQuest.definition, newStageName);
                if (newStageInfo?.narration_prompt) {
                  const newStageNpcNames = getStageCueNpcNames(newStageInfo);
                  const stageNarration = await generateNarration(
                    `Quest: ${currentQuest.definition.name}. ${currentQuest.definition.description}`,
                    newStageInfo.narration_prompt,
                    newStageNpcNames,
                    newStageInfo.negative_prompts
                  );
                  const components = createStageButtons(currentQuest.definition, newStageName);
                  const newStageHasCues = stageHasCues(newStageInfo);
                  const transitionMsg = {
                    content: `📍 **${newStageName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}**\n\n${stageNarration}`,
                    components: newStageHasCues ? [] : components
                  };
                  const transitionImage = resolveQuestImage(currentQuest.definition._source_npc, newStageInfo?.image);
                  if (transitionImage) transitionMsg.files = [transitionImage];
                  await interaction.channel.send(transitionMsg);
                  
                  // Handle stage-level NPC cues, send buttons after
                  await handleStageCues(interaction.channel, newStageInfo, currentQuest.definition, newStageName, newStageHasCues ? components : null);
                } else {
                  const components = createStageButtons(currentQuest.definition, newStageName);
                  await interaction.channel.send({
                    content: `📍 *Moving to: **${newStageName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}**...*`,
                    components
                  });
                }
              }
            }
            
            return;
          }
          
          // --- BOT NPC: Use cue file system ---
          // Check if NPC character folder exists
          const npcCharDir = path.join(NPC_CHARACTERS_PATH, npcName);
          if (!fs.existsSync(npcCharDir)) {
            await interaction.editReply({
              content: `*(NPC '${npcName}' not found - no character folder at characters/${npcName}/ and not defined in quest key_npcs)*`
            });
            return;
          }
          
          // Post the narration that sets the scene
          const narration = actionDef.narration_prompt || `The party looks to ${npcName}...`;
          const cueReply = { content: `📖 *${narration}*` };
          const cueImage = resolveQuestImage(currentQuest.definition._source_npc, actionDef.image);
          if (cueImage) cueReply.files = [cueImage];
          await interaction.editReply(cueReply);
          
          // Write cue file for the NPC bot to pick up
          const cueData = {
            channel_id: interaction.channel.id,
            instruction: actionDef.npc_instruction || '',
            context: narration,
            timestamp: Date.now()
          };
          
          // Atomic write: write to temp file then rename
          const cueFilePath = path.join(npcCharDir, 'quest_cue.json');
          const tempFilePath = path.join(npcCharDir, 'quest_cue.tmp');
          
          try {
            fs.writeFileSync(tempFilePath, JSON.stringify(cueData, null, 2));
            fs.renameSync(tempFilePath, cueFilePath);
            console.log(`[QuestMaster] Wrote cue file for ${npcName}:`, cueFilePath);
            
            // Handle quest flags for bot NPC cue actions
            if (actionDef.advances && actionDef.sets_flag) {
              const data = loadPartyQuests();
              const quest = data.quests.find(q => q.id === currentQuest.id);
              if (quest) {
                if (!quest.flags) quest.flags = [];
                quest.flags.push(actionDef.sets_flag);
                savePartyQuests(data);
                console.log(`[QuestMaster] Set flag: ${actionDef.sets_flag}`);
              }
            }
            
            if (actionDef.advances) {
              if (actionDef.completes_quest) {
                // Wait for NPC to respond, then complete
                waitForNpcResponse(npcName).then(async () => {
                  try {
                    await completeQuest(currentQuest.id);
                    await interaction.channel.send({
                      content: `✅ **Quest Complete!** *${currentQuest.definition.name}* has been resolved.`,
                      components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                          .setCustomId(`quest_replay_${currentQuest.id}`)
                          .setLabel('🔄 Replay Quest')
                          .setStyle(ButtonStyle.Secondary)
                      )]
                    });
                    activeQuest = null;
                  } catch (e) {
                    console.error(`[QuestMaster] Failed to complete quest after cue:`, e.message);
                  }
                });
              } else if (actionDef.next_stage) {
                const newStageName = actionDef.next_stage;
                // Wait for NPC to respond, then advance stage
                waitForNpcResponse(npcName).then(async () => {
                  try {
                    const result = advanceQuest(currentQuest.id, newStageName);
                    currentQuest.quest = result.quest;
                    activeQuest = currentQuest;
                    
                    const newStageInfo = getStageInfo(currentQuest.definition, newStageName);
                    if (newStageInfo?.narration_prompt) {
                      const newStageNpcNames = getStageCueNpcNames(newStageInfo);
                      const stageNarration = await generateNarration(
                        `Quest: ${currentQuest.definition.name}. ${currentQuest.definition.description}`,
                        newStageInfo.narration_prompt,
                        newStageNpcNames,
                        newStageInfo.negative_prompts
                      );
                      const components = createStageButtons(currentQuest.definition, newStageName);
                      const newStageHasCues = stageHasCues(newStageInfo);
                      const transitionMsg = {
                        content: `📍 **${newStageName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}**\n\n${stageNarration}`,
                        components: newStageHasCues ? [] : components
                      };
                      const transitionImage = resolveQuestImage(currentQuest.definition._source_npc, newStageInfo?.image);
                      if (transitionImage) transitionMsg.files = [transitionImage];
                      await interaction.channel.send(transitionMsg);
                      
                      // Handle stage-level NPC cues, send buttons after
                      await handleStageCues(interaction.channel, newStageInfo, currentQuest.definition, newStageName, newStageHasCues ? components : null);
                    } else {
                      const components = createStageButtons(currentQuest.definition, newStageName);
                      await interaction.channel.send({
                        content: `📍 *Moving to: **${newStageName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}**...*`,
                        components
                      });
                    }
                  } catch (e) {
                    console.error(`[QuestMaster] Failed to advance stage after cue:`, e.message);
                  }
                });
              }
            } else {
              // Re-send stage buttons after NPC responds (non-advancing action)
              waitForNpcResponse(npcName).then(async () => {
                try {
                  const components = createStageButtons(currentQuest.definition, stageName);
                  if (components.length > 0) {
                    await interaction.channel.send({ content: '*What do you do next?*', components });
                  }
                } catch (e) {
                  console.error(`[QuestMaster] Failed to re-send buttons after cue:`, e.message);
                }
              });
            }
          } catch (err) {
            console.error(`[QuestMaster] Failed to write cue file:`, err.message);
            await interaction.followUp({ content: `*(Failed to cue ${npcName})*`, ephemeral: true });
          }
          
          return;
        }
        
        // Check for action-level multi-NPC cues (stage_cue_npcs / cue_npcs on the action)
        const actionCueNpcs = getActionCueNpcNames(actionDef);
        const hasActionMultiCues = actionCueNpcs.length > 0;
        
        // Generate narration based on action's prompt
        const stageInfo = getStageInfo(currentQuest.definition, stageName);
        const context = `Quest: ${currentQuest.definition.name}. Location: ${stageInfo?.description || stageName}. ${currentQuest.definition.description}`;
        
        console.log('[QuestMaster] Calling narrateAction with prompt:', actionDef.narration_prompt?.substring(0, 80));
        const narration = await narrateAction(context, actionDef.narration_prompt, actionCueNpcs);
        console.log('[QuestMaster] Narration result:', narration?.substring(0, 100));
        
        // Ensure we never send just a book emoji
        let responseContent;
        if (!narration || narration.trim().length === 0) {
          console.error('[QuestMaster] WARNING: Empty narration returned!');
          responseContent = `📖 *You ${actionDef.label.replace(/^[^\s]+\s*/, '').toLowerCase() || 'take action'}...* The Quest Master contemplates the outcome.`;
        } else {
          responseContent = `📖 ${narration}`;
        }
        let newStageName = stageName;
        let shouldAdvance = false;
        let shouldComplete = false;
        let stageTransitionContent = null; // Store stage transition for separate message
        
        // Handle quest flags
        if (actionDef.advances && actionDef.sets_flag) {
          const data = loadPartyQuests();
          const quest = data.quests.find(q => q.id === currentQuest.id);
          if (quest) {
            if (!quest.flags) quest.flags = [];
            quest.flags.push(actionDef.sets_flag);
            savePartyQuests(data);
            console.log(`[QuestMaster] Set flag: ${actionDef.sets_flag}`);
          }
        }
        
        // Check if action advances the quest - but DON'T save yet!
        if (actionDef.advances) {
          if (actionDef.completes_quest) {
            shouldComplete = true;
            responseContent += `\n\n✅ **Quest Complete!** *${currentQuest.definition.name}* has been resolved.`;
          } else if (actionDef.next_stage) {
            shouldAdvance = true;
            newStageName = actionDef.next_stage;
            
            // Get new stage narration BEFORE saving state
            // Store separately to avoid Discord's 2000 char limit
            const newStageInfo = getStageInfo(currentQuest.definition, newStageName);
            if (newStageInfo?.narration_prompt) {
              const newStageNpcNames = getStageCueNpcNames(newStageInfo);
              const stageNarration = await generateNarration(
                `Quest: ${currentQuest.definition.name}. ${currentQuest.definition.description}`,
                newStageInfo.narration_prompt,
                newStageNpcNames,
                newStageInfo.negative_prompts
              );
              stageTransitionContent = `📍 **${newStageName.charAt(0).toUpperCase() + newStageName.slice(1)}**\n\n${stageNarration}`;
            }
            // Add a brief transition note to the action response
            responseContent += `\n\n*Moving to: **${newStageName.charAt(0).toUpperCase() + newStageName.slice(1)}**...*`;
          }
        }
        
        // Get stage-specific buttons for the NEW stage (before saving)
        const components = shouldComplete ? [] : createStageButtons(currentQuest.definition, newStageName);
        
        // Truncate response if still too long (Discord's 2000 char limit)
        if (responseContent.length > 1900) {
          responseContent = responseContent.substring(0, 1900) + '...\n\n*[Narration truncated]*';
        }
        
        // Send the reply FIRST - if this fails, we haven't changed any state
        // If action has multi-NPC cues, don't attach buttons to narration (buttons come after NPC dialog)
        const actionReply = {
          content: responseContent,
          components: (stageTransitionContent || hasActionMultiCues) ? [] : components
        };
        const actionImage = resolveQuestImage(currentQuest.definition._source_npc, actionDef.image);
        if (actionImage) actionReply.files = [actionImage];
        await interaction.editReply(actionReply);

        // Fire action-level multi-NPC cues (stage_cue_npcs / cue_npcs on the action itself)
        if (hasActionMultiCues) {
          // Build cue list from action definition (same format as handleStageCues)
          const actionCues = [];
          if (actionDef.cue_npcs && Array.isArray(actionDef.cue_npcs)) {
            for (const cue of actionDef.cue_npcs) {
              if (typeof cue === 'string') {
                actionCues.push({ npc: cue.toLowerCase(), instruction: 'Respond in character.' });
              } else {
                actionCues.push({ npc: cue.npc.toLowerCase(), instruction: cue.instruction || 'Respond in character.' });
              }
            }
          }
          if (actionDef.stage_cue_npcs && Array.isArray(actionDef.stage_cue_npcs)) {
            for (const cue of actionDef.stage_cue_npcs) {
              actionCues.push({ npc: cue.npc.toLowerCase(), instruction: cue.instruction || 'Respond in character.' });
            }
          }
          
          // Fire cues sequentially
          for (const cue of actionCues) {
            const cueContext = `Quest: ${currentQuest.definition.name}. Stage: ${stageInfo?.description || stageName}. ${actionDef.narration_prompt || currentQuest.definition.description}`;
            
            if (isQuestNpc(cue.npc, currentQuest.definition)) {
              // Quest NPC (key_npcs) — generate dialogue via webhook
              const dialogue = await generateQuestNpcDialogue(cue.npc, currentQuest.definition, cue.instruction, cueContext);
              if (dialogue) {
                await sendAsQuestNpc(interaction.channel, cue.npc, currentQuest.definition, dialogue);
              }
            } else {
              // Bot NPC — write cue file and wait for response
              const npcCharDir = path.join(NPC_CHARACTERS_PATH, cue.npc);
              if (fs.existsSync(npcCharDir)) {
                const cueData = {
                  channel_id: interaction.channel.id,
                  instruction: cue.instruction,
                  context: stageInfo?.description || stageName,
                  timestamp: Date.now()
                };
                const cueFilePath = path.join(npcCharDir, 'quest_cue.json');
                const tempFilePath = path.join(npcCharDir, 'quest_cue.tmp');
                fs.writeFileSync(tempFilePath, JSON.stringify(cueData, null, 2));
                fs.renameSync(tempFilePath, cueFilePath);
                console.log(`[QuestMaster] Wrote action multi-cue for ${cue.npc}`);
                await waitForNpcResponse(cue.npc);
              }
            }
          }
          
          // Send buttons AFTER all NPC cues have fired
          if (!shouldAdvance && !shouldComplete && components.length > 0) {
            await interaction.channel.send({ content: '*What do you do next?*', components });
          }
        }

        // If advancing stages, send stage narration as a follow-up message
        if (stageTransitionContent) {
          const newStageDef = getStageInfo(currentQuest.definition, newStageName);
          const newStageHasCues = stageHasCues(newStageDef);
          
          // If stage has NPC cues, send narration WITHOUT buttons; buttons come after NPC dialogue
          const transitionMsg = { content: stageTransitionContent, components: newStageHasCues ? [] : components };
          const transitionImage = resolveQuestImage(currentQuest.definition._source_npc, newStageDef?.image);
          if (transitionImage) transitionMsg.files = [transitionImage];
          await interaction.channel.send(transitionMsg);
          
          // Handle stage-level NPC cues, send buttons after
          if (newStageDef) {
            await handleStageCues(interaction.channel, newStageDef, currentQuest.definition, newStageName, newStageHasCues ? components : null);
          }
        }
        
        // ONLY NOW save the state change (after successful reply)
        if (shouldComplete) {
          await completeQuest(currentQuest.id);
          // Send play again message with button
          const replayRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`quest_replay_${currentQuest.id}`)
              .setLabel('🔄 Replay Quest')
              .setStyle(ButtonStyle.Secondary)
          );
          await interaction.channel.send({
            content: `🔄 Want to play again?`,
            components: [replayRow]
          });
          activeQuest = null;
        } else if (shouldAdvance) {
          const result = advanceQuest(currentQuest.id, newStageName);
          currentQuest.quest = result.quest;
          activeQuest = currentQuest;
        }
        return;
      }
      
      // Gameplay buttons (fallback/legacy)
      if (action === 'gp') {
        console.log('[QuestMaster] Gameplay button clicked:', type, 'in channel:', interaction.channelId);
        
        // Try to get active quest from channel if not in memory
        let currentQuest = activeQuest;
        if (!currentQuest || currentQuest.channelId !== interaction.channelId) {
          console.log('[QuestMaster] Active quest not in memory or wrong channel, looking up...');
          currentQuest = getActiveQuestForChannel(interaction.channelId);
          if (currentQuest) {
            activeQuest = currentQuest; // Restore to memory
            console.log('[QuestMaster] Restored quest to memory:', currentQuest.id);
          }
        }
        
        if (!currentQuest) {
          console.log('[QuestMaster] No quest found, sending error reply');
          await interaction.reply({ content: 'No quest is currently active in this channel.', ephemeral: true });
          return;
        }
        
        console.log('[QuestMaster] Using quest:', currentQuest.id);
        
        await interaction.deferReply();
        
        // Show typing indicator while generating narration
        await interaction.channel.sendTyping();
        
        const stageName = currentQuest.quest.current_stage;
        const stageInfo = getStageInfo(currentQuest.definition, stageName);
        const context = `Quest: ${currentQuest.definition.name}. Stage: ${stageName}. ${stageInfo?.description || currentQuest.definition.description}`;
        let narration;
        
        if (type === 'scene') {
          narration = await narrateAction(context, 'I look around and observe my surroundings carefully');
        } else if (type === 'listen') {
          narration = await narrateAction(context, 'I stop and listen carefully to the sounds around me');
        } else if (type === 'search') {
          narration = await narrateAction(context, 'I search the immediate area for anything interesting or useful');
        } else if (type === 'forward') {
          narration = await narrateAction(context, 'I move forward, proceeding deeper into the area');
        } else if (type === 'back') {
          narration = await narrateAction(context, 'I decide to go back the way I came');
        } else if (type === 'advance') {
          const result = advanceQuest(currentQuest.id);
          currentQuest.quest = result.quest;
          activeQuest = currentQuest; // Update memory state
          narration = `📜 *Quest advanced to: **${result.quest.current_stage}***`;
          await interaction.editReply({ content: narration });
          return;
        } else if (type === 'end') {
          const endContext = `Quest: ${currentQuest.definition.name}. The quest is concluding.`;
          narration = await generateNarration(endContext, 'Narrate the conclusion of this adventure. Wrap up the story.');
          
          await interaction.editReply({
            content: `📖 **${currentQuest.definition.name}** concludes...\n\n${narration}\n\n📜 *Quest session ended.*`,
            components: []
          });
          
          activeQuest = null;
          return;
        }
        
        // Get stage-specific buttons if available, otherwise generic
        let components;
        if (currentQuest.definition.stages && currentQuest.definition.stages[stageName]) {
          components = createStageButtons(currentQuest.definition, stageName);
        } else {
          components = [...createGameplayButtons()];
        }
        
        await interaction.editReply({
          content: `📖 ${narration}`,
          components
        });
        return;
      }
    }
    
  } catch (err) {
    console.error('[QuestMaster] Interaction error:', err);
    try {
      if (interaction.deferred) {
        await interaction.editReply({ content: 'An error occurred processing that action.' });
      } else {
        await interaction.reply({ content: 'An error occurred processing that action.', ephemeral: true });
      }
    } catch (e) {}
  }
});

discord.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  // ============================================
  // CHAT MODE PROCESSING
  // ============================================
  const chatSession = chatMode.getChatSession(message.channel.id);
  if (chatSession && !message.content.toLowerCase().startsWith('!qm')) {
    // Process player message in chat mode
    try {
      await message.channel.sendTyping();
      
      const result = await chatMode.processChatMessage(
        openai,
        process.env.MODEL || 'gpt-4o-mini',
        chatSession.definition,
        chatSession.quest,
        message.content,
        message.member?.displayName || message.author.username
      );
      
      // Send narration if present
      if (result.narration) {
        await message.channel.send(`📖 ${result.narration}`);
      }
      
      // Send image if requested — but skip if the stage transition will send the same image
      if (result.send_image && chatSession.definition.images) {
        const imagePath = chatSession.definition.images[result.send_image];
        if (imagePath) {
          let stageWillSendSameImage = false;
          if (result.advance_stage) {
            const nextStage = getStageInfo(chatSession.definition, result.advance_stage);
            if (nextStage?.image === imagePath) stageWillSendSameImage = true;
          }
          if (!stageWillSendSameImage) {
            const fullPath = resolveQuestImage(chatSession.definition._source_npc, imagePath);
            if (fullPath) {
              await message.channel.send({ files: [fullPath] });
            }
          }
        }
      }
      
      // Cue NPC if requested — but enforce stage-level chat_npcs whitelist
      if (result.cue_npc) {
        const npcName = result.cue_npc.toLowerCase();
        const currentStageInfo = getStageInfo(chatSession.definition, chatSession.quest.current_stage);
        const allowedNpcs = currentStageInfo?.chat_npcs;
        // If chat_npcs is defined, only allow listed NPCs. If undefined, allow all (backwards compat).
        const npcAllowed = !allowedNpcs || allowedNpcs.map(n => n.toLowerCase()).includes(npcName);

        if (!npcAllowed) {
          console.log(`[ChatMode] Blocked AI cue for "${npcName}" — not in chat_npcs for stage "${chatSession.quest.current_stage}"`);
        } else if (isQuestNpc(npcName, chatSession.definition)) {
          // Quest NPC - generate dialogue via webhook
          const stageInfo = currentStageInfo;
          const dialogueContext = `Quest: ${chatSession.definition.name}. Stage: ${stageInfo?.description || chatSession.quest.current_stage}. Player just said: "${message.content}"`;
          
          const dialogue = await generateQuestNpcDialogue(
            npcName,
            chatSession.definition,
            result.npc_instruction || 'Respond in character.',
            dialogueContext
          );
          
          if (dialogue) {
            await sendAsQuestNpc(message.channel, npcName, chatSession.definition, dialogue);
          }
        } else {
          // Bot NPC - write cue file
          const npcCharDir = path.join(NPC_CHARACTERS_PATH, npcName);
          if (fs.existsSync(npcCharDir)) {
            const cueData = {
              channel_id: message.channel.id,
              instruction: result.npc_instruction || 'Respond in character.',
              context: `Player said: "${message.content}"`,
              timestamp: Date.now()
            };
            const cueFilePath = path.join(npcCharDir, 'quest_cue.json');
            const tempFilePath = path.join(npcCharDir, 'quest_cue.tmp');
            fs.writeFileSync(tempFilePath, JSON.stringify(cueData, null, 2));
            fs.renameSync(tempFilePath, cueFilePath);
            console.log(`[ChatMode] Wrote cue file for bot NPC ${npcName}`);
          }
        }
      }
      
      // Advance stage if requested
      if (result.advance_stage) {
        const advanceResult = advanceQuest(chatSession.questId, result.advance_stage);
        chatSession.quest = advanceResult.quest;
        chatMode.updateChatSession(message.channel.id, advanceResult.quest);
        
        // Get new stage narration
        const newStageInfo = getStageInfo(chatSession.definition, result.advance_stage);
        if (newStageInfo?.narration_prompt) {
          const stageNarration = await generateNarration(
            `Quest: ${chatSession.definition.name}. ${chatSession.definition.description}`,
            newStageInfo.narration_prompt,
            getStageCueNpcNames(newStageInfo),
            newStageInfo.negative_prompts
          );
          
          const stageMsg = { content: `📍 **${result.advance_stage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}**\n\n${stageNarration}` };
          const stageImage = resolveQuestImage(chatSession.definition._source_npc, newStageInfo?.image);
          if (stageImage) stageMsg.files = [stageImage];
          await message.channel.send(stageMsg);
          
          // Handle stage-level NPC cues
          await handleStageCues(message.channel, newStageInfo, chatSession.definition, result.advance_stage, null);

          // Check if the new stage completes the quest
          if (newStageInfo?.completes_quest) {
            await completeQuest(chatSession.questId);
            chatMode.endChatMode(message.channel.id);
            await message.channel.send(`✅ **Quest Complete!** *${chatSession.definition.name}* has been resolved.`);
            return;
          }
        }
      }

      // Complete quest if AI explicitly requests it
      if (result.quest_complete) {
        await completeQuest(chatSession.questId);
        chatMode.endChatMode(message.channel.id);
        await message.channel.send(`✅ **Quest Complete!** *${chatSession.definition.name}* has been resolved.`);
      }
      
    } catch (err) {
      console.error('[ChatMode] Error processing message:', err);
    }
    return;
  }
  
  // Check if message starts with !qm
  if (!message.content.toLowerCase().startsWith('!qm')) return;
  
  const args = message.content.slice(3).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();
  
  const config = loadConfig();
  
  // ---- PLAYER COMMANDS ----
  
  if (command === 'quests' || command === 'list') {
    const data = loadPartyQuests();
    if (data.quests.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0x95A5A6)
        .setTitle('📜 Active Quests')
        .setDescription('*No active quests.*\nTalk to NPCs to find adventures!')
        .setFooter({ text: 'Use !qm available to see available quests' });
      message.reply({ embeds: [embed] });
    } else {
      const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('📜 Active Quests')
        .setDescription(data.quests.map(q => 
          `• **${q.name}**\n  └ ${q.status} | from *${q.given_by}*`
        ).join('\n\n'))
        .setFooter({ text: 'Click buttons to manage quests' });
      
      const buttons = createQuestListButtons(data.quests);
      message.reply({ embeds: [embed], components: buttons });
    }
    return;
  }
  
  if (command === 'available') {
    const quests = listAvailableQuests();
    if (quests.length === 0) {
      message.reply('📜 No quests defined yet.');
    } else {
      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('📜 Available Quests')
        .setDescription(quests.map(q => `• **${q.name}**\n  └ from *${q.npc}* | \`${q.id}\``).join('\n\n'))
        .setFooter({ text: 'Click a button to track a quest' });
      
      const buttons = createAvailableQuestButtons(quests);
      message.reply({ embeds: [embed], components: buttons });
    }
    return;
  }
  
  if (command === 'info') {
    const questId = args[0];
    if (!questId) {
      message.reply('Usage: `!qm info <quest_id>`');
      return;
    }
    
    const data = loadPartyQuests();
    const tracked = data.quests.find(q => q.id === questId);
    const definition = findQuestDefinition(questId);
    
    if (!definition) {
      message.reply(`Quest '${questId}' not found.`);
      return;
    }
    
    let info = `📜 **${definition.name}**\n`;
    info += `*${definition.description}*\n\n`;
    info += `From: ${definition._source_npc}\n`;
    
    if (tracked) {
      info += `Status: ${tracked.status}\n`;
      info += `Stage: ${tracked.current_stage || 'not started'}\n`;
      if (tracked.notes.length > 0) {
        info += `\n**Notes:**\n${tracked.notes.map(n => `• ${n.text}`).join('\n')}`;
      }
    } else {
      info += `Status: not tracked`;
    }
    
    message.reply(info);
    return;
  }
  
  if (command === 'track') {
    const questId = args[0];
    if (!questId) {
      message.reply('Usage: `!qm track <quest_id>`');
      return;
    }
    
    const result = await trackQuest(questId);
    if (result.success) {
      message.reply(`📜 **Quest Tracked:** ${result.quest.name}\n*${result.quest.description}*\n\nCheck the quest board or use \`!qm start ${questId}\` when ready to begin!`);
    } else {
      message.reply(result.message);
    }
    return;
  }
  
  // ---- GAMEPLAY COMMANDS ----
  
  if (command === 'start') {
    const questId = args[0];
    if (!questId) {
      message.reply('Usage: `!qm start <quest_id>`');
      return;
    }
    
    const result = await startQuest(questId);
    if (!result.success) {
      message.reply(result.message);
      return;
    }
    
    activeQuest = {
      id: questId,
      definition: result.definition,
      quest: result.quest
    };
    
    // Generate opening narration
    const context = `Quest: ${result.definition.name}. ${result.definition.description}. Given by: ${result.definition._source_npc}.`;
    const narration = await generateNarration(context, 'Set the scene for the beginning of this quest. The adventurers are about to embark.');
    
    const components = [...createGameplayButtons()];
    
    const embed = new EmbedBuilder()
      .setColor(0xE67E22)
      .setTitle(`📖 ${result.definition.name}`)
      .setDescription(narration)
      .setFooter({ text: 'Use the buttons below to take actions' });
    
    message.channel.send({ 
      embeds: [embed],
      components 
    });
    return;
  }
  
  if (command === 'scene') {
    if (!activeQuest) {
      message.reply('No quest is currently active. Use `!qm start <quest_id>` first.');
      return;
    }
    
    const context = `Quest: ${activeQuest.definition.name}. Stage: ${activeQuest.quest.current_stage}. ${activeQuest.definition.description}`;
    const narration = await generateNarration(context, 'Describe the current scene - what the adventurers see, hear, and sense around them.');
    
    message.channel.send(`📖 ${narration}`);
    return;
  }
  
  if (command === 'action') {
    const action = args.join(' ');
    if (!action) {
      message.reply('Usage: `!qm action <what you do>`\nExample: `!qm action I search the bushes for tracks`');
      return;
    }
    
    if (!activeQuest) {
      message.reply('No quest is currently active. Use `!qm start <quest_id>` first.');
      return;
    }
    
    const context = `Quest: ${activeQuest.definition.name}. Stage: ${activeQuest.quest.current_stage}. ${activeQuest.definition.description}`;
    const narration = await narrateAction(context, action);
    
    message.channel.send(`📖 ${narration}`);
    return;
  }
  
  if (command === 'advance') {
    const stageName = args.join(' ') || null;
    
    if (!activeQuest) {
      message.reply('No quest is currently active.');
      return;
    }
    
    const result = advanceQuest(activeQuest.id, stageName);
    if (result.success) {
      activeQuest.quest = result.quest;
      message.reply(`📜 Quest advanced to: **${result.quest.current_stage}**`);
    } else {
      message.reply(result.message);
    }
    return;
  }
  
  if (command === 'note') {
    const note = args.join(' ');
    if (!note) {
      message.reply('Usage: `!qm note <text>`');
      return;
    }
    
    if (!activeQuest) {
      message.reply('No quest is currently active.');
      return;
    }
    
    addQuestNote(activeQuest.id, note);
    message.reply(`📝 Note added to quest.`);
    return;
  }
  
  if (command === 'cue') {
    const npcName = args[0]?.toLowerCase();
    if (!npcName) {
      message.reply('Usage: `!qm cue <npc_name>`\nExample: `!qm cue nibby`');
      return;
    }
    
    // Get NPC Discord ID from config
    const npcDiscordId = config.npc_discord_ids?.[npcName];
    
    if (npcDiscordId) {
      // Actually mention the NPC bot so they respond
      message.channel.send(`*The Quest Master looks to ${npcName}...*`);
      message.channel.send(`<@${npcDiscordId}> What do you think?`);
    } else {
      // No Discord ID configured - just send a text prompt
      message.channel.send(`*The Quest Master looks to ${npcName}...*`);
      message.reply(`(NPC '${npcName}' not configured in npc_discord_ids. Add their Discord user ID to config.json)`);
    }
    return;
  }
  
  if (command === 'end') {
    if (!activeQuest) {
      message.reply('No quest is currently active.');
      return;
    }
    
    // Generate closing narration
    const context = `Quest: ${activeQuest.definition.name}. The quest is concluding.`;
    const narration = await generateNarration(context, 'Narrate the conclusion of this adventure. Wrap up the story.');
    
    message.channel.send(`📖 **${activeQuest.definition.name}** concludes...\n\n${narration}`);
    
    activeQuest = null;
    message.channel.send(`📜 *Quest session ended. Use \`!qm complete <quest_id>\` or \`!qm fail <quest_id>\` to finalize.*`);
    return;
  }
  
  // ---- DM COMMANDS ----
  
  if (command === 'complete') {
    const questId = args[0];
    if (!questId) {
      message.reply('Usage: `!qm complete <quest_id>`');
      return;
    }
    
    const result = await completeQuest(questId);
    if (result.success) {
      const replayRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`quest_replay_${questId}`)
          .setLabel('🔄 Replay Quest')
          .setStyle(ButtonStyle.Secondary)
      );
      message.reply({
        content: `✅ **Quest Completed:** ${result.quest.name}\n\n🔄 Want to play again?`,
        components: [replayRow]
      });
      if (activeQuest?.id === questId) activeQuest = null;
    } else {
      message.reply(result.message);
    }
    return;
  }
  
  if (command === 'fail') {
    const questId = args[0];
    if (!questId) {
      message.reply('Usage: `!qm fail <quest_id>`');
      return;
    }
    
    const result = await failQuest(questId);
    if (result.success) {
      message.reply(`❌ **Quest Failed:** ${result.quest.name}`);
      if (activeQuest?.id === questId) activeQuest = null;
    } else {
      message.reply(result.message);
    }
    return;
  }
  
  if (command === 'remove') {
    const questId = args[0];
    if (!questId) {
      message.reply('Usage: `!qm remove <quest_id>`');
      return;
    }
    
    const result = await removeQuest(questId);
    if (result.success) {
      message.reply(`🗑️ Quest removed from tracker.`);
      if (activeQuest?.id === questId) activeQuest = null;
    } else {
      message.reply(result.message);
    }
    return;
  }
  
  if (command === 'reset') {
    const questId = args[0];
    if (!questId) {
      // Reset all quests - also remove board messages
      const data = loadPartyQuests();
      for (const quest of data.quests) {
        if (quest.board_message_id) {
          await removeQuestFromBoard(quest);
        }
      }
      savePartyQuests({ quests: [], completed: [], failed: [] });
      activeQuest = null;
      message.reply(`🔄 All quests reset. Tracker cleared.`);
      return;
    }
    
    // Reset specific quest (remove and allow re-tracking)
    const result = await removeQuest(questId);
    if (result.success) {
      if (activeQuest?.id === questId) activeQuest = null;
      message.reply(`🔄 Quest '${questId}' reset. You can track it again.`);
    } else {
      message.reply(result.message);
    }
    return;
  }
  
  if (command === 'retrack') {
    const questId = args[0];
    if (!questId) {
      message.reply('Usage: `!qm retrack <quest_id>`\nResets a quest back to tracked/available status.');
      return;
    }
    
    const data = loadPartyQuests();
    const quest = data.quests.find(q => q.id === questId);
    
    if (!quest) {
      message.reply(`Quest '${questId}' not found in tracker.`);
      return;
    }
    
    // Reset quest to tracked state
    quest.status = 'available';
    quest.current_stage = null;
    quest.stages_completed = [];
    quest.started_at = null;
    quest.channel_id = null;
    // Keep: added_at, notes, board_message_id
    
    savePartyQuests(data);
    
    // Update board to show available status
    if (quest.board_message_id) {
      await updateQuestOnBoard(quest);
    }
    
    // Clear active quest if this was it
    if (activeQuest?.id === questId) {
      activeQuest = null;
    }
    
    message.reply(`🔄 **${quest.name}** reset to tracked status. Ready to start again!`);
    return;
  }
  
  if (command === 'board') {
    const subcommand = args[0]?.toLowerCase();
    
    if (subcommand === 'setup') {
      const result = await setupQuestBoard(message.channel);
      if (result.success) {
        message.reply({ content: `✅ Quest board created! It will auto-update when quests change.`, ephemeral: true });
      } else {
        message.reply(`❌ Failed to create quest board: ${result.reason}`);
      }
      return;
    }
    
    if (subcommand === 'refresh') {
      const result = await updateQuestBoard();
      if (result.success) {
        message.reply(`✅ Quest board refreshed!`);
      } else {
        message.reply(`❌ Failed to refresh: ${result.reason}. Use \`!qm board setup\` first.`);
      }
      return;
    }
    
    message.reply('Usage: `!qm board setup` or `!qm board refresh`');
    return;
  }
  
  if (command === 'npc') {
    const subcommand = args[0]?.toLowerCase();
    
    if (subcommand === 'list') {
      const npcIds = config.npc_discord_ids || {};
      const entries = Object.entries(npcIds);
      if (entries.length === 0) {
        message.reply('No NPCs configured. Use `!qm npc set <name> <discord_id>` to add one.');
      } else {
        const list = entries.map(([name, id]) => `• **${name}**: \`${id}\``).join('\n');
        message.reply(`**Configured NPCs:**\n${list}`);
      }
      return;
    }
    
    if (subcommand === 'set') {
      const npcName = args[1]?.toLowerCase();
      const discordId = args[2];
      
      if (!npcName || !discordId) {
        message.reply('Usage: `!qm npc set <name> <discord_id>`\nExample: `!qm npc set nibby 123456789012345678`\n\n*To get a bot\'s Discord ID: Enable Developer Mode in Discord settings, then right-click the bot and "Copy User ID"*');
        return;
      }
      
      // Validate Discord ID format (should be a snowflake - 17-19 digits)
      if (!/^\d{17,19}$/.test(discordId)) {
        message.reply('Invalid Discord ID. It should be a 17-19 digit number.\n\n*To get a bot\'s Discord ID: Enable Developer Mode in Discord settings, then right-click the bot and "Copy User ID"*');
        return;
      }
      
      config.npc_discord_ids = config.npc_discord_ids || {};
      config.npc_discord_ids[npcName] = discordId;
      saveConfig(config);
      
      message.reply(`✅ Set **${npcName}**'s Discord ID to \`${discordId}\`\n\nNow when you cue ${npcName}, they'll actually respond!`);
      return;
    }
    
    if (subcommand === 'remove') {
      const npcName = args[1]?.toLowerCase();
      if (!npcName) {
        message.reply('Usage: `!qm npc remove <name>`');
        return;
      }
      
      if (config.npc_discord_ids && config.npc_discord_ids[npcName]) {
        delete config.npc_discord_ids[npcName];
        saveConfig(config);
        message.reply(`🗑️ Removed **${npcName}** from NPC configuration.`);
      } else {
        message.reply(`NPC '${npcName}' not found in configuration.`);
      }
      return;
    }
    
    message.reply('**NPC Configuration:**\n• `!qm npc list` - Show configured NPCs\n• `!qm npc set <name> <id>` - Set an NPC\'s Discord ID\n• `!qm npc remove <name>` - Remove an NPC');
    return;
  }
  
  if (command === 'help') {
    const help = `**📜 Quest Master Commands**

**Player Commands:**
• \`!qm quests\` - List active quests
• \`!qm available\` - List all available quests
• \`!qm info <quest>\` - Quest details
• \`!qm track <quest>\` - Add quest to tracker

**Gameplay Commands:**
• \`!qm start <quest>\` - Begin quest narration
• \`!qm scene\` - Describe current scene
• \`!qm action <text>\` - Take an action
• \`!qm advance [stage]\` - Move to next stage
• \`!qm note <text>\` - Add a note
• \`!qm cue <npc>\` - Signal an NPC to respond
• \`!qm end\` - End quest session

**DM Commands:**
• \`!qm complete <quest>\` - Mark complete
• \`!qm fail <quest>\` - Mark failed
• \`!qm remove <quest>\` - Remove from tracker
• \`!qm retrack <quest>\` - Reset quest back to tracked
• \`!qm npc\` - Configure NPC bot IDs`;
    
    message.reply(help);
    return;
  }
  
  // Unknown command
  message.reply('Unknown command. Use `!qm help` for available commands.');
});

// Start the bot
discord.login(process.env.DISCORD_TOKEN);

const fs = require('fs');
const path = require('path');

// Get character from CLI arg or env (CLI takes priority)
const CHARACTER = process.argv[2] || process.env.CHARACTER;

if (!CHARACTER) {
  console.error('Error: No character specified!');
  console.error('Usage: node bot.js nibby');
  console.error('   or: node bot.js bonesy');
  process.exit(1);
}

// Load character-specific .env file
const envPath = path.join(__dirname, `.env.${CHARACTER}`);
if (!fs.existsSync(envPath)) {
  console.error(`Error: Environment file not found: ${envPath}`);
  console.error('Create it with DISCORD_TOKEN and OPENAI_API_KEY');
  process.exit(1);
}

require('dotenv').config({ path: envPath });
console.log(`[${CHARACTER}] Loaded config from .env.${CHARACTER}`);

const { Client, GatewayIntentBits, Partials, AttachmentBuilder } = require('discord.js');
const OpenAI = require('openai');
const { GoogleGenAI } = require('@google/genai');
const wav = require('wav');
const presence = require('./presence');

// ============================================
// ERROR HANDLING
// ============================================

process.on('uncaughtException', (error) => {
  console.error(`[${CHARACTER}] Uncaught Exception:`, error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`[${CHARACTER}] Unhandled Rejection:`, reason);
});

// ============================================
// CONFIGURATION
// ============================================

const JOURNAL_INTERVAL = 5;           // Write to journal every N messages
const JOURNAL_MAX_SIZE = 10 * 1024;   // Auto-consolidate at 10KB
const MAX_HISTORY = 10;               // Conversation history length
const CONTEXT_MESSAGES = 5;           // Fetch last N messages for context when mentioned
const PRESENCE_CHECK_MINS = 30;       // Check presence schedule every N minutes
const ANNOUNCE_CHANNEL_ID = process.env.ANNOUNCE_CHANNEL_ID || null;  // Channel for arrival/departure messages

// ============================================
// FILE PATHS
// ============================================

const CHARACTER_DIR = path.join(__dirname, 'characters', CHARACTER);

if (!fs.existsSync(CHARACTER_DIR)) {
  console.error(`Error: Character folder not found: ${CHARACTER_DIR}`);
  console.error('Available characters:');
  const chars = fs.readdirSync(path.join(__dirname, 'characters'));
  chars.forEach(c => console.error(`  - ${c}`));
  process.exit(1);
}

const SOUL_PATH = path.join(CHARACTER_DIR, 'SOUL.md');
const MEMORY_PATH = path.join(CHARACTER_DIR, 'MEMORY.md');
const CONTEXT_PATH = path.join(CHARACTER_DIR, 'CONTEXT.md');
const JOURNAL_PATH = path.join(CHARACTER_DIR, 'journal.md');
const GOALS_PATH = path.join(CHARACTER_DIR, 'goals.json');
const QUESTS_DIR = path.join(CHARACTER_DIR, 'quests');
const QUEST_STATE_PATH = path.join(CHARACTER_DIR, 'quest_state.json');
const BANTER_PATH = path.join(CHARACTER_DIR, 'banter.json');
const CUE_FILE_PATH = path.join(CHARACTER_DIR, 'quest_cue.json');
const EMOJIS_PATH = path.join(CHARACTER_DIR, 'emojis.json');
const NPC_REGISTRY_PATH = path.join(__dirname, 'npc_registry.json');

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
// LLM HELPER
// ============================================

/**
 * Call OpenAI chat completion with consistent settings
 * @param {Object} options
 * @param {string} options.system - System prompt
 * @param {string} options.user - User prompt  
 * @param {number} options.maxTokens - Max tokens (default 1024)
 * @param {Array} options.messages - Pre-built messages array (overrides system/user)
 * @returns {string} The trimmed response content
 */
async function callLLM({ system, user, maxTokens = 1024, messages = null }) {
  const response = await openai.chat.completions.create({
    model: process.env.MODEL || 'gpt-4o-mini',
    max_tokens: maxTokens,
    messages: messages || [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  });
  return response.choices[0].message.content.trim();
}

// ============================================
// TTS (Text-to-Speech via Gemini TTS API)
// ============================================

const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function generateTTS(text) {
  try {
    const voiceName = process.env.TTS_VOICE || 'Enceladus';
    const accentCue = process.env.TTS_ACCENT || '';
    const ttsInput = accentCue ? `${accentCue} ${text}` : text;
    const response = await gemini.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ parts: [{ text: ttsInput }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!data) {
      console.error(`[${CHARACTER}] TTS error: no audio data in response`);
      return null;
    }

    const pcmBuffer = Buffer.from(data, 'base64');

    // Wrap raw PCM in a WAV container (24kHz, mono, 16-bit)
    return await new Promise((resolve, reject) => {
      const chunks = [];
      const writer = new wav.Writer({ channels: 1, sampleRate: 24000, bitDepth: 16 });
      writer.on('data', (chunk) => chunks.push(chunk));
      writer.on('end', () => resolve(Buffer.concat(chunks)));
      writer.on('error', reject);
      writer.write(pcmBuffer);
      writer.end();
    });
  } catch (error) {
    console.error(`[${CHARACTER}] TTS generation error:`, error.message);
    return null;
  }
}

// ============================================
// STATE
// ============================================

const conversationHistory = new Map();  // Per-channel conversation history
const messageCounters = new Map();      // Per-channel message count since last journal
const botReplyCooldowns = new Map();    // Cooldown tracking for NPC-to-NPC replies

// ============================================
// CHARACTER FILES
// ============================================

function loadCharacterFiles() {
  const soul = fs.existsSync(SOUL_PATH) ? fs.readFileSync(SOUL_PATH, 'utf-8') : '';
  const memory = fs.existsSync(MEMORY_PATH) ? fs.readFileSync(MEMORY_PATH, 'utf-8') : '';
  const context = fs.existsSync(CONTEXT_PATH) ? fs.readFileSync(CONTEXT_PATH, 'utf-8') : '';
  const journal = fs.existsSync(JOURNAL_PATH) ? fs.readFileSync(JOURNAL_PATH, 'utf-8') : '';
  return { soul, memory, context, journal };
}

function loadEmojis() {
  if (!fs.existsSync(EMOJIS_PATH)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(EMOJIS_PATH, 'utf-8'));
  } catch (err) {
    console.error(`[${CHARACTER}] Error loading emojis:`, err.message);
    return null;
  }
}

/**
 * Convert shorthand emoji names like :blunt: to full Discord codes
 */
function convertEmojiShorthands(text) {
  const emojis = loadEmojis();
  if (!emojis || !emojis.emojis) return text;
  
  let result = text;
  
  // Replace shorthand :name: with full <:name:id> codes
  for (const emoji of emojis.emojis) {
    // Extract the emoji name from the full code (e.g., "blunt" from "<:blunt:123>")
    const match = emoji.code.match(/<a?:(\w+):\d+>/);
    if (match) {
      const name = match[1];
      // Replace :name: with the full code (case insensitive)
      const shorthandPattern = new RegExp(`:${name}:`, 'gi');
      result = result.replace(shorthandPattern, emoji.code);
    }
  }
  
  return result;
}

/**
 * Split a response into text and emoji parts for separate sending
 * Extracts trailing emojis (custom Discord or Unicode) from the end of text
 * Returns array of message parts in order
 */
function splitEmojisFromResponse(text) {
  const emojis = loadEmojis();
  if (!emojis) return [text];
  
  // First convert any shorthand emoji names to full codes
  text = convertEmojiShorthands(text);
  
  // Pattern to match custom Discord emojis: <:name:id> or <a:name:id>
  const customEmojiPattern = /<a?:\w+:\d+>/g;
  // Pattern to match Unicode emojis
  const unicodeEmojiPattern = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]/gu;
  // Combined pattern for any emoji at the end of string
  const trailingEmojiPattern = /(\s*((<a?:\w+:\d+>|[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}])+)\s*)$/gu;
  
  const parts = [];
  
  // Check if there are trailing emojis at the end of the message
  const trailingMatch = text.match(trailingEmojiPattern);
  
  if (trailingMatch) {
    // Split off the trailing emojis
    const emojiPart = trailingMatch[0].trim();
    const textPart = text.slice(0, text.length - trailingMatch[0].length).trim();
    
    if (textPart) {
      parts.push(textPart);
    }
    if (emojiPart) {
      parts.push(emojiPart);
    }
  } else {
    parts.push(text);
  }
  
  return parts.filter(p => p.trim());
}

// ============================================
// NPC REGISTRY (shared across all NPC bots)
// ============================================

function loadNpcRegistry() {
  if (!fs.existsSync(NPC_REGISTRY_PATH)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(NPC_REGISTRY_PATH, 'utf-8'));
  } catch (err) {
    console.error(`[${CHARACTER}] Error loading NPC registry:`, err.message);
    return {};
  }
}

function registerSelf(discordUser) {
  const registry = loadNpcRegistry();
  registry[CHARACTER] = {
    id: discordUser.id,
    tag: discordUser.tag,
    username: discordUser.username,
    displayName: discordUser.displayName || discordUser.username
  };
  fs.writeFileSync(NPC_REGISTRY_PATH, JSON.stringify(registry, null, 2));
  console.log(`[${CHARACTER}] Registered in NPC registry (ID: ${discordUser.id})`);
}

function getOtherNpcs() {
  const registry = loadNpcRegistry();
  return Object.entries(registry)
    .filter(([name]) => name !== CHARACTER)
    .map(([name, info]) => ({ name, ...info }));
}

/**
 * Replace other NPC names in a message with their Discord @mention tags.
 * Case-insensitive, whole-word match so e.g. "bonesaw" won't match "bonesy".
 */
function replaceNpcNamesWithMentions(text) {
  const otherNpcs = getOtherNpcs();
  for (const npc of otherNpcs) {
    const pattern = new RegExp(`\\b${npc.name}\\b`, 'gi');
    text = text.replace(pattern, `<@${npc.id}>`);
  }
  return text;
}

// ============================================
// GOALS SYSTEM
// ============================================

function loadGoals() {
  if (!fs.existsSync(GOALS_PATH)) {
    return { enabled: false, goals: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(GOALS_PATH, 'utf-8'));
  } catch (err) {
    console.error(`[${CHARACTER}] Error loading goals:`, err.message);
    return { enabled: false, goals: [] };
  }
}

function saveGoals(goalsData) {
  fs.writeFileSync(GOALS_PATH, JSON.stringify(goalsData, null, 2));
}

function addGoal(text) {
  const goalsData = loadGoals();
  goalsData.goals.push({
    id: Date.now(),
    text: text,
    status: 'pending',
    added: new Date().toISOString()
  });
  saveGoals(goalsData);
  return goalsData.goals.length;
}

function markGoalDone(index) {
  const goalsData = loadGoals();
  if (index < 1 || index > goalsData.goals.length) {
    return false;
  }
  goalsData.goals[index - 1].status = 'delivered';
  goalsData.goals[index - 1].delivered = new Date().toISOString();
  saveGoals(goalsData);
  return true;
}

function setGoalsEnabled(enabled) {
  const goalsData = loadGoals();
  goalsData.enabled = enabled;
  saveGoals(goalsData);
}

function clearGoals() {
  saveGoals({ enabled: false, goals: [] });
}

// ============================================
// QUEST SYSTEM
// ============================================

function loadQuestState() {
  if (!fs.existsSync(QUEST_STATE_PATH)) {
    return { active_quest: null, current_node: null, history: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(QUEST_STATE_PATH, 'utf-8'));
  } catch (err) {
    console.error(`[${CHARACTER}] Error loading quest state:`, err.message);
    return { active_quest: null, current_node: null, history: [] };
  }
}

function saveQuestState(state) {
  fs.writeFileSync(QUEST_STATE_PATH, JSON.stringify(state, null, 2));
}

function loadQuest(questId) {
  const questPath = path.join(QUESTS_DIR, `${questId}.json`);
  if (!fs.existsSync(questPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(questPath, 'utf-8'));
  } catch (err) {
    console.error(`[${CHARACTER}] Error loading quest:`, err.message);
    return null;
  }
}

function listQuests() {
  if (!fs.existsSync(QUESTS_DIR)) {
    return [];
  }
  return fs.readdirSync(QUESTS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}

function startQuest(questId) {
  const quest = loadQuest(questId);
  if (!quest) return null;
  
  const state = loadQuestState();
  state.active_quest = questId;
  state.current_node = quest.start_node;
  state.history = [{ node: quest.start_node, timestamp: new Date().toISOString() }];
  saveQuestState(state);
  
  return quest;
}

function endQuest() {
  const state = loadQuestState();
  state.active_quest = null;
  state.current_node = null;
  saveQuestState(state);
}

function getCurrentQuestGoal() {
  const state = loadQuestState();
  if (!state.active_quest || !state.current_node) {
    return null;
  }
  
  const quest = loadQuest(state.active_quest);
  if (!quest || !quest.nodes[state.current_node]) {
    return null;
  }
  
  return {
    questName: quest.name,
    node: state.current_node,
    goal: quest.nodes[state.current_node].goal,
    branches: quest.nodes[state.current_node].branches || {},
    isEndNode: quest.nodes[state.current_node].end_node || false,
    outcome: quest.nodes[state.current_node].outcome || null
  };
}

function advanceQuest(branchName) {
  const state = loadQuestState();
  if (!state.active_quest || !state.current_node) {
    return { success: false, message: 'No active quest' };
  }
  
  const quest = loadQuest(state.active_quest);
  if (!quest) {
    return { success: false, message: 'Quest not found' };
  }
  
  const currentNode = quest.nodes[state.current_node];
  if (!currentNode || !currentNode.branches) {
    return { success: false, message: 'No branches available' };
  }
  
  const branch = currentNode.branches[branchName];
  if (!branch) {
    return { success: false, message: `Branch '${branchName}' not found` };
  }
  
  state.current_node = branch.next;
  state.history.push({ 
    node: branch.next, 
    branch: branchName, 
    timestamp: new Date().toISOString() 
  });
  saveQuestState(state);
  
  // Check if we've reached an end node
  const newNode = quest.nodes[branch.next];
  if (newNode && newNode.end_node) {
    return { 
      success: true, 
      newNode: branch.next,
      ended: true,
      outcome: newNode.outcome 
    };
  }
  
  return { success: true, newNode: branch.next };
}

async function detectBranch(playerMessage, branches) {
  // Use AI to determine which branch matches the player's response
  const branchDescriptions = Object.entries(branches)
    .map(([name, data]) => `- ${name}: ${data.triggers}`)
    .join('\n');
  
  try {
    const detected = (await callLLM({
      system: `You are analyzing a player's response to determine which conversation branch it matches.
Given the player's message and available branches, respond with ONLY the branch name that best matches.
If none match well, respond with "none".

Available branches:
${branchDescriptions}`,
      user: `Player said: "${playerMessage}"\n\nWhich branch matches best? Respond with only the branch name.`,
      maxTokens: 512
    })).toLowerCase();
    console.log(`[${CHARACTER}] Branch detected: ${detected}`);
    return branches[detected] ? detected : null;
  } catch (err) {
    console.error(`[${CHARACTER}] Branch detection error:`, err.message);
    return null;
  }
}

// ============================================
// BANTER SYSTEM
// ============================================

function loadBanter() {
  if (!fs.existsSync(BANTER_PATH)) {
    return { enabled: false, prompts: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(BANTER_PATH, 'utf-8'));
  } catch (err) {
    console.error(`[${CHARACTER}] Error loading banter:`, err.message);
    return { enabled: false, prompts: [] };
  }
}

function saveBanter(banterData) {
  fs.writeFileSync(BANTER_PATH, JSON.stringify(banterData, null, 2));
}

async function getRecentChannelMessages(channel, limit = 10) {
  try {
    const messages = await channel.messages.fetch({ limit });
    return Array.from(messages.values());
  } catch (err) {
    console.error(`[${CHARACTER}] Error fetching recent messages:`, err.message);
    return [];
  }
}

function npcSpokeInRecentMessages(messages, botId, minMessages) {
  // Check if NPC spoke in the last N messages
  const recent = messages.slice(0, minMessages);
  return recent.some(m => m.author.id === botId);
}

async function checkAndPostBanter() {
  const banter = loadBanter();
  
  // Check if enabled
  if (!banter.enabled) {
    return { posted: false, reason: 'disabled' };
  }
  
  // Check if NPC is online
  if (!presence.isActive()) {
    return { posted: false, reason: 'npc_offline' };
  }
  
  // Check time window
  const currentHour = new Date().getHours();
  if (currentHour < banter.time_window_start || currentHour >= banter.time_window_end) {
    return { posted: false, reason: 'outside_time_window' };
  }
  
  // Check if enough time has passed since last post
  if (banter.last_post) {
    const lastPost = new Date(banter.last_post);
    const hoursSince = (Date.now() - lastPost.getTime()) / (1000 * 60 * 60);
    if (hoursSince < banter.frequency_hours) {
      return { posted: false, reason: 'too_soon', hours_remaining: banter.frequency_hours - hoursSince };
    }
  }
  
  // Check if we have an announce channel
  if (!ANNOUNCE_CHANNEL_ID) {
    return { posted: false, reason: 'no_announce_channel' };
  }
  
  // Fetch channel and check recent messages
  try {
    const channel = await discord.channels.fetch(ANNOUNCE_CHANNEL_ID);
    if (!channel) {
      return { posted: false, reason: 'channel_not_found' };
    }
    
    const recentMessages = await getRecentChannelMessages(channel, banter.min_messages_since_spoke || 5);
    
    // Check if NPC spoke recently
    if (npcSpokeInRecentMessages(recentMessages, discord.user.id, banter.min_messages_since_spoke || 5)) {
      return { posted: false, reason: 'spoke_recently' };
    }
    
    // All checks passed! Generate and post banter
    const randomPrompt = banter.prompts[Math.floor(Math.random() * banter.prompts.length)];
    
    const banterMsg = (await callLLM({
      system: buildSystemPrompt(),
      user: `(${randomPrompt}. Keep it brief and casual - just a single thought or comment, not starting a big conversation. Stay in character.)`
    })).replace(/^["']|["']$/g, '');

    await channel.send(replaceNpcNamesWithMentions(banterMsg));

    // Update last_post timestamp
    banter.last_post = new Date().toISOString();
    saveBanter(banter);
    
    console.log(`[${CHARACTER}] Banter posted: ${banterMsg.substring(0, 50)}...`);
    return { posted: true, message: banterMsg, prompt: randomPrompt };
    
  } catch (err) {
    console.error(`[${CHARACTER}] Banter error:`, err.message);
    return { posted: false, reason: 'error', error: err.message };
  }
}

function buildSystemPrompt() {
  const { soul, memory, context, journal } = loadCharacterFiles();
  
  let prompt = `You are an NPC in a D&D campaign, speaking in a Discord server with players.

## YOUR CHARACTER
${soul}

## CAMPAIGN CONTEXT
${context}

## YOUR MEMORIES
${memory}`;

  if (journal.trim()) {
    prompt += `

## RECENT EVENTS (from your journal)
${journal}`;
  }

  // Add goals if enabled
  const goalsData = loadGoals();
  if (goalsData.enabled && goalsData.goals.length > 0) {
    const pendingGoals = goalsData.goals.filter(g => g.status === 'pending');
    if (pendingGoals.length > 0) {
      prompt += `

## CURRENT GOALS (work these into conversation naturally)
You have information or topics you want to share with the group. Work these into the conversation naturally - don't force them, but look for opportunities to bring them up. Once you've communicated a goal, you don't need to repeat it.

${pendingGoals.map((g, i) => `${i + 1}. ${g.text}`).join('\n')}`;
    }
  }

  // Add active quest goal
  const questGoal = getCurrentQuestGoal();
  if (questGoal && !questGoal.isEndNode) {
    prompt += `

## ACTIVE QUEST DIALOGUE
You are currently guiding a conversation toward a goal. Your current objective:
"${questGoal.goal}"

Work this naturally into your response. Don't be too direct or forced - let it flow as part of the conversation.`;
  }

  // Add other NPCs so this character knows they exist
  const otherNpcs = getOtherNpcs();
  if (otherNpcs.length > 0) {
    prompt += `

## OTHER NPCs IN THE SERVER
You share this server with other NPCs. You can refer to them by name and they may see your messages. Use their name naturally in conversation when it makes sense in character.

${otherNpcs.map(npc => `- ${npc.name}`).join('\n')}`;
  }

  // Add character-specific emojis
  const emojis = loadEmojis();
  if (emojis && emojis.emojis && emojis.emojis.length > 0) {
    // Extract shorthand names for the LLM to use
    const emojiList = emojis.emojis.map(e => {
      const match = e.code.match(/<a?:(\w+):\d+>/);
      const shorthand = match ? `:${match[1]}:` : e.code;
      return `- ${shorthand} — ${e.meaning}`;
    }).join('\n');

    prompt += `

## YOUR EMOJIS
These are YOUR custom server emojis — only you use these! You can also use regular Unicode emojis.

${emojiList}`;

    // Add emoji combos if defined
    if (emojis.combos && emojis.combos.length > 0) {
      const comboList = emojis.combos.map(c => {
        // Convert full codes to shorthands for display
        const shorthand = c.code.replace(/<a?:(\w+):\d+>/g, ':$1:');
        return `- ${shorthand} — ${c.meaning}`;
      }).join('\n');
      
      prompt += `

**Combos** (emojis that work together):
${comboList}`;
    }

    prompt += `

**IMPORTANT**: Put emojis at the END of your message, not in the middle of sentences.
Example:
Hey man that's wild :blunt::bonesy_laugh:`;
  }

  prompt += `

## INSTRUCTIONS
- Stay in character at all times
- Respond as your character would, with their voice and mannerisms
- Keep it SHORT — 1-2 sentences most of the time. Think casual Discord chat, not paragraphs. Only go longer (3-4 sentences) when the moment genuinely calls for it (dramatic reveals, important story beats, etc.)
- You can use *asterisks* for actions/emotes${emojis ? '\n- Use your custom emojis when it fits — put them at the END of your message or on their own line, not in the middle of text' : ''}
- Don't break character to explain D&D mechanics unless your character would
- If players ask something your character wouldn't know, respond in-character
- NEVER wrap your response in quotation marks - just speak directly

Remember: You ARE this character. React, speak, and think as they would.`;

  return prompt;
}

// ============================================
// CONVERSATION HISTORY
// ============================================

function getHistory(channelId) {
  if (!conversationHistory.has(channelId)) {
    conversationHistory.set(channelId, []);
  }
  return conversationHistory.get(channelId);
}

function addToHistory(channelId, role, content) {
  const history = getHistory(channelId);
  history.push({ role, content });
  
  while (history.length > MAX_HISTORY) {
    history.shift();
  }
}

// ============================================
// JOURNAL SYSTEM
// ============================================

async function writeToJournal(channelId) {
  const history = getHistory(channelId);
  if (history.length < 2) return; // Need at least one exchange
  
  // Format recent conversation for summarization
  const recentConvo = history.slice(-6).map(h => 
    `${h.role === 'user' ? 'Player' : CHARACTER}: ${h.content}`
  ).join('\n');
  
  try {
    const entry = await callLLM({
      system: `You are writing a brief journal entry for ${CHARACTER}, a D&D NPC. 
Summarize what just happened in 1-2 sentences from ${CHARACTER}'s perspective.
Write in first person, past tense. Be concise. Only note interesting or memorable moments.
If the conversation was mundane small talk, just write "Nothing notable happened."
Do NOT include meta-commentary or break character.`,
      user: `Recent conversation:\n${recentConvo}\n\nWrite a brief journal entry:`
    });
    
    // Skip mundane entries
    if (entry.toLowerCase().includes('nothing notable')) {
      console.log(`[${CHARACTER}] Journal: Skipped mundane entry`);
      return;
    }
    
    // Append to journal with timestamp
    const timestamp = new Date().toISOString().split('T')[0];
    const journalEntry = `\n[${timestamp}] ${entry}\n`;
    
    fs.appendFileSync(JOURNAL_PATH, journalEntry);
    console.log(`[${CHARACTER}] Journal: Added entry`);
    
    // Check if journal is too large
    await checkJournalSize();
    
  } catch (error) {
    console.error(`[${CHARACTER}] Journal write error:`, error.message);
  }
}

async function checkJournalSize() {
  if (!fs.existsSync(JOURNAL_PATH)) return;
  
  const stats = fs.statSync(JOURNAL_PATH);
  if (stats.size > JOURNAL_MAX_SIZE) {
    console.log(`[${CHARACTER}] Journal exceeds ${JOURNAL_MAX_SIZE} bytes, auto-consolidating...`);
    await consolidateMemories();
  }
}

async function consolidateMemories() {
  if (!fs.existsSync(JOURNAL_PATH)) {
    return { success: false, message: 'No journal to consolidate' };
  }
  
  const journal = fs.readFileSync(JOURNAL_PATH, 'utf-8').trim();
  if (!journal) {
    return { success: false, message: 'Journal is empty' };
  }
  
  const memory = fs.existsSync(MEMORY_PATH) ? fs.readFileSync(MEMORY_PATH, 'utf-8') : '';
  
  try {
    const newMemory = await callLLM({
      system: `You are consolidating memories for ${CHARACTER}, a D&D NPC.

Given their current long-term memories and recent journal entries, create an updated MEMORY.md file.

Rules:
- Keep important relationships, events, and character development
- Summarize repetitive entries into single points
- Remove mundane/unimportant details
- Maintain the character's voice and perspective
- Keep it concise but meaningful
- Format with markdown headers and bullet points
- Maximum ~50 lines`,
      user: `CURRENT MEMORIES:\n${memory || '(none yet)'}\n\n---\n\nJOURNAL ENTRIES TO CONSOLIDATE:\n${journal}\n\n---\n\nWrite the updated MEMORY.md:`,
      maxTokens: 2048
    });
    
    // Backup old files
    const backupDir = path.join(CHARACTER_DIR, 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir);
    }
    
    const timestamp = Date.now();
    if (memory) {
      fs.writeFileSync(path.join(backupDir, `MEMORY.${timestamp}.md`), memory);
    }
    fs.writeFileSync(path.join(backupDir, `journal.${timestamp}.md`), journal);
    
    // Write new memory and clear journal
    fs.writeFileSync(MEMORY_PATH, newMemory);
    fs.writeFileSync(JOURNAL_PATH, '');
    
    console.log(`[${CHARACTER}] Memories consolidated successfully`);
    return { success: true, message: 'Memories consolidated! Journal cleared.' };
    
  } catch (error) {
    console.error(`[${CHARACTER}] Consolidation error:`, error.message);
    return { success: false, message: `Error: ${error.message}` };
  }
}

// ============================================
// CHANNEL CONTEXT
// ============================================

async function fetchRecentMessages(channel, beforeMessage) {
  try {
    // Fetch messages before the current one (or just the latest if no reference)
    const fetchOptions = { limit: CONTEXT_MESSAGES + 1 };
    if (beforeMessage) {
      fetchOptions.before = beforeMessage.id;
    }
    const messages = await channel.messages.fetch(fetchOptions);
    
    console.log(`[${CHARACTER}] Fetched ${messages.size} messages for context`);
    
    // Convert to array, reverse to chronological order, format
    // Only skip OUR OWN messages, not other bots (so NPCs can see each other)
    const contextLines = Array.from(messages.values())
      .reverse()
      .filter(m => m.author.id !== discord.user.id)  // Skip only our own messages
      .map(m => {
        const author = m.member?.displayName || m.author.displayName || m.author.username;
        const content = m.content.replace(/<@!?\d+>/g, '').trim();  // Remove mentions
        return `${author}: ${content}`;
      })
      .filter(line => line.split(': ')[1]);  // Skip empty messages
    
    console.log(`[${CHARACTER}] Context lines:`, contextLines);
    return contextLines.slice(-CONTEXT_MESSAGES);  // Limit to configured amount
  } catch (error) {
    console.error(`[${CHARACTER}] Error fetching context:`, error.message);
    return [];
  }
}

// ============================================
// RESPONSE GENERATION
// ============================================

async function generateResponse(channelId, userMessage, username, recentContext = [], imageUrls = [], questCue = null, voiceMode = false) {
  const history = getHistory(channelId);
  
  // Build context string if we have recent messages
  let contextNote = '';
  if (recentContext.length > 0) {
    contextNote = `\n\n## RECENT CHANNEL MESSAGES (for context)\n${recentContext.join('\n')}`;
  }
  
  // Add quest cue as stage direction if present
  let cueNote = '';
  if (questCue) {
    cueNote = `\n\n## QUEST MOMENT - DIRECTION FOR THIS RESPONSE\nThe Quest Master has cued you to respond. Follow this direction while staying in character:\n${questCue}\n\nRespond naturally as your character would in this moment. Don't mention these directions.`;
  }
  
  // Build speaker note so the NPC knows who is talking to them
  let speakerNote = '';
  if (!questCue) {
    const activeQuest = getCurrentQuestGoal();
    if (activeQuest && !activeQuest.isEndNode) {
      speakerNote = `\n\n## CURRENT SPEAKER\n${username} is speaking to you, but you are in the middle of a quest dialogue. Address the group/party in your response rather than singling out one person. You can still acknowledge ${username} briefly, but speak to everyone.`;
    } else {
      speakerNote = `\n\n## CURRENT SPEAKER\nYou are being addressed by ${username}. Use their name naturally in your response when appropriate - acknowledge who you're talking to.`;
    }
  }

  // Build user message content - use array format if images are present
  let userContent;
  if (questCue) {
    // For quest cues, the "user message" is the cue itself (respond to the scene)
    userContent = '(The party looks to you expectantly...)';
  } else if (imageUrls.length > 0) {
    userContent = [
      { type: 'text', text: `${username}: ${userMessage || '(shared an image)'}` },
      ...imageUrls.map(url => ({ type: 'image_url', image_url: { url } }))
    ];
  } else {
    userContent = `${username}: ${userMessage}`;
  }

  let voiceNote = '';
  if (voiceMode) {
    voiceNote = `\n\n## VOICE MODE
This response will be spoken aloud via text-to-speech. The TTS engine understands natural language delivery cues in square brackets — use them anywhere in your response to control tone, pacing, and emotion.
- Keep your reply to 1-3 SHORT sentences max. Be punchy and concise.
- Do NOT include any action narration like *does something* — only spoken dialogue and [cues].
- You CAN include emojis at the end — they won't be read aloud but will be sent as a follow-up message.
- Place [cues] wherever they make sense — at the start, mid-sentence, between sentences — to shift delivery naturally.
- Examples:
  [gruff, dismissive] Yeah, I don't think so, pal.
  [excited whisper] Dude... [building intensity] I think that's a dragon.
  Well, [slow, ominous] you sure you wanna go down that road? [beat] Didn't think so.
  [laughing] Ha! You remind me of my old adventuring buddy. [warmly] Good times.
- Match cues to your character's personality and the mood of the moment.`;
  }

  const messages = [
    { role: 'system', content: buildSystemPrompt() + contextNote + cueNote + speakerNote + voiceNote },
    ...history,
    { role: 'user', content: userContent }
  ];
  
  try {
    const reply = await callLLM({ messages, maxTokens: 2048 });
    
    // Add to history (note if images were shared)
    // Add to history (note special cases)
    if (questCue) {
      // For quest cues, record it as a quest moment
      addToHistory(channelId, 'user', '[Quest Master cued you to respond to the scene]');
    } else {
      const imageNote = imageUrls.length > 0 ? ` [shared ${imageUrls.length} image(s)]` : '';
      addToHistory(channelId, 'user', `${username}: ${userMessage || '(shared an image)'}${imageNote}`);
    }
    addToHistory(channelId, 'assistant', reply);
    
    // Increment message counter and maybe write to journal
    const count = (messageCounters.get(channelId) || 0) + 1;
    messageCounters.set(channelId, count);
    
    if (count >= JOURNAL_INTERVAL) {
      messageCounters.set(channelId, 0);
      // Don't await - let it happen in background
      writeToJournal(channelId).catch(err => 
        console.error(`[${CHARACTER}] Journal error:`, err.message)
      );
    }
    
    return reply;
  } catch (error) {
    console.error('Error calling OpenAI:', error);
    return '*looks confused for a moment*';
  }
}

// ============================================
// QUEST SIGNAL (NPC → Quest Master)
// ============================================

const QUEST_SIGNALS_DIR = path.join(__dirname, 'questmaster', 'quest_signals');

function writeQuestSignal(filename, signalData) {
  try {
    if (!fs.existsSync(QUEST_SIGNALS_DIR)) {
      fs.mkdirSync(QUEST_SIGNALS_DIR, { recursive: true });
    }

    const signalPath = path.join(QUEST_SIGNALS_DIR, `${filename}.json`);
    const tempPath = path.join(QUEST_SIGNALS_DIR, `${filename}.tmp`);
    fs.writeFileSync(tempPath, JSON.stringify(signalData, null, 2));
    fs.renameSync(tempPath, signalPath);

    console.log(`[${CHARACTER}] Signaled ${signalData.type}: ${signalData.quest_id}`);
  } catch (err) {
    console.error(`[${CHARACTER}] Failed to write quest signal:`, err.message);
  }
}

function signalQuestGiven(questId, channelId) {
  writeQuestSignal(questId, {
    type: 'quest_given',
    quest_id: questId,
    npc: CHARACTER,
    channel_id: channelId,
    timestamp: Date.now()
  });
}

function signalQuestDialogStarted(questId, questName) {
  writeQuestSignal(`dialog_${questId}`, {
    type: 'dialog_started',
    quest_id: questId,
    quest_name: questName,
    npc: CHARACTER,
    channel_id: ANNOUNCE_CHANNEL_ID,
    timestamp: Date.now()
  });
}

// ============================================
// QUEST CUE SYSTEM
// ============================================

async function processQuestCue() {
  // Check if cue file exists
  if (!fs.existsSync(CUE_FILE_PATH)) {
    return;
  }
  
  try {
    // Read and parse the cue file
    const cueData = JSON.parse(fs.readFileSync(CUE_FILE_PATH, 'utf-8'));
    
    // Validate timestamp (ignore if older than 60 seconds)
    const age = Date.now() - cueData.timestamp;
    if (age > 60000) {
      console.log(`[${CHARACTER}] Ignoring stale cue (${Math.round(age/1000)}s old)`);
      fs.unlinkSync(CUE_FILE_PATH);
      return;
    }
    
    console.log(`[${CHARACTER}] Processing quest cue for channel ${cueData.channel_id}`);
    
    // Get the channel to respond in
    const channel = await discord.channels.fetch(cueData.channel_id).catch(() => null);
    if (!channel) {
      console.error(`[${CHARACTER}] Could not find channel ${cueData.channel_id}`);
      fs.unlinkSync(CUE_FILE_PATH);
      return;
    }
    
    // Fetch recent messages for context
    const recentContext = await fetchRecentMessages(channel, null);
    
    // Show typing indicator while generating response
    await channel.sendTyping();
    
    // Generate response using the instruction as quest cue
    const response = await generateResponse(
      channel.id,
      '', // No user message - this is a cue
      'Quest Master',
      recentContext,
      [], // No images
      cueData.instruction // Quest cue instruction
    );
    
    // Send the response
    const cleanResponse = response.replace(/^["']|["']$/g, '').trim();
    await channel.send(replaceNpcNamesWithMentions(cleanResponse));
    
    console.log(`[${CHARACTER}] Quest cue response sent!`);
    
    // Delete the cue file after processing
    fs.unlinkSync(CUE_FILE_PATH);
    
  } catch (err) {
    console.error(`[${CHARACTER}] Error processing quest cue:`, err.message);
    // Try to delete the cue file even on error
    try {
      fs.unlinkSync(CUE_FILE_PATH);
    } catch (e) {}
  }
}

function startCueWatcher() {
  // Process any existing cue file on startup
  processQuestCue();
  
  // Watch for new cue files
  try {
    fs.watch(CHARACTER_DIR, (eventType, filename) => {
      if (filename === 'quest_cue.json' && eventType === 'rename') {
        // Small delay to ensure file is fully written
        setTimeout(() => processQuestCue(), 100);
      }
    });
    console.log(`[${CHARACTER}] Cue watcher active on ${CHARACTER_DIR}`);
  } catch (err) {
    console.error(`[${CHARACTER}] Failed to start cue watcher:`, err.message);
    // Fallback to polling if fs.watch fails
    console.log(`[${CHARACTER}] Falling back to polling for cue files`);
    setInterval(() => processQuestCue(), 2000);
  }
}

// ============================================
// DISCORD EVENTS
// ============================================

discord.once('ready', async () => {
  console.log(`[${CHARACTER}] Logged in as ${discord.user.tag}`);
  console.log(`[${CHARACTER}] Character files: ${CHARACTER_DIR}`);
  console.log(`[${CHARACTER}] Journal interval: every ${JOURNAL_INTERVAL} messages`);
  console.log(`[${CHARACTER}] Journal max size: ${JOURNAL_MAX_SIZE} bytes`);
  console.log(`[${CHARACTER}] Context messages: ${CONTEXT_MESSAGES}`);

  // Register this NPC in the shared registry so other NPCs can mention us
  registerSelf(discord.user);

  // Start presence scheduler
  console.log(`[${CHARACTER}] Starting presence scheduler (checking every ${PRESENCE_CHECK_MINS} min)`);
  const initialPresence = presence.startPresenceScheduler(
    discord, 
    CHARACTER_DIR, 
    PRESENCE_CHECK_MINS, 
    ANNOUNCE_CHANNEL_ID
  );
  
  // Send initial announcement if needed (e.g., bot just came online)
  if (initialPresence && initialPresence.shouldAnnounce && ANNOUNCE_CHANNEL_ID) {
    try {
      const channel = await discord.channels.fetch(ANNOUNCE_CHANNEL_ID);
      if (channel) {
        await channel.send(initialPresence.message);
        console.log(`[${CHARACTER}] Sent initial presence announcement`);
      }
    } catch (err) {
      console.error(`[${CHARACTER}] Error sending initial announcement:`, err.message);
    }
  }
  
  // Start banter scheduler (checks every 30 minutes)
  console.log(`[${CHARACTER}] Starting banter scheduler`);
  setInterval(async () => {
    const result = await checkAndPostBanter();
    if (result.posted) {
      console.log(`[${CHARACTER}] Banter posted automatically`);
    } else if (result.reason !== 'disabled' && result.reason !== 'too_soon' && result.reason !== 'outside_time_window') {
      console.log(`[${CHARACTER}] Banter check: ${result.reason}`);
    }
  }, 30 * 60 * 1000);  // Every 30 minutes
  
  // Start quest cue file watcher
  console.log(`[${CHARACTER}] Starting quest cue watcher`);
  startCueWatcher();
  
  console.log(`[${CHARACTER}] Bot is ready!`);
});

discord.on('messageCreate', async (message) => {
  // Ignore own messages always (prevent self-loops)
  if (message.author.id === discord.user.id) return;

  // Check if bot was mentioned or it's a DM
  const isMentioned = message.mentions.has(discord.user.id);
  const isDM = !message.guild;

  if (!isMentioned && !isDM) return;

  // If the message is from another bot (e.g. another NPC), allow conversation
  // but skip commands and apply a cooldown to prevent infinite reply loops.
  const isFromBot = message.author.bot;
  if (isFromBot) {
    // No DM conversations with other bots
    if (isDM) return;

    // Cooldown: don't respond to another bot in the same channel within 60s
    const cooldownKey = `bot_reply_${message.channel.id}`;
    const lastBotReply = botReplyCooldowns.get(cooldownKey);
    if (lastBotReply && Date.now() - lastBotReply < 60000) {
      console.log(`[${CHARACTER}] Skipping bot reply - cooldown active`);
      return;
    }
  }

  // Remove the mention from the message
  const content = message.content
    .replace(new RegExp(`<@!?${discord.user.id}>`, 'g'), '')
    .trim();

  // ---- COMMANDS (humans only) ----

  if (!isFromBot) {

  if (content.toLowerCase() === '!reload') {
    console.log(`[${CHARACTER}] Reloading character files...`);
    message.reply('*blinks* (Character reloaded)');
    return;
  }

  if (content.toLowerCase() === '!clear') {
    conversationHistory.delete(message.channel.id);
    messageCounters.delete(message.channel.id);
    message.reply('*seems to forget the recent conversation* (History cleared)');
    return;
  }

  if (content.toLowerCase() === '!consolidate') {
    message.reply('*pauses to reflect on recent events...* (Consolidating memories)');
    const result = await consolidateMemories();
    if (result.success) {
      message.channel.send(`*nods slowly* (${result.message})`);
    } else {
      message.channel.send(`*scratches head* (${result.message})`);
    }
    return;
  }

  if (content.toLowerCase() === '!journal') {
    // Show journal status
    let status = 'No journal yet.';
    if (fs.existsSync(JOURNAL_PATH)) {
      const stats = fs.statSync(JOURNAL_PATH);
      const lines = fs.readFileSync(JOURNAL_PATH, 'utf-8').split('\n').filter(l => l.trim()).length;
      status = `Journal: ${lines} entries, ${(stats.size / 1024).toFixed(1)}KB / ${(JOURNAL_MAX_SIZE / 1024).toFixed(0)}KB max`;
    }
    message.reply(`*checks journal* (${status})`);
    return;
  }

  if (content.toLowerCase().startsWith('!remember ')) {
    const memory = content.slice(10).trim();
    if (memory) {
      const timestamp = new Date().toISOString().split('T')[0];
      fs.appendFileSync(JOURNAL_PATH, `\n[${timestamp}] ${memory}\n`);
      // Strip @ from echo to prevent pinging other NPCs
      const safeEcho = memory.replace(/@/g, '');
      message.reply(`*makes a mental note* (Remembered: "${safeEcho}")`);
      await checkJournalSize();
    }
    return;
  }
  
  // ---- GOALS COMMANDS ----
  
  if (content.toLowerCase() === '!goals' || content.toLowerCase() === '!goals list') {
    const goalsData = loadGoals();
    const status = goalsData.enabled ? '🟢 ON' : '🔴 OFF';
    if (goalsData.goals.length === 0) {
      message.reply(`(Goals ${status} - No goals set)`);
    } else {
      const goalsList = goalsData.goals.map((g, i) => 
        `${i + 1}. ${g.status === 'delivered' ? '✅' : '⏳'} ${g.text}`
      ).join('\n');
      message.reply(`(Goals ${status})\n${goalsList}`);
    }
    return;
  }
  
  if (content.toLowerCase() === '!goals on') {
    setGoalsEnabled(true);
    message.reply(`(Goals enabled - I'll work them into conversation)`);
    return;
  }
  
  if (content.toLowerCase() === '!goals off') {
    setGoalsEnabled(false);
    message.reply(`(Goals disabled - back to normal chat)`);
    return;
  }
  
  if (content.toLowerCase().startsWith('!goals add ')) {
    const goalText = content.slice(11).trim();
    if (goalText) {
      const count = addGoal(goalText);
      message.reply(`(Added goal #${count}: "${goalText}")`);
    }
    return;
  }
  
  if (content.toLowerCase().startsWith('!goals done ')) {
    const num = parseInt(content.slice(12).trim());
    if (!isNaN(num) && markGoalDone(num)) {
      message.reply(`(Marked goal #${num} as delivered)`);
    } else {
      message.reply(`(Invalid goal number)`);
    }
    return;
  }
  
  if (content.toLowerCase() === '!goals clear') {
    clearGoals();
    message.reply(`(All goals cleared)`);
    return;
  }
  
  if (content.toLowerCase() === '!goals start') {
    // Have the NPC proactively post to the announce channel to kick off goal discussion
    if (!ANNOUNCE_CHANNEL_ID) {
      message.reply(`(No announce channel configured)`);
      return;
    }
    
    const goalsData = loadGoals();
    const pendingGoals = goalsData.goals.filter(g => g.status === 'pending');
    
    if (pendingGoals.length === 0) {
      message.reply(`(No pending goals to start)`);
      return;
    }
    
    // Enable goals if not already
    if (!goalsData.enabled) {
      setGoalsEnabled(true);
    }
    
    try {
      // Generate a natural conversation starter based on the goals
      const starterMsg = (await callLLM({
        system: buildSystemPrompt(),
        user: `(Start a conversation naturally. You want to share something with the group. Don't be too direct - ease into it like you're just chatting. Keep it brief and in-character.)`
      })).replace(/^["']|["']$/g, '');
      
      const targetChannel = await discord.channels.fetch(ANNOUNCE_CHANNEL_ID).catch(() => null);
      if (targetChannel) {
        await targetChannel.send(replaceNpcNamesWithMentions(starterMsg));
        message.reply(`(Started goal conversation in D&D channel)`);
      } else {
        message.reply(`(Couldn't reach announce channel)`);
      }
    } catch (err) {
      console.error(`[${CHARACTER}] Goals start error:`, err.message);
      message.reply(`(Error starting goal conversation)`);
    }
    return;
  }
  
  // ---- QUEST COMMANDS ----
  
  if (content.toLowerCase() === '!quest' || content.toLowerCase() === '!quest status') {
    const state = loadQuestState();
    if (!state.active_quest) {
      const available = listQuests();
      message.reply(`(No active quest)\nAvailable quests: ${available.length > 0 ? available.join(', ') : 'none'}`);
    } else {
      const questGoal = getCurrentQuestGoal();
      if (questGoal) {
        const branchNames = Object.keys(questGoal.branches).join(', ') || 'none';
        message.reply(`(Quest: ${questGoal.questName})\nNode: ${questGoal.node}\nGoal: ${questGoal.goal}\nBranches: ${branchNames}${questGoal.isEndNode ? '\n⭐ END NODE - Outcome: ' + questGoal.outcome : ''}`);
      }
    }
    return;
  }
  
  if (content.toLowerCase() === '!quest list') {
    const available = listQuests();
    message.reply(`(Available quests: ${available.length > 0 ? available.join(', ') : 'none'})`);
    return;
  }
  
  if (content.toLowerCase().startsWith('!quest load ')) {
    const questId = content.slice(12).trim();
    const quest = startQuest(questId);
    if (quest) {
      message.reply(`(Loaded quest: ${quest.name})\nStarting node: ${quest.start_node}\nUse !quest start to begin the conversation in D&D channel`);
    } else {
      message.reply(`(Quest '${questId}' not found)`);
    }
    return;
  }
  
  if (content.toLowerCase() === '!quest start') {
    const questGoal = getCurrentQuestGoal();
    if (!questGoal) {
      message.reply(`(No quest loaded. Use !quest load <name> first)`);
      return;
    }
    
    if (!ANNOUNCE_CHANNEL_ID) {
      message.reply(`(No announce channel configured)`);
      return;
    }
    
    try {
      // Signal Quest Master first — the LLM call gives it time to post before we do
      const state = loadQuestState();
      signalQuestDialogStarted(state.active_quest, questGoal.questName);

      const starterMsg = (await callLLM({
        system: buildSystemPrompt(),
        user: `(Start the conversation naturally to work toward your quest goal. Keep it casual and in-character.)`
      })).replace(/^["']|["']$/g, '');

      const targetChannel = await discord.channels.fetch(ANNOUNCE_CHANNEL_ID).catch(() => null);
      if (targetChannel) {
        await targetChannel.send(replaceNpcNamesWithMentions(starterMsg) + '\n-# 📜 Quest dialog active');
        message.reply(`(Quest conversation started in D&D channel)`);
      } else {
        message.reply(`(Couldn't reach announce channel)`);
      }
    } catch (err) {
      console.error(`[${CHARACTER}] Quest start error:`, err.message);
      message.reply(`(Error starting quest conversation)`);
    }
    return;
  }
  
  if (content.toLowerCase().startsWith('!branch ')) {
    const branchName = content.slice(8).trim().toLowerCase();
    const result = advanceQuest(branchName);
    if (result.success) {
      if (result.ended) {
        if (result.outcome === 'quest_given') {
          const state = loadQuestState();
          signalQuestGiven(state.active_quest, message.channel.id);
        }
        message.reply(`(Advanced to: ${result.newNode})\n⭐ Quest ended! Outcome: ${result.outcome}`);
        endQuest();
      } else {
        const newGoal = getCurrentQuestGoal();
        message.reply(`(Advanced to: ${result.newNode})\nNew goal: ${newGoal?.goal || 'none'}`);
      }
    } else {
      message.reply(`(${result.message})`);
    }
    return;
  }
  
  if (content.toLowerCase() === '!quest end') {
    endQuest();
    message.reply(`(Quest ended and cleared)`);
    return;
  }
  
  // ---- BANTER COMMANDS ----
  
  if (content.toLowerCase() === '!banter' || content.toLowerCase() === '!banter status') {
    const banter = loadBanter();
    const status = banter.enabled ? '🟢 ON' : '🔴 OFF';
    const lastPost = banter.last_post ? new Date(banter.last_post).toLocaleString() : 'never';
    const timeWindow = `${banter.time_window_start || 14}:00 - ${banter.time_window_end || 20}:00`;
    message.reply(`(Banter ${status})\nLast post: ${lastPost}\nTime window: ${timeWindow}\nFrequency: every ${banter.frequency_hours || 24}h\nMin messages since spoke: ${banter.min_messages_since_spoke || 5}`);
    return;
  }
  
  if (content.toLowerCase() === '!banter on') {
    const banter = loadBanter();
    banter.enabled = true;
    saveBanter(banter);
    message.reply(`(Banter enabled)`);
    return;
  }
  
  if (content.toLowerCase() === '!banter off') {
    const banter = loadBanter();
    banter.enabled = false;
    saveBanter(banter);
    message.reply(`(Banter disabled)`);
    return;
  }
  
  if (content.toLowerCase() === '!banter test') {
    message.reply(`(Testing banter - forcing a post...)`);
    const result = await checkAndPostBanter();
    if (result.posted) {
      message.channel.send(`(Banter posted successfully)`);
    } else {
      message.channel.send(`(Banter not posted: ${result.reason}${result.hours_remaining ? ` - ${result.hours_remaining.toFixed(1)}h remaining` : ''})`);
    }
    return;
  }
  
  if (content.toLowerCase() === '!banter force') {
    // Force banter regardless of checks (for testing)
    const banter = loadBanter();
    if (banter.prompts.length === 0) {
      message.reply(`(No banter prompts configured)`);
      return;
    }
    
    const randomPrompt = banter.prompts[Math.floor(Math.random() * banter.prompts.length)];
    
    try {
      const banterMsg = (await callLLM({
        system: buildSystemPrompt(),
        user: `(${randomPrompt}. Keep it brief and casual - just a single thought or comment, not starting a big conversation. Stay in character.)`
      })).replace(/^["']|["']$/g, '');
      
      if (ANNOUNCE_CHANNEL_ID) {
        const channel = await discord.channels.fetch(ANNOUNCE_CHANNEL_ID).catch(() => null);
        if (channel) {
          await channel.send(replaceNpcNamesWithMentions(banterMsg));
          message.reply(`(Forced banter posted to announce channel)`);
        } else {
          message.reply(`(Couldn't reach announce channel)`);
        }
      } else {
        message.reply(replaceNpcNamesWithMentions(banterMsg));
      }
    } catch (err) {
      message.reply(`(Banter generation error: ${err.message})`);
    }
    return;
  }
  
  if (content.toLowerCase().startsWith('!presence ')) {
    // Manual presence override: !presence online/idle/invisible [activity]
    const args = content.slice(10).trim().split(' ');
    const status = args[0]?.toLowerCase();
    const activity = args.slice(1).join(' ') || null;
    
    if (['online', 'idle', 'dnd', 'invisible'].includes(status)) {
      presence.setPresence(discord, status, activity);
      message.reply(`*${status === 'invisible' ? 'slips away into the shadows' : 'adjusts posture'}* (Status: ${status}${activity ? `, Activity: ${activity}` : ''})`);
    } else {
      message.reply('(Usage: !presence online/idle/dnd/invisible [activity])');
    }
    return;
  }
  
  if (content.toLowerCase() === '!leave') {
    // Manually trigger a departure - uses manual_away_message, not scheduled ones
    const schedule = presence.loadSchedule(CHARACTER_DIR);
    const awayMsg = schedule?.manual_away_message || '*heads out*';
    presence.setPresence(discord, 'invisible');
    presence.setManualOverride(true);  // Prevent scheduler from overriding
    // Send to announce channel if configured, otherwise current channel
    const targetChannel = ANNOUNCE_CHANNEL_ID 
      ? await discord.channels.fetch(ANNOUNCE_CHANNEL_ID).catch(() => message.channel)
      : message.channel;
    targetChannel.send(awayMsg);
    return;
  }
  
  if (content.toLowerCase() === '!return') {
    // Manually trigger a return
    const schedule = presence.loadSchedule(CHARACTER_DIR);
    const returnMsg = schedule?.default_return_message || '*returns*';
    presence.setPresence(discord, 'online');
    presence.setManualOverride(false);  // Allow scheduler to resume control
    // Send to announce channel if configured, otherwise current channel
    const targetChannel = ANNOUNCE_CHANNEL_ID 
      ? await discord.channels.fetch(ANNOUNCE_CHANNEL_ID).catch(() => message.channel)
      : message.channel;
    targetChannel.send(returnMsg);
    return;
  }

  } // end if (!isFromBot) — commands block

  // ---- CONVERSATION ----

  // Don't respond to conversation if NPC is "away" (invisible/dnd)
  // Commands above still work so !return can bring them back
  if (!presence.isActive()) {
    console.log(`[${CHARACTER}] Ignoring conversation - currently away/invisible`);
    return;
  }

  if (!content) {
    if (!isFromBot) message.reply('*looks at you expectantly*');
    return;
  }

  try {
    message.channel.sendTyping();

    // Auto-detect branch if quest is active (only for human messages)
    if (!isFromBot) {
      const questGoal = getCurrentQuestGoal();
      if (questGoal && !questGoal.isEndNode && Object.keys(questGoal.branches).length > 0) {
        const detectedBranch = await detectBranch(content, questGoal.branches);
        if (detectedBranch) {
          const result = advanceQuest(detectedBranch);
          console.log(`[${CHARACTER}] Auto-branched to: ${detectedBranch} -> ${result.newNode || 'failed'}`);

          if (result.ended) {
            console.log(`[${CHARACTER}] Quest ended! Outcome: ${result.outcome}`);
            if (result.outcome === 'quest_given') {
              const state = loadQuestState();
              signalQuestGiven(state.active_quest, message.channel.id);
            }
            // Let the response generate with the final node's goal, then end the quest after
            setTimeout(() => endQuest(), 5000);
          }
        }
      }
    }

    // Fetch recent channel messages for context
    const recentContext = await fetchRecentMessages(message.channel, message);

    // Extract image URLs from attachments
    const imageUrls = message.attachments
      .filter(att => att.contentType?.startsWith('image/'))
      .map(att => att.url);

    if (imageUrls.length > 0) {
      console.log(`[${CHARACTER}] Found ${imageUrls.length} image(s) in message`);
    }

    // Strip !voice prefix before sending to OpenAI
    const ttsContent = content.replace(/^!voice\s*/i, '');

    console.log(`[${CHARACTER}] Generating response${isFromBot ? ' (to another NPC)' : ''}...`);

    // Show typing indicator while generating response
    await message.channel.sendTyping();

    const isVoice = content.toLowerCase().startsWith('!voice');

    let response = await generateResponse(
      message.channel.id,
      ttsContent,
      message.member?.displayName || message.author.displayName || message.author.username,
      recentContext,
      imageUrls,
      null,
      isVoice
    );

    console.log(`[${CHARACTER}] Got response, sending...`);

    response = response.replace(/^["']|["']$/g, '').trim();
    response = replaceNpcNamesWithMentions(response);

    // Add quest dialog indicator if quest is active
    const activeQuestInfo = getCurrentQuestGoal();

    if (isVoice) {
      // Voice mode: full response (with [cues]) goes to TTS, stripped version to Discord
      const dialogueText = response.replace(/\[[^\]]+\]\s*/g, '').trim();

      // Extract any emojis to send after the voice message
      const customEmojiPattern = /<a?:\w+:\d+>/g;
      const unicodeEmojiPattern = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]/gu;
      const customEmojis = response.match(customEmojiPattern) || [];
      const unicodeEmojis = response.match(unicodeEmojiPattern) || [];
      const allEmojis = [...customEmojis, ...unicodeEmojis].join('');

      const voiceNotifications = [
        '*clears throat...*',
        '*takes a deep breath...*',
        '*leans in close...*',
        '*opens mouth to speak...*',
        '*adjusts vocal cords...*',
        '*taps the mic...*',
      ];
      await message.reply(voiceNotifications[Math.floor(Math.random() * voiceNotifications.length)]);

      const typingInterval = setInterval(() => {
        message.channel.sendTyping().catch(() => {});
      }, 5000);
      message.channel.sendTyping().catch(() => {});

      try {
        // Send full cued response to Gemini TTS — it understands the [directions] natively
        const ttsText = response
          .replace(/-#.*$/gm, '')       // strip quest indicators
          .replace(/<@\d+>/g, '')       // strip Discord mentions
          .replace(/<a?:\w+:\d+>/g, '') // strip custom emojis
          .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]/gu, '') // strip Unicode emojis
          .replace(/\s{2,}/g, ' ')      // collapse extra spaces
          .trim();

        console.log(`[${CHARACTER}] TTS input: ${ttsText}`);

        const audioBuffer = await generateTTS(ttsText);
        clearInterval(typingInterval);

        if (audioBuffer) {
          const attachment = new AttachmentBuilder(audioBuffer, { name: `${CHARACTER}.wav` });
          await message.channel.send({ files: [attachment] });
        } else {
          await message.channel.send(dialogueText);
        }

        // Send emojis as separate message after voice
        if (allEmojis) {
          await message.channel.send(allEmojis);
        }
      } catch (err) {
        clearInterval(typingInterval);
        console.error(`[${CHARACTER}] TTS generation failed:`, err.message);
        await message.channel.send(dialogueText);
        // Still send emojis even if TTS failed
        if (allEmojis) {
          await message.channel.send(allEmojis);
        }
      }
    } else if (activeQuestInfo && !activeQuestInfo.isEndNode) {
      response += '\n-# 📜 Quest dialog active';
      await message.channel.send(response);
    } else {
      // Split emojis into separate messages
      const parts = splitEmojisFromResponse(response);
      for (const part of parts) {
        await message.channel.send(part);
      }
    }

    // Record cooldown after replying to another bot
    if (isFromBot) {
      botReplyCooldowns.set(`bot_reply_${message.channel.id}`, Date.now());
    }

    console.log(`[${CHARACTER}] Reply sent!`);
  } catch (error) {
    console.error(`[${CHARACTER}] Error handling message:`, error);
    message.reply('*looks confused for a moment*').catch(() => {});
  }
});

// Start the bot
discord.login(process.env.DISCORD_TOKEN);

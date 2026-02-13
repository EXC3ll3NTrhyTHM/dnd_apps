/**
 * Dialogue Engine
 *
 * Handles NPC conversation for the web app.
 * Mirrors the Discord bot's buildSystemPrompt() pattern
 * but adapted for location-based web chat with emotion tags.
 */

const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const CHARACTERS_DIR = path.resolve(__dirname, '..', '..', '..', 'characters');
const NPC_REGISTRY_PATH = path.resolve(__dirname, '..', '..', '..', 'npc_registry.json');
const LOCATIONS_PATH = path.resolve(__dirname, '..', '..', 'data', 'locations.json');

const VALID_EMOTIONS = ['idle', 'happy', 'angry', 'suspicious', 'sad', 'surprised', 'scared', 'thoughtful'];

let openai = null;

function getOpenAI() {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

// ============================================
// CHARACTER CONTEXT LOADING
// ============================================

function loadCharacterContext(npcName) {
  const charDir = path.join(CHARACTERS_DIR, npcName);

  const readFile = (filename) => {
    try {
      return fs.readFileSync(path.join(charDir, filename), 'utf-8');
    } catch {
      return '';
    }
  };

  return {
    soul: readFile('SOUL.md'),
    memory: readFile('MEMORY.md'),
    context: readFile('CONTEXT.md'),
    journal: readFile('journal.md')
  };
}

function loadNpcRegistry() {
  try {
    return JSON.parse(fs.readFileSync(NPC_REGISTRY_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function loadLocations() {
  try {
    return JSON.parse(fs.readFileSync(LOCATIONS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

// ============================================
// SYSTEM PROMPT BUILDING
// ============================================

function buildWebSystemPrompt(npcName, locationContext, playerName) {
  const { soul, memory, context, journal } = loadCharacterContext(npcName);

  if (!soul) {
    return `You are ${npcName}, an NPC in a D&D campaign. Stay in character and respond briefly.`;
  }

  // Extract character name from SOUL.md first line
  const nameMatch = soul.match(/^#\s*(.+?)(?:\s*[—\-–]|$)/m);
  const characterName = nameMatch ? nameMatch[1].trim() : npcName;

  let prompt = `You ARE ${characterName}. You speak in first person. You NEVER refer to yourself in third person. You NEVER talk about "${characterName}" as if they are someone else — that IS you.

You are an NPC in the Bound By Rot D&D campaign, chatting with players through a web app at a location in Okhan.

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

  // Location awareness
  if (locationContext) {
    prompt += `

## CURRENT LOCATION
You are currently at: ${locationContext.name} — ${locationContext.description}
${locationContext.otherNpcs?.length > 0 ? `Also present: ${locationContext.otherNpcs.join(', ')}` : ''}`;
  }

  // Other NPCs awareness
  const registry = loadNpcRegistry();
  const otherNpcs = Object.entries(registry)
    .filter(([key]) => key !== npcName)
    .map(([, val]) => val.displayName || val.username);

  if (otherNpcs.length > 0) {
    prompt += `

## OTHER NPCs YOU KNOW
${otherNpcs.map(n => `- ${n}`).join('\n')}`;
  }

  prompt += `

## CURRENT SPEAKER
You are being addressed by ${playerName}. Use their name naturally when appropriate.

## RESPONSE FORMAT
You must respond with valid JSON in this exact format:
{"text": "your in-character response here", "emotion": "one of: idle, happy, angry, suspicious, sad, surprised, scared, thoughtful"}

Choose the emotion that best matches your character's mood in this response. Default to "idle" for neutral responses.

## INSTRUCTIONS
- Stay in character at all times
- Respond as your character would, with their voice and mannerisms
- Keep it SHORT — 1-2 sentences most of the time. Think casual chat, not paragraphs. Only go longer (3-4 sentences) when the moment genuinely calls for it
- You can use *asterisks* for actions/emotes
- Don't break character to explain D&D mechanics unless your character would
- If players ask something your character wouldn't know, respond in-character
- NEVER wrap your text response in quotation marks - just speak directly
- NEVER refer to yourself in third person. You ARE this character — use "I", "me", "my"
- Do NOT use custom Discord emojis (like :blunt: or <:emoji:id>) — only use standard Unicode emojis sparingly

Remember: You ARE this character. React, speak, and think as they would. Always use first person.
IMPORTANT: Your entire response must be valid JSON. Nothing else.`;

  return prompt;
}

// ============================================
// RESPONSE GENERATION
// ============================================

async function generateResponse(npcName, playerName, message, history = [], locationContext = null) {
  const systemPrompt = buildWebSystemPrompt(npcName, locationContext, playerName);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-20).map(h => ({
      role: h.role === 'player' ? 'user' : 'assistant',
      content: h.role === 'player'
        ? `${h.playerName || 'Player'}: ${h.text}`
        : JSON.stringify({ text: h.text, emotion: h.emotion || 'idle' })
    })),
    { role: 'user', content: `${playerName}: ${message}` }
  ];

  try {
    const ai = getOpenAI();
    const response = await ai.chat.completions.create({
      model: process.env.CHAT_MODEL || 'gpt-4o-mini',
      max_tokens: 512,
      temperature: 0.9,
      messages
    });

    const raw = response.choices[0].message.content.trim();

    // Parse JSON response
    try {
      const parsed = JSON.parse(raw);
      return {
        text: parsed.text || raw,
        emotion: VALID_EMOTIONS.includes(parsed.emotion) ? parsed.emotion : 'idle',
        npc: npcName
      };
    } catch {
      // If JSON parse fails, treat the whole thing as text
      return {
        text: raw.replace(/^["']|["']$/g, ''),
        emotion: 'idle',
        npc: npcName
      };
    }
  } catch (error) {
    console.error(`[dialogue] Error generating response for ${npcName}:`, error.message);
    return {
      text: '*looks confused for a moment*',
      emotion: 'idle',
      npc: npcName
    };
  }
}

// ============================================
// NPC PICKER (room chat mode)
// ============================================

async function pickRespondingNpc(locationNpcs, message, recentHistory = [], groups = {}) {
  // Only NPCs explicitly @mentioned will respond
  const registry = loadNpcRegistry();
  const msgLower = message.toLowerCase();

  // Expand group @mentions into their member NPC IDs
  const groupMentionedNpcs = new Set();
  for (const [groupId, group] of Object.entries(groups || {})) {
    const groupName = group.displayName || groupId;
    if (msgLower.includes(`@${groupName.toLowerCase()}`)) {
      for (const memberId of (group.members || [])) {
        groupMentionedNpcs.add(memberId);
      }
    }
  }

  const mentioned = locationNpcs.filter(npc => {
    const entry = registry[npc];
    if (!entry) return false;

    // Skip NPCs handled by external systems (like Marcel/Clawdbot)
    if (entry.handledBy) return false;

    // Check if NPC is in an @mentioned group
    if (groupMentionedNpcs.has(npc)) return true;

    const names = [entry.displayName, entry.username, npc].filter(Boolean);
    return names.some(name =>
      msgLower.includes(`@${name.toLowerCase()}`)
    );
  });

  return mentioned;
}

// ============================================
// JOURNAL INTEGRATION
// ============================================

async function writeWebJournal(npcName, history) {
  if (history.length < 4) return;

  const recentConvo = history.slice(-6).map(h =>
    `${h.role === 'player' ? (h.playerName || 'Player') : npcName}: ${h.text}`
  ).join('\n');

  try {
    const ai = getOpenAI();
    const response = await ai.chat.completions.create({
      model: process.env.CHAT_MODEL || 'gpt-4o-mini',
      max_tokens: 200,
      messages: [
        {
          role: 'system',
          content: `You are writing a brief journal entry for ${npcName}, a D&D NPC.
Summarize what just happened in 1-2 sentences from ${npcName}'s perspective.
Write in first person, past tense. Be concise. Only note interesting or memorable moments.
If the conversation was mundane small talk, just write "Nothing notable happened."
Do NOT include meta-commentary or break character.`
        },
        {
          role: 'user',
          content: `Recent conversation:\n${recentConvo}\n\nWrite a brief journal entry:`
        }
      ]
    });

    const entry = response.choices[0].message.content.trim();

    if (entry.toLowerCase().includes('nothing notable')) {
      return;
    }

    const journalPath = path.join(CHARACTERS_DIR, npcName, 'journal.md');
    const timestamp = new Date().toISOString().split('T')[0];
    const journalEntry = `\n[${timestamp}] ${entry}\n`;

    fs.appendFileSync(journalPath, journalEntry);
    console.log(`[dialogue] Journal entry added for ${npcName}`);
  } catch (error) {
    console.error(`[dialogue] Journal write error for ${npcName}:`, error.message);
  }
}

module.exports = {
  loadCharacterContext,
  loadNpcRegistry,
  loadLocations,
  buildWebSystemPrompt,
  generateResponse,
  pickRespondingNpc,
  writeWebJournal,
  VALID_EMOTIONS
};

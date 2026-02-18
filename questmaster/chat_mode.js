/**
 * Chat Mode for Quest Manager
 * 
 * Enables free-form chat interaction instead of buttons.
 * AI decides when to progress stages, cue NPCs, and send images.
 */

const fs = require('fs');
const path = require('path');

// Track which channels are in chat mode
// channelId -> { questId, definition, quest }
const chatModeSessions = new Map();

/**
 * Check if a quest should use chat mode
 */
function isChateMode(questDefinition) {
  return questDefinition.chat_mode === true;
}

/**
 * Start chat mode for a quest in a channel
 */
function startChatMode(channelId, questId, definition, quest) {
  chatModeSessions.set(channelId, {
    questId,
    definition,
    quest,
    lastActivity: Date.now()
  });
  console.log(`[ChatMode] Started for quest ${questId} in channel ${channelId}`);
}

/**
 * End chat mode for a channel
 */
function endChatMode(channelId) {
  chatModeSessions.delete(channelId);
  console.log(`[ChatMode] Ended for channel ${channelId}`);
}

/**
 * Get chat mode session for a channel
 */
function getChatSession(channelId) {
  return chatModeSessions.get(channelId) || null;
}

/**
 * Update quest state in chat session
 */
function updateChatSession(channelId, quest) {
  const session = chatModeSessions.get(channelId);
  if (session) {
    session.quest = quest;
    session.lastActivity = Date.now();
  }
}

/**
 * Build context for AI from quest definition and current stage
 */
function buildChatContext(definition, quest) {
  const stageName = quest.current_stage;
  const stage = definition.stages?.[stageName];
  
  let context = `# QUEST: ${definition.name}\n\n`;
  context += `## Description\n${definition.description}\n\n`;
  
  // Add world context (important rules about NPCs, pronouns, etc.)
  if (definition.world_context) {
    context += `## CRITICAL WORLD RULES\n${definition.world_context}\n\n`;
  }
  
  // Add key NPCs
  if (definition.key_npcs) {
    context += `## NPCs Present\n`;
    for (const [npcId, npc] of Object.entries(definition.key_npcs)) {
      context += `### ${npc.name} (${npcId})\n`;
      context += `- Race: ${npc.race || 'Unknown'}\n`;
      context += `- Personality: ${npc.personality || ''}\n`;
      context += `- Voice/Mannerisms: ${npc.voice || ''}\n`;
      if (npc.description) context += `- Description: ${npc.description}\n`;
      context += `\n`;
    }
  }
  
  // Add current stage info
  if (stage) {
    context += `## Current Stage: ${stageName}\n`;
    context += `${stage.description || ''}\n\n`;
    
    if (stage.narration_prompt) {
      context += `### Scene\n${stage.narration_prompt}\n\n`;
    }
    
    // Add available information/dialogue for this stage
    if (stage.information) {
      context += `### Information Available This Stage\n`;
      for (const [infoId, info] of Object.entries(stage.information)) {
        context += `- **${infoId}**: ${info.content}\n`;
        if (info.trigger) context += `  (Reveal when: ${info.trigger})\n`;
      }
      context += `\n`;
    }
    
    // Add stage advancement conditions
    if (stage.advance_conditions) {
      context += `### Stage Advancement\n`;
      context += `Advance to next stage when: ${stage.advance_conditions}\n`;
      if (stage.next_stage) {
        context += `Next stage: ${stage.next_stage}\n`;
      }
      context += `\n`;
    }

    // Add chat NPC whitelist
    if (stage.chat_npcs) {
      if (stage.chat_npcs.length === 0) {
        context += `### NPC Cueing\nNo NPCs may be cued in this stage. Do NOT set cue_npc.\n\n`;
      } else {
        context += `### NPC Cueing\nOnly these NPCs may be cued: ${stage.chat_npcs.join(', ')}. Do NOT cue any other NPC.\n\n`;
      }
    }

    // Add negative prompts (things to avoid)
    if (stage.negative_prompts && stage.negative_prompts.length > 0) {
      context += `### RESTRICTIONS — Do NOT do any of the following:\n`;
      for (const restriction of stage.negative_prompts) {
        context += `- ${restriction}\n`;
      }
      context += `\n`;
    }
  }
  
  // Add images available
  if (definition.images) {
    context += `## Available Images\n`;
    for (const [imageId, imagePath] of Object.entries(definition.images)) {
      context += `- ${imageId}: ${imagePath}\n`;
    }
    context += `\n`;
  }
  
  return context;
}

/**
 * AI prompt for processing player chat in chat mode
 */
function getChatModeSystemPrompt(context) {
  return `You are a Quest Master running a D&D scene via Discord chat.

${context}

## Your Role
- Narrate the scene and NPC reactions based on player messages
- Decide when NPCs should speak (you'll indicate which NPC, and they'll speak separately)
- Decide when to advance to the next stage based on the advancement conditions
- Decide when to show images based on what's being described

## Response Format
Respond with a JSON object (no markdown, just raw JSON):
{
  "narration": "Your scene narration text here (or null if NPC should speak first)",
  "cue_npc": "npc_id" or null,
  "npc_instruction": "What the NPC should say/do" or null,
  "advance_stage": "next_stage_name" or null,
  "send_image": "image_id" or null,
  "quest_complete": false
}

## Rules
- Keep narration SHORT (2-4 sentences max for Discord)
- Use second person ("You see...", "The prisoner flinches...")
- NEVER end narration with a question like "What will you do?" or "What do you do next?" — just describe the scene and stop
- NEVER include NPC dialogue in the "narration" field. ALL NPC speech MUST go through cue_npc + npc_instruction. The narration should only describe the scene, atmosphere, and what the player sees. If the scene prompt contains NPC dialogue, use it as the npc_instruction and cue that NPC — do not narrate their words yourself.
- If an NPC should respond, set cue_npc and provide npc_instruction with what they should say
- Advance the stage when the player's intent reasonably matches the advance conditions — don't require exact wording. If the player is asking related questions, showing interest, or trying to engage with the topic mentioned in the conditions, that counts. Err on the side of advancing rather than stalling.
- Only set quest_complete when the quest is truly finished
- Don't make decisions for players
- Stay strictly within the quest document - no outside knowledge`;
}

/**
 * Process a player message in chat mode
 * Returns: { narration, cue_npc, npc_instruction, advance_stage, send_image, quest_complete }
 */
async function processChatMessage(openai, model, definition, quest, playerMessage, playerName) {
  const context = buildChatContext(definition, quest);
  const systemPrompt = getChatModeSystemPrompt(context);
  
  try {
    const response = await openai.chat.completions.create({
      model: model || 'gpt-4o-mini',
      max_completion_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Player "${playerName}" says/does: "${playerMessage}"` }
      ]
    });
    
    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.error('[ChatMode] Empty response from AI');
      return { narration: '*The Quest Master pauses...*', error: true };
    }
    
    try {
      const result = JSON.parse(content);
      console.log('[ChatMode] AI decision:', JSON.stringify(result, null, 2));
      return result;
    } catch (parseErr) {
      console.error('[ChatMode] Failed to parse AI response:', content);
      return { narration: content, error: true };
    }
  } catch (err) {
    console.error('[ChatMode] AI error:', err.message);
    return { narration: '*The Quest Master fumbles their notes...*', error: true };
  }
}

module.exports = {
  isChateMode,
  startChatMode,
  endChatMode,
  getChatSession,
  updateChatSession,
  buildChatContext,
  processChatMessage
};

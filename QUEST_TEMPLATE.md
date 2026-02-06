# Quest Creation Guide

---

## ⚠️ QUEST CREATION RULES (PRIORITY)

These rules override all other guidelines. Follow them strictly.

### Rule 1: Consistency Is King

**Everything must be consistent.** This is the single most important rule.

**Character Appearances:**
- Every `key_npc` MUST have a detailed, specific `description` field covering: race, build, height, skin tone, hair (color, style, length), eye color, distinguishing marks (scars, tattoos, etc.), clothing/armor, weapons, and any unique visual traits.
- Once a character's appearance is described, it NEVER changes between stages, actions, or images unless the story explicitly explains why (e.g., they put on a disguise).
- NPC descriptions in `narration_prompt` fields must match their `key_npcs` entry exactly. Do not improvise or add details that contradict the defined appearance.

**Images:**
- Characters depicted in generated images must match their defined descriptions and reference images exactly. Same face, same hair, same clothing, same build, every time.
- If a character appears in multiple stage images, they must look like the same person across all of them.
- Player characters have reference images in `references/characters/`. Always use them when generating scenes that include those characters.
- Quest NPCs should have a `visual_prompt` field in their `key_npcs` entry: a concise image-generation-ready description for feeding directly to the image model, ensuring every generated image of that NPC is visually identical.

**Narration:**
- Character names, titles, speech patterns, and personality traits must remain consistent across all stages and NPC instructions.
- If an NPC has an accent, mannerism, or verbal tic, it appears EVERY time they speak, not just the first time.

### Rule 2: Every Quest Needs Images

**Quests must have images.** They are not optional.

- Every quest should have at least one image per stage. Key emotional moments, reveals, and climactic scenes should always have images.
- Stage images go in the `image` field of the stage and are stored in `characters/<npc>/quests/images/`
- Images should be generated using the character reference images to maintain visual consistency (Rule 1).
- Scene images should be landscape (1536x1024). Character-focused moments can be portrait (1024x1536).
- Generate all quest images before the quest goes live. Don't ship a quest with placeholder or missing images.

### Rule 3: Quest NPCs Need Webhook Avatars

**Every quest NPC (defined in `key_npcs`) must have an avatar image for their Discord webhook.**

- The Quest Manager automatically creates Discord webhooks for quest NPCs so they can "speak" in character during quests.
- Each quest NPC needs an avatar image saved to `characters/<quest_giver>/quests/images/<npc_id>.png`
- The Quest Manager looks for `<npc_id>_avatar.png` or `<npc_id>.png` in the quest images folder.
- This is ONLY for quest NPCs (`key_npcs`), NOT for regular NPC bots (they have their own bot accounts with avatars).
- Use the same reference portrait from `references/characters/` or generate a dedicated avatar. Crop to a square if needed for best Discord webhook display.

### Rule 4: Quest NPCs Need Reference Images

**Before a quest goes live, every key NPC must have a reference image generated and saved.**

- When creating a quest with `key_npcs`, generate a portrait reference image for each new NPC using their `visual_prompt` field.
- Save reference images to `references/characters/<npc_name>.png`
- These reference images are then used by the image generation pipeline to maintain visual consistency across all quest scene images.
- No quest should ship with a key NPC that doesn't have a reference portrait. If you can describe them, you can generate them.

---

## Overview

Quests have **two systems** that work together:

1. **Nodes** - The NPC bot's dialog tree for the **quest hook** (the conversation where the NPC convinces a player to take the quest). This is what the bot uses for real-time branching chat.

2. **Stages** - The Quest Master's **narrative system** for the actual quest experience. Rich scene descriptions, player action buttons, NPC cue instructions, images, and story progression.

Think of it like: **Nodes get them hooked. Stages tell the story.**

---

## Quest JSON Structure

```json
{
  "id": "quest_id_snake_case",
  "name": "Human Readable Quest Name",
  "description": "One-line pitch. What's the quest about?",
  "location": "Where it takes place",
  "reward_gold": 100,
  "tone": "Describe the emotional feel. Examples: 'Wholesome with emotional weight', 'Eerie mystery with dark comedy', 'Tense heist energy'",
  "branching": true,

  "start_node": "first_node_id",
  "current_node": null,
  "active": false,
  "completed": false,
  "quest_flags": [],

  "companions": ["npc_name"],

  "key_npcs": { ... },
  "stages": { ... },
  "nodes": { ... }
}
```

---

## Part 1: Nodes (Dialog Hook Tree)

Nodes are the **NPC-to-player conversation** where the quest gets offered. The bot auto-detects which branch a player's response matches and advances through the tree.

### Node Structure

```json
"node_id": {
  "goal": "What the NPC is trying to do/say in this beat. Written as direction TO the NPC. This is injected into the system prompt.",
  "branches": {
    "branch_name": {
      "triggers": "Description of what player response matches this branch",
      "next": "next_node_id"
    }
  }
}
```

### End Nodes

```json
"quest_accepted": {
  "goal": "NPC reacts to acceptance. Express excitement, give instructions for next steps.",
  "end_node": true,
  "outcome": "quest_given"
}
```

**Outcomes:**
- `quest_given` - Player accepted. Signals the Quest Master to add it to the board.
- `quest_declined` - Player said no. Quest can be re-armed later.
- `quest_shelved` - NPC backed off. Low-stakes decline.

### Node Design Rules

1. **Goals are NPC direction.** Write them like you're directing an actor: "Be excited but nervous. Tell them about X. Ask if they'll help."
2. **Branch triggers are fuzzy.** The AI matches player intent, not exact words. Write triggers as descriptions: "Player shows interest" not "Player says yes."
3. **Always have a decline path.** Players should be able to say no gracefully.
4. **Funnel toward acceptance.** Multiple paths should converge on the acceptance node. Even decline paths can loop back with a softer ask.
5. **3-6 nodes is the sweet spot** for a hook conversation. Too few feels railroaded, too many drags on.
6. **Keep goals to 3-5 sentences.** The NPC generates its own dialog from the goal, so give direction, not a script.

### Node Flow Pattern

```
start_node
  ├── curious → more_detail
  │     ├── interested → offer
  │     │     ├── accepts → quest_given ✓
  │     │     └── declines → soft_decline
  │     └── worried → reassure → offer
  ├── suspicious → reassure
  │     └── convinced → offer
  ├── agrees → quest_given ✓
  └── refuses → plead
        ├── relents → offer
        └── firm_no → quest_declined ✗
```

---

## Part 2: Stages (Narrative Quest System)

Stages are the **Quest Master's playbook** for running the quest. Each stage is a scene with narration, player choices, and optional NPC moments.

### Stage Structure

```json
"stage_id": {
  "description": "Brief internal description of what happens in this stage",
  "image": "optional_image_filename.png",
  "narration_prompt": "The Quest Master reads this aloud or posts it as scene-setting text. Write it like prose - vivid, atmospheric, showing not telling. This IS the D&D experience.",
  "actions": [
    {
      "id": "action_id",
      "label": "🎭 Button Label (emoji + short text)",
      "narration_prompt": "What happens when the player picks this action. Same quality as stage narration.",
      "advances": false
    },
    {
      "id": "advance_action",
      "label": "🥾 Move Forward",
      "narration_prompt": "Narration for this choice.",
      "advances": true,
      "next_stage": "next_stage_id"
    }
  ]
}
```

### Action Types

**Explore actions** (`advances: false`):
- Let players examine, ask questions, observe
- Flesh out the scene without moving the plot
- Players can pick multiple before advancing

**Advance actions** (`advances: true, next_stage: "...")`):
- Move the story forward
- Usually 1-2 per stage
- Should feel like natural "okay, let's move on" moments

**NPC cue actions**:
```json
{
  "id": "ask_npc",
  "label": "💬 Ask [NPC Name]",
  "narration_prompt": "Brief scene-setting before the NPC speaks.",
  "cue_npc": "npc_name",
  "npc_instruction": "Direction TO the NPC. What to say, how to say it, emotional beats to hit. Write like you're directing an actor in a specific scene. Be detailed - tone, pauses, what they reveal, what they hold back.",
  "advances": false
}
```

**Branching actions** (with flags):
```json
{
  "id": "choice_a",
  "label": "💬 Choose Path A",
  "narration_prompt": "What happens.",
  "advances": true,
  "next_stage": "path_a_stage",
  "sets_flag": "path_a"
}
```

### Stage Design Rules

1. **3-6 actions per stage.** 1-2 explore, 1-2 with NPC cues, 1-2 that advance.
2. **Narration is king.** This is the D&D experience. Write it like a novel. Sensory details, emotional weight, show don't tell.
3. **NPC instructions are actor direction.** Be specific: what they say, how they say it, what emotion to hit, what to reveal vs hold back.
4. **Let players breathe.** Not every action needs to advance the plot. The explore actions ARE the game.
5. **Images enhance key moments.** Not every stage needs one, but first impressions and emotional peaks benefit from visuals.
6. **Labels need emojis.** They're buttons - make them scannable. Use relevant emojis.

---

## Part 3: Key NPCs

Quest-specific characters that aren't existing NPC bots. The Quest Master and NPC bots use these for consistent portrayal.

```json
"key_npcs": {
  "npc_id": {
    "name": "Display Name",
    "race": "Race",
    "age": "Age or range",
    "description": "Physical appearance. What players SEE. Be specific and visual — race, build, height, skin tone, hair color/style, eye color, scars/tattoos, clothing, weapons, unique traits. This is the canonical reference. (See Rule 1)",
    "visual_prompt": "Concise image-generation-ready description. Used directly in image prompts to ensure every generated image of this NPC looks identical. Include only visual details: physical features, clothing, coloring, distinguishing marks.",
    "personality": "How they act. Speech patterns, mannerisms, emotional defaults, what they hide."
  }
}
```

---

## Part 4: Putting It Together

### Quest Design Checklist

- [ ] **Concept:** One sentence pitch
- [ ] **Quest giver:** Which NPC bot starts the hook?
- [ ] **Tone:** What should this feel like?
- [ ] **Key NPCs:** Any new characters needed?
- [ ] **Hook nodes:** 4-6 node dialog tree for the approach conversation
- [ ] **Stages:** 4-8 narrative stages for the quest itself
- [ ] **Branching:** At least one meaningful fork (different paths/endings)
- [ ] **Endings:** 2+ outcomes with different emotional payoffs
- [ ] **No combat unless intentional:** These are RP quests, not dungeon crawls

### Quest Complexity Tiers

**Simple (Bonesy's Good Vibes Spot):**
- Linear progression through stages
- One path, one ending
- Focus on atmosphere and character moments
- ~5 stages, ~6 nodes
- Best for: chill moments, character bonding, world-building

**Standard:**
- One major fork (2 paths)
- 2-3 endings
- Mix of exploration and NPC interaction
- ~6 stages, ~8 nodes
- Best for: side quests, character development, mysteries

**Complex (The Rooftop Kingdom):**
- Multiple forks, converging paths
- 3-5 endings with flags tracking choices
- Rich NPC cast with detailed cue instructions
- ~8+ stages, ~10+ nodes
- Best for: major story beats, emotional heavy-hitters, consequential choices

---

## Quick Reference: What Goes Where

| Element | Nodes | Stages |
|---------|-------|--------|
| Purpose | Quest hook conversation | Quest narrative experience |
| Who runs it | NPC bot (auto-branching) | Quest Master (narrated) |
| Player input | Free-text chat | Button actions |
| NPC behavior | Generated from `goal` | Directed by `npc_instruction` |
| Branching | AI-detected intent matching | Explicit `next_stage` + flags |
| When | Before quest starts | During quest |

---

## Template: Minimal Quest

```json
{
  "id": "QUEST_ID",
  "name": "QUEST_NAME",
  "description": "QUEST_PITCH",
  "location": "LOCATION",
  "reward_gold": 0,
  "tone": "TONE",
  "branching": false,

  "start_node": "approach",
  "current_node": null,
  "active": false,
  "completed": false,
  "quest_flags": [],

  "companions": ["NPC_NAME"],

  "key_npcs": {},

  "stages": {
    "opening": {
      "description": "SCENE_DESCRIPTION",
      "narration_prompt": "RICH_NARRATION",
      "actions": [
        {
          "id": "explore",
          "label": "👀 Look Around",
          "narration_prompt": "WHAT_THEY_SEE",
          "advances": false
        },
        {
          "id": "continue",
          "label": "🥾 Continue",
          "narration_prompt": "TRANSITION",
          "advances": true,
          "next_stage": "climax"
        }
      ]
    },
    "climax": {
      "description": "SCENE_DESCRIPTION",
      "narration_prompt": "RICH_NARRATION",
      "actions": [
        {
          "id": "resolve",
          "label": "🏠 Head Home",
          "narration_prompt": "CLOSING_NARRATION",
          "advances": true,
          "next_stage": null,
          "completes_quest": true
        }
      ]
    }
  },

  "nodes": {
    "approach": {
      "goal": "NPC_DIRECTION_FOR_HOOK",
      "branches": {
        "interested": {
          "triggers": "Player shows interest or asks questions",
          "next": "pitch"
        },
        "declines": {
          "triggers": "Player refuses or seems uninterested",
          "next": "soft_decline"
        }
      }
    },
    "pitch": {
      "goal": "NPC_MAKES_THE_ASK",
      "branches": {
        "accepts": {
          "triggers": "Player agrees to help or go along",
          "next": "accepted"
        },
        "declines": {
          "triggers": "Player says no",
          "next": "soft_decline"
        }
      }
    },
    "accepted": {
      "goal": "NPC_REACTS_WITH_EXCITEMENT",
      "end_node": true,
      "outcome": "quest_given"
    },
    "soft_decline": {
      "goal": "NPC_RESPECTS_DECISION_LEAVES_DOOR_OPEN",
      "end_node": true,
      "outcome": "quest_declined"
    }
  }
}
```

# Quest Definition Template

This document explains how to create stage-based quests for the Quest Manager system.

## Quest File Location

Quest files go in an NPC's folder:
```
npc-bot/characters/<npc_name>/quests/<quest_id>.json
```

## Basic Structure

```json
{
  "id": "quest_id",
  "name": "Quest Display Name",
  "description": "Brief description shown on quest board",
  "location": "Where the quest takes place",
  
  "companions": ["nibby"],
  
  "stages": {
    "stage_name": {
      "description": "Internal description of this stage",
      "narration_prompt": "What to narrate when entering this stage",
      "actions": [
        {
          "id": "action_id",
          "label": "🔍 Button Label",
          "narration_prompt": "What happens when this action is taken",
          "advances": false
        }
      ]
    }
  },
  
  "nodes": { ... }
}
```

## Stages

Stages represent distinct phases of a quest. Players move through stages by taking actions that advance the quest.

### Stage Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `description` | string | Yes | Internal description (not shown to players) |
| `narration_prompt` | string | Yes | Text to generate narration from when entering stage |
| `actions` | array | Yes | List of available actions in this stage |

### Example Stage

```json
"investigation": {
  "description": "The party investigates the area around the hunter's blind",
  "narration_prompt": "The old hunter's blind is weathered and covered in moss. Strange scratch marks mar several nearby trees.",
  "actions": [
    {
      "id": "study_scratches",
      "label": "🔍 Study Scratches",
      "narration_prompt": "The player examines the scratch marks closely...",
      "advances": false
    },
    {
      "id": "follow_trail",
      "label": "🥾 Follow Trail",
      "narration_prompt": "The party follows the trail deeper into the forest...",
      "advances": true,
      "next_stage": "discovery"
    }
  ]
}
```

## Actions

Actions are buttons players can click during a quest stage.

### Action Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string | Yes | Unique identifier for this action |
| `label` | string | Yes | Button text (include emoji!) |
| `narration_prompt` | string | Yes | Description of what happens (fed to AI) |
| `advances` | boolean | No | Does this action advance the quest? Default: false |
| `next_stage` | string | No | Stage to advance to (required if advances=true) |
| `completes_quest` | boolean | No | Does this action complete the quest? |
| `cue_npc` | string | No | NPC name to cue for a response |
| `npc_instruction` | string | No | Instructions for the NPC when cued |

### Action Types

#### 1. Exploration Actions (non-advancing)
Standard actions that let players explore without moving the quest forward.

```json
{
  "id": "examine_trees",
  "label": "🌲 Examine Trees",
  "narration_prompt": "The player examines the trees closely, looking for marks or disturbances.",
  "advances": false
}
```

#### 2. Advancing Actions
Actions that move to the next stage of the quest.

```json
{
  "id": "head_to_blind",
  "label": "🚶 Head to Blind",
  "narration_prompt": "The party moves toward the old hunter's blind.",
  "advances": true,
  "next_stage": "investigation"
}
```

#### 3. Quest-Completing Actions
Actions that end the quest successfully.

```json
{
  "id": "report_findings",
  "label": "📋 Report Findings",
  "narration_prompt": "The party concludes their investigation.",
  "advances": true,
  "next_stage": null,
  "completes_quest": true
}
```

#### 4. NPC Cue Actions
Actions that prompt an NPC to speak. There are two types:

**Bot NPC** (has a character folder in `characters/`): The Quest Manager writes a cue file and the NPC bot picks it up and responds itself.

**Quest NPC** (defined in `key_npcs`): The Quest Manager generates dialogue via AI and sends it through a webhook with the NPC's name and avatar.

Both use the same action format:

```json
{
  "id": "ask_nibby",
  "label": "💬 Ask Nibby",
  "narration_prompt": "The player turns to Nibby for input.",
  "cue_npc": "nibby",
  "npc_instruction": "The party is asking what you think about the scratch marks. Share your thoughts nervously.",
  "advances": false
}
```

### ⚠️ CRITICAL RULE: All NPC Dialogue Goes Through NPCs, Not Narration

The Quest Manager is a **narrator**, not a voice actor. It describes the scene, the environment, body language, and what the player sees. It should **never** speak dialogue for an NPC. If an NPC has something to say, they say it themselves through their webhook/bot.

**The rule is simple: narration_prompt = what the player sees and does. NPC dialogue = cue_npc.**

Any time you're tempted to write quoted dialogue (`'...'`) inside a `narration_prompt`, stop. That dialogue belongs in a `cue_npc` + `npc_instruction` instead.

**Wrong** — Quest Manager narrates NPC dialogue:
```json
{
  "id": "approach_stranger",
  "narration_prompt": "You approach. The man says 'I am looking for my son.' He coughs and steadies himself. 'My name is Hiro Zenatsu.'"
}
```

**Right** — Quest Manager sets the scene, NPC speaks for themselves:
```json
{
  "id": "approach_stranger",
  "narration_prompt": "You approach the gate. Up close, the resemblance is unmistakable.",
  "cue_npc": "hiro",
  "npc_instruction": "Nalyd has approached you. Introduce yourself with quiet dignity. Say your name, and that you are looking for your son."
}
```

This applies everywhere:
- **Actions** — use `cue_npc` + `npc_instruction`
- **Stage intros** — use `stage_cue_npc` + `stage_npc_instruction` (single NPC) or `stage_cue_npcs` array (multiple NPCs speaking in sequence)

```json
"stage_cue_npcs": [
  { "npc": "hiro", "instruction": "Speak softly: 'You are taller than I imagined.'" },
  { "npc": "djinn", "instruction": "After a long pause, say: 'You are smaller.'" }
]
```

If multiple NPCs speak in one scene, use `stage_cue_npcs` with an array — they fire in order.

### ⚠️ IMPORTANT: First Appearance Gets a Portrait

The **first action** where a quest NPC speaks should include `"image"` set to that NPC's reference image (e.g. `"image": "hiro.png"`). This lets players see who they're talking to. Subsequent cues of the same NPC don't need the image unless the scene calls for it.

```json
{
  "id": "approach_stranger",
  "label": "🗣️ Approach the Stranger",
  "narration_prompt": "You approach the gate. Up close, the resemblance is unmistakable.",
  "image": "hiro.png",
  "cue_npc": "hiro",
  "npc_instruction": "Introduce yourself with quiet dignity.",
  "advances": false
}
```

## Companions

List NPCs that accompany the party on this quest:

```json
"companions": ["nibby", "bonesy"]
```

These NPCs will appear in the NPC dropdown menu during the quest.

## Key NPCs (Quest-Only Characters)

Some quests introduce new characters that don't have their own bot. Define them in `key_npcs`:

```json
"key_npcs": {
  "hiro": {
    "name": "Hiro Zenatsu",
    "race": "Human",
    "age": "62",
    "description": "A gaunt, weathered old man...",
    "visual_prompt": "Description for image generation...",
    "personality": "Measured and deliberate..."
  }
}
```

The Quest Manager handles these NPCs internally: it generates their dialogue via AI and sends it through a Discord webhook with their name and avatar image.

### Avatar Images for Key NPCs

Place avatar images at:
```
characters/<source_npc>/quests/images/<key_npc_name>.png
```
For example: `characters/djinn/quests/images/hiro.png`

The webhook system looks for `<npc_name>_avatar.png` or `<npc_name>.png`.

## Button Styling

The Quest Manager automatically styles buttons based on their properties:

- **Primary (Blue)**: Standard exploration actions
- **Secondary (Gray)**: NPC cue actions
- **Success (Green)**: Advancing actions
- **Danger (Red)**: Quest-completing actions or End Quest

## Complete Example

```json
{
  "id": "haunted_well",
  "name": "The Haunted Well",
  "description": "Strange whispers come from the old well at night",
  "location": "Village square",
  
  "companions": ["bonesy"],
  
  "stages": {
    "approach": {
      "description": "Party approaches the well",
      "narration_prompt": "The old stone well sits in the center of the empty square. Even in daylight, an unnatural chill emanates from its depths.",
      "actions": [
        {
          "id": "peer_down",
          "label": "👁️ Peer Into Well",
          "narration_prompt": "The player leans over the well's edge, trying to see into the darkness below.",
          "advances": false
        },
        {
          "id": "ask_bonesy",
          "label": "💀 Ask Bonesy",
          "narration_prompt": "The player asks Bonesy if he senses anything undead.",
          "cue_npc": "bonesy",
          "npc_instruction": "They're asking if you sense undead near the well. You DO sense something - faint but definitely there. Be casual but concerned.",
          "advances": false
        },
        {
          "id": "descend",
          "label": "🪜 Climb Down",
          "narration_prompt": "The party begins descending into the well using the old rope.",
          "advances": true,
          "next_stage": "depths"
        }
      ]
    },
    
    "depths": {
      "description": "Inside the well",
      "narration_prompt": "The walls are slick with moisture. Faint luminescent fungi provide dim light. A tunnel leads off to the side.",
      "actions": [
        {
          "id": "examine_fungi",
          "label": "🍄 Examine Fungi",
          "narration_prompt": "The player carefully examines the glowing fungi.",
          "advances": false
        },
        {
          "id": "enter_tunnel",
          "label": "🚪 Enter Tunnel",
          "narration_prompt": "The party squeezes through the narrow tunnel opening.",
          "advances": true,
          "next_stage": "chamber"
        }
      ]
    },
    
    "chamber": {
      "description": "Hidden chamber",
      "narration_prompt": "A small chamber opens up. In the center, a ghostly figure hovers above an old chest.",
      "actions": [
        {
          "id": "speak_ghost",
          "label": "👻 Speak to Ghost",
          "narration_prompt": "The player attempts to communicate with the spirit.",
          "advances": false
        },
        {
          "id": "help_ghost",
          "label": "🙏 Help the Ghost",
          "narration_prompt": "The party agrees to help the ghost find peace.",
          "advances": true,
          "next_stage": null,
          "completes_quest": true
        }
      ]
    }
  }
}
```

## Tips for Good Quest Design

1. **3-5 stages** is a good range - enough for a journey, not too long
2. **Include non-advancing actions** so players can explore each stage
3. **Add NPC cue actions** when companions are present - makes them feel involved
4. **Use evocative narration prompts** - the AI builds on these
5. **Make advancing actions clear** with directional labels (Follow Trail, Enter, Continue, etc.)
6. **End with meaningful resolution** - not just "quest complete"

### ⚠️ Buttons Always Come AFTER NPC Dialogue

If a stage or action cues an NPC to speak, the action buttons must appear **after** the NPC dialogue, never before it. Players should read the NPC's response before deciding what to do next.

The Quest Manager handles this automatically: when a stage has `stage_cue_npc` or `stage_cue_npcs`, narration is sent without buttons, the NPC(s) speak, and then the buttons appear in a follow-up message. Same goes for action-level `cue_npc`. Don't try to work around this by putting dialogue in `narration_prompt` instead of using the cue system.

**Flow should always be:**
1. 📖 Stage narration (no buttons)
2. 💬 NPC dialogue (via webhook or cue file)
3. 🎮 Action buttons ("What do you do next?")

### ⚠️ Keep Narration Prompts Short

This is Discord, not a novel. Players read these on screens between button clicks. Walls of text kill pacing.

- **`narration_prompt` for stages**: 1-3 sentences. Set the scene, establish the vibe, stop.
- **`narration_prompt` for actions**: 1-2 sentences. What happens, what changes, done.
- **`npc_instruction`**: Keep it focused. Tell the NPC what to say/do, not a paragraph of backstory.

The AI narrator will expand your prompts with atmosphere. If you write a paragraph, the AI adds *more* on top of that and you end up with a novel. Write tight prompts and let the AI do the embellishing.

**Too long:**
```json
"narration_prompt": "The party arrives at the edge of the Greymist Forest. The trees here are ancient, their gnarled roots breaking through the earth like skeletal fingers. A thick fog rolls between the trunks, muffling all sound. Somewhere deep within, a faint blue light pulses rhythmically. The air smells of wet earth and something faintly metallic. Birds have gone silent."
```

**Just right:**
```json
"narration_prompt": "The Greymist Forest looms ahead, fog thick between ancient trees. A faint blue light pulses somewhere deep within."
```

## Integration with NPC Conversation Trees

Quests can have both:
- `stages` - For gameplay when the quest is active
- `nodes` - For NPC conversation trees (how the quest is given)

The NPC uses `nodes` to roleplay giving the quest. Once tracked and started, the Quest Manager uses `stages` for gameplay.

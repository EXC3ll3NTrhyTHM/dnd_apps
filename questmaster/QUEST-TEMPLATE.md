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
Actions that prompt an NPC companion to speak.

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

## Companions

List NPCs that accompany the party on this quest:

```json
"companions": ["nibby", "bonesy"]
```

These NPCs will appear in the NPC dropdown menu during the quest.

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

## Integration with NPC Conversation Trees

Quests can have both:
- `stages` - For gameplay when the quest is active
- `nodes` - For NPC conversation trees (how the quest is given)

The NPC uses `nodes` to roleplay giving the quest. Once tracked and started, the Quest Manager uses `stages` for gameplay.

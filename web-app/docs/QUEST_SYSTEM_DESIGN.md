# Quest System Design

*A stage-based quest system with skill checks, combat encounters, and NPC integration.*

---

## Overview

Quests are multi-stage adventures that players progress through by taking actions. Actions can be:
- **Normal actions** — Narration + optional stage advancement
- **Skill checks** — Roll dice against a DC, branch based on success/failure
- **Combat encounters** — Trigger the shared combat engine, branch on victory/defeat
- **NPC cues** — Prompt an NPC to speak in character

The system reuses the existing combat engine (`lib/encounters.js`) so updates to arena combat automatically apply to quest combat.

---

## Quest Definition Schema

Quests are JSON files stored in NPC character folders:
```
characters/<npc_name>/quests/<quest_id>.json
```

### Top-Level Structure

```json
{
  "id": "haunted_manor",
  "name": "The Haunted Manor",
  "description": "Strange lights have been seen in the abandoned manor on the hill.",
  "location": "Northwood Village",
  "reward_gold": 50,
  "reward_xp": 200,
  "tone": "Spooky, mysterious, with moments of dark humor.",

  "companions": ["nibby", "bonesy"],
  
  "key_npcs": {
    "ghost": {
      "name": "Lady Ashworth",
      "description": "A translucent woman in Victorian dress",
      "personality": "Melancholy but polite, trapped between worlds"
    }
  },

  "stages": { ... },
  "nodes": { ... }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique quest identifier |
| `name` | string | Display name |
| `description` | string | Short description for quest board |
| `location` | string | Where the quest takes place |
| `reward_gold` | number | Base gold reward (split by contribution) |
| `reward_xp` | number | Base XP reward |
| `tone` | string | Guidance for AI narration style |
| `companions` | string[] | NPC bots that accompany the party |
| `key_npcs` | object | Quest-specific NPCs (not full bots) |
| `stages` | object | Stage definitions (gameplay) |
| `nodes` | object | Conversation tree (quest-giving) |

---

## Stage Types

### 1. Normal Stage

Standard exploration/roleplay stage with action buttons.

```json
"arrival": {
  "description": "Party arrives at the manor gates",
  "narration_prompt": "Iron gates hang askew on rusted hinges. Beyond, the manor looms against a stormy sky.",
  "image": "manor_gates.png",
  
  "actions": [
    {
      "id": "examine_gates",
      "label": "🔍 Examine Gates",
      "narration_prompt": "You study the gates. Old family crest, barely visible under the rust.",
      "advances": false
    },
    {
      "id": "enter_grounds",
      "label": "🚶 Enter the Grounds",
      "narration_prompt": "You push through the gates. They groan in protest.",
      "advances": true,
      "next_stage": "courtyard"
    }
  ]
}
```

### 2. Combat Stage

Triggers the shared encounter system. Same engine as the Arena.

```json
"ambush": {
  "type": "combat",
  "description": "Skeletal guardians attack",
  "narration_prompt": "Bones rattle in the darkness. Three skeletons rise from the ground!",
  "image": "skeleton_ambush.png",
  
  "monster": "skeleton",
  "monster_count": 3,
  
  "victory": {
    "narration_prompt": "The bones clatter to the ground, finally at rest.",
    "next_stage": "after_ambush",
    "sets_flag": "defeated_guardians"
  },
  
  "defeat": {
    "narration_prompt": "You fall. When you wake, you're back at the manor gates.",
    "next_stage": "arrival",
    "sets_flag": "was_defeated"
  },
  
  "flee": {
    "dc": 12,
    "narration_prompt": "You sprint for the exit!",
    "success_stage": "courtyard",
    "failure_narration": "A bony hand grabs your ankle!"
  }
}
```

**Combat Stage Properties:**

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"combat"` | Marks this as a combat stage |
| `monster` | string | Monster ID from `data/monsters.json` |
| `monster_count` | number | How many of this monster (default: 1) |
| `victory` | object | What happens on victory |
| `defeat` | object | What happens on defeat |
| `flee` | object | Optional flee mechanics |

### 3. Skill Check Stage

A stage that requires a skill check to proceed.

```json
"locked_door": {
  "type": "skill_check",
  "description": "A locked door blocks your path",
  "narration_prompt": "An iron door bars your way. The lock looks complex but not impossible.",
  
  "skill": "thieves_tools",
  "ability": "DEX",
  "dc": 15,
  
  "success": {
    "narration_prompt": "Click. The lock surrenders to your expertise.",
    "next_stage": "treasury"
  },
  "failure": {
    "narration_prompt": "The pick snaps. You'll need another approach.",
    "next_stage": "find_key"
  },
  "critical_success": {
    "narration_prompt": "Child's play. You also notice a hidden compartment.",
    "next_stage": "treasury",
    "sets_flag": "found_hidden_cache"
  },
  "critical_failure": {
    "narration_prompt": "Your pick jams the lock completely. It's ruined.",
    "next_stage": "door_jammed",
    "sets_flag": "lock_destroyed"
  }
}
```

---

## Action Types

Actions within stages can have different types:

### Normal Action

```json
{
  "id": "look_around",
  "label": "👁️ Look Around",
  "narration_prompt": "You scan the room, taking in every detail.",
  "advances": false
}
```

### Advancing Action

```json
{
  "id": "proceed",
  "label": "🚶 Continue Forward",
  "narration_prompt": "You move deeper into the manor.",
  "advances": true,
  "next_stage": "hallway"
}
```

### Skill Check Action

```json
{
  "id": "persuade_ghost",
  "type": "skill_check",
  "label": "🗣️ Reason with the Ghost",
  
  "skill": "persuasion",
  "ability": "CHA",
  "dc": 14,
  
  "narration_prompt": "You try to calm the spirit with words.",
  
  "success": {
    "narration_prompt": "The ghost's rage subsides. She listens.",
    "advances": true,
    "next_stage": "ghost_peaceful"
  },
  "failure": {
    "narration_prompt": "Your words fall on deaf ears. She attacks!",
    "advances": true,
    "next_stage": "ghost_combat"
  },
  "critical_success": {
    "narration_prompt": "Tears stream down her translucent face. 'You... understand.'",
    "sets_flag": "ghost_ally",
    "advances": true,
    "next_stage": "ghost_helps"
  },
  "critical_failure": {
    "narration_prompt": "You accidentally mention her murderer's name. She SCREAMS.",
    "advances": true,
    "next_stage": "ghost_enraged"
  }
}
```

### NPC Cue Action

```json
{
  "id": "ask_bonesy",
  "label": "💀 Ask Bonesy",
  "narration_prompt": "You turn to your skeletal companion.",
  "cue_npc": "bonesy",
  "npc_instruction": "The party is in a haunted manor. They're asking if you sense any undead. You DO sense something powerful deeper in. Be casual but concerned.",
  "advances": false
}
```

### Combat Trigger Action

```json
{
  "id": "attack_guard",
  "type": "combat_trigger",
  "label": "⚔️ Attack!",
  "narration_prompt": "You draw your weapon and charge!",
  "monster": "manor_guard",
  "victory_stage": "guard_defeated",
  "defeat_stage": "captured"
}
```

---

## Skill Check System

### Supported Skills

Map to D&D 5e skills with their governing abilities:

| Skill | Ability | Example Use |
|-------|---------|-------------|
| `acrobatics` | DEX | Balance, tumble, escape grapple |
| `animal_handling` | WIS | Calm a beast, ride |
| `arcana` | INT | Identify magic, recall lore |
| `athletics` | STR | Climb, jump, swim, shove |
| `deception` | CHA | Lie convincingly |
| `history` | INT | Recall historical facts |
| `insight` | WIS | Detect lies, read intentions |
| `intimidation` | CHA | Threaten, coerce |
| `investigation` | INT | Search for clues, deduce |
| `medicine` | WIS | Stabilize, diagnose |
| `nature` | INT | Recall nature lore |
| `perception` | WIS | Spot hidden things |
| `performance` | CHA | Entertain, distract |
| `persuasion` | CHA | Convince, negotiate |
| `religion` | INT | Recall religious lore |
| `sleight_of_hand` | DEX | Pickpocket, palm objects |
| `stealth` | DEX | Move unseen |
| `survival` | WIS | Track, forage, navigate |
| `thieves_tools` | DEX | Pick locks, disable traps |

### Roll Resolution

```javascript
// Server-side resolution
const d20 = clientRoll; // From 3D dice overlay
const abilityMod = getAbilityMod(characterSheet, action.ability);
const profBonus = isProficient(characterSheet, action.skill) ? characterSheet.profBonus : 0;

const total = d20 + abilityMod + profBonus;

let outcome;
if (d20 === 20) outcome = 'critical_success';
else if (d20 === 1) outcome = 'critical_failure';
else if (total >= action.dc) outcome = 'success';
else outcome = 'failure';
```

### Outcome Properties

Each outcome (`success`, `failure`, `critical_success`, `critical_failure`) can have:

| Field | Type | Description |
|-------|------|-------------|
| `narration_prompt` | string | What the narrator says |
| `advances` | boolean | Move to next stage? |
| `next_stage` | string | Stage to advance to |
| `sets_flag` | string | Quest flag to set |
| `cue_npc` | string | NPC to speak after |
| `npc_instruction` | string | What to tell the NPC |

---

## Combat Integration

### How It Works

Combat stages use the **same encounter engine** as the Arena (`lib/encounters.js`). This means:
- One codebase for all combat
- Updates to combat mechanics apply everywhere
- Same 3D dice, same UI, same reward system

### Quest Combat Flow

```
┌─────────────────────────────────────────────────────────────┐
│  1. Quest reaches a combat stage                            │
│                                                             │
│  2. Quest Manager calls:                                    │
│     POST /api/encounters/spawn                              │
│     { locationId: "quest_<questId>", monsterId: "skeleton" }│
│                                                             │
│  3. Encounter system creates fight, broadcasts via WS       │
│                                                             │
│  4. Quest UI shows EncounterBanner (same as Arena)          │
│     - Player HP bars                                        │
│     - Monster HP bar                                        │
│     - Attack / Defend / Flee buttons                        │
│                                                             │
│  5. Combat plays out using existing round system            │
│                                                             │
│  6. On encounter_end WS event:                              │
│     - victory → advance to victory.next_stage               │
│     - defeat  → advance to defeat.next_stage                │
│     - fled    → advance to flee.success_stage               │
│                                                             │
│  7. Quest narrates the outcome and continues                │
└─────────────────────────────────────────────────────────────┘
```

### Virtual Location IDs

Each quest combat gets a unique location ID:
```javascript
const combatLocationId = `quest_${questId}_combat`;
```

This allows:
- Multiple quests to have active combat simultaneously
- Clean separation from Arena encounters
- Proper WebSocket routing

### Monster Definitions

Monsters are defined in `data/monsters.json`. Quest combat uses the same pool:

```json
{
  "id": "manor_ghost",
  "name": "Vengeful Spirit",
  "description": "A translucent figure wreathed in cold fury",
  "cr": 2,
  "ac": 12,
  "maxHp": 45,
  "attacks": [
    {
      "name": "Chilling Touch",
      "bonus": 4,
      "damage": "2d6+2",
      "type": "necrotic",
      "description": "reaches through you with icy fingers"
    }
  ],
  "multiattack": 1,
  "xpReward": 450,
  "goldReward": 0,
  "spawnText": "The temperature drops. A ghostly figure materializes!",
  "deathText": "The spirit wails and dissipates into mist.",
  "attackTexts": [
    "The spirit reaches for {target} with spectral claws!",
    "Cold emanates from the ghost as it lunges at {target}!"
  ],
  "missTexts": [
    "{target} phases through the ghostly attack.",
    "The spirit's hand passes harmlessly through {target}."
  ]
}
```

---

## Quest State

### Runtime State Schema

```json
{
  "questId": "haunted_manor",
  "status": "active",
  "current_stage": "courtyard",
  "flags": ["entered_manor", "met_ghost"],
  "participants": ["user_123", "user_456"],
  
  "combat": {
    "active": true,
    "encounterId": "enc_abc123",
    "victoryStage": "ghost_defeated",
    "defeatStage": "manor_entrance"
  },
  
  "skill_check": {
    "pending": false,
    "actionId": null,
    "awaitingRoll": false
  },
  
  "history": [
    { "stage": "arrival", "timestamp": "2026-02-13T10:00:00Z" },
    { "stage": "courtyard", "timestamp": "2026-02-13T10:05:00Z" }
  ]
}
```

### Status Values

| Status | Description |
|--------|-------------|
| `available` | Can be tracked/started |
| `tracked` | On player's quest tracker |
| `active` | Currently being played |
| `combat` | In a combat encounter |
| `completed` | Successfully finished |
| `failed` | Failed or abandoned |

---

## API Endpoints

### Quest Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/quests` | GET | List all available quests |
| `/api/quests/:id` | GET | Get quest details |
| `/api/quests/:id/start` | POST | Start a quest |
| `/api/quests/:id/stage` | GET | Get current stage info |
| `/api/quests/:id/action` | POST | Submit an action |

### Skill Checks

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/quests/:id/skill-check` | POST | Submit skill check roll |

**Request:**
```json
{
  "actionId": "persuade_ghost",
  "roll": 15
}
```

**Response:**
```json
{
  "roll": 15,
  "modifier": 5,
  "total": 20,
  "dc": 14,
  "outcome": "success",
  "narration": "The ghost's rage subsides. She listens.",
  "advances": true,
  "nextStage": "ghost_peaceful"
}
```

### Combat (uses existing encounter endpoints)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/encounters/spawn` | POST | Spawn combat (quest calls this) |
| `/api/encounters/:id/join` | POST | Join the fight |
| `/api/encounters/:id/action` | POST | Attack/Defend/Flee |

---

## WebSocket Events

### Quest Events

```javascript
// Stage changed
{
  type: 'quest_stage',
  questId: 'haunted_manor',
  stage: 'courtyard',
  narration: '...',
  actions: [...]
}

// Skill check result
{
  type: 'quest_skill_check',
  questId: 'haunted_manor',
  skill: 'persuasion',
  roll: 15,
  total: 20,
  dc: 14,
  outcome: 'success',
  narration: '...'
}

// Quest completed
{
  type: 'quest_complete',
  questId: 'haunted_manor',
  rewards: {
    xp: 200,
    gold: 50
  }
}
```

### Combat Events (existing)

```javascript
// Encounter spawned (combat stage started)
{
  type: 'encounter_spawn',
  locationId: 'quest_haunted_manor_combat',
  encounter: { ... }
}

// Encounter ended
{
  type: 'encounter_end',
  encounterId: 'enc_abc123',
  outcome: 'victory',
  rewards: { ... }
}
```

---

## Client Components

### New Components Needed

| Component | Purpose |
|-----------|---------|
| `QuestPanel.jsx` | Main quest UI (stage info, actions) |
| `SkillCheckModal.jsx` | Dice roll UI for skill checks |
| `QuestNarration.jsx` | Styled narration display |
| `QuestActionBar.jsx` | Action buttons with type detection |

### Reused Components

| Component | Used For |
|-----------|----------|
| `EncounterBanner.jsx` | Combat HP bars and actions |
| `DiceOverlay.jsx` | 3D dice for skill checks |
| `ChatBubble.jsx` | NPC dialogue display |

### Component Flow

```jsx
function QuestPanel({ quest }) {
  const stage = quest.stages[quest.current_stage];
  
  // Combat stage → show encounter UI
  if (stage.type === 'combat' && quest.combat?.active) {
    return <EncounterBanner encounterId={quest.combat.encounterId} />;
  }
  
  // Skill check pending → show roll modal
  if (quest.skill_check?.pending) {
    return <SkillCheckModal action={quest.skill_check.action} />;
  }
  
  // Normal stage → show actions
  return (
    <div className="quest-panel">
      <QuestNarration text={stage.narration_prompt} />
      <QuestActionBar 
        actions={stage.actions}
        onAction={handleAction}
      />
    </div>
  );
}
```

---

## File Structure

```
web-app/
├── server/
│   ├── lib/
│   │   ├── encounters.js      # Shared combat engine (no changes)
│   │   ├── quests.js          # NEW: Quest state management
│   │   └── skillChecks.js     # NEW: Skill check resolution
│   └── routes/
│       ├── encounters.js      # Combat routes (no changes)
│       └── quests.js          # NEW: Quest routes
├── client/
│   └── src/
│       └── components/
│           ├── EncounterBanner.jsx  # Reused for quest combat
│           ├── QuestPanel.jsx       # NEW: Main quest UI
│           ├── SkillCheckModal.jsx  # NEW: Roll prompt
│           └── QuestActionBar.jsx   # NEW: Action buttons
└── data/
    ├── monsters.json          # Monster definitions (shared)
    └── quests/                # NEW: Active quest states
```

---

## Example: Complete Quest

```json
{
  "id": "ghost_of_ashworth",
  "name": "The Ghost of Ashworth Manor",
  "description": "A spirit haunts the old manor. Discover what binds her to this world.",
  "location": "Ashworth Manor",
  "reward_gold": 75,
  "reward_xp": 300,
  "tone": "Gothic horror with emotional beats. The ghost is tragic, not evil.",

  "companions": ["bonesy"],

  "key_npcs": {
    "lady_ashworth": {
      "name": "Lady Ashworth",
      "description": "A translucent woman in a tattered ball gown",
      "personality": "Confused, angry, but underneath it all, deeply sad"
    }
  },

  "stages": {
    "manor_gates": {
      "description": "Arrival at the manor",
      "narration_prompt": "The gates of Ashworth Manor stand before you, rusted and forbidding.",
      "image": "manor_gates.png",
      "actions": [
        {
          "id": "examine_gates",
          "label": "🔍 Examine the Gates",
          "narration_prompt": "The Ashworth family crest is barely visible beneath decades of rust.",
          "advances": false
        },
        {
          "id": "ask_bonesy",
          "label": "💀 Ask Bonesy",
          "cue_npc": "bonesy",
          "npc_instruction": "The party is at a haunted manor. They're asking if you sense anything. You sense powerful undead energy inside. Be your usual casual self but mention this is serious.",
          "advances": false
        },
        {
          "id": "enter",
          "label": "🚪 Enter the Manor",
          "narration_prompt": "You push through the gates. They shriek in protest.",
          "advances": true,
          "next_stage": "foyer"
        }
      ]
    },

    "foyer": {
      "description": "The manor foyer",
      "narration_prompt": "Dust motes dance in pale moonlight. A grand staircase rises before you. Something moves in the shadows above.",
      "image": "foyer.png",
      "actions": [
        {
          "id": "stealth_approach",
          "type": "skill_check",
          "label": "🤫 Approach Quietly",
          "skill": "stealth",
          "ability": "DEX",
          "dc": 12,
          "narration_prompt": "You try to move without alerting whatever lurks above.",
          "success": {
            "narration_prompt": "You slip through the shadows unnoticed.",
            "next_stage": "balcony_stealth",
            "sets_flag": "approached_quietly"
          },
          "failure": {
            "narration_prompt": "A floorboard creaks. The shadow above TURNS.",
            "next_stage": "ghost_appears"
          }
        },
        {
          "id": "call_out",
          "label": "📢 Call Out",
          "narration_prompt": "Your voice echoes through the empty manor.",
          "advances": true,
          "next_stage": "ghost_appears"
        }
      ]
    },

    "ghost_appears": {
      "description": "Lady Ashworth manifests",
      "narration_prompt": "The temperature plummets. A woman in a tattered gown descends through the air, her eyes hollow pits of rage.",
      "image": "lady_ashworth.png",
      "stage_cue_npc": "lady_ashworth",
      "stage_npc_instruction": "You have just appeared before intruders in your home. You are confused and angry. Demand to know who they are and why they disturb your rest. Your voice should echo unnaturally.",
      "actions": [
        {
          "id": "persuade",
          "type": "skill_check",
          "label": "🗣️ Try to Calm Her",
          "skill": "persuasion",
          "ability": "CHA",
          "dc": 14,
          "narration_prompt": "You raise your hands peacefully and speak in soothing tones.",
          "success": {
            "narration_prompt": "The ghost's fury wavers. She tilts her head, listening.",
            "next_stage": "ghost_talks"
          },
          "failure": {
            "narration_prompt": "She screams. The sound shatters nearby glass.",
            "next_stage": "ghost_combat"
          },
          "critical_success": {
            "narration_prompt": "Tears stream down her translucent cheeks. 'You... you see me. Truly see me.'",
            "sets_flag": "ghost_trusts",
            "next_stage": "ghost_vulnerable"
          },
          "critical_failure": {
            "narration_prompt": "You accidentally mention something that enrages her further. Objects fly at your head.",
            "next_stage": "ghost_combat_hard"
          }
        },
        {
          "id": "attack",
          "label": "⚔️ Attack!",
          "narration_prompt": "You draw your weapon and charge the spirit!",
          "advances": true,
          "next_stage": "ghost_combat"
        }
      ]
    },

    "ghost_combat": {
      "type": "combat",
      "description": "Fight the ghost",
      "narration_prompt": "Lady Ashworth shrieks and attacks!",
      
      "monster": "manor_ghost",
      
      "victory": {
        "narration_prompt": "The ghost dissipates with a wail. But something remains... a locket clatters to the floor.",
        "next_stage": "find_locket"
      },
      "defeat": {
        "narration_prompt": "Cold overwhelms you. You wake outside the manor gates.",
        "next_stage": "manor_gates",
        "sets_flag": "was_expelled"
      }
    },

    "ghost_talks": {
      "description": "The ghost speaks",
      "narration_prompt": "The ghost floats before you, calmer now but still guarded.",
      "stage_cue_npc": "lady_ashworth",
      "stage_npc_instruction": "The intruders have calmed you. You're still suspicious but willing to talk. Tell them you cannot rest because something was taken from you. A locket. Without it, you cannot remember who you were.",
      "actions": [
        {
          "id": "offer_help",
          "label": "🤝 Offer to Find the Locket",
          "narration_prompt": "You promise to search the manor for her locket.",
          "cue_npc": "lady_ashworth",
          "npc_instruction": "They've offered to help. You're surprised but grateful. Tell them the locket was taken to the cellar. But warn them: something else lives down there now.",
          "advances": true,
          "next_stage": "cellar_entrance"
        },
        {
          "id": "ask_about_death",
          "type": "skill_check",
          "label": "🔍 Ask About Her Death",
          "skill": "insight",
          "ability": "WIS",
          "dc": 13,
          "narration_prompt": "You gently ask what happened to her.",
          "success": {
            "narration_prompt": "Pain flickers across her features. She remembers fragments.",
            "cue_npc": "lady_ashworth",
            "npc_instruction": "They asked about your death. You struggle to remember. Flashes: a party, a man's face, cold water. You were betrayed. Murdered. But the details slip away like smoke.",
            "sets_flag": "knows_murder"
          },
          "failure": {
            "narration_prompt": "She recoils. 'I don't... I can't...' The question causes her pain.",
            "advances": false
          }
        }
      ]
    },

    "cellar_entrance": {
      "description": "The cellar door",
      "narration_prompt": "A heavy door leads down into darkness. Something skitters below.",
      "actions": [
        {
          "id": "descend",
          "label": "🪜 Descend",
          "narration_prompt": "You light a torch and head down the stairs.",
          "advances": true,
          "next_stage": "cellar_rats"
        }
      ]
    },

    "cellar_rats": {
      "type": "combat",
      "description": "Giant rats attack",
      "narration_prompt": "The cellar writhes with giant rats! They swarm toward you!",
      
      "monster": "giant_rat",
      "monster_count": 4,
      
      "victory": {
        "narration_prompt": "The last rat squeals and flees into a crack. In the corner, something glints.",
        "next_stage": "find_locket"
      },
      "defeat": {
        "narration_prompt": "The rats overwhelm you. You barely escape back up the stairs.",
        "next_stage": "cellar_entrance",
        "sets_flag": "rat_beaten"
      }
    },

    "find_locket": {
      "description": "Find the locket",
      "narration_prompt": "A tarnished silver locket lies in the dust. Inside is a faded portrait of a man and the initials 'E.A.'",
      "image": "locket.png",
      "actions": [
        {
          "id": "return_locket",
          "label": "👻 Return to the Ghost",
          "narration_prompt": "You climb back up and seek out Lady Ashworth.",
          "advances": true,
          "next_stage": "resolution"
        }
      ]
    },

    "resolution": {
      "description": "Return the locket",
      "narration_prompt": "You find Lady Ashworth in the foyer, waiting.",
      "stage_cue_npc": "lady_ashworth",
      "stage_npc_instruction": "They have returned with your locket. As you take it, memories flood back. Edmund. Your husband. He killed you for your fortune. The grief and rage drain away, replaced by peace. Thank them. Tell them you can finally rest. Begin to fade.",
      "actions": [
        {
          "id": "farewell",
          "label": "👋 Say Farewell",
          "narration_prompt": "You watch as Lady Ashworth fades into light, a peaceful smile on her lips. The manor feels warmer somehow.",
          "advances": true,
          "next_stage": null,
          "completes_quest": true
        }
      ]
    }
  }
}
```

---

## Implementation Phases

### Phase 1: Core System
- [ ] Quest state management (`lib/quests.js`)
- [ ] Basic stage navigation
- [ ] Normal actions with narration
- [ ] Quest API routes

### Phase 2: Skill Checks
- [ ] Skill check action type
- [ ] Roll resolution logic
- [ ] Skill check modal UI
- [ ] Integration with character sheets

### Phase 3: Combat Integration
- [ ] Combat stage type
- [ ] Virtual location ID mapping
- [ ] WS event handling for quest combat
- [ ] Victory/defeat branching

### Phase 4: Polish
- [ ] Quest log/journal UI
- [ ] Multiple participant support
- [ ] Quest rewards distribution
- [ ] Achievements integration

---

## Notes

- **Narration is AI-generated.** The `narration_prompt` is a seed — the narrator expands it with atmosphere.
- **NPCs speak for themselves.** Never put NPC dialogue in `narration_prompt`. Use `cue_npc` instead.
- **Keep prompts short.** 1-3 sentences max. The AI adds flourishes.
- **Combat uses existing rewards.** XP/gold from combat stages comes from the monster definition.
- **Flags persist.** Quest flags can be checked in future actions with `requires_flag`.

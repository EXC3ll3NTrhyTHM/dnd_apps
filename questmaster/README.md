# Quest Manager Bot

A Discord bot for managing D&D quests with interactive buttons and AI-powered narration.

## Quick Start

```bash
cd C:\Users\corpo\npc-bot\questmaster

# Run production bot (default)
node bot.js prod
# or just: node bot.js

# Run development bot
node bot.js dev
```

Or to run in background:
```bash
# Production
Start-Process -FilePath "node" -ArgumentList "bot.js prod" -WorkingDirectory "C:\Users\corpo\npc-bot\questmaster" -WindowStyle Hidden

# Development
Start-Process -FilePath "node" -ArgumentList "bot.js dev" -WorkingDirectory "C:\Users\corpo\npc-bot\questmaster" -WindowStyle Hidden
```

## Configuration

The bot supports separate dev and prod environments. Each environment has its own config files.

### Environment Files

| File | Purpose |
|------|---------|
| `.env.questmaster.prod` | Production Discord token + API keys |
| `.env.questmaster.dev` | Development Discord token + API keys |
| `config.prod.json` | Production channel IDs |
| `config.dev.json` | Development channel IDs |
| `party_quests.prod.json` | Production quest state |
| `party_quests.dev.json` | Development quest state |

### `.env.questmaster.{env}`
```env
DISCORD_TOKEN=your_bot_token
OPENAI_API_KEY=your_openai_key
MODEL=gpt-4o-mini  # optional, defaults to gpt-4o-mini
```

### `config.{env}.json`
```json
{
  "announce_channel_id": "channel_id",     // Where quest announcements go
  "narration_style": "dramatic but concise", // AI narration style
  "auto_cue_npcs": true,                   // Auto-cue NPCs during quests
  "board_channel_id": "channel_id",        // #available-quests channel
  "board_title_message_id": "msg_id"       // Title message ID (set by !qm board setup)
}
```

### Setting Up Dev Environment

1. Create a second bot at https://discord.com/developers/applications
2. Copy the bot token to `.env.questmaster.dev`
3. Update `config.dev.json` with your dev/test channel IDs
4. Invite the dev bot to your server

## Commands

### Player Commands
| Command | Description |
|---------|-------------|
| `!qm quests` | List your tracked quests |
| `!qm available` | List all available quests (from NPCs) |
| `!qm info <quest_id>` | Get quest details |
| `!qm track <quest_id>` | Add quest to your tracker |

### Gameplay Commands (during active quest)
| Command | Description |
|---------|-------------|
| `!qm start <quest_id>` | Begin quest narration |
| `!qm scene` | Describe current scene |
| `!qm action <text>` | Take an action ("I search the bushes") |
| `!qm advance [stage]` | Move to next quest stage |
| `!qm note <text>` | Add a note to the quest |
| `!qm cue <npc>` | Signal an NPC to speak |
| `!qm end` | End quest session |

### DM Commands
| Command | Description |
|---------|-------------|
| `!qm complete <quest_id>` | Mark quest as completed |
| `!qm fail <quest_id>` | Mark quest as failed |
| `!qm remove <quest_id>` | Remove from tracker |
| `!qm reset [quest_id]` | Reset one or all quests |
| `!qm board setup` | Create quest board in current channel |
| `!qm board refresh` | Force refresh the board |

## Quest Board

The quest board shows **tracked quests** (quests the party has accepted but not started).

### Setup
1. Go to your #available-quests channel
2. Run `!qm board setup`
3. Bot posts a title message + one embed per tracked quest
4. Each quest has a **▶️ Start Quest** button

### Flow
```
NPC gives quest → Player tracks it → Appears on board → Player clicks Start → Quest begins
```

When a quest is started, it's removed from the board (no longer "available").

## Stage-Based Gameplay

When a quest starts, players see **stage-specific action buttons** instead of generic ones.

### How It Works

1. **Quest starts** → First stage loads with its actions
2. **Player clicks action** → AI narrates the result
3. **Non-advancing actions** → Explore without progressing
4. **Advancing actions** → Move to next stage, get new narration + buttons
5. **Quest-completing action** → Quest marked complete, session ends

### NPC Companions

Quests can define `companions` - NPCs that accompany the party:
```json
"companions": ["nibby", "bonesy"]
```

Actions can cue companions to speak:
```json
{
  "id": "ask_nibby",
  "label": "💬 Ask Nibby",
  "cue_npc": "nibby",
  "npc_instruction": "The party is asking your opinion. Be helpful but nervous."
}
```

This posts a message prompting the NPC bot to respond in character.

## File Structure

```
questmaster/
├── bot.js                    # Main bot code
├── .env.questmaster.prod     # Production secrets (token, API key)
├── .env.questmaster.dev      # Development secrets
├── config.prod.json          # Production channel config
├── config.dev.json           # Development channel config
├── party_quests.prod.json    # Production quest state
├── party_quests.dev.json     # Development quest state
└── questmaster.log           # Log output
```

### `party_quests.json` Structure
```json
{
  "quests": [
    {
      "id": "forest_mystery",
      "name": "Strange Sounds in the Forest",
      "description": "Quest description...",
      "location": "North edge of the forest",
      "given_by": "nibby",
      "status": "tracked",
      "current_stage": null,
      "board_message_id": "123456789"  // Discord message ID on board
    }
  ],
  "completed": [],
  "failed": []
}
```

## Quest Definitions

Quests are defined in NPC character folders:
```
npc-bot/characters/<npc_name>/quests/<quest_id>.json
```

### Stage-Based Quests

Quests use a **stage-based system** where each stage has specific actions players can take.

```json
{
  "id": "forest_mystery",
  "name": "Strange Sounds in the Forest",
  "description": "Nibby heard something weird...",
  "companions": ["nibby"],
  
  "stages": {
    "arrival": {
      "description": "Party arrives at the forest edge",
      "narration_prompt": "Tall pines tower overhead...",
      "actions": [
        {
          "id": "examine_trees",
          "label": "🌲 Examine Trees",
          "narration_prompt": "The player examines the trees...",
          "advances": false
        },
        {
          "id": "head_deeper",
          "label": "🚶 Go Deeper",
          "narration_prompt": "The party moves deeper into the forest...",
          "advances": true,
          "next_stage": "investigation"
        }
      ]
    }
  },
  
  "nodes": { ... }  // Conversation tree for NPC roleplay
}
```

### Action Properties

| Property | Description |
|----------|-------------|
| `id` | Unique action identifier |
| `label` | Button text (include emoji) |
| `narration_prompt` | Description for AI narration |
| `advances` | Does this move to next stage? |
| `next_stage` | Stage to advance to |
| `completes_quest` | Does this complete the quest? |
| `cue_npc` | NPC name to prompt for response |
| `npc_instruction` | Context for the NPC |

### Creating New Quests

See **QUEST-TEMPLATE.md** for full documentation on creating stage-based quests.

## Buttons

The bot uses Discord buttons for interaction:
- **📜 Track** - Track an available quest
- **▶️ Start** - Begin a tracked quest
- **ℹ️ Info** - View quest details
- **🗑️** - Remove from tracker
- **Gameplay buttons** - Look Around, Listen, Search, Move, etc.

## Troubleshooting

### Bot not responding
1. Check if running: `Get-Process -Name node`
2. Check logs: `Get-Content questmaster.log -Tail 20`
3. Restart: Kill node processes and run `node bot.js prod` (or `dev`)

### Multiple instances
```powershell
# Kill all node processes
Get-Process -Name node | Stop-Process -Force
# Start fresh
node bot.js prod  # or: node bot.js dev
```

### Running both dev and prod
You can run both bots simultaneously since they use different tokens:
```powershell
# Terminal 1 - Production
node bot.js prod

# Terminal 2 - Development  
node bot.js dev
```

### Board not updating
1. Run `!qm board refresh`
2. Or delete channel messages and run `!qm board setup` again

## Integration with NPCs

Quest Manager works with NPC bots (Nibby, Bonesy, etc.):
1. NPCs have conversation trees that can "give" quests
2. When quest outcome = `quest_given`, player can track it
3. Quest Manager handles tracking, narration, and completion

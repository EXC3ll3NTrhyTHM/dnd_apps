# Adding New Characters

## Overview

Each NPC character needs:
1. A Discord bot application (with its own token)
2. An environment file (`.env.<name>`)
3. A character folder with personality files (`characters/<name>/`)

## Step 1: Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application"
3. Name it after your character (e.g., "Bonesy")
4. Go to the "Bot" section in the left sidebar
5. Click "Reset Token" and copy the token (save it somewhere safe!)
6. Enable these Privileged Gateway Intents:
   - **Message Content Intent** (required to read messages)
7. Go to "OAuth2" > "URL Generator"
8. Select scopes: `bot`
9. Select permissions: `Send Messages`, `Read Message History`, `View Channels`
10. Copy the generated URL and open it to invite the bot to your server

## Step 2: Create the Environment File

Create `.env.<character>` in the project root:

```bash
# .env.grolm (example for a new character named Grolm)

# Discord bot token from Step 1
DISCORD_TOKEN=paste_your_token_here

# OpenAI API key (can reuse the same one across all characters)
OPENAI_API_KEY=sk-proj-your-key-here

# Model to use
MODEL=gpt-4o-mini
```

## Step 3: Create Character Files

Create a folder `characters/<name>/` with three files:

### SOUL.md
The character's personality, voice, and identity. This is WHO they are.

```markdown
# Character Name

## Who You Are
- Name, race, role
- Core personality traits

## How You Talk
- Speech patterns
- Vocabulary
- Example lines

## Your Role
- What you do in the world
- How you interact with others
```

### CONTEXT.md
Campaign and world information the character would know.

```markdown
# Campaign Context

## Setting
Where and when the campaign takes place

## People You Know
NPCs, party members, relationships

## Current Events
What's happening in the world
```

### MEMORY.md
Personal memories and experiences. This grows over time.

```markdown
# Character's Memories

## Past Events
Things that happened to them

## Relationships
Personal connections and history

## Recent Events
Updated as the campaign progresses
```

## Step 4: Run the Character

```bash
node bot.js <character-name>
```

## Example: Adding "Grolm the Blacksmith"

```bash
# 1. Create the character folder
mkdir characters/grolm

# 2. Create the files (or copy from another character as template)
# Edit characters/grolm/SOUL.md
# Edit characters/grolm/CONTEXT.md  
# Edit characters/grolm/MEMORY.md

# 3. Create .env.grolm with the Discord token

# 4. Run
node bot.js grolm
```

## Tips

- **Reuse the OpenAI key** across all characters to simplify billing
- **Keep SOUL.md focused** - personality and voice, not backstory dumps
- **Update MEMORY.md** as the campaign progresses
- **Use !reload** to hot-reload character files without restarting the bot

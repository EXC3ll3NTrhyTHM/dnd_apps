# D&D NPC Discord Bot

A multi-character NPC bot for D&D campaigns. Each NPC runs as a separate Discord bot with its own personality, memories, and voice.

📚 **[Full Documentation](docs/README.md)** - Detailed guides on setup, adding characters, and architecture.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a Discord bot application for each NPC at https://discord.com/developers/applications

3. Create a `.env.<character>` file for each NPC:
   ```bash
   # .env.nibby
   DISCORD_TOKEN=nibbys_token
   OPENAI_API_KEY=your_openai_key
   MODEL=gpt-4o-mini
   
   # .env.bonesy
   DISCORD_TOKEN=bonesys_token
   OPENAI_API_KEY=your_openai_key
   MODEL=gpt-4o-mini
   ```

## Running a Character

Just pass the character name as an argument:

```bash
node bot.js nibby
node bot.js bonesy
```

The bot automatically loads `.env.<character>` for that NPC.

## Characters

Each character lives in `characters/<name>/` with three files:

- `SOUL.md` - Personality, voice, mannerisms, core identity
- `CONTEXT.md` - Campaign info, world knowledge, relationships
- `MEMORY.md` - Personal memories, experiences, things they've done

### Current Characters

- **nibby** - Angsty teen ranger-in-training, Tyren's adopted son
- **bonesy** - Chill skeleton bro, king of vibes, stoner energy

## Running Multiple NPCs

Each NPC needs its own terminal or use a process manager:

```bash
# Terminal 1
node bot.js nibby

# Terminal 2  
node bot.js bonesy
```

Or use PM2 for background running:
```bash
pm2 start bot.js --name nibby -- nibby
pm2 start bot.js --name bonesy -- bonesy
```

## Commands

When talking to a bot:
- `!reload` - Reload character files (hot-reload personality changes)
- `!clear` - Clear conversation history for the channel

## Adding a New NPC

1. Create a Discord bot application and get its token
2. Create `characters/<name>/` folder with SOUL.md, CONTEXT.md, MEMORY.md
3. Run with the new character name

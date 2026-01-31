# Project Architecture

## Overview

This is a multi-character Discord bot for D&D NPCs. Each character runs as a separate Node.js process with its own Discord connection, but they share the same codebase.

```
┌─────────────────────────────────────────────────────────┐
│                      npc-bot/                           │
├─────────────────────────────────────────────────────────┤
│  bot.js              Single entry point for all chars   │
│  .env.<character>    Per-character credentials          │
│  characters/         Character definitions              │
│    ├── nibby/                                           │
│    │   ├── SOUL.md       Personality & voice            │
│    │   ├── CONTEXT.md    World knowledge                │
│    │   └── MEMORY.md     Personal memories              │
│    └── bonesy/                                          │
│        ├── SOUL.md                                      │
│        ├── CONTEXT.md                                   │
│        └── MEMORY.md                                    │
└─────────────────────────────────────────────────────────┘
```

## How It Works

### Startup Flow

```
node bot.js nibby
       │
       ▼
┌──────────────────┐
│ Parse CLI arg    │ ─── CHARACTER = "nibby"
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Load .env.nibby  │ ─── DISCORD_TOKEN, OPENAI_API_KEY
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Load character   │ ─── characters/nibby/SOUL.md
│ files            │     characters/nibby/CONTEXT.md
│                  │     characters/nibby/MEMORY.md
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Connect to       │
│ Discord          │
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Listen for       │
│ @mentions & DMs  │
└──────────────────┘
```

### Message Flow

```
User @mentions bot
       │
       ▼
┌──────────────────┐
│ Extract message  │ ─── Remove @mention, get content
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Build prompt     │ ─── System: SOUL + CONTEXT + MEMORY
│                  │     History: Last 10 messages
│                  │     User: Current message
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Call OpenAI      │ ─── gpt-4o-mini (configurable)
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Reply in Discord │
└──────────────────┘
```

## Key Components

### bot.js

The main entry point. Handles:
- CLI argument parsing
- Environment loading (per-character)
- Discord client setup
- Message handling
- OpenAI API calls
- Conversation history management

### Character Files

| File | Purpose | When Loaded |
|------|---------|-------------|
| SOUL.md | Core personality, voice, mannerisms | Every message (builds system prompt) |
| CONTEXT.md | Campaign info, world knowledge | Every message (builds system prompt) |
| MEMORY.md | Personal memories, experiences | Every message (builds system prompt) |

All three files are combined into the system prompt for every API call. This means changes take effect immediately (or use `!reload` to be safe).

### Conversation History

- Stored in-memory per channel (Map)
- Keeps last 10 message pairs (user + assistant)
- Cleared on bot restart or `!clear` command
- Separate per channel, so conversations don't bleed

## Running Multiple Characters

Each character runs as an independent process:

```
┌─────────────┐     ┌─────────────┐
│ Process 1   │     │ Process 2   │
│ node bot.js │     │ node bot.js │
│ nibby       │     │ bonesy      │
├─────────────┤     ├─────────────┤
│ Discord     │     │ Discord     │
│ Connection  │     │ Connection  │
│ (Nibby bot) │     │ (Bonesy bot)│
└──────┬──────┘     └──────┬──────┘
       │                   │
       ▼                   ▼
┌─────────────────────────────────┐
│         Discord Server          │
│  (Both bots connected)          │
└─────────────────────────────────┘
```

Benefits:
- Isolated: One crash doesn't affect others
- Independent: Each has its own memory/history
- Scalable: Add more characters without code changes

## API Usage

Each message to an NPC = 1 OpenAI API call

Approximate token usage per message:
- System prompt (SOUL + CONTEXT + MEMORY): ~1000-2000 tokens
- Conversation history (10 messages): ~500-1000 tokens
- Response: ~100-300 tokens

With gpt-4o-mini pricing, expect ~$0.001-0.002 per message.

## Security Notes

- `.env.*` files contain secrets - never commit them
- Discord tokens grant full bot control - keep them private
- OpenAI keys are billed to your account - monitor usage
- Bot can only see channels it's been given permission to access

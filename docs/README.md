# NPC Bot Documentation

## Contents

- [Getting Started](getting-started.md) - Installation, running bots, using PM2
- [Adding Characters](adding-characters.md) - Discord setup, tokens, character files
- [Architecture](architecture.md) - How the code works, message flow, API usage
- [Memory System](memory-system.md) - Auto-journaling and memory consolidation

## Quick Reference

### Run a character
```bash
node bot.js <character-name>
```

### Available characters
- `nibby` - Angsty teen ranger
- `bonesy` - Chill skeleton bro

### Bot commands (when mentioned)
- `!reload` - Reload character files
- `!clear` - Clear conversation history
- `!journal` - Show journal status
- `!remember <text>` - Add manual journal entry
- `!consolidate` - Merge journal → long-term memory

### Files per character
```
.env.<name>           # Discord token + API keys
characters/<name>/
  ├── SOUL.md         # Personality
  ├── CONTEXT.md      # World knowledge  
  ├── MEMORY.md       # Long-term memories
  ├── journal.md      # Recent events (auto-generated)
  └── backups/        # Old memories before consolidation
```

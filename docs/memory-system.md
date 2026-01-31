# Memory System

The NPC bots have a two-tier memory system: long-term memories (MEMORY.md) and a rolling journal (journal.md).

## How It Works

```
┌─────────────────┐     Every 5 messages     ┌─────────────────┐
│  Conversations  │ ────────────────────────▶│   journal.md    │
│   (in memory)   │    AI summarizes what    │  (recent events)│
└─────────────────┘    just happened         └────────┬────────┘
                                                      │
                                                      │ !consolidate
                                                      │ (or auto at 10KB)
                                                      ▼
                                             ┌─────────────────┐
                                             │   MEMORY.md     │
                                             │ (long-term)     │
                                             └─────────────────┘
```

## Files

| File | Purpose | Size |
|------|---------|------|
| `MEMORY.md` | Long-term memories, important events, relationships | Stays small (~50 lines max) |
| `journal.md` | Recent events, auto-logged | Grows until consolidation |
| `backups/` | Old versions before consolidation | Automatic |

## Automatic Journaling

Every 5 messages (configurable), the bot:
1. Summarizes the recent conversation
2. Writes a 1-2 sentence journal entry from the NPC's perspective
3. Skips mundane/boring conversations automatically

Example journal entry:
```
[2026-01-26] Met a new adventurer named Blake at the tavern. Shared some snacks and talked about the weather in Okhan.
```

## Consolidation

When journal.md gets too large (10KB default) or you run `!consolidate`:

1. AI reads current MEMORY.md + all journal entries
2. Creates a new, condensed MEMORY.md
3. Backs up old files to `backups/` folder
4. Clears the journal

This keeps MEMORY.md lean while preserving important stuff.

## Commands

| Command | What it does |
|---------|--------------|
| `!journal` | Shows journal status (entries, size) |
| `!remember <thing>` | Manually add something to the journal |
| `!consolidate` | Merge journal into long-term memory |
| `!clear` | Clear conversation history (not journal) |

## Configuration

In `bot.js`, you can adjust:

```javascript
const JOURNAL_INTERVAL = 5;           // Write to journal every N messages
const JOURNAL_MAX_SIZE = 10 * 1024;   // Auto-consolidate at 10KB
```

## Example Flow

1. Players chat with Bonesy for a while
2. After 5 messages, bot writes: `[2026-01-26] Had a chill conversation with some adventurers about dragons. Offered them snacks.`
3. More conversations happen, journal grows
4. At 10KB (or manual `!consolidate`), memories get merged
5. MEMORY.md now has a clean summary, journal is empty, cycle repeats

## Backups

Before any consolidation, the system saves:
- `backups/MEMORY.<timestamp>.md` - Previous long-term memory
- `backups/journal.<timestamp>.md` - Journal being consolidated

So you can always recover if something goes wrong.

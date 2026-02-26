# Private 1-on-1 NPC Conversations + Reputation System

## Overview

Make NPC interactions more engaging by letting players **tap an NPC sprite** to pull them aside for a private conversation. NPCs remember you, form opinions (reputation), and other players see that you're chatting with someone (social indicators). This is the foundation for future features: skill checks in dialogue, NPC gambling/minigames, and side quests.

## Features (Phase 1)

### 1. Private 1-on-1 Conversations
- Tap any NPC sprite in the scene to open a full-screen private chat overlay
- Uses the existing AI dialogue engine with a modified prompt: "this is private, you can be candid, share secrets"
- Separate chat history per player per NPC (`data/chat_history/npc_dm/{userId}_{npcId}.json`)
- Never leaks into shared location chat
- Marcel excluded (keeps existing @mention/DM behavior via Clawdbot)

### 2. Basic Reputation System
- Each NPC evaluates how conversation made them feel (`repDelta` -2 to +2 in AI response)
- Score accumulates over time, clamped to [-100, +100]
- Displayed as a badge in the overlay header
- Labels: "Distrusted" / "Wary" / "Neutral" / "Friendly" / "Trusted Ally"
- Stored in `data/npc_reputation.json`
- Foundation for future unlocks (discounts, quests, secrets, skill check DCs)

### 3. Social Indicators
- Other players at the location see "Acacia is chatting" on the NPC sprite
- In-memory tracker on server, broadcast via WebSocket
- Creates intrigue without revealing conversation content

---

## Implementation Plan

### Step 1: Server — Reputation Module

**New file: `server/lib/reputation.js`**

Simple JSON-backed store at `data/npc_reputation.json`.

- `getReputation(userId, npcId)` -> `{ score, totalMessages, lastInteraction }`
- `updateReputation(userId, npcId, delta)` -> clamp to [-100, +100], increment totalMessages
- `getAllReputations(userId)` -> all NPC rep scores for a player
- `getReputationLabel(score)` -> maps score ranges to text
- Atomic writes (`.tmp` + rename pattern)

### Step 2: Server — Active Conversation Tracker

**New file: `server/lib/npcConversations.js`**

In-memory Map tracking who's in a private NPC chat (for social indicators).

- `startConversation(locationId, userId, npcId, npcDisplayName, playerName)` — ends any existing conversation for this user first
- `endConversation(locationId, userId)`
- `getActiveConversations(locationId)` -> array of active conversations

### Step 3: Server — Dialogue Engine Changes

**Modify: `server/lib/dialogue.js`**

1. When `locationContext.isPrivateConversation` is true, append a **PRIVATE CONVERSATION** section:
   - "You are having a private 1-on-1 conversation. No one else can hear you."
   - Include reputation description: "Your relationship: [Friendly / Wary / etc.]"
   - Clear `otherNpcs` (nobody else listening)
2. Add `repDelta` to JSON response format: `{"text": "...", "emotion": "...", "repDelta": -2 to 2}`
3. Modify `generateResponse()` to parse and return `repDelta` (default 0)

### Step 4: Server — Chat History Support

**Modify: `server/lib/chatHistory.js`**

Add `npc_dm_` channel prefix handling in `resolveHistoryPath()` (mirrors existing `marcel_dm_` pattern):
- Path: `data/chat_history/npc_dm/{userId}_{npcId}.json`

### Step 5: Server — NPC DM Routes

**New file: `server/routes/npcDm.js`**

Modeled on `server/routes/marcelDm.js`:

| Endpoint | Purpose |
|----------|---------|
| `POST /api/npc-dm/:npcId/start` | Start conversation, broadcast WS indicator, return history + reputation |
| `POST /api/npc-dm/:npcId/message` | Send message, get AI response, update reputation |
| `GET /api/npc-dm/:npcId/history` | Paginated conversation history |
| `POST /api/npc-dm/:npcId/end` | End conversation, clear indicator (supports sendBeacon) |

Key behaviors:
- Per-user lock via `acquireLock(userId_npcId)`
- Rate limit (5 msg/min)
- Validate NPC exists at player's current location
- Skip NPCs with `handledBy` (Marcel)
- Journal write every 8 messages (reuse `writeWebJournal`)
- Award XP, increment `npc_private_messages` lifetime stat

Register in `server/server.js`: `app.use('/api/npc-dm', require('./routes/npcDm'));`

### Step 6: Client — NpcChatOverlay Component

**New files: `client/src/components/NpcChatOverlay.jsx` + `client/src/styles/npc-chat.css`**

Full-screen overlay (follows FishingOverlay pattern):

```
+----------------------------------+
| [<- Back]    Bonesy              |  header
|        [Rep: Friendly (+32)]     |  reputation badge
+----------------------------------+
|     [NPC Portrait - large]       |  emotion-driven via NpcPortrait
|  [Scrollable chat messages]      |  reuses ChatBubble component
+----------------------------------+
| [Type a message...]      [Send]  |  native <input>
+----------------------------------+
```

- On mount: `POST start` -> load history + reputation, broadcast indicator
- On send: `POST message` -> typing dots, append response, update portrait + rep
- On unmount: `POST end` via `navigator.sendBeacon`
- iOS safe area padding on header
- Uses native `<input>` (CustomKeyboard not needed here)

### Step 7: Client — LocationChat Integration

**Modify: `client/src/pages/LocationChat.jsx`**

1. New state: `npcChatTarget` (which NPC overlay is open) + `npcConversations` (other players' active convos)
2. Modify `handleNpcClick` (line 1097): check if NPC has `handledBy` -> if not, open overlay instead of @mention
3. Handle WS events `npc_conversation_start` / `npc_conversation_end` from other users
4. Render `<NpcChatOverlay>` with Suspense lazy loading

### Step 8: Client — Social Indicators on NPC Sprites

**Modify: `client/src/pages/scenes/SceneBase.jsx`**

Add `conversationInfo` prop to `NpcSprite`:
- When present, show floating label: "Acacia is chatting" with pulsing dot
- Pass `npcConversations` from LocationChat through scene props

---

## Key Design Decisions

- **Marcel exception:** NPCs with `handledBy` skip the overlay, keep existing behavior
- **One conversation at a time:** Opening a new NPC chat auto-closes any existing one
- **Separate history:** Private conversations never leak into shared location chat
- **Private-only AI context:** NPC sees only private history (last 20 msgs) + personality files, not shared chat
- **Reputation is AI-driven:** The NPC decides `repDelta` per message — no manual scoring rules

---

## Critical Files

| File | Action |
|------|--------|
| `server/lib/reputation.js` | Create |
| `server/lib/npcConversations.js` | Create |
| `server/lib/dialogue.js` | Modify |
| `server/lib/chatHistory.js` | Modify |
| `server/lib/xp.js` | Modify |
| `server/routes/npcDm.js` | Create |
| `server/server.js` | Modify |
| `client/src/components/NpcChatOverlay.jsx` | Create |
| `client/src/styles/npc-chat.css` | Create |
| `client/src/pages/LocationChat.jsx` | Modify |
| `client/src/pages/scenes/SceneBase.jsx` | Modify |

**Reference files (reuse patterns from):**
- `server/routes/marcelDm.js` — route structure, locks, rate limiting
- `client/src/components/FishingOverlay.jsx` — overlay pattern
- `client/src/components/ChatBubble.jsx` — message rendering (reuse as-is)
- `client/src/components/NpcPortrait.jsx` — emotion portrait (reuse as-is)

---

## Future Phases

- **Phase 2:** Skill checks during NPC conversations (Persuasion, Intimidation, Insight rolls with dice system)
- **Phase 3:** NPC gambling / minigames (dice games, wagers at the tavern, training challenges at the dojo)
- **Phase 4:** NPC side quests via private conversations (uses existing quest node system in `characters/{npc}/quests/`)
- **Phase 5:** Reputation affecting gameplay (shop discounts, quest availability, NPC-initiated conversations)

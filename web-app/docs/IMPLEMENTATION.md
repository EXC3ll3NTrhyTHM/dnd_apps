# Dragon's Hollow — Web App Implementation

Location-based NPC chat companion for the Bound By Rot campaign. Players navigate an illustrated map of Okhan, enter locations, and chat with AI-driven NPCs.

---

## Architecture Overview

```
web-app/
├── server/
│   ├── server.js              # Express server (port 3420)
│   ├── lib/
│   │   ├── dialogue.js        # NPC dialogue engine (NEW)
│   │   ├── economy.js         # Wallet, inventory, shop data layer
│   │   └── discord-auth.js    # Discord OAuth2 flow
│   ├── middleware/
│   │   └── auth.js            # JWT auth (Bearer token + cookie)
│   └── routes/
│       ├── chat.js            # Location-based chat API (NEW)
│       ├── campaign.js        # Campaign phase state API (NEW)
│       ├── auth.js            # Login, callback, /me, logout
│       ├── wallet.js          # Balance, inventory
│       ├── shop.js            # Shop catalog, purchases
│       ├── tavern.js          # Tavern menu, purchases (signal-based)
│       ├── quests.js          # Quest board
│       └── leaderboard.js     # Gold rankings
├── data/
│   ├── locations.json         # Location config with NPC assignments (NEW)
│   ├── campaign_state.json    # Current theme phase value (NEW)
│   └── chat_history/          # Per-player per-location chat logs (NEW)
│       └── {userId}/{locationId}.json
├── client/
│   └── src/
│       ├── main.jsx           # React root (+ ThemeProvider)
│       ├── App.jsx            # Routes (map, location chat, admin)
│       ├── context/
│       │   └── ThemeContext.jsx    # Campaign phase state + polling (NEW)
│       ├── pages/
│       │   ├── Map.jsx            # Location hub with NPC presence (NEW)
│       │   ├── LocationChat.jsx   # Chat interface, room + 1-on-1 (NEW)
│       │   ├── Admin.jsx          # DM panel — phase, NPC assignments (NEW)
│       │   ├── Profile.jsx        # Stats + inventory + leaderboard (MODIFIED)
│       │   ├── Quests.jsx         # Quest board (unchanged)
│       │   ├── Tavern.jsx         # Legacy (redirects to /map)
│       │   ├── Shop.jsx           # Legacy (redirects to /map)
│       │   └── Leaderboard.jsx    # Legacy (absorbed into Profile)
│       ├── components/
│       │   ├── ChatBubble.jsx     # Message bubble with NPC portrait (NEW)
│       │   ├── ChatInput.jsx      # Text input with mode indicator (NEW)
│       │   ├── NpcPortrait.jsx    # Emotion-based portrait crossfade (NEW)
│       │   ├── NpcBar.jsx         # Horizontal NPC selector bar (NEW)
│       │   ├── Layout.jsx         # App shell — 3-tab nav (MODIFIED)
│       │   ├── ItemCard.jsx       # Reused in chat menu panels
│       │   ├── Toast.jsx          # Notifications
│       │   └── GoldBadge.jsx      # Currency display
│       └── styles/
│           ├── theme-engine.js    # Phase interpolation engine (NEW)
│           ├── location-chat.css  # Chat UI styles (NEW)
│           ├── map.css            # Map hub styles (NEW)
│           └── index.css          # Global theme variables
└── docs/
    └── IMPLEMENTATION.md          # This file
```

---

## Locations & NPCs

5 locations, configured in `data/locations.json`. NPCs are swappable — edit the JSON or use the Admin panel.

| Location | ID | NPCs | Features |
|---|---|---|---|
| The Collective | `the_collective` | marcel | — |
| Dragon's Hollow | `dragons_hollow` | bonesy, mira, nibby, kumo, bigtam, grumm | tavern_menu, shop |
| The Barracks | `the_barracks` | cena, jonah, reah | — |
| The Veil | `the_veil` | aurelia, brynleaf, ember, ithrae | — |
| The Dojo | `the_dojo` | djinn, kai, mai, edgar, ximena, kumo | — |

---

## Chat System

### How it works

1. Player enters a location from the Map
2. The NPC bar shows who's present
3. **Room mode (default):** Player sends a message, `pickRespondingNpc()` uses an LLM call to decide which 1-2 NPCs should respond based on message content and their personalities
4. **1-on-1 mode:** Player taps an NPC portrait to direct messages at them specifically
5. Each NPC response includes an `emotion` tag (idle, happy, angry, suspicious, sad, surprised, scared, thoughtful) that drives portrait expression changes

### Dialogue Engine (`server/lib/dialogue.js`)

Mirrors the Discord bot's `buildSystemPrompt()` pattern from `bot.js`, adapted for web:

- `loadCharacterContext(npcName)` — reads SOUL.md, MEMORY.md, CONTEXT.md, journal.md from `characters/{npcName}/`
- `buildWebSystemPrompt(npcName, locationContext, playerName)` — constructs system prompt with character identity, campaign context, memories, journal, location awareness, other NPCs, and JSON response format instructions
- `generateResponse(npcName, playerName, message, history, locationContext)` — calls OpenAI with the last 20 messages of history, returns `{ text, emotion, npc }`
- `pickRespondingNpc(locationNpcs, message, recentHistory)` — checks for name mentions first, then uses LLM to pick who responds
- `writeWebJournal(npcName, history)` — writes to the same `journal.md` files the Discord bots use, so NPC memories persist across both platforms

### Chat History

- Stored in `data/chat_history/{userId}/{locationId}.json`
- Last 30 messages kept per player per location
- Atomic writes (temp file + rename) to prevent corruption
- Journal entries written every 8 messages per NPC

### Rate Limiting

- 5 messages per minute per user
- In-memory tracking (sufficient for ~5 players)
- Returns 429 with a friendly error message

---

## API Endpoints (New)

### Chat

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/chat/locations` | Required | List all locations with NPC presence |
| GET | `/api/chat/locations/:id/history` | Required | Chat history for user at location |
| POST | `/api/chat/locations/:id/message` | Required | Room chat — system picks responding NPC(s) |
| POST | `/api/chat/locations/:id/npc/:name/message` | Required | 1-on-1 — message a specific NPC |

**Message request body:** `{ "message": "string (max 1000 chars)" }`

**Response format:**
```json
{
  "playerMessage": { "role": "player", "playerName": "...", "text": "...", "timestamp": "..." },
  "responses": [
    {
      "role": "npc",
      "npc": "bonesy",
      "npcDisplayName": "Bonesy",
      "text": "Heyyy maaaan...",
      "emotion": "happy",
      "timestamp": "..."
    }
  ]
}
```

### Campaign

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/campaign/state` | Required | Current phase value |
| POST | `/api/campaign/state` | DM only | Update phase (0-3) |
| POST | `/api/campaign/locations` | DM only | Update NPC assignments at a location |

---

## Theme Decay System

The app's visual identity shifts as the campaign progresses. The DM controls the pace via the Admin panel.

### 3 Phases

| Phase | Name | Description |
|---|---|---|
| 1.0 | Illuminated Manuscript | Deep navy/black backgrounds, ornate gold accents, clean borders |
| 2.0 | Creeping Rot | Golds tarnish to copper, backgrounds shift green-tinged, borders darken |
| 3.0 | Full Decay | Bioluminescent teal/purple replaces gold, organic dark palette |

### How it works

1. `ThemeContext.jsx` fetches the campaign phase from `GET /api/campaign/state` on mount and polls every 5 minutes
2. `theme-engine.js` defines 3 RGB color palettes and linearly interpolates between adjacent palettes based on the phase value
3. Computed CSS custom properties (`--bg-deepest`, `--color-gold`, `--text-primary`, etc.) are applied to `:root` via JavaScript
4. All existing CSS uses these variables, so the entire UI shifts seamlessly

**Example:** At phase 1.7, the engine interpolates 70% of the way from Manuscript to Rot. Gold (`#d4a843`) blends toward tarnished copper (`#b8843c`).

### Variables interpolated

`--bg-deepest`, `--bg-dark`, `--bg-surface`, `--bg-elevated`, `--bg-card`, `--bg-card-hover`, `--color-gold`, `--color-gold-bright`, `--color-gold-dim`, `--color-accent`, `--border-color`, `--border-color-light`, `--text-primary`, `--text-secondary`, `--text-muted`, `--text-bright`, `--shadow-glow`

---

## NPC Portraits

### Structure

```
client/public/portraits/
├── manifest.json              # Lists available emotions per NPC
├── default.svg                # Generic silhouette fallback
├── bonesy/
│   └── idle.png               # Currently only idle expression
└── nalyd/
    └── idle.png
```

### Manifest format

```json
{
  "bonesy": ["idle"],
  "nibby": [],
  "mira": []
}
```

### Emotion resolution (NpcPortrait.jsx)

1. Check manifest for requested emotion (e.g., "happy")
2. If available: `/portraits/{npcId}/happy.png`
3. If not, fall back to: `/portraits/{npcId}/idle.png`
4. If no portraits at all: `/portraits/default.svg`

Portrait transitions use two stacked `<img>` elements with `opacity 0.4s ease-in-out` crossfade.

### Adding portraits

1. Create `client/public/portraits/{npcName}/` directory
2. Add `{emotion}.png` files (idle, happy, angry, suspicious, sad, surprised, scared, thoughtful)
3. Update `manifest.json` to list available emotions

---

## Navigation

### Bottom nav (3 tabs)

| Tab | Route | Content |
|---|---|---|
| Map | `/map` | Stylized location cards with NPC presence indicators |
| Quests | `/quests` | Quest board (existing, unchanged) |
| Profile | `/profile` | Stats, inventory, leaderboard (consolidated) |

### Full-screen routes (no bottom nav)

| Route | Content |
|---|---|
| `/location/:locationId` | Location chat interface |

### Legacy redirects

| Old Route | Redirects To |
|---|---|
| `/tavern` | `/map` |
| `/shop` | `/map` |
| `/leaderboard` | `/profile` |

---

## Economy Integration

When at Dragon's Hollow, the chat header shows "Menu" and "Shop" buttons:

- **Menu** opens a slide-up panel with Big Tam's tavern menu (reuses existing `ItemCard` component and `POST /api/tavern/buy`)
- **Shop** opens Grumm's shop catalog (reuses `POST /api/shop/buy`)
- After purchase, wallet updates and a contextual message is injected into the chat

These features are controlled by the `features` array in `locations.json`. Any location can have `tavern_menu` and/or `shop` features added.

---

## Admin Panel (`/admin`)

Access restricted to Discord user IDs listed in `DM_USER_IDS` environment variable.

- **Campaign phase slider** — 1.0 to 3.0 with 0.05 step increments, live preview of theme shift
- **NPC location assignment** — toggle buttons to add/remove any of 18 NPCs from any location

---

## Configuration

### Environment Variables (`.env`)

| Variable | Required | Description |
|---|---|---|
| `DISCORD_CLIENT_ID` | Yes | Discord OAuth2 application ID |
| `DISCORD_CLIENT_SECRET` | Yes | Discord OAuth2 secret |
| `DISCORD_REDIRECT_URI` | Yes | OAuth callback URL |
| `PORT` | No | Server port (default: 3420) |
| `JWT_SECRET` | Yes | Secret for signing auth tokens |
| `NODE_ENV` | No | development or production |
| `CLIENT_URL` | No | Frontend URL (default: http://localhost:5173) |
| `OPENAI_API_KEY` | Yes | OpenAI API key for NPC dialogue |
| `CHAT_MODEL` | No | LLM model (default: gpt-4o-mini) |
| `DM_USER_IDS` | No | Comma-separated Discord user IDs for admin access |

---

## Running

```bash
cd web-app
npm install
cd client && npm install && cd ..
npm run dev
```

Server runs on `http://localhost:3420`, client on `http://localhost:5173`.

---

## Integration with Discord Bots

The web app reads and writes the same files the Discord bots use:

| Shared Resource | Used By |
|---|---|
| `characters/{name}/SOUL.md` | Bot personality + Web dialogue |
| `characters/{name}/MEMORY.md` | Bot memory + Web dialogue |
| `characters/{name}/CONTEXT.md` | Bot context + Web dialogue |
| `characters/{name}/journal.md` | Bot writes entries, Web reads + writes entries |
| `economy/wallets.prod.json` | Shopkeeper bot + Web purchases |
| `economy/inventories.prod.json` | Shopkeeper bot + Web purchases |
| `npc_registry.json` | Bot identity + Web NPC display names |
| `questmaster/party_quests.prod.json` | Questmaster bot + Web quest board |

NPC memories persist across Discord and web — if a player chats with Bonesy on the web app, the conversation gets journaled to the same `journal.md` that Bonesy's Discord bot reads.

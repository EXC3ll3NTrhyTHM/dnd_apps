# Dragon's Hollow - Web App Roadmap

## Vision
A mobile-first PWA that brings the D&D Discord server to life as an illustrated game world. Players log in with Discord, explore locations, interact with NPCs, buy items, take quests, and eventually fight monsters. All backed by the same economy and quest systems the Discord bots use.

Hosted on Blake's PC. 5 players. Cloudflare Tunnel for public access.

---

## Phase 1 - Foundation ✅
*Status: Built*

- [x] Express API server reading/writing the same economy JSON files as bots
- [x] Discord OAuth2 login
- [x] JWT session management
- [x] API routes: wallet, inventory, shop, tavern, quests, leaderboard
- [x] React + Vite frontend skeleton
- [x] Dark fantasy theme (Cinzel headings, dark backgrounds, gold accents)
- [x] Mobile-first layout with bottom nav
- [x] PWA manifest + service worker (installable on iOS/Android)
- [x] Pages: Landing, Tavern, Shop, Quests, Profile, Leaderboard

**Location:** `npc-bot/web-app/`

---

## Phase 2 - Illustrated UI
*Status: Not started*

Replace the card-based layout with visual scenes. Each location is an illustrated environment, not a list.

### Locations
- [ ] **Tavern** - Interior of The Dragon's Hollow. Big Tam behind the bar. Click her to see the menu. Warm lighting, wooden beams, fireplace.
- [ ] **Shop** - Grumm's shop interior. Shelves of items. A large bear behind the counter with reading glasses. Click items or Grumm to browse.
- [ ] **Quest Board** - Physical board on a wall in the tavern or town square. Quest scrolls pinned to it. Click a scroll to read/accept.
- [ ] **Town Square** - Hub that connects to other locations. Shows which NPCs are currently "online" (based on presence schedule).
- [ ] **Player Profile** - Character sheet style layout. Gold pouch, inventory grid, quest log.

### NPC Interactions
- [ ] NPC art displayed in their location
- [ ] Click NPC to open interaction panel (dialog, menu, shop)
- [ ] NPCs show as present/away based on their Discord presence schedule
- [ ] NPC dialog generated via OpenAI (same as Discord bots)

### Art Pipeline
- [ ] Use `generate-quest-images.js` to create location scenes
- [ ] Character reference images in `references/characters/`
- [ ] Location scenes in `references/locations/`
- [ ] Consistent painterly fantasy art style

### Navigation
- [ ] Visual map or location selector (not just bottom nav tabs)
- [ ] Transition animations between locations
- [ ] Ambient sound per location (optional, stretch goal)

---

## Phase 3 - Quest UI
*Status: Not started*

Quests rendered as visual narrative experiences in the app. Same quest JSON format the bots use.

### Quest Board
- [ ] Available quests displayed as scrolls/cards with NPC portraits
- [ ] Quest details: description, reward, quest giver, tone
- [ ] Accept quest button

### Quest Playthrough
- [ ] Stage narration displayed with scene images
- [ ] Action buttons rendered as styled choices (like a visual novel)
- [ ] NPC cue moments: NPC portrait + generated dialog
- [ ] Branch tracking and quest flags
- [ ] Quest completion with reward distribution

### Quest Management (DM)
- [ ] Quest panel UI (same as Discord `!quest` panel but in the app)
- [ ] Load, arm, force start, end quests
- [ ] Target specific players
- [ ] Monitor quest progress

---

## Phase 4 - Marcel Integration
*Status: Not started*

Marcel (AI assistant) available as a separate entity any player can interact with in the app.

### Player-Facing
- [ ] Chat interface accessible from any location
- [ ] Marcel can answer questions about the world, NPCs, quests
- [ ] Marcel has his own presence in the game world (appears in a location)
- [ ] Marcel aware of player's gold, inventory, active quests for context

### Architecture
- [ ] Chat endpoint in the Express API
- [ ] Routes to Clawdbot session or dedicated OpenAI instance
- [ ] Marcel's personality/SOUL loaded as system prompt
- [ ] Conversation history per player (stored in JSON like everything else)
- [ ] Rate limiting to control API costs

### Open Questions
- Should Marcel be a Clawdbot session (same Marcel as Discord) or a separate instance?
- What can Marcel do for players? Just chat, or can he trigger game actions?
- Does Marcel have a visual avatar/location in the world?

---

## Phase 5 - Turn-Based Combat
*Status: Not started - needs design*

### Open Design Questions
- D&D 5e rules or simplified custom system?
- PvE only or PvP too?
- Where do player stats come from? (levels, classes, items from shop?)
- Solo encounters or party-based?
- Real-time multiplayer or async turns?
- What triggers combat? (quest stages, random encounters, arena?)

### Likely Components
- [ ] Combat system engine (turn order, actions, damage calc)
- [ ] Player stats/class system
- [ ] Enemy/monster definitions
- [ ] Combat UI (health bars, action buttons, attack animations)
- [ ] Combat rewards (gold, items, XP?)
- [ ] Integration with quest stages (combat as a quest action)

---

## Infrastructure

### Hosting
- Express server + Vite build on Blake's PC
- Cloudflare Tunnel for public HTTPS URL
- Same machine as all NPC bots (shared file access)

### Data
- All game data in JSON files (no database)
- Shared with Discord bots - same files, same atomic write pattern
- Economy: `economy/wallets.prod.json`, `inventories.prod.json`, `transactions.prod.json`
- Shop: `economy/shop_catalog.json`
- Tavern: `characters/bigtam/tavern_menu.json`
- Quests: `characters/*/quests/*.json`

### Auth
- Discord OAuth2 (players log in with Discord)
- JWT tokens for session management
- Player identity = Discord user ID (same as bots use for wallets)

---

## Art Style
- Painterly fantasy illustration
- Rich colors, atmospheric lighting, textured brushwork
- NOT photorealistic, NOT anime, NOT cartoonish
- Reference: classic fantasy book illustrations with modern polish
- Generated via OpenAI image API with character reference images for consistency

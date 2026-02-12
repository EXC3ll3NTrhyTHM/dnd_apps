# Web App - Issues & Feature Requests

*Tracking bugs and feature ideas for the NPC Bot web app*

---

## Blockers 🚧

### Clawdbot Integration
- [ ] **Marcel/Clawdbot on the Web App** ❌ *Blocking migration*
  - Need Clawdbot present in web app like Discord
  - Respond when @mentioned (not monitoring everything)
  
  **Required API:**
  ```
  POST /api/clawdbot/message      → Web app sends tagged message to Clawdbot
  GET  /api/channels              → List all locations/rooms
  GET  /api/channels/:id/messages → Message history (for context)
  POST /api/channels/:id/messages → Clawdbot sends response
  GET  /api/users/:id             → Player info
  ```
  
  **Flow:**
  1. Player sends message with @Marcel
  2. Web app detects mention → POST to Clawdbot
  3. Clawdbot fetches recent history if needed for context
  4. Clawdbot responds → POST back to channel
  
  **Nice-to-have:** WebSocket for real-time (not required if mention-only)
  
  **Clawdbot side:** Custom channel plugin to talk to web app API

---

## Bugs 🐛

### UI/Display
- [ ] Rotate screen message displays during page reload/blank screen
- [x] DM controls show for everybody (should be DM-only)

### Chat/Messaging
- [ ] NPCs still respond when no @mention is added (should require mention)
- [ ] **[iPhone]** @mention popup doesn't add mentions to keyboard

---

## Feature Requests ✨

### Chat/Input
- [x] **Message Reactions** ⚡ *Priority - Tonight*
  - Emoji reactions on individual messages (Discord/Slack style)
  - Tap/long-press message to add reaction
  - Show reaction counts under message
  - Quick reaction bar (most used emojis)

- [ ] **Quick Actions Button** (Keyboard Shortcut)
  - Button near keyboard for most-used extras
  - Opens mini menu: dice, spells, emotes, items, etc.
  - Player can customize their shortcuts
  - One tap access to frequent actions without menu diving
  
- [ ] Add autocomplete to keyboard
- [ ] Clicking player sprite should add their @tag to text input (not working)
- [ ] Image sharing support ⚡ *Priority*
  - Plus icon opens drawer under keyboard
  - Multiple options in drawer
  - Could include NPC or player icon selector

- [x] **Private Marcel Chat** ⚡ *Priority*
  - Each player gets a private DM channel with Marcel on the app
  - Same functionality as Discord DMs but in-app
  - **Summon Gesture** - Draw an "M" on screen to summon Marcel
    - Gesture recognition for the letter M
    - Use **Jager** library ([GitHub](https://github.com/vmikhav/jager)) - built for drawn symbol recognition
    - Chat appears as overlay with magical animation (smoke, shimmer)
    - Feels like a summoning ritual, not just opening a chat
    - Remove Marcel pin from map (not a physical place)
    - Could have a subtle hint/tutorial on first use
    - Future: more patterns (⭐ for quests, 🎲 for dice, etc.)

### Dice Rolling
- [ ] **3D Dice Roller** ⚡ *Priority - Tonight (2026-02-11)*
  - **Core Requirements:**
    - Throw 3D physics-based dice onto the screen
    - Track what they land on and automatically add player's modifier
    - Everyone sees when someone throws dice (global broadcast)
    - **Rate limiting** - prevent spam in every chat
    - **Global overlay toggle** - option to hide other players' dice if you don't want to see them
  - **Tech Stack:**
    - Recommended: `@3d-dice/dice-box` (npm)
    - BabylonJS + AmmoJS physics, web workers for performance
  - Full D&D dice set: d4, d6, d8, d10, d12, d20, d100
  - Advanced notation support:
    - `2d20kh1` - advantage (keep highest)
    - `2d20kl1` - disadvantage (keep lowest)
    - `4d6dl1` - stat rolling (drop lowest)
    - `2d6+4` - modifiers
  - Themes available (gemstone, rust, etc.)
  - Demo: [fantasticdice.games](https://fantasticdice.games)
  - Full Roll20 dice spec with parser add-on

### Mini-Games
- [ ] **Class-Based Card Game**
  - Tavern mini-game between quests
  - Each player's D&D class = unique deck/playstyle
  - Ideas:
    - **Cleric** - Healing/buff cards, outlast opponents
    - **Ranger** - Trap cards, chip damage over time
    - **Monk** - Combo chains, high skill ceiling
    - **Rogue** - Discard/steal from opponent's hand
  - Simple rules, class flavor makes it replayable
  - Could bet gold, earn rewards, or just for fun

### Progression System
- [ ] Daily and weekly quests for experience
  - Example: "Send 10 messages"
  - Rewards XP/gold for engagement

- [ ] **Hidden Lore Videos (NotebookLM)**
  - AI-generated videos from campaign sources
  - Hidden in the world for players to discover naturally
  - Achievement + XP reward when found
  - Could be: hidden room, interactable object, NPC secret dialogue
  - Makes exploration rewarding

- [ ] **Character Quizzes**
  - Quizzes based on player's character lore/backstory
  - "How well do you know your character?"
  - Rewards XP on completion
  - Could scale XP by score (higher score = more XP)
  - Maybe unlock character insights or bonus lore

### Access Control
- [ ] Block players from visiting certain locations (DM-controlled)

### Social
- [ ] **Friends / Players List**
  - Accessible to all players
  - Shows: avatar, name, last online ("2 hours ago"), last location
  - See who's around and where they're hanging out
  - Click to view player profile
  - Maybe quick actions: jump to their location, send DM

- [ ] **Player Profile View** (Snapchat-style)
  - Click player icon → opens their profile
  - **Stats section:**
    - Gold, XP, Level
    - Most visited location
    - Quests completed
  - **Inventory section:** their items
  - **Gallery section:** images they've uploaded
  - Clean, scrollable profile layout

- [ ] **Location Info View** (Discord-style)
  - Click location name → opens location details
  - Media gallery: all images uploaded to that location
  - Grid view like Discord's channel media
  - Maybe also: location description, who's currently there, recent activity

- [ ] **Chat Presence Sprites** (Snapchat-style)
  - Little character sprite shows when you open a chat
  - Player chats: their character avatar
  - Location chats: show sprites of everyone currently there
  - Static sprite, just visual flair for presence
  - Makes chats feel more personal/alive

### Emotes
- [ ] **Clash Royale Style Emotes**
  - Animated character emotes with sound effects
  - Pops up on screen for everyone in location
  - Examples: laughing, crying, angry, shocked, thumbs up, facepalm
  - Could be:
    - Player character reactions (custom per character?)
    - Fantasy-themed (goblin laugh, wizard facepalm, dwarf cheers)
    - Universal reactions (skull/dead, fire/hype, question mark)
  - No transparency needed - just animated GIFs/video loops with sound
  - Great for social moments without typing
  
- [ ] **Emote Wheel UI**
  - Hold button to open radial wheel
  - Drag to select emote, release to send
  - 6-8 emotes visible at once
  - Maybe swipe to access more pages/categories
  - Mobile-friendly (thumb-reachable)

### Spell Animations
- [ ] **Spell Effects with Smart Suggestions**
  - Players have spells they can cast for visual effects during RP
  - Animations are visual flair only, don't auto-resolve outcomes
  - Keyword detection suggests spells while typing:
    - Player types "I cast fireball..." → system shows `✨ Cast Fireball?`
    - Tap to trigger animation for everyone in location
  - Keeps flow natural, no menu diving

- [ ] **AI-Generated Spell Animations** (Technical Notes)
  - **Wan 2.1/2.2 + ComfyUI** - Best open source option for transparent animations
  - Hardware requirements:
    - 8GB VRAM minimum (with optimizations)
    - 12-16GB VRAM comfortable
    - 32-64GB system RAM
  - **Cloud GPU costs (very cheap):**
    - RTX 3090: ~$0.20-0.30/hr (Vast.ai)
    - RTX 4090: ~$0.40-0.50/hr (RunPod)
    - ~$0.04-0.08 per animation (~5-10 min generation)
    - Full spell library (50 spells) = ~$2-4 total
  - Workflow: Generate on black bg → alpha channel extraction → WebM with transparency
  - Alternative: Lottie files / itch.io effect packs for quick wins

### Item Animations
- [ ] **Shared Item Animations** - Broadcast effects to all players in location
  - Example: Using a blunt → smoke fills everyone's screen
  - WebSocket broadcast: "player X used item Y at location Z"
  - All clients in that location play the animation
  - Great for social/immersive moments
  - Effects: smoke, sparkles, flash, explosions, etc.

- [ ] **Personal Item Animations** - Feedback on your own screen
  - Example: Drinking → icon floats up, color tint, gulp sound
  - Simple: Item icon fades with sparkle + screen color wash
  - Medium: Bubbles/steam particles, "+1 Tipsy" status appears
  - Fancy: Cumulative drunk effects (wobble, blur after multiple drinks)
  - Items can define `"animation": "drink"` in data

### Audio/Ambiance
- [ ] **Pocket Bard** - DM music control for open world
  - DM can change background music for all players in a location
  - Sets mood during exploration, combat, RP moments
  - Players hear synchronized ambient/battle/tavern music
  - Could tie to location or be manual override

### Authentication
- [x] **Sign in with Discord** - OAuth2 login
  - No passwords to remember, uses existing Discord session
  - Works on mobile (opens Discord app or web auth)
  - User clicks "Sign in with Discord" → Authorize → redirected back logged in
  - Gets Discord ID, username, avatar automatically
  - Setup: Discord Developer Portal app + OAuth2 redirect URL + `/auth/discord` callback endpoint

- [ ] **Join Request / Approval System**
  - New users request to join instead of auto-access
  - DM/admin sees pending requests and approves or denies
  - Keeps randos out, only approved players get in
  - Could show request reason: "I'm in Blake's Thursday game"

### DM Controls
- [ ] **DM Steering Mode** - Queue and guide AI responses
  - Player actions queue instead of AI responding immediately
  - DM sees queue: "Nalyd wants to investigate the lockbox"
  - DM options:
    - ✅ **Approve** - Let AI respond naturally
    - ✏️ **Guide** - Add context/direction ("Make this tense, have him hear whispers")
    - 🎭 **Override** - Write the response yourself
    - ⏸️ **Hold** - Pause for dramatic timing
  - AI does heavy lifting, DM steers at key moments
  - Could filter by location/quest (only queue during active quests)

---

## Notes

*Added 2026-02-09*

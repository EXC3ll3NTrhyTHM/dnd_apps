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
- [ ] DM controls show for everybody (should be DM-only)

### Chat/Messaging
- [ ] NPCs still respond when no @mention is added (should require mention)
- [ ] **[iPhone]** @mention popup doesn't add mentions to keyboard

---

## Feature Requests ✨

### Chat/Input
- [ ] **Message Reactions** ⚡ *Priority - Tonight*
  - Emoji reactions on individual messages (Discord/Slack style)
  - Tap/long-press message to add reaction
  - Show reaction counts under message
  - Quick reaction bar (most used emojis)
  
- [ ] Add autocomplete to keyboard
- [ ] Clicking player sprite should add their @tag to text input (not working)
- [ ] Image sharing support
  - Plus icon opens drawer under keyboard
  - Multiple options in drawer
  - Could include NPC or player icon selector

### Progression System
- [ ] Daily and weekly quests for experience
  - Example: "Send 10 messages"
  - Rewards XP/gold for engagement

### Access Control
- [ ] Block players from visiting certain locations (DM-controlled)

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
- [ ] **Sign in with Discord** - OAuth2 login
  - No passwords to remember, uses existing Discord session
  - Works on mobile (opens Discord app or web auth)
  - User clicks "Sign in with Discord" → Authorize → redirected back logged in
  - Gets Discord ID, username, avatar automatically
  - Setup: Discord Developer Portal app + OAuth2 redirect URL + `/auth/discord` callback endpoint

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

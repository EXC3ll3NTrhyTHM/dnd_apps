# Web App - Issues & Feature Requests

*Tracking bugs and feature ideas for the NPC Bot web app*

---

## Blockers 🚧

### Clawdbot Integration
- [x] **Marcel/Clawdbot on the Web App** ❌ *Blocking migration*
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
- [x] Rotate screen message displays during page reload/blank screen
- [x] DM controls show for everybody (should be DM-only)

### Chat/Messaging
- [x] NPCs still respond when no @mention is added (should require mention)
- [x] **[iPhone]** @mention popup doesn't add mentions to keyboard

### Dice
- [ ] **[iPhone] Dice disappearing** — Dice randomly stop showing up on iPhone (inconsistent, hard to reproduce)

### Keyboard/Input
- [ ] **Swipe typing backspace** — After swiping to type, pressing backspace should delete the swiped text (currently doesn't work as expected)
- [ ] **[iOS] Text selection** — Users can't adjust/move the text cursor or selection in the input field

### Combat/Arena
- [ ] **Stun condition (Dylan)** — Dylan's stun effect on enemies doesn't actually do anything
- [ ] **50 dice rolls achievement** — Doesn't count Arena dice rolls toward the total

### Locations
- [ ] **Fishing** — Currently just an overlay, needs to be an actual location with proper transition
- [ ] **Fishing** — Needs ambient music (soothing, relaxing vibes)
- [ ] **Arena** — Needs music transition when entering (battle music)

---

## Feature Requests ✨

### Onboarding / First Launch
- [ ] **Announcements / Welcome Popup**
  - Modal that appears on first app launch (or after updates)
  - First announcement: prompt user to enable notifications
  - Could show recent updates, tips, or DM messages
  - Dismissable, remembers if user has seen it
  - Maybe a "What's New" section for returning players

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
  
- [x] Add autocomplete to keyboard
- [ ] Clicking player sprite should add their @tag to text input (not working)
- [x] Image sharing support ⚡ *Priority*
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
- [x] **3D Dice Roller** ⚡ *Priority - Tonight (2026-02-11)*
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

### Combat Encounters
- [ ] **PvE Combat Encounter System** — [Full Design Doc](./COMBAT_ENCOUNTER_SYSTEM.md)
  - Monsters spawn at locations, players fight using real D&D stats
  - Attack rolls (d20 + modifier vs AC), damage dice from equipped weapons
  - Monster counterattacks, knockouts, victory/defeat
  - Rewards split by damage contribution (XP + gold)
  - Plays out in chat with narrator messages + 3D dice
  - Phase 1: basic attack/defend/flee, 5 starter monsters
  - Phase 2: initiative, weapon choice, monster abilities, random spawns
  - Phase 3: spells, healing, status effects, boss fights, dungeons

### Dice Games

- [ ] **Tavern Gambling (High-Low)**
  - Roll 1d100, guess if the next roll is higher or lower
  - Streak multiplier — consecutive correct guesses = bigger gold payout
  - NPCs could react/comment on wins and losses
  - Ante gold to play, house takes a cut on losses
  - Simple to build, uses existing dice + economy

- [ ] **Duel**
  - Two players each roll 1d20, highest wins
  - Optional gold wager between participants
  - NPCs could referee or heckle from the sidelines
  - Challenge system: player sends duel request, opponent accepts
  - Could add achievements (win streak, upset victory, etc.)

- [ ] **Bounty Board**
  - Daily dice challenge posted by an NPC (e.g., "Roll 3d6 and beat 15")
  - New target/dice combo each day, auto-generated
  - Bonus XP/gold reward for hitting the target
  - Tiered rewards: meet target = base, exceed by 5+ = bonus
  - Visible in tavern location, resets at midnight

- [ ] **Liar's Dice**
  - Each player rolls secretly, then takes turns bidding on total dice across all players
  - Bluff or call — works great in chat format
  - Rounds play out in chat messages with NPC dealer managing the game
  - Wager gold to enter, winner takes the pot
  - Classic tavern game, fits the theme perfectly

- [ ] **Arm Wrestling** (Tap game)
  - Real-time tapping contest between two players
  - Both players tap as fast as possible — a tug-of-war bar shifts toward whoever taps faster
  - Push the bar past the opponent's threshold to win the round
  - Best of 3 rounds, optional gold wager
  - Random "surge" moments where taps count double — rewards timing over pure speed
  - Could add strength modifier once player stats exist (handicap the bar starting position)
  - NPC bartender announces matches, crowd reacts
  - Challenge/accept flow via chat, game opens as a full-screen overlay
  - Achievements for win streaks, comeback victories, speed records

- [ ] **Monster Hunt** (Location-wide event)
  - NPC posts a monster with HP in a location
  - Players take turns rolling damage dice to chip it down
  - Whoever lands the killing blow gets a special reward
  - All participants get XP based on damage dealt
  - Could be scheduled events or random encounters
  - Drives group engagement with minimal new UI — just NPC messages tracking HP

- [ ] **Pit Fighter Arena** *(Requires player stats)*
  - Simple turn-based combat between players
  - Each player has HP, picks attack (d20 to hit, damage die based on weapon) or defend (+5 AC)
  - Last one standing wins the pot
  - Needs: player HP, AC, weapon/damage stats
  - Could be 1v1 or free-for-all

- [ ] **Heist** *(Requires player stats)*
  - Cooperative dice game — players pick roles (lockpick, lookout, muscle)
  - Each role has a skill check with different DCs
  - Pass enough checks = split the loot, fail = lose your ante
  - Needs: player skill modifiers / class abilities
  - Great for group coordination and RP moments

### Activities & Events

- [ ] **Dragon Siege** (Location-wide cooperative event)
  - A dragon (or other boss) attacks a location — DM-triggered or on a schedule
  - All players present contribute actions over hours/days
  - Actions: reinforce walls, heal NPCs, attack the dragon (dice rolls)
  - Collective progress bar visible to everyone in the location
  - Success = massive shared gold/XP reward for all participants
  - Failure = location temporarily "damaged" (cosmetic: scorched theme, NPC dialogue changes)
  - Contribution-based rewards — more actions = bigger individual payout
  - NPCs react in real-time: panicking, rallying, calling for help

- [ ] **Tavern Trivia Night** (PvP)
  - NPC quizmaster asks D&D/fantasy/campaign lore trivia
  - Timed answers — first correct answer in chat wins the round
  - Points per round, gold/XP payout based on final standing
  - Could be scheduled weekly events or triggered by DM
  - Question categories: world lore, NPC knowledge, monster facts, campaign history
  - Achievements for win streaks, perfect rounds, trivia master

- [ ] **Foraging & Gathering**
  - Each location has discoverable items (herbs, gems, artifacts, ingredients)
  - "Search" action with a cooldown (e.g., once per hour per location)
  - Roll-based: higher roll = rarer find, nat 1 = nothing, nat 20 = jackpot
  - Different locations yield different resources (forest = herbs, mine = gems, ruins = artifacts)
  - Sell findings to NPCs for gold or save for crafting/recipes
  - Rare items could be ingredients for potions or quest objectives
  - Achievements for completing collection sets

- [ ] **Garden Plot**
  - Buy seeds from the shop, plant them in your personal garden
  - Crops grow over real time (hours/days depending on type)
  - Different locations = different climates = different available crops
  - Harvest for gold, rare ingredients, or shop items
  - Watering/tending (daily action) speeds growth or improves yield
  - Neglect too long = crops wither
  - Rare seeds from foraging, quests, or special events
  - Cosmetic garden view on player profile

- [ ] **Pet Companion**
  - Earn or buy a creature egg from the shop
  - Egg hatches over real time (1-3 days)
  - Species determined by which location you hatched it in (forest = wolf pup, cave = baby drake, tavern = imp, etc.)
  - Feed it (spend gold) and interact daily — it grows through stages
  - Pet shows on your profile and optionally next to your chat messages
  - Cosmetic but sticky — names, accessories, evolution paths
  - Achievements for raising pets, collecting different species
  - Neglect penalties: pet gets sad (cosmetic), eventually runs away if abandoned too long

### Arcade Mini-Games (Tap & Swipe)

- [ ] **Tavern Brawl**
  - Swipe to dodge incoming bottles, fists, chairs
  - Tap to counter-attack when openings appear
  - Survival mode — waves get increasingly chaotic
  - Combo multiplier for consecutive dodges + counters
  - NPCs cheer, heckle, and throw things from the sidelines
  - Gold/XP reward based on how long you survive
  - Leaderboard for longest brawl
  - Achievements: first brawl, survive 60 seconds, 100-hit combo, etc.

- [ ] **Arrow Defense**
  - Enemies march toward your castle wall in waves
  - Tap to shoot arrows at individual enemies
  - Swipe to aim and launch catapults at clusters
  - Different enemy types: goblins (fast/weak), orcs (slow/tanky), flying (require timing)
  - Gold per wave survived, bonus for no enemies reaching the wall
  - Upgrade catapult/bow between waves (spend earned gold)
  - Endless mode for leaderboard, campaign mode with set levels
  - Location-themed: defend whichever location you're currently in

- [ ] **Fishing**
  - Cast line with a swipe (distance/direction matters)
  - Wait for a bite — tap when the bobber dips (timing window)
  - Reel in: rapid tap or follow a swipe pattern to fight the fish
  - Bigger fish = harder reel-in minigame
  - Different fish at different locations (river vs lake vs ocean vs underground)
  - Rare catches worth big gold, legendary fish for achievements
  - Sell to NPCs or keep for collection/recipes
  - Peaceful ambient mode — good contrast to combat games
  - Cooldown or bait system (buy bait from shop) to gate sessions

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
- [x] Daily and weekly quests for experience
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

### Player Stats Integration (D&D Beyond)
- [ ] **Character Sheet on Profile Page**
  - Condensed D&D stat block on each player's profile
  - Six ability scores (STR/DEX/CON/INT/WIS/CHA) with modifiers
  - Race, class + level, HP, AC, background
  - Quick "who is this character" view for all players
  - Should look nice and be fun to view and navigate

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

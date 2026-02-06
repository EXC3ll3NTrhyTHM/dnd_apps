# Feature Plan: Dynamic NPC Stage & Interactive Log

## 1. Visual Stage Architecture

The "Stage" is the primary interaction layer where character sprites appear dynamically.

### Spatial Positioning
- **NPCs:** Slide in from the Left or Center
- **Players:** Slide in from the Right (mirroring modern chat UI)

### The "Spotlight" Effect
- **Active Speaker:** Sprite scales up (110%), brightens, and moves to the foreground
- **Inactive Participants:** Sprites desaturate (grayscale/dim) and shrink slightly
- **Dialogue Bubbles:** Floating tails that point specifically to the speaker's mouth or portrait

---

## 2. Multi-Agent Logic

Handles how the AI-driven NPCs interact without overwhelming the screen.

### The "Cross-Talk" Layout
When two NPCs talk to each other, they occupy the left and right "slots" of the stage, facing inward.

### Concurrency Queue
If multiple NPCs reply at once, the system queues the sprites to slide in sequentially rather than overlapping.

### Tagging System
If an NPC "tags" a player, the player's sprite vibrates or glows to signal a needed response.

---

## 3. The "Infinite Archive" (Collapsible Log)

A secondary layer for reviewing previous context.

### The Hidden Drawer
A swipe-out or button-triggered panel that covers the stage with 80% opacity.

### Smart Scroll
Automatically jumps to the most recent message but allows free scrolling for deep history.

### Lore Indicators
Specific colors or icons next to messages to differentiate between:
- System Messages
- NPC Dialogue
- Player Chat

---

## 4. Technical Implementation Ideas

### Animation
Use **Framer Motion** or **GSAP** for the "Slide & Scale" transitions.

### State Management
Use a global store (like **Zustand** or **Redux**) to track which `activeSpeakerID` should have the spotlight.

---

## Status

- [ ] Stage layout prototype
- [ ] Spotlight effect implementation
- [ ] Multi-agent queue system
- [ ] Archive drawer UI
- [ ] Animation integration

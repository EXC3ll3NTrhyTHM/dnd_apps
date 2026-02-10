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

## 1.5 Seat-Based Spatial Context

Before the stage activates, the player chooses where to sit. This determines their POV and which NPCs are visible.

### Seat Selection Flow

```
┌─────────────────────────────────────┐
│     DRAGON'S HOLLOW - ENTRANCE      │
│                                     │
│   Where would you like to sit?      │
│                                     │
│  ┌─────────┐ ┌─────────┐ ┌────────┐ │
│  │   BAR   │ │  TABLE  │ │ BOOTH  │ │
│  │  🍺     │ │   🪑    │ │  🛋️   │ │
│  └─────────┘ └─────────┘ └────────┘ │
│                                     │
└─────────────────────────────────────┘
```

### What Seat Selection Sets
- `currentBackground` - The POV image for that seat
- `visibleNpcs[]` - Who you can see/interact with from there
- `playerAnchor` - Where your sprite anchors on screen (if shown)
- `npcSlots` - Positions for NPC sprites in this view

### Seat Data Structure

```js
seats: {
  bar: {
    background: "/images/tavern-bar-view.png",
    visibleNpcs: ["tam", "nibby"],
    playerAnchor: { x: "80%", y: "70%" },
    npcSlots: {
      left: { x: "20%", y: "50%" },   // Tam behind bar
      center: { x: "50%", y: "60%" }  // Nibby walking by
    },
    description: "You slide onto a stool at the bar"
  },
  table: {
    background: "/images/tavern-table-view.png",
    visibleNpcs: ["nibby", "kumo", "mira", "bonesy"],
    playerAnchor: { x: "80%", y: "70%" },
    npcSlots: {
      left: { x: "15%", y: "50%" },
      center: { x: "45%", y: "55%" },
      right: { x: "70%", y: "50%" }
    },
    description: "You take a seat at an open table"
  },
  booth: {
    background: "/images/tavern-booth-view.png",
    visibleNpcs: ["bonesy", "nibby"],
    playerAnchor: { x: "75%", y: "65%" },
    npcSlots: {
      left: { x: "25%", y: "50%" }  // Bonesy across from you
    },
    description: "You slide into the corner booth"
  }
}
```

### NPC Default Locations

Each NPC has a spot they're "always at" in the tavern:

| NPC    | Default Spot | Notes |
|--------|--------------|-------|
| Tam    | bar          | She runs it, never leaves |
| Bonesy | booth        | It's literally "his spot" |
| Nibby  | (roams)      | Busing tables, can appear anywhere |
| Kumo   | table        | Regular patron |
| Mira   | table/bar    | Visits to see friends |

### Integration with Spotlight System

The existing spotlight/slide-in system still works:
1. Player picks seat → Background changes to that POV
2. NPCs visible from that seat appear as tappable sprites
3. Player taps an NPC → Dialogue overlay opens
4. Active speaker gets spotlight effect (110% scale, brightens)
5. Inactive speakers dim/shrink
6. "Move seats" button returns to seat picker

### Art Assets Needed

**Backgrounds (per seat):**
- `tavern-bar-view.png` - Sitting at bar, Tam in front, room behind
- `tavern-table-view.png` - Sitting at table, see bar + booth from here
- `tavern-booth-view.png` - Sitting in booth, cozy corner view

**NPC Portraits (for dialogue overlay):**
- `tam-portrait.png`
- `bonesy-portrait.png`
- `nibby-portrait.png`
- `kumo-portrait.png`
- `mira-portrait.png`

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
- [ ] Seat selection UI (bar/table/booth picker)
- [ ] Seat-based background switching
- [ ] NPC visibility per seat
- [ ] Seat POV art assets

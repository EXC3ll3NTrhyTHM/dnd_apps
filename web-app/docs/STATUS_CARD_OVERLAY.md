# Status Card Overlay Design Spec

## Overview

A floating card overlay that displays detailed status information for a player or enemy when their row is tapped in the Arena view. Replaces the current inline condition icon sprawl with a cleaner, expandable design.

---

## Trigger

**Open:** Tap/click anywhere on a player or enemy row (health bar, icon, name, or empty space within the row)

**Close:** 
- Tap outside the card (on the dimmed overlay)
- Tap the Close button at bottom of card

**Single card only:** Opening a new card auto-closes any existing card. Only one status card can be open at a time.

---

## Visual Design

### Card Appearance

- **Background:** Semi-transparent dark (#1a1a1a at ~85% opacity) - user can still see the arena behind
- **Border/Accent:** 
  - **Players:** Yellow/gold accent border
  - **Enemies:** Red accent border
- **Position:** Dead center of screen
- **Size:** Responsive to content width, max-width ~320px recommended
- **Scrollable:** If conditions + descriptions exceed viewport, card content scrolls internally

### Animation

- **Open:** Fade in (opacity 0→1) + scale up (0.9→1.0), ~200ms ease-out
- **Close:** Reverse animation, ~150ms ease-in

### Overlay/Backdrop

- Semi-transparent dark overlay behind card (~50% black)
- Turn indicator should display OVER the card when it's the viewer's turn

---

## Card Layout

```
┌──────────────────────────────────┐
│                                  │
│      [Avatar]   NAME             │  ← Header
│                                  │
│  ════════════════════════════    │  ← Divider
│                                  │
│  ❤️ HEALTH                       │
│  [██████████████░░░░░]  18/24    │  ← Health bar + numbers
│                                  │
│  ════════════════════════════    │  ← Divider
│                                  │
│  ⚡ CONDITIONS                   │  ← Section header
│                                  │
│  ┌────────────────────────────┐  │
│  │ 🎯 Targeted                │  │  ← Condition pill
│  │ An enemy is focusing you.  │  │  ← Brief description
│  │ Until: Enemy's next turn   │  │  ← Duration/end trigger
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │ ✨ Dodge                   │  │
│  │ Attacks have disadvantage. │  │
│  │ Until: Start of next turn  │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │ ⚔️ Advantage               │  │
│  │ Your next attack has ADV.  │  │
│  │ Until: Used or turn ends   │  │
│  └────────────────────────────┘  │
│                                  │
│           [ Close ]              │  ← Close button at bottom
│                                  │
└──────────────────────────────────┘
```

---

## Card Sections

### 1. Header
- Character avatar (if available) or class/type icon
- Character name
- Accent color matches player (yellow) or enemy (red)

### 2. Health Section
- Label: ❤️ HEALTH (or just the heart icon)
- Visual health bar matching the color scheme
- Numeric display: `current / max`

### 3. Conditions Section
- Label: ⚡ CONDITIONS
- Shows even when empty (just header, no pills)
- Each condition displayed as a pill/chip containing:
  - **Icon + Name** (top line, bold)
  - **Description** (brief, 1-2 lines, explains what it does)
  - **Duration/End Trigger** (how/when it ends)

---

## Condition Pill Design

```
┌──────────────────────────────────┐
│ 🎯 Targeted                      │  ← Icon + name (bold)
│ An enemy is focusing their       │  ← Description (regular weight)
│ attacks on you.                  │     Multi-line allowed, keep brief
│ ⏱️ Until: Enemy's next turn      │  ← Duration/end trigger (muted color)
└──────────────────────────────────┘
```

### Duration/End Trigger Examples
- `⏱️ 3 rounds remaining`
- `⏱️ Until: Start of your next turn`
- `⏱️ Until: You take damage`
- `⏱️ Until: Concentration broken`
- `⏱️ Until: Removed by spell/action`
- `⏱️ Permanent` (for persistent effects)

---

## Empty State

When a character has no active conditions:

```
│  ⚡ CONDITIONS                   │
│                                  │
│     No active conditions         │  ← Muted text, centered
│                                  │
```

---

## Turn Indicator Behavior

When it becomes the viewing player's turn while a status card is open:
- Turn indicator displays ON TOP of the card overlay
- Card remains visible underneath
- Player can see it's their turn without dismissing the card
- Standard turn indicator animation/styling applies

---

## Future Expansion

Sections that can be added later without redesigning:
- **🛡️ Resistances & Vulnerabilities**
- **💛 Temporary HP** (separate bar or indicator)
- **📜 Buffs vs Debuffs** (split into two columns)
- **⚔️ DM Quick Actions** (remove condition, adjust HP buttons)
- **📊 Stats** (AC, speed, etc.)

---

## Technical Notes

### Component Structure (suggested)
```
StatusCardOverlay/
├── StatusCardOverlay.jsx    # Main overlay + backdrop
├── StatusCardOverlay.css    # Styles
├── HealthSection.jsx        # Health bar component
├── ConditionPill.jsx        # Individual condition display
└── index.js                 # Exports
```

### Props (suggested)
```js
<StatusCardOverlay
  isOpen={boolean}
  onClose={function}
  character={{
    name: string,
    avatar: string | null,
    type: 'player' | 'enemy',
    currentHp: number,
    maxHp: number,
    conditions: [
      {
        id: string,
        icon: string,
        name: string,
        description: string,
        duration: string  // Human-readable end condition
      }
    ]
  }}
/>
```

### Z-Index Layers
1. Arena UI (base)
2. Backdrop overlay (z: 100)
3. Status card (z: 101)
4. Turn indicator (z: 102) - always on top

---

## Implementation Checklist

- [ ] Create StatusCardOverlay component
- [ ] Add backdrop with click-to-close
- [ ] Implement fade + scale animation
- [ ] Build header section with avatar/name
- [ ] Build health bar section
- [ ] Build conditions section with pills
- [ ] Add duration/end trigger display to conditions
- [ ] Handle empty conditions state
- [ ] Add player (yellow) vs enemy (red) accent colors
- [ ] Make content scrollable for long condition lists
- [ ] Ensure turn indicator displays over card
- [ ] Add close button at bottom
- [ ] Wire up tap handlers on Arena player/enemy rows
- [ ] Update condition data model to include descriptions + durations

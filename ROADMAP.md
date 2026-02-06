# D&D Discord Bot System - Roadmap & Design

*Last updated: 2026-01-28*

## Overview

A comprehensive Discord bot system for running D&D campaigns, featuring NPC characters, quest management, character tracking, and various gameplay systems.

---

## Current Bots

- [x] **Nibby** - Angsty teen ranger NPC
- [x] **Bonesy** - Chill skeleton bro NPC
- [x] **Quest Manager** - Quest board and narration

---

## Planned Features

### Quest Board Enhancements

- [ ] **Refresh button** at bottom of quest board
- [ ] **Info button** next to each quest's start button
  - Shows quest preview before starting
  - Updates after completion to reveal discoveries
  - Acts as quest log/lore tracker
- [ ] **Time-gated quests** - certain quests only available at specific times
  - Time of day (night-only quests, morning market, etc.)
  - Day of week?
  - Seasonal/event-based?
- [ ] **Shorter scene descriptions** - keep generated text concise

### Character Tracker Bot

- [ ] Store player character sheets
  - Stats (STR, DEX, CON, INT, WIS, CHA)
  - Spells known/prepared
  - Inventory items
  - Gold/currency
  - Proficiencies
- [ ] **Dice rolling with auto-modifiers**
  - `@Tracker roll perception` → adds WIS + proficiency
  - `@Tracker roll attack longsword` → adds STR + proficiency + damage
  - Support for advantage/disadvantage
  - Saving throws, skill checks, attack rolls
- [ ] Character sheet display command
- [ ] Update commands for DM

### Battle System

- [ ] Turn-based combat
- [ ] Initiative tracking
- [ ] HP tracking
- [ ] Integrates with character tracker for stats
- [ ] Action economy (action, bonus action, reaction)

### Crafting System

- [ ] Recipe database
- [ ] Combine resources into items
- [ ] Skill checks for crafting success
- [ ] Crafting stations/locations?

### Resource Gathering

- [ ] Gathering locations/nodes
- [ ] Different resource types (ore, herbs, wood, etc.)
- [ ] Skill checks for gathering
- [ ] Cooldowns or availability windows?

### NPC Resource Collection (Per-Player Duties)

Players collect unique resources from their NPCs, tied to their role in Okhan. These resources could feed into crafting, quests, or kingdom-building.

**Aly** - Collects **Intel** from her NPC network (rooftop patrol, cleric contacts)
  - Intel could unlock quest hints, reveal hidden info, or provide strategic advantages

**Tyren** - Collects **???** (TBD)
  - Ideas: Arms/Materials from the Iron Forge, Military Reports from Ashen Vow troops, Forge Output

**Nalyd** - Collects **???** (TBD)
  - Ideas: Spiritual Energy/Ki from dojo training, Discipline from students, Elemental Essence

**Nibby** - Collects **???** (TBD)
  - Ideas: Scouting Reports from ranger patrols, Rumors from sneaking around, Tracking Data

*TODO: Finalize resource types for each player. Each should feel unique to their role and useful in different systems (crafting, quests, shop, kingdom management).*

### Achievement System

- [ ] Track player milestones
- [ ] Achievement announcements
- [ ] Categories:
  - Combat ("First Blood", "Dragon Slayer")
  - Crafting ("Apprentice Smith", "Master Alchemist")
  - Quests ("Quest Novice", "Completionist")
  - Social ("Made a Friend", "Silver Tongue")
  - Exploration ("Explorer", "Cartographer")

### Pets System

- [ ] Collectible companions
- [ ] Pet leveling/progression
- [ ] Small stat bonuses or abilities
- [ ] Pet personalities
- [ ] Pet care/feeding mechanics?

### New NPCs

- [ ] **Drill Sergeant** - Strict, loud military character
  - Barks orders
  - Training/combat instructor vibes
  - Contrast to Bonesy's chill energy

---

## System Integration

How systems connect:

```
┌─────────────────┐
│  Quest Manager  │ ─── rewards ───┐
└────────┬────────┘                │
         │ triggers                ▼
         ▼                 ┌───────────────┐
┌─────────────────┐        │   Character   │
│  Battle System  │◄──────►│    Tracker    │
└────────┬────────┘ stats  └───────┬───────┘
         │                         │
         │ drops                   │ stores
         ▼                         ▼
┌─────────────────┐        ┌───────────────┐
│    Crafting     │◄───────│   Inventory   │
└────────┬────────┘        └───────────────┘
         │                         ▲
         │ requires                │
         ▼                         │
┌─────────────────┐                │
│    Resource     │────────────────┘
│    Gathering    │   materials
└─────────────────┘

         ┌─────────────────┐
         │   Achievements  │ ◄── tracks all systems
         └─────────────────┘

         ┌─────────────────┐
         │      Pets       │ ◄── companion bonuses
         └─────────────────┘
```

---

## Technical Notes

### Concurrency Handling

For multi-player quests:
- Players can see previous messages in quest channel for context
- No special locking needed for now - keep it simple

### Data Storage

- Character data: JSON files per player? Database?
- Quest progress: Per-party tracking
- Achievements: Per-player persistent storage
- Pet data: Per-player

---

### Weather Events

- [ ] **Dynamic weather system** for the server
  - Random or scheduled weather events (storms, fog, blizzards, heatwaves)
  - Could affect quests (harder gathering in storms, new quests during events)
  - Flavor posts in a channel ("A thick fog rolls into Okhan...")
  - NPC reactions to weather (Bonesy vibing in the rain, Nibby complaining)
  - Tie into campaign themes (unnatural weather as foreshadowing?)

## Ideas Backlog

*Random ideas to explore later:*

- Economy/trading between players
- Guild/party system
- Leaderboards
- Daily quests/rewards
- Seasonal events
- PvP arena?

---

## Campaign Planning

### Character Core Tenets Evolution

Plan how each character's core beliefs/principles evolve in the next campaign:

- [ ] Tyren - ?
- [ ] Nalyd - ?
- [ ] Acacia - ?
- [ ] Aly - ?
- [ ] Nibby - ?

*TODO: Map out character arcs and how their tenets shift through campaign events*

### Quest Ideas

- [ ] **Famine Setup Quest** - Side quest that sets the stage for the beginning of a famine
  - Foreshadowing for larger campaign arc
  - Could tie into the "Bound By Rot" themes (crops dying, blight, etc.)

---

## Completed

- [x] Multi-character NPC bot architecture
- [x] Character-specific .env files
- [x] Memory system (journal + consolidation)
- [x] Context awareness (bots see recent messages)
- [x] Basic quest manager


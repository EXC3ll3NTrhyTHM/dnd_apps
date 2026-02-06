# D&D Companion App - Project Plan

**Status:** Planning
**Created:** 2026-02-04

---

## Vision

A mobile companion app for the Bound By Rot D&D campaign. Players chat with NPCs who have expressive portrait art that cycles between gestures and expressions based on dialogue context. The app feels like a living artifact from the world of Okhan.

---

## Core Features

### Chat Interface
- Text-based conversation with NPCs
- Chat bubble UI (messenger-style)
- NPC messages paired with portrait art
- Player choices / dialogue options where needed
- Message history and conversation threads

### NPC Portrait System
- Each NPC has multiple portrait images (idle, happy, angry, suspicious, sad, etc.)
- Portraits swap dynamically based on dialogue sentiment/tags
- Smooth crossfade transitions between expressions
- Portraits framed in themed UI elements (see Theme section)
- Potential for subtle idle animations (breathing, blinking) via Lottie

### Future Considerations
- Quest log integration
- Party/inventory views
- Map elements
- Push notifications for in-game events
- Integration with existing NPC bot system

---

## Theme: Hybrid Manuscript-to-Decay

The app's visual identity evolves with the campaign's story, mirroring the corruption at the heart of Bound By Rot.

### Phase 1: Illuminated Manuscript (Default State)
- Clean dark backgrounds (deep navy, black)
- Ornate gold and copper accents
- Illuminated letter styling for headers and section titles
- Elegant filigree borders on chat bubbles
- NPC portraits in circular medallion frames with metallic edges
- Typography: serif, clean, authoritative
- Color palette: deep navy, black, gold, crimson
- Vibe: A royal document from Okhan's archives. Polished, weighty, official.

### Phase 2: Creeping Rot (Mid-Campaign Transition)
- Parchment textures begin showing age and wear
- Gold accents tarnish, shifting toward copper and bronze
- Subtle fungal/organic details appear at UI edges
- Borders develop slight imperfections, hairline cracks
- Color palette shifts: golds dim, faint teals and sickly greens bleed in
- Typography loosens slightly, less rigid
- Vibe: Something is wrong. The document is aging unnaturally.

### Phase 3: Full Decay (Late Campaign)
- Dark slate/stone textures replace clean backgrounds
- Bioluminescent accents dominate (teal, sickly green, pale purple)
- Chat bubbles develop organic edges like bark or chitin
- Fungal growth and twisted vine/root details creep into borders and frames
- NPC portrait frames shift to twisted root, bone, or corrupted metal
- Typography becomes irregular, slightly unsettling
- Color palette: deep blacks, bioluminescent greens and purples, rotted gold
- Vibe: The app itself has been touched by the rot. It's alive.

### Implementation Notes
- Theme state controlled by a campaign progress variable (DM-controlled)
- Transitions are gradual, not sudden. Players should notice something feels "off" before it's obvious
- Consider per-element decay (some UI pieces corrupt before others)
- Mirrors the Celia's Journal writing style degradation concept from campaign design

---

## Tech Stack

### Frontend
- **Framework:** React Native + TypeScript
- **Rationale:** Cross-platform (iOS + Android), JS/TS ecosystem alignment with existing NPC bot backend, mature chat UI libraries, fast prototyping

### Key Libraries
- **Chat UI:** React Native Gifted Chat (or custom implementation)
- **Animations:** react-native-reanimated 3 (portrait expression transitions, UI decay effects)
- **Idle Animations:** Lottie (react-native-lottie) for breathing, blinking, subtle movement
- **State Management:** Zustand (lightweight, fast)
- **Navigation:** React Navigation

### Backend
- **Runtime:** Node.js
- **NPC Dialogue:** API layer over existing NPC bot system or standalone dialogue engine
- **Portrait Assets:** Preloaded sprite sheets per NPC, swapped by sentiment tags in dialogue data

### Portrait System Architecture
- Each NPC has a sprite sheet or image set (3-6 expression variants minimum)
- Dialogue data includes sentiment/gesture tags per message
- Frontend maps tags to portrait variants and crossfades between them
- Start simple: preload images, swap on tag change
- Iterate toward: layered sprite composition (base + expression + accessory overlays)

---

## Inspiration & References

### Primary References
- **Mystic Messenger** - Chat app UI as gameplay, character portrait expressions within messaging interface. The blueprint for chat UX.
- **The Arcana** - Fantasy visual novel on mobile, clean portrait expression system, great art direction for fantasy setting.
- **Honkai: Star Rail** - Best modern example of polished portrait dialogue on mobile. Expression variant quality.

### Secondary References
- **Ace Attorney** - Gold standard for portrait gesture systems. Expression snap-changes on dialogue beats.
- **Hades** - Fantasy setting, contextual expression swaps, tight dialogue writing.
- **Coffee Talk** - Fantasy NPCs + chat-like feel + expression cycling in intimate format.
- **VA-11 Hall-A** - Character sprite expression shifts during conversation. Intimate, character-driven.
- **Darkest Dungeon** - UI design for conveying mood through minimal art. Dark atmosphere reference.
- **The Banner Saga** - Grim fantasy dialogue with portraits. Choices feel weighty.
- **Florence** - Chat bubbles as core mechanic. Making text conversation feel alive on mobile.

### UX References
- **Ren'Py** (visual novel engine) - Study sprite expression layering system for technical reference.
- **Genshin Impact** (mobile) - Clean dialogue portrait system on small screens.

---

## Milestones

### M0: Prototype
- [ ] React Native project scaffolded
- [ ] Basic chat screen rendering
- [ ] One NPC with 2-3 expression variants
- [ ] Expression swap on hardcoded sentiment tags
- [ ] Phase 1 theme applied (illuminated manuscript)

### M1: Core Chat Loop
- [ ] Multiple NPCs selectable
- [ ] Dialogue data structure defined (messages + sentiment tags)
- [ ] Portrait crossfade animations working
- [ ] Chat history persistence
- [ ] Basic NPC dialogue engine (scripted responses)

### M2: Theme System
- [ ] Theme state variable (DM-controlled)
- [ ] Phase 1 → Phase 2 gradual transition implemented
- [ ] Phase 2 → Phase 3 gradual transition implemented
- [ ] Per-element decay timing

### M3: Backend Integration
- [ ] API layer for NPC dialogue
- [ ] Hook into existing NPC bot system (or standalone engine)
- [ ] Dynamic dialogue (AI-driven or branching tree)
- [ ] Push notifications for in-game events

### M4: Polish & Expand
- [ ] Lottie idle animations on portraits
- [ ] Quest log integration
- [ ] Sound design (ambient, UI feedback)
- [ ] Additional NPC portrait sets
- [ ] Beta testing with players

---

## Open Questions
- [ ] How many expression variants per NPC? (minimum viable: 3-4, ideal: 6-8)
- [ ] Who creates the NPC portrait art? (commission, AI-generated, Blake's own art?)
- [ ] Should players be able to text each other through the app or just NPCs?
- [ ] Does the DM (The Architect) have a presence in the app? (narrator voice, messages from The Architect?)
- [ ] Offline support needed or always-connected?
- [ ] How does the DM control theme progression? (admin panel? simple toggle? tied to quest milestones?)

---

**Tags:** #project #dnd #app #bound-by-rot

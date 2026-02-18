# The University of Okhan

**Feature Design Document**
**Status:** Planning
**Last Updated:** 2026-02-17

---

## Overview

The University of Okhan is an in-app location where players learn D&D mechanics through interactive, in-world tutorials and quests. Instead of telling players to "read the rulebook," we gamify the learning process within the fiction of Okhan itself.

**Core Philosophy:** Learning the rules should feel like content, not homework.

---

## Location

- Accessible from the map like other locations (Tavern, Barracks, Dojo, etc.)
- Has its own scene/atmosphere - grand halls, libraries, training grounds
- NPCs are professors/instructors who guide lessons
- Players can return anytime to review or take new courses

---

## The Four Schools

### 🗡️ School of Steel
*"Master your body, master the battlefield."*

**Topics Covered:**
- Combat basics (initiative, turns, rounds)
- Actions, bonus actions, movement, reactions
- Attack rolls vs AC
- Damage and damage types
- Weapons and armor
- Opportunity attacks
- Cover and positioning

**Professor NPC:** *Ser Aldric Ironbrand* - Grizzled veteran, no-nonsense, respects effort

---

### ✨ School of the Arcane
*"Magic is not power. Magic is precision."*

**Topics Covered:**
- Spellcasting basics
- Spell slots and spell levels
- Cantrips vs leveled spells
- Concentration
- Spell attack rolls vs Spell save DC
- Components (V, S, M)
- Ritual casting
- Preparing spells (for prepared casters)

**Professor NPC:** *Magistra Elwen Quill* - Patient, precise, slightly condescending but means well

---

### 🎭 School of Cunning
*"The sharpest blade is the mind."*

**Topics Covered:**
- Ability scores and modifiers
- Skill checks and proficiency
- Advantage and disadvantage
- Passive checks (Passive Perception)
- Saving throws
- Contests
- Tools and tool proficiency
- Inspiration

**Professor NPC:** *"Whisper"* - Mysterious, speaks in riddles, appears and disappears

---

### 🏕️ School of Survival
*"The adventure doesn't end when you fall. It ends when you give up."*

**Topics Covered:**
- Hit points and hit dice
- Short rests and long rests
- Death saving throws
- Conditions (stunned, prone, poisoned, etc.)
- Healing and stabilizing
- Exhaustion
- Food, water, and encumbrance (light touch)

**Professor NPC:** *Bramwell Thornwood* - Kindly old ranger, speaks from experience, has scars with stories

---

## Lesson Structure

Each school contains **5-7 lessons**, structured as:

### 1. The Lecture (Learn)
- Short, digestible explanation (2-3 paragraphs max)
- Delivered by the Professor NPC in their voice
- Can include simple diagrams or visual aids
- Optional: Link to Handbooker Helper video for deeper dive

### 2. The Exercise (Practice)
- Interactive question or scenario
- Multiple choice or short input
- Immediate feedback ("Correct! Because..." or "Not quite. Remember...")
- Can retry until correct

### 3. The Practical Exam (Prove)
- Apply what you learned to a scenario
- Example: "You're 30ft from a goblin. You have a longsword and one spell slot. Describe your turn."
- Reviewed by the Professor NPC (could be AI-evaluated or simple pattern matching)
- Pass/fail with feedback

---

## Rewards

### Per Lesson Completed
- **10-25 gold** (scaling with lesson complexity)
- **XP** toward player level

### Per School Completed
- **Title/Badge:** 
  - School of Steel → "Battletested"
  - School of the Arcane → "Arcanist Initiate"
  - School of Cunning → "Silver Tongue"
  - School of Survival → "Hardened"
- **Bonus gold:** 100g per school
- **Cosmetic:** School-themed avatar frame or icon?

### Full Graduation (All 4 Schools)
- **Title:** "Scholar of Okhan"
- **Major reward:** 500 gold + exclusive item?
- **Recognition:** Announcement in Discord? Badge in app?

---

## Progression Tracking

- Track which lessons/schools each player has completed
- Show progress bars on the University page
- "Transcript" page showing completed courses and grades?
- Can revisit any lesson for review (no repeat rewards)

---

## UI/UX Concepts

### University Main Page
```
┌─────────────────────────────────────────┐
│  THE UNIVERSITY OF OKHAN                │
│  "Knowledge is the first weapon."       │
├─────────────────────────────────────────┤
│                                         │
│  [🗡️ School of Steel]     ██████░░ 75%  │
│  [✨ School of the Arcane] ░░░░░░░░  0%  │
│  [🎭 School of Cunning]   ████░░░░ 50%  │
│  [🏕️ School of Survival]  ██░░░░░░ 25%  │
│                                         │
│  Your Progress: 12/28 lessons           │
│                                         │
└─────────────────────────────────────────┘
```

### Lesson Page
```
┌─────────────────────────────────────────┐
│  SCHOOL OF STEEL - Lesson 3             │
│  "The Attack Roll"                      │
├─────────────────────────────────────────┤
│                                         │
│  [Professor Aldric portrait]            │
│                                         │
│  "When you swing your sword, fate       │
│   decides if it lands. Roll a d20,      │
│   add your attack modifier, and         │
│   compare to your enemy's AC..."        │
│                                         │
│  [Continue]                             │
│                                         │
└─────────────────────────────────────────┘
```

---

## Sample Lessons

### School of Steel - Lesson 1: "Your Turn in Combat"

**Lecture:**
> "Listen well, recruit. When steel meets steel, chaos reigns - but YOUR actions must be precise. On your turn, you can do three things: MOVE, take an ACTION, and sometimes a BONUS ACTION. 
>
> Movement is simple - you have a speed, usually 30 feet. Use it however you like, before, after, or during your action.
>
> Your Action is the big one. Attack. Cast a spell. Dash to move again. Dodge. Help an ally. Hide. Most of the time, you're attacking.
>
> Bonus Actions are special - you only get one if an ability specifically grants it. Don't waste time looking for one if you don't have it."

**Exercise:**
> You have 30 feet of movement and a longsword. An enemy is 20 feet away. What can you do on your turn?
>
> A) Move 20ft and attack ✓  
> B) Attack twice  
> C) Move 40ft  
> D) Nothing, you're too far away

**Practical:**
> "There are two goblins. One is 25 feet to your left, one is 40 feet ahead. You want to engage the closer one but stay away from the far one. Describe your turn."

---

### School of the Arcane - Lesson 1: "The Weave of Magic"

**Lecture:**
> "Magic is not an infinite well, child. It is a reservoir - and you must learn to manage it.
>
> Cantrips are simple. They cost nothing. You can cast them endlessly. Think of them as breathing.
>
> Leveled spells are different. Each requires a SPELL SLOT. You have a limited number per day, and they return only after rest. A 1st-level spell requires a 1st-level slot - or higher. Yes, you can use a bigger slot for a smaller spell. Sometimes it even makes the spell stronger."

**Exercise:**
> You're a 3rd-level wizard with two 1st-level slots and one 2nd-level slot. You cast Shield (1st level) and Magic Missile (1st level). Can you still cast another leveled spell?
>
> A) No, I'm out of slots  
> B) Yes, I have my 2nd-level slot ✓  
> C) Yes, cantrips are free  
> D) Only if I take a short rest

---

## Technical Implementation

### Database
- `user_lessons` table: user_id, lesson_id, completed_at, score
- `user_schools` table: user_id, school_id, completed_at
- Lessons defined in JSON/config file for easy editing

### API Endpoints
- `GET /api/university/progress` - User's overall progress
- `GET /api/university/school/:id` - School details + lesson list
- `GET /api/university/lesson/:id` - Lesson content
- `POST /api/university/lesson/:id/submit` - Submit exercise/exam answer
- `POST /api/university/lesson/:id/complete` - Mark lesson complete, grant rewards

### Frontend
- New location scene: `UniversityScene.jsx`
- Lesson viewer component with lecture → exercise → practical flow
- Progress tracking UI

---

## Future Expansion Ideas

- **Advanced Courses:** Multiclassing, feats, specific class deep-dives
- **Guest Lectures:** Tie into actual D&D sessions - "Professor Aldric will discuss last week's battle"
- **Study Groups:** Players can help each other, earn XP for teaching
- **Exams:** Periodic comprehensive tests with bigger rewards
- **Class-Specific Tracks:** "So you want to be a Paladin" mini-course
- **Library:** In-world repository linking to external resources (PHB sections, videos)

---

## Open Questions

- [ ] Should lessons be gated (must complete Lesson 1 before Lesson 2)?
- [ ] How to handle the "Practical Exam" evaluation - AI? Pattern matching? DM review?
- [ ] Should there be a "placement test" to skip basics if player already knows?
- [ ] Integrate with character sheet - auto-suggest relevant lessons based on class?

---

## Resources to Link

- Handbooker Helper Playlist: https://www.youtube.com/playlist?list=PL1tiwbzkOjQyr6-gqJ8r29j_rJkR49uDN
- D&D Beyond Basic Rules: https://www.dndbeyond.com/sources/basic-rules
- 5e Quick Reference: https://crobi.github.io/dnd5e-quickref/preview/quickref.html

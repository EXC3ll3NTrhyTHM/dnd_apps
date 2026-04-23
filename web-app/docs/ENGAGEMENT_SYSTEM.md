# Engagement System Design Spec

## Overview

A positioning abstraction that tracks who is in melee range of whom without requiring a grid or movement system. Characters form **Engagement Groups** when they enter melee combat, which determines valid attack targets and triggers opportunity attacks.

---

## Core Concept: Engagement Groups

An **Engagement Group** is a cluster of players and enemies who are all within melee range of each other. Think of it as "these people are all fighting in the same scrum."

```
ENGAGEMENT GROUP 1              DISENGAGED
┌─────────────────────┐         ┌─────────────────────┐
│ Nalyd (player)      │         │ Aly (player)        │
│ Tyren (player)      │         │ Enemy Shaman        │
│ Orc Warrior (enemy) │         └─────────────────────┘
│ Goblin Rogue (enemy)│         
└─────────────────────┘         ENGAGEMENT GROUP 2
                                ┌─────────────────────┐
                                │ Nibby (player)      │
                                │ Goblin Archer       │
                                └─────────────────────┘
```

### Rules:
- Everyone in a group can melee attack anyone else in that group
- Groups must contain at least one player AND one enemy to exist
- Groups with only players or only enemies **dissolve** (all members become disengaged)
- Groups do NOT merge - they remain separate clusters
- A character can only be in ONE group at a time

---

## Becoming Engaged

### How Groups Form:
1. **Player melees a disengaged enemy** → New group with just those two
2. **Enemy melees a disengaged player** → New group with just those two
3. **Anyone melees someone already in a group** → Attacker joins that group

### What Triggers Engagement:
- ✅ Melee weapon attacks
- ✅ Touch spells (treated as melee)
- ❌ Ranged attacks (do not engage)
- ❌ Ranged spells (do not engage)

### Joining an Existing Group:
When you melee attack someone who is already in a group, you join their entire group and are now in melee range of everyone in it.

**Example:**
- Group 1 contains: Nalyd, Orc
- Goblin Rogue melees Nalyd
- Group 1 now contains: Nalyd, Orc, Goblin Rogue
- Nalyd can now melee attack either Orc OR Goblin Rogue

---

## Breaking Engagement (Disengage)

### Disengage Action (Safe Exit)
- **Costs:** Main action
- **Effect:** You safely leave your engagement group with no opportunity attacks
- **After Disengage:** You may use your bonus action to:
  - Join another engagement group (melee attack someone)
  - Remain disengaged

### Leaving Without Disengage (Risky Exit)
If you attempt a melee attack on a target NOT in your current group without using Disengage first:
- **Every enemy in your current group gets an opportunity attack against you**
- Then you leave your group and join the new target's group (or form a new group)

**Example:**
- Nalyd is in Group 1 with Orc and Goblin Rogue
- Nalyd wants to melee the Archer in Group 2
- Without Disengage: Both Orc AND Goblin Rogue get opportunity attacks on Nalyd
- With Disengage: Nalyd uses main action to safely leave, bonus action to engage Archer

---

## Attack Rules

### Melee Attacks

| Situation | Can Attack? | Notes |
|-----------|-------------|-------|
| Target in your group | ✅ Yes | Normal attack |
| Target in different group | ⚠️ Yes, but... | Triggers opportunity attacks from ALL enemies in your current group |
| Target is disengaged, you are disengaged | ✅ Yes | Forms new group |
| Target is disengaged, you are engaged | ⚠️ Yes, but... | Triggers opportunity attacks (you're leaving your group) |

### Ranged Attacks

| Situation | Can Attack? | Disadvantage? |
|-----------|-------------|---------------|
| You are disengaged, target anywhere | ✅ Yes | No |
| You are engaged, target in YOUR group | ✅ Yes | **Yes** (too close) |
| You are engaged, target in OTHER group | ✅ Yes | No |
| You are engaged, target is disengaged | ✅ Yes | No |

**Key Insight:** Disadvantage only applies when shooting at enemies **in your own engagement group** (they're in your face). Shooting at enemies in other groups or disengaged enemies is normal.

### Spells

| Spell Type | Engagement Rules |
|------------|------------------|
| Touch spells | See detailed table below |
| Ranged spells | Ranged rules (no engagement, disadvantage if target in your group) |
| AOE spells | No engagement interaction |
| Self/buff spells | No engagement interaction |

### Touch Spells - Detailed Engagement Rules

Touch spells require you to move into melee range of the target. This applies whether targeting enemies OR allies.

| Target | You Are | Result |
|--------|---------|--------|
| Enemy (disengaged) | Disengaged | Form new group with enemy |
| Enemy (in a group) | Disengaged | Join that enemy's group |
| Enemy (in a group) | In same group | Stay in group (no change) |
| Enemy (different group) | In a group | Opportunity attacks from current group, then join new group |
| Ally (disengaged) | Either | No engagement change |
| Ally (in a group) | Disengaged | **Join ally's group** (you moved into the scrum) |
| Ally (in a group) | In same group | Stay in group (no change) |
| Ally (different group) | In a group | **Opportunity attacks from current group, then join ally's group** |

**The Logic:** Touching someone means you moved to their location. If they're in a melee scrum, you just stepped into that scrum.

**Example:**
- Aly is disengaged (🏹 FREE)
- Tyren is in Group 1 with Orc and Goblin
- Aly casts Cure Wounds (touch) on Tyren
- Aly now joins Group 1 - she's in melee range of Orc and Goblin

**Warning:** Healers beware! Touching your frontline allies puts you in danger.

---

## Opportunity Attacks

### When They Trigger:
- Leaving an engagement group without using Disengage action
- This includes: attacking someone in a different group, moving to engage a disengaged enemy, etc.

### Who Gets Them:
- **Every enemy** in your current engagement group gets ONE opportunity attack against you

### When They Don't Trigger:
- Using Disengage action (main action) to leave safely
- Using ranged attacks (you stay in your group, just have disadvantage if targeting same group)
- Casting non-touch spells

---

## Tanking / Aggro

### Engagement Blocking
Enemies must deal with whoever is in their engagement group. They cannot simply walk past the tank to reach the archer.

**How Tanks Protect:**
1. Tank engages enemy → Enemy is now in a group with tank
2. Enemy wants to reach the backline archer? Must either:
   - Kill the tank first
   - Use Disengage (costs their action)
   - Leave without Disengage (tank gets opportunity attack)

### Enemy Intelligence

Enemy behavior is determined by their Intelligence Level and Behavior Tags. See the full [Enemy AI & Targeting System](./ENEMY_AI_SYSTEM.md) spec for details.

**Quick Reference:**
- **Mindless/Dumb enemies:** Attack whoever is in their group, never disengage
- **Average enemies:** Basic threat assessment, rarely disengage
- **Smart/Tactical enemies:** May disengage or risk opportunity attacks to reach high-value targets

This is configured per-enemy in the enemy data model.

---

## Group Dissolution

### When Groups Dissolve:
- All players leave (only enemies remain) → Group dissolves, enemies become disengaged
- All enemies leave/die (only players remain) → Group dissolves, players become disengaged

### Optional Simplification:
Groups with only one "side" remain as groups, but members can leave freely without using Disengage (since there's no one to trigger opportunity attacks).

---

## Edge Cases

### Last Enemy in Group Dies
- Remaining players in that group become disengaged
- They can freely engage elsewhere on their next turn

### Character Gets Knocked Unconscious
- They remain in their engagement group (enemies can still hit them)
- If they're stabilized/healed, they're still in the group

### Multiple Groups Want to Merge
- Groups do NOT auto-merge
- If two separate groups are fighting near each other, they stay separate
- Characters must actively move between groups

### Forced Movement (Shove, Thunderwave, etc.)
- If an effect forces someone out of melee range, they leave their group
- DM decides if this triggers opportunity attacks based on the effect

---

## UI Display

### Arena Panel Layout
Keep Players and Enemies in separate columns, but mark engagement groups clearly.

```
┌─────────────────────────────────────────────────────────┐
│  PLAYERS                 │  ENEMIES                     │
├──────────────────────────┼──────────────────────────────┤
|                                                         |
│                     ⚔️ GROUP 1                         │
|                                                         |
│  Nalyd    [████████] 18  │  Orc      [████░░░░] 12      │
│  Tyren    [██████████]30 │  Goblin   [██████░░]  8      │
├──────────────────────────┼──────────────────────────────┤
|                                                         |
│                      ⚔️ GROUP 2                         │
|                                                         |
│  Nibby    [██████░░] 14  │  Archer   [████████] 10      │
├──────────────────────────┼──────────────────────────────┤
|                                                         |
│                       🏹 FREE                           │
|                                                         |
│  Aly      [██████████]24 │  Shaman   [██████░░] 18      │
└──────────────────────────┴──────────────────────────────┘
```

### Visual Indicators
- **Group labels:** "⚔️ GROUP 1", "⚔️ GROUP 2", etc.
- **Free/Disengaged:** "🏹 FREE" section at bottom
- **Color coding:** Optional - same group = same subtle background tint

### When Targeting
- If player is engaged and tries to target outside their group with melee → Warning: "Opportunity attack from X enemies!"
- If player is engaged and tries ranged attack on same group → Warning: "Disadvantage - target too close"

---

## Action Summary

| Action | Cost | Effect |
|--------|------|--------|
| Melee attack (same group) | Action | Normal attack |
| Melee attack (different group) | Action | Attack + receive opportunity attacks from ALL enemies in current group |
| Melee attack (you disengaged) | Action | Attack + join/form group |
| Ranged attack (same group) | Action | Attack with disadvantage |
| Ranged attack (other group/disengaged) | Action | Normal attack |
| Disengage | Main Action | Safely leave group, no opportunity attacks |
| Join new group after Disengage | Bonus Action | Engage new target |

---

## Implementation Checklist

### Data Model
- [ ] Add `engagementGroupId` field to players and enemies
- [ ] Create engagement group tracking (which characters in which group)
- [ ] Track group membership changes

### Combat Flow
- [ ] On melee attack: auto-engage logic (join group or form new)
- [ ] On target selection: detect if target is in different group
- [ ] Trigger opportunity attack flow when leaving group unsafely
- [ ] Disengage action implementation
- [ ] Group dissolution when one side is empty

### UI
- [ ] Update Arena panel to show groups
- [ ] Add "FREE" section for disengaged characters
- [ ] Warning prompts for opportunity attacks
- [ ] Warning prompts for ranged disadvantage (same group)
- [ ] Disengage button/action in combat UI

### Enemy AI
- [ ] See [Enemy AI & Targeting System](./ENEMY_AI_SYSTEM.md) for full implementation
- [ ] Integrate AI targeting with engagement group logic

---

## Future Considerations

- **Reach weapons:** Can attack from adjacent group without joining?
- **Sentinel feat:** Opportunity attacks stop movement
- **Mobile feat:** No opportunity attacks from target you attacked
- **Pack Tactics:** Advantage when ally in same group
- **Flanking (optional rule):** Advantage when 2+ allies in group vs same enemy

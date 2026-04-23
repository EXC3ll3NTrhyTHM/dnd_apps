# Enemy AI & Targeting System Design Spec

## Overview

A tagging system that defines enemy behavior during combat, including target selection, tactical decisions, and engagement preferences. Works alongside the [Engagement System](./ENGAGEMENT_SYSTEM.md) to determine how enemies act.

---

## Intelligence Levels

Every enemy has an **Intelligence Level** that determines their base behavior patterns.

| Level | Description | Disengage? | Target Assessment |
|-------|-------------|------------|-------------------|
| **Mindless** | No thought, pure reaction | Never | None - attacks nearest |
| **Dumb** | Basic instincts only | Never | Minimal - stays on current target |
| **Average** | Some tactical awareness | Rarely | Basic - switches to wounded/threatening |
| **Smart** | Strategic thinking | Yes | Advanced - prioritizes high-value targets |
| **Tactical** | Battlefield commander | Yes | Full - coordinates with allies |

---

## Behavior by Intelligence Level

### Mindless
*Examples: Zombies, oozes, animated objects, mindless undead*

- Attacks nearest target, no exceptions
- Never disengages (doesn't understand the concept)
- No target switching mid-combat
- Ignores threat, just reacts to proximity
- Will keep attacking downed targets

**Targeting Priority:**
1. Whoever attacked them last
2. Nearest target in engagement group
3. Random if tied

---

### Dumb
*Examples: Beasts, wolves, giant insects, skeletons, basic undead*

- Attacks whoever is in their engagement group
- Won't risk opportunity attacks to reach new targets
- May switch targets within group if current dies
- Basic self-preservation (but won't flee)

**Targeting Priority:**
1. Current target (sticky)
2. Whoever dealt most damage to them
3. Lowest AC target in group

---

### Average
*Examples: Goblins, orcs, bandits, kobolds, gnolls*

- Understands basic threat assessment
- May switch targets within group based on situation
- Rarely disengages (only if severely outmatched)
- Finishes wounded targets when possible

**Targeting Priority:**
1. Current target if winning the fight
2. Wounded targets (finish kills)
3. Whoever is threatening them most
4. Easiest target (lowest AC)

---

### Smart
*Examples: Hobgoblins, assassins, mages, veterans, intelligent monsters*

- Will disengage to reach priority targets
- Accepts opportunity attacks if payoff is worth it
- Targets healers and casters in backline
- Focuses fire on single targets
- Retreats if fight is clearly lost

**Targeting Priority:**
1. Healers / support (will disengage to reach)
2. Casters (high damage, low HP)
3. Lowest HP target (secure kills)
4. Biggest damage threat
5. Current target

**Disengage Logic:**
- Will disengage if high-value target is unprotected
- Will risk 1-2 opportunity attacks to reach a caster
- Won't risk 3+ opportunity attacks unless desperate

---

### Tactical
*Examples: Commanders, warlords, generals, dragon, intelligent BBEG*

- Full battlefield awareness
- Coordinates focus fire with other enemies
- Protects allied casters/ranged
- Sets up engagement traps
- Strategic retreats and regrouping
- May hold action for optimal timing

**Targeting Priority:**
1. Coordinate with allies - focus fire on single target
2. Protect own vulnerable allies
3. Exploit positioning mistakes
4. Control the engagement flow

**Special Behaviors:**
- Can issue "commands" that affect other enemies' targeting
- May direct Dumb/Average allies to specific targets
- Creates engagement groups strategically

---

## Behavior Tags

Additional tags that modify an enemy's base intelligence behavior. An enemy can have multiple tags.

### Aggression Tags

| Tag | Effect |
|-----|--------|
| **Aggressive** | Always attacks, never takes defensive actions, charges in first |
| **Defensive** | Prefers to stay engaged with current target, protects position |
| **Cowardly** | Flees when below 25% HP, avoids engaging alone |
| **Reckless** | Ignores self-preservation, will trade hits freely |
| **Cautious** | Won't engage unless odds are favorable, hangs back |

### Targeting Tags

| Tag | Effect |
|-----|--------|
| **Vengeful** | Prioritizes whoever hurt them most, holds grudges |
| **Hunter** | Prioritizes wounded targets, goes for kills |
| **Caster-Killer** | Always prioritizes spellcasters above all else |
| **Tank-Ignorer** | Will always try to bypass frontline to reach backline |
| **Leader-Focus** | Targets whoever appears to be giving orders |
| **Random** | Unpredictable targeting, changes frequently |

### Role Tags

| Tag | Effect |
|-----|--------|
| **Protector** | Stays near and defends a specific ally (specify who) |
| **Assassin** | Stealths/waits for opportunity, then strikes high-value target |
| **Berserker** | At low HP, becomes more aggressive, stops defending |
| **Support** | Prioritizes buffing/healing allies over attacking |
| **Controller** | Uses crowd control abilities, targets groups |

### Survival Tags

| Tag | Effect |
|-----|--------|
| **Fearless** | Never flees, fights to the death |
| **Self-Preserving** | Flees at 50% HP if losing |
| **Pack Mentality** | Flees if majority of allies are dead |
| **Surrenders** | May surrender if clearly defeated |

---

## Example Enemy Profiles

### Goblin (Minion)
```yaml
name: Goblin
intelligence: Dumb
tags: [Cowardly, Pack Mentality]
behavior:
  - Fights whoever is in engagement group
  - Flees at 25% HP
  - Flees if more than half of goblin allies are dead
```

### Orc Warrior
```yaml
name: Orc Warrior
intelligence: Average
tags: [Aggressive, Vengeful]
behavior:
  - Charges into melee immediately
  - Prioritizes whoever hurt them most
  - Fights to the death (Aggressive overrides flee)
```

### Hobgoblin Warlord
```yaml
name: Hobgoblin Warlord
intelligence: Tactical
tags: [Protector(Shaman), Leader-Focus]
behavior:
  - Stays near the Hobgoblin Shaman
  - Coordinates other hobgoblins to focus fire
  - Targets enemy party leader
  - Will disengage to intercept threats to Shaman
```

### Assassin
```yaml
name: Assassin
intelligence: Smart
tags: [Hunter, Caster-Killer, Self-Preserving]
behavior:
  - Waits for opportunity (may skip first round)
  - Targets wounded casters preferentially
  - Will disengage and risk OAs to reach caster
  - Flees at 50% HP if fight is going poorly
```

### Zombie
```yaml
name: Zombie
intelligence: Mindless
tags: [Fearless]
behavior:
  - Attacks nearest target
  - Never switches targets unless current is dead
  - Keeps attacking downed creatures
  - Fights until destroyed
```

### Young Dragon
```yaml
name: Young Red Dragon
intelligence: Tactical
tags: [Aggressive, Reckless, Fearless]
behavior:
  - Opens with breath weapon on groups
  - Focuses fire on biggest threat
  - Uses flight to control engagement
  - Arrogant - won't flee even when losing
```

---

## Data Model

### Enemy Schema Addition

```javascript
{
  // ... existing enemy fields ...
  
  ai: {
    intelligence: 'mindless' | 'dumb' | 'average' | 'smart' | 'tactical',
    tags: [
      // Aggression
      'aggressive' | 'defensive' | 'cowardly' | 'reckless' | 'cautious',
      // Targeting
      'vengeful' | 'hunter' | 'caster-killer' | 'tank-ignorer' | 'leader-focus' | 'random',
      // Role
      'protector' | 'assassin' | 'berserker' | 'support' | 'controller',
      // Survival
      'fearless' | 'self-preserving' | 'pack-mentality' | 'surrenders'
    ],
    protects: 'enemy_id' | null,  // For Protector tag
    fleeThreshold: 0.25,          // HP percentage to flee (if applicable)
    notes: ''                      // DM notes on special behavior
  }
}
```

### Defaults by Enemy Type

| Enemy Type | Default Intelligence | Common Tags |
|------------|---------------------|-------------|
| Undead (mindless) | Mindless | Fearless |
| Undead (intelligent) | Smart | Vengeful |
| Beast | Dumb | Self-Preserving |
| Humanoid (minion) | Dumb | Cowardly |
| Humanoid (soldier) | Average | — |
| Humanoid (elite) | Smart | — |
| Humanoid (leader) | Tactical | — |
| Construct | Mindless | Fearless |
| Dragon | Tactical | Aggressive, Fearless |

---

## Integration with Engagement System

### Target Selection Flow

```
1. Check intelligence level
2. Get valid targets (in engagement group, or assess disengage)
3. Apply targeting tags (filter/sort targets)
4. Apply role tags (special behaviors)
5. Check survival tags (flee conditions)
6. Execute action
```

### Disengage Decision (Smart/Tactical only)

```
IF intelligence >= Smart
  AND high-value target exists outside group
  AND (opportunity_attack_count <= acceptable_risk)
THEN
  Consider disengage or risk OAs
```

**Acceptable Risk by Intelligence:**
- Smart: 1-2 opportunity attacks
- Tactical: 2-3 opportunity attacks (better at weighing payoff)

---

## UI Considerations

### DM Enemy Creation
- Dropdown for Intelligence level
- Checkbox list for Tags
- "Protects" enemy selector (if Protector tag)
- Flee threshold slider (if applicable)

### Combat Display (DM Only)
- Show enemy AI summary on hover/click
- Indicate current target preference
- Show if enemy is considering disengage

---

## Implementation Checklist

### Data Model
- [ ] Add `ai` object to enemy schema
- [ ] Intelligence level enum
- [ ] Tags array field
- [ ] Protects reference field
- [ ] Flee threshold field

### Enemy Creation UI
- [ ] Intelligence dropdown
- [ ] Tags multi-select
- [ ] Protector target selector
- [ ] Preset templates by creature type

### Combat AI Logic
- [ ] Target selection by intelligence level
- [ ] Tag-based priority modifiers
- [ ] Disengage decision logic
- [ ] Flee condition checking
- [ ] Protector proximity logic

### Integration
- [ ] Link to engagement system for valid targets
- [ ] Opportunity attack risk assessment
- [ ] Coordinate with turn order system

---

## Future Considerations

- **Morale system:** Group morale affects flee decisions
- **Memory:** Smart enemies remember who healed, who dealt damage
- **Threat table:** Track threat per-player for aggro mechanics
- **Pack tactics:** Coordinated behaviors for groups of same enemy
- **Boss phases:** Change AI profile at HP thresholds

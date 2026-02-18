# Arena D&D 5e Upgrade Plan

**Created:** 2026-02-16
**Status:** Planning

This document outlines the phased implementation plan for upgrading the Arena combat system to incorporate full D&D 5th Edition rules.

---

## Current State ✅

The Arena currently supports:

- Initiative (d20 + DEX mod)
- Turn-based combat with initiative order
- Attack rolls (d20 + attack bonus vs AC)
- Damage rolls (weapon dice + STR/DEX mod)
- Critical hits (NAT 20 = roll damage twice)
- Fumbles (NAT 1 = auto-miss)
- Defend action (+2 AC)
- Flee action
- HP tracking, knockout at 0 HP
- Monster multiattack
- D&D Beyond character sheet integration

---

## Phase 1: Core 5e Mechanics

### 1.1 Advantage/Disadvantage System

**Description:** Roll 2d20 instead of 1d20, taking the higher (advantage) or lower (disadvantage) result.

**Implementation:**
- Add `advantageState` to attack context: `'advantage' | 'disadvantage' | 'normal'`
- Modify dice roll logic to roll 2d20 when advantage/disadvantage applies
- UI shows both dice results, highlights the one used
- Sources: conditions, Help action, abilities, Dodge action

**Files affected:**
- `server/lib/encounters.js` - attack resolution logic
- `client/src/pages/Arena.jsx` - dice roll display
- `client/src/components/RollResultOverlay.jsx` - show both dice

### 1.2 Death Saving Throws

**Description:** Players at 0 HP aren't immediately defeated. They roll to stabilize or die.

**Mechanics:**
- At 0 HP → enter "dying" state (not knocked out yet)
- On their turn: roll d20 (no modifiers)
  - 10+ = success
  - <10 = failure
  - NAT 20 = regain 1 HP, back in the fight
  - NAT 1 = counts as 2 failures
- 3 successes = stabilized (unconscious but alive, skip turns)
- 3 failures = defeated
- Taking damage while at 0 HP = automatic failure

**Implementation:**
- Add to participant state: `{ dying: bool, deathSaves: { successes: 0, failures: 0 }, stabilized: bool }`
- New turn phase for death save rolls
- UI for death save tracking (3 diamonds for success/fail)

**Files affected:**
- `server/lib/encounters.js` - death save logic, turn handling
- `client/src/pages/Arena.jsx` - death save UI and roll flow

### 1.3 Expanded Actions

**Dodge Action (upgrade from Defend):**
- Current: +2 AC
- New: Attacks against you have disadvantage until your next turn
- More impactful defensive option

**Help Action:**
- Give an ally advantage on their next attack roll
- Target selection UI needed
- Track "helped" state on recipient

**Implementation:**
- Modify action handlers in encounters.js
- Add ally targeting for Help action
- Track advantage sources per participant

### 1.4 Bonus Actions

**Description:** Separate action economy slot for bonus actions.

**Implementation:**
- Add `bonusActionUsed: bool` to participant turn state
- Reset at start of each turn
- Some abilities/items require bonus action instead of action
- UI indicator for bonus action availability

### 1.5 Potion System

**Description:** Consumable items that heal or provide buffs. Critical for recovering from death saves.

**Potion Types (5e Standard):**
| Potion | Healing | Cost | Rarity |
|--------|---------|------|--------|
| Healing | 2d4+2 | 50 gp | Common |
| Greater Healing | 4d4+4 | 100 gp | Uncommon |
| Superior Healing | 8d4+8 | 500 gp | Rare |
| Supreme Healing | 10d4+20 | 5000 gp | Very Rare |

**Action Economy:**
- Drink potion on self: Action (or Bonus Action as house rule?)
- Administer to ally at 0 HP: Action

**Implementation:**
- Add potions to Shop inventory
- Track potions in player inventory
- "Use Potion" action in combat
- Target selection (self or downed ally)
- Potion heals → stabilizes dying player and brings them back
- Animate potion use (drinking effect, HP restore)

**Data:**
```javascript
participant.inventory = {
  potions: [
    { id: 'healing', name: 'Potion of Healing', dice: '2d4+2', quantity: 2 }
  ]
}
```

**Shop Integration:**
- Potions available in existing shop
- Price in gold
- Limited stock or unlimited?
- Restocks on long rest or daily

### 1.6 Dice Customization System

**Description:** Players can buy cosmetic dice sets from the shop. Their dice color/theme changes in battle and location rolls.

**Available Colorsets (from dice-box):**
- `white`, `red`, `blue`, `green`, `yellow`, `purple`, `black`
- `bronze`, `silver`, `gold`
- `fire`, `ice`, `poison`, `acid`
- And more from the library

**Implementation:**

**Shop:**
- Add "Dice" category to shop
- Each dice set has: name, colorset/themeColor, price, preview image
- Example: "Inferno Dice" (fire), "Frost Dice" (ice), "Golden Dice" (gold)

**Player Data:**
```javascript
player.cosmetics = {
  equippedDice: 'fire',  // colorset name or hex
  ownedDice: ['default', 'fire', 'ice', 'gold']
}
```

**Profile/Inventory:**
- View owned dice sets
- Equip/switch active dice
- Preview roll animation

**Integration:**
- DiceOverlay reads player's equipped dice colorset
- Pass to dice-box as `themeColor` or `colorset`
- Each player's rolls show their custom dice
- Spectators see the roller's dice color

**Pricing Ideas:**

*Basic Sets:*
| Dice Set | Price | Colorset |
|----------|-------|----------|
| Default | Free | (default) |
| Radiant | 100g | `radiant` |
| Thunder | 100g | `thunder` |
| Air | 100g | `air` |
| Water | 100g | `water` |
| Earth | 100g | `earth` |

*Damage Type Sets:*
| Dice Set | Price | Colorset |
|----------|-------|----------|
| Fire | 200g | `fire` |
| Ice | 200g | `ice` |
| Poison | 200g | `poison` |
| Acid | 200g | `acid` |
| Lightning | 200g | `lightning` |
| Force | 250g | `force` |
| Psychic | 250g | `psychic` |
| Necrotic | 250g | `necrotic` |

*Premium Sets:*
| Dice Set | Price | Colorset |
|----------|-------|----------|
| Bronze | 300g | `bronze` |
| Blood Moon | 400g | `bloodmoon` |
| Starry Night | 400g | `starynight` |
| Astral Sea | 500g | `astralsea` |
| Glitter Party | 500g | `glitterparty` |
| Pink Dreams | 500g | `pinkdreams` |

*Class-Themed (Homebrew idea):*
| Dice Set | Price | For Class |
|----------|-------|-----------|
| Storm Dice | 300g | Aly (lightning theme) |
| Inferno Dice | 300g | Nalyd (fire theme) |
| Dragon Dice | 400g | Acacia (custom) |
| Justice Dice | 400g | Tyren (radiant/ice) |
| Holy Dice | 400g | Thalor (radiant/gold) |

---

## Phase 2: Spells & Class Abilities

> **Note:** Only implement spells/abilities for the current player classes. Add spells one-by-one as players use them.

### Current Player Classes

| Player | Class | Subclass |
|--------|-------|----------|
| Tyren | Ranger | TBD |
| Nalyd | Monk | TBD |
| Acacia | Bard | TBD |
| Aly | Cleric | TBD |
| Thalor | Paladin | TBD |

### 2.1 Spell Slot Tracking

**Data:**
```javascript
participant.spellSlots = {
  1: { max: 4, used: 1 },
  2: { max: 3, used: 0 },
  // ...
}
```

**Integration:**
- Pull max slots from character sheet
- Track usage per encounter (reset on new encounter)
- UI shows available slots by level

### 2.2 Cantrips

- No slot cost, unlimited use
- Scale damage with character level
- Add to action menu based on class

### 2.3 Class-Specific Abilities

**Ranger (Tyren):**
- Hunter's Mark (concentration, bonus action)
- Favored Enemy bonuses
- Natural Explorer features
- Ranger spells (Cure Wounds, etc.)

**Monk (Nalyd):**
- Ki points tracking
- Flurry of Blows (bonus action, 1 ki)
- Patient Defense (bonus action, 1 ki) - Dodge as bonus action
- Step of the Wind (bonus action, 1 ki)
- Stunning Strike (on hit, 1 ki) - target CON save or stunned
- Martial Arts die scaling

**Bard (Acacia):**
- Bardic Inspiration dice (bonus action, give ally die)
- Bard spells (Healing Word, Vicious Mockery, etc.)
- Song of Rest (short rest healing)

**Cleric (Aly):**
- Channel Divinity (1-2/rest)
- Cleric spells (Spiritual Weapon, Guiding Bolt, Healing Word, etc.)
- Domain features

**Paladin (Thalor):**
- Divine Smite (on hit, expend spell slot for extra radiant damage)
- Lay on Hands (healing pool)
- Channel Divinity (1/rest)
- Paladin spells (Divine Favor, Shield of Faith, Cure Wounds, etc.)
- Aura of Protection (CHA mod to saves for nearby allies)
- Fighting Style bonuses

### 2.4 Concentration

- Track `participant.concentrating = { spellId, spellName }`
- Taking damage triggers CON save (DC = 10 or half damage taken, whichever higher)
- Fail = concentration broken, spell ends
- Casting new concentration spell ends previous one
- UI indicator for active concentration

### 2.5 Spell Casting Flow

1. Select "Cast Spell" action
2. Show available spells (filtered by class from character sheet)
3. Select spell
4. Select slot level (if applicable)
5. Select targets (if applicable)
6. Roll attack or force save
7. Apply effects (damage, healing, conditions)

---

## Phase 3: Homebrew Abilities

> **Note:** Custom abilities for each player character. Build alongside class abilities.

### 3.1 Tyren - Ashril (Frost-Forged Lightblade)

**Properties:**
- Damage types: Cold + Radiant
- Ignite: Bonus action to activate visual effect
- Liar's Bane: Extra damage vs creatures marked as "liar" (DM toggle)
- Truth Bound: If Tyren lies, blade goes dark until dawn (RP feature)

**Conditions needed:** None initially

**Implementation:**
- Special weapon handling in damage calculation
- Visual effect toggle (glowing blade sprite overlay)
- DM admin panel for "liar" flag on monsters

### 3.2 Nalyd - Ignition Form

**Properties:**
- Activation: Action (1/long rest)
- Duration: X rounds or until dismissed
- Effects:
  - Stat increases (STR, CON?)
  - Fire damage added to attacks
  - Healing ability (bonus action?)
- Visual: Fire overlay on sprite

**Conditions needed:** Could add "burning" condition to enemies hit

**Implementation:**
- New action type: "Transform"
- Transformation state tracking
- Stat override while transformed
- Custom sprite/overlay for form

### 3.3 Acacia - Dragon Form

**Properties:**
- Activation: Action
- Duration: X rounds or concentration
- Effects:
  - Different stat block (AC, HP, attacks)
  - Breath weapon attack option
- Visual: Dragon sprite replacement

**Conditions needed:** Breath weapon might cause "frightened"

**Implementation:**
- Transformation system (shared with Nalyd)
- Alternate stat block loading
- Unique action menu while transformed

### 3.4 Aly - Storm Abilities

**Properties:**
- Spiritual Weapon: Bonus action to attack (uses spell slot initially, bonus action thereafter)
- Stormpiercer (bow): Lightning damage, special properties
- Stormblades: Ranged dagger attacks

**Conditions needed:** Could cause "stunned" on crit (lightning)

**Implementation:**
- Spiritual Weapon as persistent summon/effect
- Weapon property system for special effects
- Multiple weapon options in attack menu

---

## Phase 4: Saving Throws

### 4.1 Saving Throw Mechanics

**Flow:**
1. Effect triggers save (monster ability, spell, trap)
2. Determine save type (STR/DEX/CON/INT/WIS/CHA) and DC
3. Roll d20 + save modifier
4. Compare to DC
5. Apply success or failure effect

**Character sheet integration:**
- Pull save modifiers from D&D Beyond data
- Account for proficiency in saves (class features)

### 4.2 Monster Save DCs

Add to monster definitions:
```javascript
monster.abilities = [
  {
    name: 'Poison Bite',
    damage: '1d6',
    save: {
      type: 'CON',
      dc: 12,
      onFail: { condition: 'poisoned', duration: 3 },
      onSuccess: 'half_damage' // or 'no_effect'
    }
  }
]
```

### 4.3 Player-Forced Saves

For spells/abilities that force monster saves (e.g., Stunning Strike, Vicious Mockery):
- Add `monster.savingThrows` to monster definitions
- Calculate save modifier from monster CR or explicit values

---

## Phase 5: Conditions & Status Effects

> **Note:** Build conditions iteratively as spells/abilities require them.

### 5.1 Condition System Framework

**Data structure:**
```javascript
participant.conditions = [
  { 
    id: 'poisoned', 
    duration: 3,
    durationType: 'rounds',
    source: 'Giant Spider',
    sourceId: 'monster'
  }
]
```

**Core functions:**
- `addCondition(participantId, condition)`
- `removeCondition(participantId, conditionId)`
- `hasCondition(participantId, conditionId)`
- `tickConditions(participantId)` - called at end of turn
- `getAttackModifiers(participantId)` - returns advantage/disadvantage based on conditions

### 5.2 Conditions (Add as Needed)

Build these as abilities/spells require them:

| Condition | Attack Rolls | Attacked By | Trigger |
|-----------|--------------|-------------|---------|
| **Stunned** | Can't attack | Advantage | Nalyd's Stunning Strike |
| **Frightened** | Disadvantage | — | Acacia's abilities |
| **Burning** | — | — | Nalyd's Ignition hits |
| **Poisoned** | Disadvantage | — | Monster abilities |

### 5.3 Condition UI

- Status icons displayed on player/monster portraits
- Tooltip on hover showing condition name, description, duration
- Visual indicator when condition expires

### 4.1 Spell Slot Tracking

**Data:**
```javascript
participant.spellSlots = {
  1: { max: 4, used: 1 },
  2: { max: 3, used: 0 },
  // ...
}
```

**Integration:**
- Pull max slots from character sheet
- Track usage per encounter (reset on new encounter)
- UI shows slot availability

### 4.2 Cantrips

- No slot cost, unlimited use
- Scale damage with character level
- Add to action menu based on class

### 4.3 Leveled Spells

**Casting flow:**
1. Select "Cast Spell" action
2. Show available spells (from character sheet)
3. Select spell
4. Select slot level (if applicable)
5. Select targets (if applicable)
6. Roll attack or force save
7. Apply effects

### 4.4 Concentration

- Track `participant.concentrating = { spellId, spellName }`
- Taking damage triggers CON save (DC = 10 or half damage taken, whichever higher)
- Fail = concentration broken, spell ends
- Casting new concentration spell ends previous one

---

## Implementation Priority

**Philosophy:** Build abilities/spells first that trigger conditions, then implement conditions one-by-one as needed. Don't build a full condition system with no way to test it.

### Recommended Order

| Step | Feature | Why |
|------|---------|-----|
| 1 | Advantage/Disadvantage | Foundation for many mechanics |
| 2 | Death Saving Throws | Core 5e survival mechanic |
| 3 | Potion System | Heal downed players, buy from shop |
| 4 | Bonus Action System | Needed for spells/abilities |
| 5 | Dodge Action | Tests advantage system |
| 6 | Spell Slot Tracking | Foundation for casters |
| 7 | Ki Points (Nalyd) | Monk resource system |
| 8 | First Class Ability (e.g., Flurry of Blows) | Test ability system |
| 9 | First Spell (e.g., Healing Word) | Test spell system |
| 10 | Saving Throw Framework | Needed for Stunning Strike, etc. |
| 11 | Stunning Strike (Nalyd) | First ability that adds a condition |
| 12 | Stunned Condition | Built because Stunning Strike needs it |
| 13 | Homebrew: Ignition Form | Nalyd's transformation |
| 14 | Continue iteratively... | Each ability adds what it needs |

### Condition-First vs Ability-First

❌ **Old approach (condition-first):**
1. Build full condition framework
2. Implement 10 conditions
3. Build UI for all conditions
4. Then build abilities that use them
5. Find bugs with no way to trigger them

✅ **New approach (ability-first):**
1. Pick an ability (e.g., Nalyd's Ignition)
2. Build the ability
3. If it needs a condition (e.g., "burning"), build just that condition
4. Test thoroughly with that ability
5. Move to next ability, add conditions as needed
6. Condition system grows organically with real test cases

---

## File Structure (New Files)

```
server/
  lib/
    conditions.js      # Condition definitions and helpers
    savingThrows.js    # Save calculation and resolution
    spells.js          # Spell casting logic
    homebrew.js        # Custom ability handlers

client/
  src/
    components/
      ConditionIcons.jsx     # Status effect icons
      DeathSaveTracker.jsx   # Death save UI
      SpellSelector.jsx      # Spell casting modal
      TransformOverlay.jsx   # Transformation effects
```

---

## Notes

- **No Movement:** This plan intentionally excludes movement/distance mechanics. All combatants are assumed to be in melee range.
- **D&D Beyond Integration:** Character data (stats, spells, equipment) pulled from existing character sheet sync.
- **Incremental Rollout:** Each phase can be deployed independently without breaking existing functionality.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-16 | Initial plan created |

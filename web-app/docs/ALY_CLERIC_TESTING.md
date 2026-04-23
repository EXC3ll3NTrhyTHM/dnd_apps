# Aly's Cleric Abilities — Testing Checklist

Aly is a **Level 3 Life Domain Cleric** (WIS 14, spell DC 12, spell attack +4, 4 first-level slots, 2 second-level slots).

---

## Batch 1: Cantrips + Cure Wounds + Disciple of Life

### Sacred Flame (Cantrip)
- [x] Appears in Aly's spell list (action spells)
- [x] No spell slot consumed
- [x] Monster makes a **DEX save** vs DC 12
- [x] On failed save: **1d8 radiant** damage
- [x] On successful save: no damage
- [x] Dice overlay shows the d8 roll

> **Note:** Aly's D&D Beyond cantrips are Sacred Flame, Guidance, and Thaumaturgy. Toll the Dead was removed (not on her sheet).

### Cure Wounds (Level 1, Action)
- [x] Appears in Aly's spell list as an action heal
- [x] Shows ally target selection (like Healing Word)
- [x] Consumes a **level 1 spell slot**
- [x] Heals **1d8 + WIS mod (2) + Disciple of Life (3) = 1d8 + 5**
   - The additional +3 isnt shown in the final calculation and its hard to tell that is even made but it is made
- [x] Narration mentions Disciple of Life bonus
- [x] Cannot cast if no level 1+ slots remain

### Disciple of Life (Passive)
This bonus applies automatically to ALL leveled healing spells:
- [x] **Cure Wounds**: +3 healing (2 + spell level 1)
- [x] Bonus shows in the heal overlay total
   - It is not shown in the heal overlay
- [x] Bonus mentioned in combat narration
- [x] Does NOT apply to potions or non-spell healing

### Healing Word
Not apart of Aly's spells anymore but seems to have broken for Acacia now
- [x] Cure Wounds should apply and the turn transition back to her main attacks since it is a bonus action


**Things to watch for:**
- Disciple of Life should stack with the WIS mod, not replace it

---

## Batch 2: Guiding Bolt + Channel Divinity: Preserve Life

### Guiding Bolt (Level 1, Action)
- [x] Appears in Aly's spell list
- [x] Consumes a **level 1 spell slot**
- [x] Rolls **d20 + 4** (spell attack) vs monster AC
- [x] On hit: **4d6 radiant** damage
- [x] On crit (nat 20): **8d6 radiant** damage
- [x] On miss: no damage
- [x] On hit: monster gets **guidingBoltAdvantage** flag
- [x] Next player attack against that monster rolls **2d20 (advantage)**
- [x] Advantage is consumed after one attack (flag clears)
- [x] Advantage works for ANY player, not just Aly

**Things to watch for:**
- The advantage flag should persist across turns until consumed
- If the monster dies before the advantage is used, no issue (flag dies with it)
- Make sure the advantage indicator is visible on the monster somehow

### Channel Divinity: Preserve Life (Action)
- [x] "Preserve Life" button appears in Aly's abilities area
- [x] Only available if Channel Divinity is not yet used
- [x] Opens allocation modal showing **damaged allies only**
- [x] Shows a pool of **15 HP** (cleric level 3 x 5)
- [x] Each ally capped at healing up to **half their max HP** (not above)
- [x] +/- stepper buttons work correctly
- [x] Pool counter updates as you allocate
- [x] Cannot allocate more than the pool total
- [ ] Submit applies healing to all selected allies
- [x] Channel Divinity marked as used after submission
- [x] Channel Divinity resets on next encounter (or long rest)

**Things to watch for:**
- The half-max-HP cap: if an ally has 30 max HP and 20 current HP, max heal is `floor(30/2) - 20 = -5` → should show 0 (no healing needed, they're above half)
- If an ally has 30 max HP and 10 current HP, max heal is `floor(30/2) - 10 = 5`
- Empty allocation (0 to everyone) should be rejected or no-op
- Preserve Life does NOT get Disciple of Life bonus (it's not a spell)

---

## Batch 3: Spiritual Weapon

### Spiritual Weapon (Level 2, Bonus Action to Cast)
- [ ] Appears as a **bonus action** option (not in action spells)
- [ ] Only available if Aly has a **level 2 spell slot**
- [ ] Consumes a level 2 slot on cast
- [ ] **Immediate attack on cast**: d20 + 4 vs AC, **1d8 + WIS mod (2)** force damage
- [ ] Sets `spiritualWeaponActive = true`
- [ ] Active indicator/badge appears on Aly's player info

### Spiritual Weapon Attack (Subsequent Turns)
- [ ] While active, "Spiritual Weapon Attack" appears as a bonus action
- [ ] Does NOT consume a spell slot (already cast)
- [ ] Same attack: d20 + 4 vs AC, 1d8 + 2 force damage
- [ ] Available both as pre-bonus (before action) and post-bonus (after action)
- [ ] Lasts up to **10 rounds** then expires automatically
- [ ] Duration ticks down each turn advance

**Things to watch for:**
- Spiritual Weapon should NOT appear as a castable spell in the action phase — it's bonus action only
- The "cast" version (first use) and "attack" version (subsequent) should be separate bonus action buttons
- Cannot cast a second Spiritual Weapon while one is active
- If Aly is knocked unconscious, Spiritual Weapon should probably remain (it's not concentration)
- Verify the turn counter decrements correctly and the weapon despawns at 0

---

## Batch 4: Bless

### Bless (Level 1, Action, Concentration)
- [ ] Appears in Aly's spell list as an action
- [ ] Consumes a **level 1 spell slot**
- [ ] Opens **multi-target selection modal** (up to 3 allies)
- [ ] Can select Aly herself as a target
- [ ] Adds `blessed` condition to all selected targets
- [ ] Condition icon shows on blessed participants

### Bless in Combat (d4 Bonus)
- [ ] Blessed players auto-roll a **d4** on attack rolls
- [ ] d4 bonus added to the attack total (shown in breakdown)
- [ ] "+X Bless" appears in the attack roll display
- [ ] Bless d4 is sent to server as `blessRoll`
- [ ] Bless works for off hand attack or any secondary attack

### Bless Concentration
- [ ] Bless is a **concentration** spell
- [ ] If Aly takes damage, she must make a **CON save** (DC = max of 10 or half damage)
- [ ] Failed save: Bless drops from ALL blessed targets
- [ ] If Aly casts another concentration spell (e.g., a future spell), Bless ends
- [ ] If Aly is knocked to 0 HP, Bless automatically ends
- [ ] `blessed` condition removed from all targets on concentration break

**Things to watch for:**
- Bless is the first multi-target concentration spell — previous ones (Hunter's Mark, Ensnaring Strike) were single-target. Verify ALL targets lose the condition when concentration breaks.
- Make sure the Bless d4 doesn't apply to monsters or non-blessed players
- Bless should NOT affect damage rolls, only attack rolls (and saving throws, but that may not be implemented yet)
- If a blessed player dies/is KO'd, their condition just goes away naturally

---

## Cross-Cutting Concerns

### Spell Slot Management
- [ ] Cantrips (Sacred Flame) never consume slots
- [ ] Level 1 spells consume level 1 slots (4 available)
- [ ] Level 2 spells consume level 2 slots (2 available)
- [ ] Spell slot pips update correctly in the resource bar
- [ ] Spells gray out / become unavailable when slots run out

### Turn Economy
- [ ] **Action spells** (Sacred Flame, Cure Wounds, Guiding Bolt, Bless): use the action
- [ ] **Bonus action** (Spiritual Weapon): uses the bonus action, not the main action
- [ ] Aly can cast an action spell AND use Spiritual Weapon in the same turn
- [ ] Aly can use Spiritual Weapon as a pre-bonus then take her main action

### Interactions Between Abilities
- [ ] Bless + Guiding Bolt advantage: a blessed player attacking a Guiding Bolt target gets BOTH advantage (2d20) AND +d4
- [ ] Spiritual Weapon attack does NOT benefit from Bless (it's a spell effect, not an attack roll by the player... actually it IS a spell attack, so this might need clarification)
- [ ] Cure Wounds + Disciple of Life stacks correctly
- [ ] Healing Word + Disciple of Life stacks correctly

### Edge Cases
- [ ] Aly joins mid-combat: abilities initialize correctly
- [ ] Aly rejoins after disconnect: state preserved (spiritual weapon, bless, etc.)
- [ ] Multiple clerics (future): each has independent Channel Divinity, spell slots
- [ ] Monster kills Aly while concentrating on Bless: all targets lose blessed
- [ ] Guiding Bolt advantage persists if the attacking player's turn is skipped/timed out

---

## Known Risks / Potential Issues

1. **Preserve Life half-HP cap math**: The formula `floor(maxHp/2) - currentHp` can go negative. The modal should clamp to 0 minimum per target.

2. **Bless concentration multi-target cleanup**: This is new territory — all previous concentration spells were single-target. The `breakConcentration()` helper was written to handle `conc.targetIds` arrays, but test it under:
   - CON save failure
   - Casting a new concentration spell
   - Being knocked to 0 HP
   - Each path should remove `blessed` from all 3 targets

3. **Spiritual Weapon duration**: Should tick on turn advance, not on round advance. Verify it counts down by 1 each time `advanceTurn()` passes Aly's turn specifically (not every turn advance).

4. **Guiding Bolt advantage consumption**: Should be consumed by the NEXT attack against the monster, regardless of who attacks. Verify it doesn't persist for multiple attacks.

5. **Route field passthrough**: `blessRoll`, `allocations`, `targetIds` were recently added to the route handlers. If any of these fail silently, the server will use fallback values (or error). Watch the server console for errors on these actions.

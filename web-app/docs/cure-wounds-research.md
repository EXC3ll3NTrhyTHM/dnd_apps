# Cure Wounds Implementation Research

## Goal
Add Cure Wounds to Tyren's spell list in the Arena combat system.

## D&D Rules - Cure Wounds
- 1st-level evocation spell
- **Action type: Main action** (NOT bonus action like Healing Word)
- Range: Touch (target an ally)
- Healing: **2d8 + spellcasting modifier** (confirmed from Tyren's D&D Beyond export)
- Tyren is a **Ranger** (uses WIS modifier for spellcasting)
- Tyren's player ID: `1374906408046166036`

## Key Difference from Healing Word
| | Healing Word | Cure Wounds |
|---|---|---|
| Action | Bonus action | **Main action** |
| Dice | 1d4 | **2d8** |
| Range | 60ft | Touch |
| Trade-off | Less healing, keeps your action | More healing, uses your action |

## Existing Spell System Architecture

### SPELL_DEFINITIONS (`server/lib/encounters.js` line 22-77)
Data-driven spell registry. Each spell has: `name`, `level`, `actionType` ('action' or 'bonus'), `effectType`, `classes`, `healDice`/`damageDice`, etc.

Current spells:
- `vicious_mockery` — cantrip, action, save_damage (Bard)
- `healing_word` — level 1, **bonus**, heal (Bard, Cleric)
- `thunderwave` — level 1, action, save_damage (Bard)
- `ensnaring_strike` — level 1, bonus, buff (Paladin, Ranger)
- `hunters_mark` — level 1, bonus, buff (Ranger)

### Heal Spell Flow (server)
1. `resolveCastSpell()` (line ~2967) — dispatches by `effectType`
2. For `effectType: 'heal'` → calls `resolveHealSpell()` (line ~2756)
3. `resolveHealSpell()` rolls `spell.healDice`, adds `player.spellcastingMod`, applies HP to target
4. Already handles KO'd targets (revive with healing)

### Bonus Action Spells (server)
- `getAvailableBonusActions()` (line ~3032) checks class, spell slots, builds target lists
- Healing Word specifically listed here with target picker (non-KO'd allies)
- Submitted via `/api/encounters/:id/bonus-action` or `/api/encounters/:id/pre-bonus-action`

### Main Action Spells (server)
- `GET /api/encounters/:id/spells` (route, line ~554) returns available main-action spells
- Filters `SPELL_DEFINITIONS` by `actionType === 'action'` and player class
- Submitted via main action endpoint with `action: 'cast_spell'` and `spellId`

### Client - Healing Word Flow (`client/src/pages/Arena.jsx`)
- `handleHealingWord()` (line ~2695):
  1. Opens target modal to pick ally
  2. Rolls `1d4` + spellMod via `requestServerRoll()` with green color (#4ade80)
  3. Shows heal overlay with dice breakdown, healer/target info, revive detection
  4. Plays sound effects (healShimmer, or revive+crowdCheer if target was KO'd)
  5. Submits to bonus-action endpoint
- Target modal UI at line ~4266: "Healing Word — Choose Target" with player list
- Bonus action button at line ~3632: sparkle emoji + "Healing Word"

### Client - Main Action Spell Flow
- Arena has a spell menu for main-action spells (fetched from `/api/encounters/:id/spells`)
- `cast_spell` action type with `spellId` in the body
- **NEEDS INVESTIGATION**: How exactly the cast_spell UI works for action spells (target selection, dice rolling, overlay display) — this is likely similar to Healing Word but submitted as main action

## Implementation Plan (Draft)

### 1. Add to SPELL_DEFINITIONS
```js
cure_wounds: {
  name: 'Cure Wounds',
  level: 1,
  actionType: 'action',  // Main action, NOT bonus
  effectType: 'heal',
  healDice: '2d8',
  range: 'ally',
  description: 'A creature you touch regains hit points',
  classes: ['Ranger', 'Bard', 'Cleric', 'Druid', 'Paladin'],
},
```

### 2. Server Changes (`server/lib/encounters.js`)
- The `resolveCastSpell()` dispatcher already handles `effectType: 'heal'` → `resolveHealSpell()`
- `resolveHealSpell()` already works generically (uses `spell.healDice` + `spellcastingMod`)
- The `/spells` GET endpoint already filters by `actionType === 'action'` and class
- **Should mostly work out of the box** — the spell definition + existing heal resolver should handle it

### 3. Client Changes (`client/src/pages/Arena.jsx`)
- **NEEDS INVESTIGATION**: How does the existing cast_spell UI handle target selection for heal spells?
- May need a target picker similar to Healing Word's modal
- Dice roll overlay should show 2d8 + modifier with green healing colors
- Sound effects: healShimmer / revive+crowdCheer (same as Healing Word)

### 4. State broadcast
- `getEncounterState()` line ~2639 has `hasHealingWord` flag — may need similar `hasCureWounds` or make it generic
- Or it might just work via the `/spells` endpoint which already returns available action spells

## Files to Modify
- `server/lib/encounters.js` — Add spell definition, possibly tweak heal resolver
- `client/src/pages/Arena.jsx` — Add target selection UI for heal-type action spells
- `client/src/styles/arena.css` — Maybe minor styling for cure wounds button

## Still Needs Investigation
- How `cast_spell` action works end-to-end in the client (the action spell menu UI, target selection for heals vs damage)
- Whether `resolveHealSpell` needs any changes for 2d8 vs 1d4
- Whether any additional state flags are needed beyond what `/spells` endpoint provides

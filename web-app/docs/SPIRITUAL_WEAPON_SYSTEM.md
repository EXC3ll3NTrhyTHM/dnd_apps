# Spiritual Weapon System (BG3-Style Summon)

## Overview

Spiritual Weapon is a Cleric spell that summons a spectral weapon as a separate combat entity with its own HP, AC, initiative turn, and targetable by monsters. This is modeled after Baldur's Gate 3's implementation rather than standard 5e (where it's just a bonus action attack).

## Stats

| Stat | Value |
|------|-------|
| HP | 20 |
| AC | 10 |
| Attack | Caster's `spellAttackBonus` |
| Damage | `1d8 + spellcastingMod` force |
| Duration | 10 rounds (unless destroyed) |
| Cast | Bonus action, consumes level 2 spell slot |

## Cast Mechanics

1. Cleric uses bonus action to cast (pre-action or post-action)
2. Consumes a level 2+ spell slot
3. Player rolls 3D initiative dice (d20) for the weapon
4. Weapon is inserted into the initiative order at the rolled position
5. **No attack on cast** -- the weapon first attacks when its initiative turn arrives
6. A summon entity is created in `encounter.summons[]`

## Turn Mechanics

1. When the weapon's initiative turn comes, the owning player sees an "Attack with Spiritual Weapon" button
2. Player rolls 3D attack dice (d20 + spellAttackBonus vs monster AC)
3. On hit, player rolls 3D damage dice (1d8 + spellcastingMod force damage)
4. Crits double the damage dice (extra 1d8)
5. Turn automatically advances after the attack resolves
6. If the player doesn't act, the turn times out and the server auto-resolves

## Monster Targeting

- Active summons are added to the monster's target pool alongside players
- Summons have a base aggro weight of 1 (same as a player with 0 damage dealt)
- Weighted random targeting: players who deal more damage are more likely targets
- When a summon is hit, damage is applied to its HP (no death saves, no rage resistance)

## Destruction

The spiritual weapon is removed from combat when:
- **HP reaches 0**: Monster attacks destroy it. "Shatters into fragments of light!"
- **Owner knocked out**: Weapon dissipates automatically
- **Owner flees**: Weapon dissipates automatically
- **Duration expires**: After 10 rounds, removed at the start of its turn

## Buff Interactions (Currently Implemented)

| Buff | Effect on Spiritual Weapon |
|------|---------------------------|
| **Guiding Bolt** | If `monster.guidingBoltAdvantage` is true, the SW attacks with advantage (consumes the flag) |
| **Bless** | If the owning player has the `blessed` condition, the SW gets +1d4 to its attack roll |
| **Prone** | If the monster has the `prone` condition, the SW (melee attack) gets advantage |

Advantage + disadvantage cancel per 5e rules.

## BG3 Buff Reference (Future Implementation)

When adding new spells, consult this list for which should interact with the Spiritual Weapon:

### Should Apply (when implemented)
- **Aid**: Increases max HP -- could apply to SW if we add Aid support
- **Heroes' Feast**: Stat buffs -- SW uses caster's stats, so indirectly applies
- **Hold Person/Monster**: Paralyzed = auto-crit on hit, advantage on attack
- **Faerie Fire**: Advantage on attack rolls against outlined targets
- **Hex**: Extra 1d6 necrotic on hit (if caster has Hex active)
- **Shield of Faith**: +2 AC to target -- could apply to SW

### Should NOT Apply
- **Healing spells**: SW has HP but can't be healed in BG3
- **Weapon coatings/poisons**: Not a physical weapon
- **Haste**: Extra action -- SW only has one action anyway
- **Crusader's Mantle**: +1d4 radiant to weapon attacks -- doesn't apply to spell attacks
- **Aura of Vitality**: Healing -- SW can't be healed

## Data Model

### Server (`encounter.summons[]`)
```js
{
  id: 'sw_' + userId,        // Unique ID
  ownerId: userId,            // Owning player's user ID
  ownerName: player.name,     // Display name
  name: "Player's Spiritual Weapon",
  summonType: 'spiritual_weapon',
  hp: 20, maxHp: 20, ac: 10,
  damageDice: '1d8',
  damageType: 'force',
  attackBonus: player.spellAttackBonus,
  spellcastingMod: player.spellcastingMod,
  turnsLeft: 10,
}
```

### Initiative Order Entry
```js
{
  id: 'sw_' + userId,
  name: "Player's Spiritual Weapon",
  type: 'summon',
  ownerId: userId,
  summonType: 'spiritual_weapon',
  roll: initiativeRoll,
  modifier: 0,
  total: initiativeRoll,
}
```

## API Endpoints

### `POST /api/encounters/:id/summon-action`
Submit attack action for a summon on its own turn.

**Body:**
```json
{
  "summonId": "sw_userId",
  "attackRoll": 15,
  "attackRoll2": null,
  "damageTotal": 12,
  "blessRoll": null
}
```

## WebSocket Events

| Event | Description |
|-------|-------------|
| `encounter_summon_result` | Broadcast after a summon attacks |
| `encounter_summon_expired` | Broadcast when a summon's duration runs out |
| `encounter_turn_start` | Sent with `currentTurn.type === 'summon'` when it's a summon's turn |

## Key Files

- `server/lib/encounters.js` -- `resolveSummonAction()`, `destroySummon()`, summon handling in `advanceTurn()`, `prepareMonsterAttacks()`, `resolveMonsterWithRolls()`
- `server/routes/encounters.js` -- `/summon-action` route, `handleTurnAdvance()` summon cases
- `client/src/pages/Arena.jsx` -- `handleSummonAttack()`, `handleSpiritualWeaponCast()`, summon turn UI
- `client/src/styles/arena.css` -- `.arena-init-entry-summon`, `.arena-btn-summon-attack`, `.arena-info-row-summon`

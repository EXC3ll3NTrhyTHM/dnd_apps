# Consumable Items - Future Ideas

Reference for D&D consumables to add to the shop catalog. Organized by priority based on what fits the app's arena combat + social tavern loop.

---

## Tier 1 — High Priority (Combat Staples)

These are the bread-and-butter items players will always want. Easy to implement with existing systems.

| Item | Effect | Est. Price | Notes |
|------|--------|-----------|-------|
| Healing Potion | Restore 2d4+2 HP | 50g | Already exists as arena potion — could add shop version for stockpiling |
| Greater Healing Potion | Restore 4d4+4 HP | 150g | Good gold sink for higher-level players |
| Superior Healing Potion | Restore 8d4+8 HP | 500g | Rare/expensive, big reward feel |
| Antitoxin | Advantage on saves vs poison for 1 hour | 50g | Could grant a buff status in arena |
| Alchemist's Fire | 1d4 fire damage (throwable) | 50g | Bonus action item in arena — deals flat damage to monster |
| Holy Water | 2d6 radiant vs undead/fiends | 25g | Extra effective against undead monsters (skeleton, etc.) |

## Tier 2 — Medium Priority (Tactical/Fun)

Add depth to combat and social play. May need new mechanics or UI.

| Item | Effect | Est. Price | Notes |
|------|--------|-----------|-------|
| Potion of Speed | Haste — extra action for 1 round | 400g | Powerful, needs balancing. Could grant one extra attack action in arena |
| Oil Flask | Splash on monster, next fire attack does bonus damage | 10g | Fun combo play between party members |
| Acid Vial | 2d6 acid damage (throwable) | 25g | Similar to Alchemist's Fire, different damage type |
| Smoke Bomb | Skip monster's next attack (obscure) | 75g | Defensive tactical option |
| Potion of Resistance | Resistance to one damage type for combat | 200g | Halve damage from matching monster attacks |
| Basic Poison | Coat weapon, +1d4 poison on next hit | 100g | Apply before a fight or as bonus action |

## Tier 3 — Lower Priority (Flavor/Social)

Fun items that add personality. Some already fit the consumable/effects system (like Halfling's Leaf).

| Item | Effect | Est. Price | Notes |
|------|--------|-----------|-------|
| Potion of Invisibility | Cosmetic effect + chat flavor text | 300g | Could hide player sprite briefly on scene |
| Potion of Giant Strength | Temporary STR boost for one encounter | 500g | +2 to attack rolls for one fight |
| Potion of Fire Breathing | Breath attack (3d6 cone) | 200g | Could be a one-time special attack in arena |
| Goodberries | Restore 1 HP x10 (out of combat healing) | 30g | Small heal, good for RP |
| Elixir of Courage | Remove fear/disadvantage effects | 75g | If fear mechanics are ever added |
| Tanglefoot Bag | Reduce monster's next attack bonus | 60g | Debuff item |
| Caltrops | Damage on monster movement phase | 10g | Passive trap flavor |

---

## Implementation Notes

### What already works
- **Simple consumables** (use_message + chat broadcast + visual effect) — see Halfling's Leaf smoke effect pattern
- **Arena potions** — healing potions already work mid-combat as bonus actions
- **Shop catalog format** — just add entries to `economy/shop_catalog.json`

### What would need new mechanics
- **Throwable damage items** (Alchemist's Fire, Acid, Holy Water) — need a "use item to deal X damage to monster" action in arena, probably as a bonus action
- **Buff/debuff items** (Antitoxin, Poison, Potion of Resistance) — need a temporary status effect system on players/monsters
- **Combo items** (Oil Flask) — need to track "oiled" status on monster, modify next fire damage
- **Pre-combat items** (Poison coating) — need a "preparation" phase or inventory use before joining encounter

### Suggested rollout order
1. **More healing potion tiers** — trivial, just add to shop + arena potion list
2. **Throwable damage items** — one new arena bonus action type ("use item → deal damage")
3. **Buff potions** (Speed, Resistance, Giant Strength) — temporary combat modifiers
4. **Debuff/utility items** — monster status effects
5. **Social/flavor items** — more smoke-style visual effects

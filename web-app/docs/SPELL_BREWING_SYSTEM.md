# Spell Brewing System

## Core Mechanics

### How It Works
1. **Learn recipes** - Find recipe scrolls, complete quests, buy from rotating shop stock
2. **Gather reagents** - Dungeon drops, fishing, garden, shop, monster loot
3. **Brew at cauldron** - Combine reagents → create consumable
4. **Use in combat/dungeon** - One-time use, instant effect

### The Cauldron
- Unlockable station in town (quest reward or gold purchase)
- Shows known recipes
- Drag reagents to brew
- Some recipes require cauldron upgrades (copper → iron → arcane)

---

## Reagent Types

### Elemental Essences (Dungeon drops)
| Reagent | Source | Used For |
|---------|--------|----------|
| Fire Essence | Fire enemies, Ember Mines | Damage spells, ATK buffs |
| Frost Essence | Ice enemies, frozen chests | Slow effects, DEF buffs |
| Shadow Essence | Undead, Void dungeon | Debuffs, curses |
| Storm Essence | Flying enemies, rare | AoE, speed buffs |
| Earth Essence | Golems, cave enemies | Defense, healing |

### Organic Materials (Fishing, Garden, Foraging)
| Reagent | Source | Used For |
|---------|--------|----------|
| Herbal Bundle | Garden, shop | Healing, cures |
| Moonpetal | Garden (night harvest) | Buffs, rare brews |
| Glowcap Mushroom | Fungal Hollow dungeon | Poison, vision |
| Pure Water | Fishing (rare), shop | Base for most potions |
| Venom Sac | Spider enemies, fishing (eel) | Poisons, debuffs |

### Monster Parts (Combat drops)
| Reagent | Source | Used For |
|---------|--------|----------|
| Monster Bone | Common drop | Base crafting material |
| Troll Blood | Troll enemies | Regeneration effects |
| Wraith Dust | Wraith enemies | Evasion, phase effects |
| Slime Core | Slime enemies | Resistance potions |
| Dragon Scale | Boss drop (rare) | Legendary brews |

### Arcane Components (Shop, rare drops)
| Reagent | Source | Used For |
|---------|--------|----------|
| Arcane Dust | Shop, disenchanting | Enchanting, spell amplification |
| Runic Shard | Puzzle rooms, shrines | Permanent buff potions |
| Void Fragment | Void dungeon only | Powerful curses/buffs |
| Crystal Vial | Shop, treasure rooms | Required for all potions |

---

## Recipe List

### Healing & Restoration
| Recipe | Reagents | Effect | Unlock |
|--------|----------|--------|--------|
| Health Potion | Herbal Bundle + Pure Water + Crystal Vial | Restore 25 HP | Starter |
| Greater Health Potion | 2x Herbal Bundle + Moonpetal + Crystal Vial | Restore 60 HP | Floor 3 |
| Regeneration Elixir | Troll Blood + Herbal Bundle + Crystal Vial | Heal 10 HP/turn for 3 turns | Quest |
| Antidote | Herbal Bundle + Slime Core + Crystal Vial | Cure poison | Starter |
| Panacea | Moonpetal + Troll Blood + Pure Water + Crystal Vial | Cure all conditions | Floor 7 |

### Damage Spells
| Recipe | Reagents | Effect | Unlock |
|--------|----------|--------|--------|
| Firebomb | Fire Essence + Arcane Dust + Crystal Vial | 40 fire damage | Floor 2 |
| Inferno Flask | 2x Fire Essence + Dragon Scale + Crystal Vial | 80 fire damage, AoE | Boss drop |
| Frost Spike | Frost Essence + Pure Water + Crystal Vial | 30 ice damage + slow | Floor 3 |
| Lightning Bolt | Storm Essence + Arcane Dust + Crystal Vial | 50 damage, hits first | Floor 5 |
| Void Burst | Void Fragment + Shadow Essence + Crystal Vial | 60 damage, ignores DEF | Void dungeon |

### Buffs (Self)
| Recipe | Reagents | Effect | Unlock |
|--------|----------|--------|--------|
| Strength Elixir | Fire Essence + Monster Bone + Crystal Vial | +20% ATK for 3 turns | Starter |
| Iron Skin Draught | Earth Essence + Slime Core + Crystal Vial | +20% DEF for 3 turns | Starter |
| Swiftness Potion | Storm Essence + Wraith Dust + Crystal Vial | Act first for 3 turns | Floor 4 |
| Stone Form | 2x Earth Essence + Runic Shard + Crystal Vial | +50% DEF, can't move, 2 turns | Quest |
| Invisibility Draught | Wraith Dust + Shadow Essence + Moonpetal + Crystal Vial | Enemies can't target you, 1 turn | Floor 8 |
| Berserker Brew | 2x Fire Essence + Troll Blood + Crystal Vial | +40% ATK, -20% DEF, 3 turns | Quest |

### Debuffs (Enemy)
| Recipe | Reagents | Effect | Unlock |
|--------|----------|--------|--------|
| Weakness Venom | Venom Sac + Shadow Essence + Crystal Vial | Enemy -20% ATK for 3 turns | Floor 2 |
| Armor Corrosion | Venom Sac + Slime Core + Crystal Vial | Enemy -20% DEF for 3 turns | Floor 2 |
| Mind Fog | Glowcap Mushroom + Shadow Essence + Crystal Vial | Enemy -50% accuracy, 2 turns | Floor 4 |
| Curse of Frailty | Void Fragment + Venom Sac + Crystal Vial | Enemy takes +25% damage, 3 turns | Floor 6 |
| Paralysis Poison | 2x Venom Sac + Storm Essence + Crystal Vial | Stun enemy 1 turn | Floor 5 |

### Utility
| Recipe | Reagents | Effect | Unlock |
|--------|----------|--------|--------|
| Escape Smoke | Shadow Essence + Arcane Dust + Crystal Vial | Flee dungeon, keep 50% loot | Starter |
| Revealing Mist | Glowcap Mushroom + Pure Water + Crystal Vial | Shows all rooms on floor | Floor 3 |
| Lucky Draught | Moonpetal + Arcane Dust + Crystal Vial | +15% crit chance, 3 turns | Quest |
| Treasure Nose | Glowcap Mushroom + Monster Bone + Crystal Vial | Highlights loot on floor | Floor 4 |
| Phase Oil | Wraith Dust + Void Fragment + Crystal Vial | Walk through one wall/trap | Floor 7 |

---

## Brewing Progression

### Cauldron Tiers
| Tier | Cost | Unlocks |
|------|------|---------|
| Copper Cauldron | 200g (starter) | Basic recipes, 1 brew slot |
| Iron Cauldron | 800g | Intermediate recipes, 2 brew slots |
| Arcane Cauldron | 2000g | Advanced recipes, 3 brew slots, can brew legendaries |

### Brew Slots
- Brewing takes real time (or dungeon runs)
- Basic: 10 min / 1 dungeon floor
- Intermediate: 30 min / 3 floors
- Advanced: 1 hour / 5 floors
- Multiple slots = parallel brewing

### Recipe Sources
- **Starter recipes** - Everyone begins with Health Potion, Antidote, Strength Elixir, Iron Skin
- **Floor unlocks** - Beat floor X to unlock that tier's recipes
- **Quest rewards** - NPCs teach special recipes
- **Dungeon drops** - Rare recipe scrolls in treasure rooms
- **Shop rotating** - One recipe scroll per week, expensive

---

## Integration Points

| System | Connection |
|--------|------------|
| **Fishing** | Catch Pure Water, Venom Sac (eel), rare reagents |
| **Garden** | Grow Herbal Bundle, Moonpetal, Glowcap |
| **Dungeon** | Drop essences, monster parts, recipe scrolls |
| **Arena** | Practice without wasting potions, earn gold for reagents |
| **Shop** | Buy Crystal Vials, Arcane Dust, missing reagents |
| **Quests** | Learn unique recipes, unlock cauldron upgrades |
| **NPCs** | Alchemist NPC sells recipes, gives brewing quests |

---

## UI Concept

```
┌─────────────────────────────────────────────────────┐
│  🧪 CAULDRON - Iron Tier                            │
├─────────────────────────────────────────────────────┤
│                                                     │
│  RECIPES          │  BREWING                        │
│  ───────          │  ────────                       │
│  [Health Potion]  │  Slot 1: [Firebomb] ████░ 80%  │
│  [Firebomb]       │  Slot 2: [Empty]               │
│  [Weakness Venom] │                                 │
│  [Strength Elixir]│  YOUR REAGENTS                  │
│  [+ 12 more]      │  ──────────────                 │
│                   │  Fire Essence x4                │
│  Filter: [All ▼]  │  Herbal Bundle x7               │
│                   │  Crystal Vial x3                │
│                   │  Arcane Dust x2                 │
│                   │                                 │
├─────────────────────────────────────────────────────┤
│  SELECTED: Firebomb                                 │
│  Requires: Fire Essence (1) + Arcane Dust (1)       │
│            + Crystal Vial (1)                       │
│  Effect: Deal 40 fire damage to enemy              │
│                          [ BREW ]  [ CANCEL ]       │
└─────────────────────────────────────────────────────┘
```

---

## Cauldron Visual Design (Three.js Implementation)

### Tech Stack
- **Three.js** (already in project)
- **three-nebula** (already in project for particles)
- No new libraries needed

### Visual Layers (Bottom to Top)
```
┌─────────────────────────────────┐
│  Steam particles (three-nebula) │  ← rises from surface
├─────────────────────────────────┤
│  Bubble particles               │  ← pop at surface
├─────────────────────────────────┤
│  Liquid surface (ripple shader) │  ← interactive, color shifts
├─────────────────────────────────┤
│  3D Cauldron model              │  ← loaded .glb
├─────────────────────────────────┤
│  Fire particles                 │  ← underneath
└─────────────────────────────────┘
```

### Cauldron Tier Appearances
| Tier | Appearance |
|------|------------|
| **Copper** | Small pot, weak fire, slow bubbles |
| **Iron** | Bigger cauldron, steady flames, glowing runes |
| **Arcane** | Floating cauldron, magical fire (purple/blue), particle effects, sigils orbiting |

### Interactive Liquid Surface
- **Heightmap ripple shader** - tap creates ripples that propagate
- Tap liquid → ripple spreads from touch point
- Drag finger → continuous ripples follow
- Drop ingredient → big splash + color shift
- Idle state → gentle simmer (tiny random ripples)

### Interaction States

**Idle cauldron:**
- Gentle simmer animation (small bubbles)
- Fire flickers underneath
- Liquid color: murky gray/green

**Dragging reagent over cauldron:**
- Cauldron glows (valid drop zone)
- Bubbles intensify
- "Drop to add" hint

**Dropping reagent in:**
- *PLOP* sound effect
- Splash animation + big ripple
- Reagent icon floats briefly then dissolves
- Liquid color shifts based on ingredient type:
  - Fire Essence → orange/red tint
  - Herbal Bundle → green tint
  - Shadow Essence → purple/black swirl

**Valid recipe detected:**
- Liquid changes to final potion color
- Sparkle/glow effect
- Recipe name appears: "Firebomb ready!"
- [ BREW ] button pulses

**Invalid combo:**
- Liquid turns muddy brown
- Sad bubble *blorp*
- "Unknown mixture" or "Missing: Crystal Vial"
- [ CLEAR ] button to dump it

**Brewing:**
- Vigorous bubbling
- Steam rising
- Progress bar or timer
- Fire intensifies
- Completion: *DING* + potion flies to inventory

### Asset Checklist
| Asset | Source | Notes |
|-------|--------|-------|
| Cauldron 3D model | Sketchfab (free, low poly) | .glb format |
| Liquid shader | Code (ripple heightmap) | Adapt from Three.js water examples |
| Fire particles | three-nebula config | No image needed |
| Bubble particles | three-nebula config | Small circles rising |
| Steam particles | three-nebula config | Wispy, slow, white/gray |
| Splash particles | three-nebula config | Triggered on drop |
| Reagent icons | Existing item art | 2D sprites |

### Nice-to-Have Polish
- **Recipe hints:** Drop 2/3 ingredients → show ghost icon of what's missing
- **Favorites:** Pin common recipes, one-click "add all ingredients"
- **Shake to clear:** Mobile gesture to dump the cauldron
- **Ingredient preview:** Hover reagent to see what recipes it's used in
- **Brew history:** "Last brewed: Firebomb" quick-repeat option

### Implementation References
- Three.js water/ripple examples
- Search "three.js interactive water shader codepen"
- @react-three/drei water effects (if using R3F)

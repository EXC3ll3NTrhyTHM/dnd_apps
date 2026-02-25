# Cooking System Design

A crafting system where players gather ingredients through foraging, fishing, and shopping, then combine them into dishes that can be consumed for temporary stat buffs or sold for profit. Integrates with the existing fishing, economy, combat, and location systems.

---

## Core Loop

```
Forage / Fish / Buy ingredients  →  Experiment or follow recipes  →  Eat for buffs  OR  Sell for profit
```

Players have two incentives to cook:
1. **Combat power** — food buffs give meaningful stat bonuses in arena encounters
2. **Economy** — cooked dishes sell for 2-3x their raw ingredient value

Fish are the primary protein source. Selling raw fish is always an option, but cooking them into dishes is the intended high-value path — a Mudcarp sells for 5G raw but becomes a 15G Grilled Fish with a pinch of salt.

---

## Ingredient Sources

### 1. Fishing (Already Exists)

Fish from the existing fishing system become cooking ingredients. Cooking gives them a second, more valuable use than selling raw.

| Fish | Rarity | Raw Sell | Cooking Role |
|------|--------|----------|-------------|
| Mudcarp | Common | 5G | Basic filler protein |
| Silver Trout | Common | 8G | Light, flaky dishes |
| Ironjaw | Uncommon | 15G | Hearty stews |
| Glowfin | Uncommon | 20G | Magical dishes (buff potency) |
| Shadow Eel | Rare | 40G | Dark/exotic recipes |
| Ember Bass | Rare | 50G | Fire-themed dishes |
| Voidpike | Epic | 100G | Powerful buff dishes |
| Leviathan Fry | Legendary | 250G | Legendary feast ingredient |

### 2. Foraging (New System)

A gathering activity available at nature-adjacent locations.

**Mechanics:**
- `POST /api/foraging/gather` with `locationId`
- 30-60 second cooldown per gather
- Server rolls what you find based on location + rarity weights
- Simple animation (rustling leaves, digging hands) + result toast

> **Future expansion**: Foraging could evolve into a more interactive mini-activity (tap rustling bushes, identify mushrooms, etc.) to make it feel more engaging. For Phase 2 it ships as a simple cooldown-based gather.

**Forageable Ingredients:**

| Ingredient | Rarity | Sell | Found At |
|-----------|--------|------|----------|
| Wild Garlic | Common | 2G | Cottage, Forest |
| Meadow Herbs | Common | 2G | Cottage, Forest |
| Forest Mushrooms | Common | 3G | Cottage, Forest |
| Root Vegetables | Common | 2G | Cottage, Forest |
| Wild Berries | Common | 3G | Forest |
| Honey | Uncommon | 8G | Forest |
| Firebloom Pepper | Uncommon | 10G | Forest (rare spawn) |
| Truffle | Rare | 25G | Forest (rare spawn) |
| Moonpetal | Rare | 30G | Cottage at night? |
| Starfruit | Epic | 60G | Special event / quest reward |

**Rarity Weights (per gather):**
- Common: 70% (1-2 items)
- Uncommon: 20% (1 item)
- Rare: 8% (1 item)
- Epic: 2% (1 item)

### 3. Shop Pantry (Purchasable)

Basic staples always available at the shop. New `"pantry"` category in `shop_catalog.json`. These are required by most recipes and act as a small gold sink that gates cooking behind a minimal cost.

| Ingredient | Price |
|-----------|-------|
| Salt | 2G |
| Flour | 3G |
| Butter | 3G |
| Sugar | 3G |
| Spice Blend | 5G |
| Ale (cooking) | 5G |
| Cream | 5G |
| Bread Loaf | 4G |

### 4. Monster Drops (Future / Arena Integration)

Rare ingredients dropped from arena encounters — unlocks legendary-tier recipes:
- Dragon Scale Flakes (dragon encounters)
- Troll Fat (troll encounters)
- Basilisk Eye (basilisk encounters)

---

## Recipe Discovery & Cooking

### Discovery Through Experimentation

Recipes are **not** known upfront. Players discover them by combining ingredients and seeing what comes out.

**How it works:**
1. Player enters the kitchen and goes to the **Experiment** mode
2. Selects 2-5 ingredients from their inventory onto a "cutting board" workspace
3. Hits "Cook" — server checks the combination against the recipe catalog
4. **Match** → recipe discovered, dish crafted, ingredients consumed, recipe added to Recipe Book
5. **No match** → ingredients consumed, player receives **"Charred Mystery Mush"** (sells for 1G, prevents total waste)

**Discovery persistence:**
- Discovered recipes stored per-player in `data/cooking_stats.json` → `{ discovered_recipes: ["grilled_fish", "herb_bread", ...] }`
- Once discovered, a recipe appears in the Recipe Book for one-tap repeat cooking
- Achievements tied to discovery milestones

**Hint system (optional future):**
- Big Tam could drop hints in conversation ("A good stew needs a sturdy root vegetable...")
- Recipe scroll items as quest rewards that auto-unlock a recipe
- Ingredient descriptions could hint at pairings ("Pairs well with hearty proteins")

### Recipe Structure

```json
{
  "id": "hearty_fish_stew",
  "name": "Hearty Fish Stew",
  "icon": "🍲",
  "description": "A thick, warming stew packed with river fish and root vegetables.",
  "category": "meals",
  "tier": 2,
  "ingredients": [
    { "type": "fish", "rarity_min": "common", "quantity": 1 },
    { "type": "item", "item_id": "root_vegetables", "quantity": 2 },
    { "type": "item", "item_id": "salt", "quantity": 1 }
  ],
  "result": {
    "quantity": 1,
    "sell_price": 30,
    "xp_award": 15,
    "buffs": [
      { "stat": "max_hp_bonus", "value": 5, "duration_rounds": 10 }
    ],
    "use_message": "savors a bowl of hearty fish stew. The warmth spreads through their bones.",
    "flavor_text": "Stick-to-your-ribs goodness. Big Tam's secret recipe."
  }
}
```

### Ingredient Matching

- `"type": "fish"` — accepts any fish from fishing, optionally filtered by `rarity_min`
- `"type": "item"` — specific item by ID from foraging or shop
- Higher rarity fish in a recipe could boost buff potency or dish quality
- Experimentation matching: server checks if the set of selected ingredients (ignoring order) matches any recipe's ingredient list

### Recipe Tiers

**Tier 1 — Simple (1-2 ingredients, no rare materials)**

| Dish | Ingredients | Buff | Sell |
|------|-----------|------|------|
| Grilled Fish | Any common fish + salt | +3 max HP (8 rounds) | 15G |
| Herb Bread | Flour + meadow herbs | Regen 1 HP/round (5 rounds) | 12G |
| Berry Tart | Wild berries + sugar + flour | +2 initiative | 14G |

**Tier 2 — Intermediate (3-4 ingredients, uncommon materials)**

| Dish | Ingredients | Buff | Sell |
|------|-----------|------|------|
| Hearty Fish Stew | Fish + root vegetables + salt | +5 max HP (10 rounds) | 30G |
| Mushroom Risotto | Forest mushrooms + butter + cream | +1 AC (8 rounds) | 28G |
| Honey-Glazed Trout | Silver trout + honey + firebloom pepper | +1 attack rolls (8 rounds) | 35G |

**Tier 3 — Advanced (4-5 ingredients, rare materials)**

| Dish | Ingredients | Buff | Sell |
|------|-----------|------|------|
| Shadow Eel Sashimi | Shadow eel + wild garlic + spice blend | +3 initiative, +1 attack (10 rounds) | 90G |
| Ember Bass Feast | Ember bass + firebloom pepper + truffle + butter | Fire resist + +2 attack (10 rounds) | 180G |
| Glowfin Elixir Soup | Glowfin + moonpetal + cream + honey | +2 spell/ability DC (10 rounds) | 120G |

**Tier 4 — Legendary (5+ ingredients, epic/legendary fish)**

| Dish | Ingredients | Buff | Sell |
|------|-----------|------|------|
| Leviathan Banquet | Leviathan fry + truffle + starfruit + spice blend + cream | +10 max HP, +2 attack, +1 AC (full encounter) | 600G |
| Voidpike Tartare | Voidpike + moonpetal + shadow eel + wild garlic | +3 attack, advantage on next save (full encounter) | 400G |

---

## Kitchen — Location & UI

### Where to Cook

**Dragon's Hollow only** — Big Tam's kitchen. The kitchen **replaces the tavern menu** (beverages). The old tavern drinks (ales, wines, etc.) fold into the kitchen as a "Drinks" section, so nothing is lost.

- Remove `"tavern_menu"` from Dragon's Hollow features, replace with `"kitchen"`
- The "Menu" button in the chat header becomes a "Kitchen" button
- No cooking at the Cottage or other locations

### Kitchen UI — Full-Screen Overlay

The kitchen is **not** a bottom slide-up panel like the shop. It's a **full-screen overlay** (similar pattern to the Arena page) that feels like entering a workspace. This makes room for the experimentation UI and distinguishes cooking from simple buy/sell transactions.

**Entry:** "Kitchen" button in Dragon's Hollow chat header → full-screen overlay with back button to return to chat.

**Layout — Three sections via tab bar or swipe:**

#### 1. Experiment (Primary Tab)

The core cooking interaction. A "cutting board" workspace where players combine ingredients.

```
┌─────────────────────────────────────┐
│  ← Big Tam's Kitchen     [Wallet]  │
│─────────────────────────────────────│
│  [ Experiment ]  [ Recipes ]  [ Drinks ] │
│─────────────────────────────────────│
│                                     │
│  ┌─────────────────────────────┐   │
│  │      🔪 Cutting Board       │   │
│  │                             │   │
│  │   [Slot 1]  [Slot 2]       │   │
│  │   [Slot 3]  [Slot 4]       │   │
│  │            [Slot 5]         │   │
│  │                             │   │
│  │        [ 🔥 Cook! ]         │   │
│  └─────────────────────────────┘   │
│                                     │
│  ── Your Ingredients ──────────    │
│  🧂 Salt ×12    🧈 Butter ×4      │
│  🐟 Mudcarp ×3  🌿 Herbs ×6      │
│  🍄 Mushrooms ×2  ...             │
│                                     │
└─────────────────────────────────────┘
```

- Tap an ingredient from the bottom list → it fills the next empty slot on the cutting board
- Tap a filled slot → removes it (returns to list)
- 2-5 ingredient slots available
- "Cook!" button enabled when at least 2 slots filled
- Result: success animation + dish appears, OR failure animation + Charred Mystery Mush

#### 2. Recipe Book (Second Tab)

Discovered recipes for repeat cooking. Only shows recipes the player has successfully made before.

```
┌─────────────────────────────────────┐
│  [ Experiment ]  [*Recipes*]  [ Drinks ] │
│─────────────────────────────────────│
│                                     │
│  ┌─────────────────────────────┐   │
│  │ 🍲 Hearty Fish Stew    T2  │   │
│  │ Fish ✓  Root Veg ✓  Salt ✓ │   │
│  │                    [ Cook ] │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │ 🐟 Grilled Fish         T1 │   │
│  │ Common Fish ✓   Salt ✗     │   │
│  │                   [ ---- ] │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │ 🔒 ??? (3 undiscovered)    │   │
│  └─────────────────────────────┘   │
│                                     │
└─────────────────────────────────────┘
```

- Each discovered recipe shows ingredient checklist (owned ✓ / missing ✗)
- "Cook" button enabled when all ingredients are in inventory
- Undiscovered recipe count shown at bottom as motivation
- One-tap cooking: no need to re-place ingredients on the board

#### 3. Drinks (Third Tab)

The old tavern menu beverages, relocated here. Same buy-and-consume flow as before, just in a new home.

```
┌─────────────────────────────────────┐
│  [ Experiment ]  [ Recipes ]  [*Drinks*] │
│─────────────────────────────────────│
│                                     │
│  🍺 Dragon's Hollow Ale    5G [Buy]│
│  🍷 Mira's Mulled Wine     8G [Buy]│
│  🥃 Firewater             12G [Buy]│
│  ...                                │
│                                     │
└─────────────────────────────────────┘
```

### API Endpoints

```
GET  /api/cooking/recipes        — Discovered recipes with player's ingredient counts
GET  /api/cooking/ingredients    — Player's cooking-relevant inventory items
POST /api/cooking/experiment     — { ingredient_ids: [...] } → match check, consume, return result
POST /api/cooking/cook           — { recipe_id } → validate known recipe, consume ingredients, create dish
```

---

## Dish Consumption & Buffs

### Eating Dishes

Same consumable pattern as potions/blunts:
- **Out of combat**: Use from inventory (items panel in chat extras drawer)
- **In combat**: Bonus action (like potions, picked from a menu)
- Broadcasts WS event → chat message + visual effect (steam/sparkle animation)

### Food Buff System

Extends `server/lib/conditions.js` with a new `buffType: 'food'` category:

```javascript
{
  id: 'well_fed',
  name: 'Well Fed',
  icon: '🍖',
  buffType: 'food',
  statModifiers: { max_hp_bonus: 5 },
  duration: 10,
  durationType: 'rounds'
}
```

**Buff Types:**

| Buff | Effect | From |
|------|--------|------|
| Well Fed | +3 to +15 max HP | Hearty/protein dishes |
| Sharp Focus | +1 to +3 attack rolls | Spicy/stimulating dishes |
| Fortified | +1 to +2 AC | Rich/heavy dishes |
| Swift | +2 to +5 initiative | Light/berry dishes |
| Resistant (element) | Resistance to one damage type | Elemental ingredient dishes |
| Inspired Palate | Advantage on next saving throw | Rare/exquisite dishes |

**Stacking Rules:**
- Only **one food buff active** at a time (new dish replaces old buff)
- Food buffs stack WITH potion effects and combat conditions
- Buff persists across encounters until duration expires or is replaced

### Arena Integration

- Food buffs display in participant status area alongside conditions
- Distinct icon styling (plate icon vs condition flame/skull icons)
- `getAttackModifiers()` and `getDefenseModifiers()` in `conditions.js` check active food buffs
- Buff ticks down each round like conditions

---

## Economy

### Cooking-for-Profit Loop

Cooked dishes sell for significantly more than raw ingredients:

| Dish | Ingredient Cost | Sell Price | Profit |
|------|----------------|-----------|--------|
| Grilled Fish | ~7G | 15G | +8G |
| Hearty Fish Stew | ~12G | 30G | +18G |
| Ember Bass Feast | ~95G | 180G | +85G |
| Leviathan Banquet | ~340G | 600G | +260G |

**Loop:** Fish (free, costs bait) → Forage (free, costs time) → Buy staples (2-5G) → Cook → Sell for 2-3x profit.

Dishes sell via the existing shop sell tab — `POST /api/shop/sell` just needs dish pricing in the lookup.

### Failed Experiment Cost

"Charred Mystery Mush" sells for 1G. Experimentation has a cost (you lose the ingredients) but not a total loss. This discourages pure random guessing on expensive ingredients while keeping the sting mild for cheap combos.

---

## Progression & Stats

### Lifetime Stats

Add to `LIFETIME_DEFAULTS` in `server/lib/xp.js`:

```javascript
dishes_cooked: 0,
dishes_eaten: 0,
dishes_sold: 0,
cooking_gold_earned: 0,
recipes_discovered: 0,
experiments_failed: 0,
ingredients_foraged: 0,
foraging_rare_finds: 0,
```

### Achievements

| Achievement | Trigger | Reward |
|------------|---------|--------|
| First Course | Cook first dish | 25 XP, 10G |
| Line Cook | Cook 10 dishes | 50 XP |
| Sous Chef | Cook 25 dishes | 100 XP, 25G |
| Head Chef | Cook 50 dishes | 200 XP, 50G |
| Experimenter | Discover 5 recipes | 50 XP |
| Culinary Scholar | Discover all recipes | 300 XP, 100G (hidden) |
| Happy Accident | Get Charred Mystery Mush | 10 XP (hidden) |
| Forager | Forage 20 ingredients | 50 XP |
| Truffle Hunter | Find a truffle | 75 XP (hidden) |
| Five Star Meal | Cook a Tier 4 dish | 200 XP, 100G (hidden) |
| Buffet Baron | Sell 25 dishes | 100 XP, 50G |
| Taste of Legend | Eat a Legendary-tier dish | 150 XP (hidden) |

---

## File Structure

### New Files

```
data/recipe_catalog.json                  — All recipes with ingredients & results
data/ingredient_catalog.json              — Forageable + shop ingredients
data/cooking_stats.json                   — Per-player cooking stats + discovered recipes
server/lib/cooking.js                     — Core cooking logic (validate, experiment, craft, buff)
server/routes/cooking.js                  — Cooking API endpoints
server/routes/foraging.js                 — Foraging API endpoints
client/src/components/KitchenOverlay.jsx  — Full-screen kitchen UI (experiment + recipe book + drinks)
client/src/styles/kitchen.css             — Kitchen styles
```

### Modified Files

```
server/server.js                   — Register cooking + foraging routes
server/lib/xp.js                   — Add cooking/foraging lifetime stats
server/lib/achievements.js         — Add cooking achievements
server/lib/conditions.js           — Add food buff type + stat modifier support
server/lib/encounters.js           — Check food buffs in combat resolution
server/routes/shop.js              — Sell prices for cooked dishes
economy/shop_catalog.json          — Add pantry ingredient category
data/locations.json                — Replace "tavern_menu" with "kitchen" on Dragon's Hollow
client/src/pages/LocationChat.jsx  — Replace "Menu" button with "Kitchen", render KitchenOverlay
```

---

## Implementation Phases

### Phase 1 — Kitchen Foundation
- Recipe catalog (8-10 starter recipes, tiers 1-2)
- Ingredient catalog + pantry items in shop
- Cooking APIs: experiment endpoint + known-recipe cook endpoint
- Full-screen KitchenOverlay with Experiment tab + Recipe Book tab
- Discovery persistence in cooking_stats.json
- Charred Mystery Mush for failed experiments
- Migrate tavern beverages into Kitchen "Drinks" tab
- Dishes as inventory items, sellable through existing shop sell tab
- Cooking XP + lifetime stat tracking
- Remove `tavern_menu` feature, add `kitchen` to Dragon's Hollow

### Phase 2 — Foraging
- Foraging API with cooldowns and rarity rolls
- Forageable ingredient catalog
- Location feature gating (Cottage, new Forest location?)
- Foraging UI (button + gathering animation + result toast)
- Foraging stats + achievements

### Phase 3 — Buffs & Combat Integration
- Food buff system in conditions.js
- Dish consumption with buff application (out of combat + arena bonus action)
- Arena UI showing active food buffs on participants
- Combat modifier hooks for food buffs
- Eating visual effects (steam/sparkle overlay)

### Phase 4 — Polish & Depth
- More recipes (tiers 3-4, 20+ total)
- Cooking quality tiers based on experimentation (Perfect / Good / Charred)
- Recipe hints from Big Tam NPC dialogue
- Recipe scroll items as quest rewards (auto-discover a recipe)
- Monster drop ingredients from arena encounters
- Cooking leaderboard on profile page
- "Daily special" rotating recipes with bonus XP/gold

---

## Open Questions

1. **NPC involvement** — Does Big Tam teach you to cook? Do you need to unlock cooking through a quest, or is it available immediately?
2. **Foraging locations** — New "Forest" / "Wilds" location, or add foraging to existing Cottage + a second spot?
3. **Buff duration outside combat** — Should food buffs last X minutes in the overworld, or only activate when entering an encounter?
4. **Ingredient storage limits** — Cap foraged ingredients with `max_stack` like bait? Prevents hoarding.
5. **Party cooking** — Could multiple players contribute ingredients to a "feast" that buffs the whole group before a big encounter?
6. **Tie-in with consumables doc** — Some items in `CONSUMABLES-IDEAS.md` (Goodberries, Antitoxin) could be cookable dishes instead of shop purchases.
7. **Experiment matching strictness** — Does ingredient order matter? Do quantities need to be exact (e.g., 2x root vegetables), or does putting 3 count? Leaning toward: order doesn't matter, exact quantities required (extra ingredients = waste/failure).

# Resource Collection System

*Feature plan for passive NPC resource gathering with player-initiated collection.*

---

## Overview

Each player character has NPCs that work for them based on their role in Okhan. These NPCs passively gather a unique resource over time. Players check in with their NPCs to collect the accumulated resources. Upgrades increase gather rate and storage duration.

---

## Core Concepts

### The Loop
1. Player's NPCs passively accumulate resources over time (background, no active process needed)
2. Player checks in with their NPCs when they want (e.g. "@the_veil anything to report?")
3. On check-in:
   - System calculates resources gathered since last collection (capped by storage duration)
   - Backend command pushes resources to player's balance in the shopkeeper
   - Frontend notification shows what was added
   - NPCs respond (TBD - nuance to work out later)

### The Math
```
gathered = min(days_since_last_collect × gather_rate, storage_days × gather_rate)
```
- **Gather rate**: resources produced per day
- **Storage duration**: max days of resources NPCs will hold
- If a player doesn't check in beyond storage duration, excess is lost

### Example
- Gather rate: 10/day, Storage: 3 days
- Check in after 2 days → collect 20
- Check in after 5 days → collect 30 (capped at 3 days worth)

---

## Player Resources

| Player | Role in Okhan | Resource | Source NPCs |
|--------|---------------|----------|-------------|
| Aly | Cleric, rooftop patrol | **Intel** | The Veil (her network) |
| Tyren | Lord Commander, Iron Forge | **TBD** | Ashen Vow / forge workers |
| Nalyd | Monk, Dojo of the Four Elements | **TBD** | Dojo students |
| Nibby* | Ranger-in-training | **TBD** | TBD |

*Nibby is an NPC, not a player. May or may not participate in resource system.*

---

## Upgrade System

### Gather Rate Tiers
How much resource NPCs produce per day.

| Tier | Rate | Cost | Flavor |
|------|------|------|--------|
| 1 | 10/day | Free (base) | Starting network |
| 2 | 20/day | TBD | Expanded contacts / better training |
| 3 | 35/day | TBD | Seasoned operatives / elite students |
| 4 | 50/day | TBD | Master-level network |

### Storage Duration Tiers
How many days NPCs will hold resources before capping out.

| Tier | Duration | Cost | Flavor |
|------|----------|------|--------|
| 1 | 3 days | Free (base) | Basic record keeping |
| 2 | 5 days | TBD | Organized filing |
| 3 | 7 days | TBD | Dedicated archive |
| 4 | 10 days | TBD | Institutional memory |

*Costs TBD - should feel meaningful but achievable. Paid in gold or possibly in the resource itself.*

---

## Data Structure

### Per-Player Resource State
Stored in the economy system (e.g. `economy/resources.{env}.json`):

```json
{
  "player_discord_id": {
    "resource_type": "intel",
    "gather_rate": 10,
    "gather_tier": 1,
    "storage_days": 3,
    "storage_tier": 1,
    "last_collected": "2026-02-02T12:00:00Z",
    "total_collected": 0
  }
}
```

### Signal From NPC → Shopkeeper
When a player checks in, the NPC bot writes a signal to `economy/currency_signals/`:

```json
{
  "type": "resource_collect",
  "player_id": "424061511833747467",
  "resource": "intel",
  "triggered_by": "the_veil",
  "timestamp": "2026-02-02T15:00:00Z"
}
```

The shopkeeper bot picks up the signal, runs the math, updates the player's balance, and sends the frontend notification.

---

## Commands

### Player Commands
| Command | Description |
|---------|-------------|
| `!resources` | View current resource balance and time since last collection |
| `!upgrade gather` | Upgrade gather rate (shows tiers and cost) |
| `!upgrade storage` | Upgrade storage duration (shows tiers and cost) |

*Note: Collection itself is NOT a command. It's triggered by the player interacting with their NPCs in character.*

### Admin/DM Commands
| Command | Description |
|---------|-------------|
| `!resources set <player> <amount>` | Override a player's resource balance |
| `!resources reset <player>` | Reset collection timer |
| `!resources config <player>` | View a player's full resource config |

---

## Shopkeeper Bot Updates Required

### New Features to Add
1. **Resource balance tracking** - New data file (`economy/resources.{env}.json`) to store per-player resource state alongside existing wallets and inventories
2. **Signal watcher** - Monitor `economy/currency_signals/` for `resource_collect` signals from NPC bots. On signal:
   - Calculate gathered amount based on time elapsed and player's gather rate/storage
   - Add to player's resource balance
   - Delete the signal file
   - Send frontend notification to the channel (e.g. "📦 Aly collected 30 Intel")
3. **Resource commands** - `!resources`, `!upgrade gather`, `!upgrade storage`
4. **Upgrade purchase flow** - Deduct gold (or resource cost) and update tier in resource config
5. **Resource display in inventory** - When players check `!shop inventory` (or whatever the command becomes), show their resource balance alongside items

### Config Updates
- Add resource type definitions to shop catalog or a new config file
- Map player Discord IDs to their resource type
- Define upgrade tier costs

### Integration Points
- NPC bots need to know how to write signals (shared `economy/currency_signals/` folder)
- Shopkeeper needs a file watcher or poll loop for the signals folder
- Notification channel config (where do collection notifications post?)

---

## Open Questions

- [ ] What are Tyren's and Nalyd's resource types?
- [ ] Does Nibby participate in this system? (He's an NPC, not a player)
- [ ] How do NPC responses work when a player checks in? (Deferred - nuance to figure out)
- [ ] Should resources be spendable? On what?
- [ ] Do different resource types interact? (e.g. Intel + Iron = something?)
- [ ] Can resources feed into the crafting system from the roadmap?
- [ ] What channel do collection notifications post in? Player's private channel? General?
- [ ] Upgrade costs - gold, resources, or both?

---

*Last updated: 2026-02-02*

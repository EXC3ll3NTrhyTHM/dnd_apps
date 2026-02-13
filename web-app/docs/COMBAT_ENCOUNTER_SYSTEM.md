# Combat Encounter System

*A D&D-style PvE combat system that plays out in chat using real player stats and 3D dice.*

---

## Overview

Monsters spawn at locations. Players at that location fight them together using their real D&D character stats (ability scores, AC, HP, weapons). Combat plays out in chat as a series of rounds — attack rolls, damage, monster counterattacks — until the monster dies or all players are knocked out. Rewards scale with contribution.

**Core fantasy:** It should feel like a real D&D combat encounter, just automated. The dice matter. Your stats matter. Your AC saves you. A nat 20 crits. A nat 1 fumbles.

---

## How It Plays

### 1. Monster Spawns
- DM triggers an encounter at a location (future: random/scheduled spawns)
- A narrator message appears in chat:
  > **A Dire Wolf crashes through the underbrush!**
  > AC 14 | HP 37 | Bite: +5 to hit, 2d6+3 damage
- An **action bar** appears above the chat input for all players at that location

### 2. Player Turn (Action Phase)
Each round, every participating player picks ONE action:
- **Attack** — Roll d20 + attack modifier vs monster's AC. Hit = roll damage.
- **Defend** — Skip attacking, gain +2 AC this round against the monster's counterattack
- **Flee** — Leave the encounter (no rewards, but safe from damage)

Players act simultaneously (no initiative order for v1 — keeps it fast). Once all players have chosen or a 30-second timer expires, the round resolves.

### 3. Round Resolution
For each player who attacked:
1. Roll d20 + attack modifier (shown via 3D dice overlay)
2. Compare to monster AC
3. **Hit:** Roll damage dice based on weapon, subtract from monster HP
4. **Miss:** "Your swing goes wide!"
5. **Nat 20:** Critical hit — double damage dice
6. **Nat 1:** Fumble — flavor text, no damage

All rolls and results appear as chat messages from a narrator NPC.

### 4. Monster Counterattack
After players resolve, the monster strikes back:
1. Monster targets 1-3 players (random, weighted toward whoever dealt the most damage)
2. Roll d20 + monster's attack bonus vs each target's AC
3. **Hit:** Roll monster's damage dice, subtract from player's encounter HP
4. **Miss:** "The Dire Wolf lunges but you dodge aside!"
5. Players who chose **Defend** get +2 AC for this attack

### 5. Knocked Out
- Player HP hits 0 → "knocked out" for the rest of the encounter
- No permadeath — you're just out of this fight
- Knocked out players can still watch the chat unfold
- Flavor: "You crumple to the ground. The others fight on."

### 6. Victory / Defeat
- **Victory:** Monster HP reaches 0 → gold/XP split among participants based on damage dealt
- **Defeat:** All players knocked out → monster "escapes," no rewards, dramatic narration
- **Timeout:** If no actions for 2 minutes, encounter fizzles ("The creature retreats into the shadows...")

---

## Player Combat Stats

Pulled from existing character sheet system (`/api/character-sheet/:userId`):

| Stat | Source | Used For |
|------|--------|----------|
| STR modifier | D&D Beyond export | Melee attack & damage rolls |
| DEX modifier | D&D Beyond export | Ranged attack & damage rolls |
| AC | Calculated from armor + DEX | Defense against monster attacks |
| HP | D&D Beyond base HP | Encounter health pool |
| Proficiency bonus | Calculated from level | Added to attack rolls |
| Equipment | Equipped weapons list | Determines damage dice |

### Attack Modifier Calculation
```
Melee weapon:  d20 + STR modifier + proficiency bonus
Ranged weapon: d20 + DEX modifier + proficiency bonus
Finesse:       d20 + max(STR, DEX) + proficiency bonus
```

### Damage Dice by Weapon
Derive from the player's equipped weapon. Use a lookup table mapping weapon names to damage dice (D&D SRD data):

```javascript
const WEAPON_DAMAGE = {
  'Scimitar':   { dice: '1d6', type: 'slashing', finesse: true },
  'Longbow':    { dice: '1d8', type: 'piercing', ranged: true },
  'Greatsword': { dice: '2d6', type: 'slashing' },
  'Dagger':     { dice: '1d4', type: 'piercing', finesse: true },
  'Handaxe':    { dice: '1d6', type: 'slashing' },
  // ... full SRD weapon table
};

// Damage roll: weapon dice + ability modifier
// e.g., Scimitar: 1d6 + DEX mod (finesse) or STR mod
```

### Players Without Character Sheets
Fallback for players who don't have a D&D Beyond export linked:
- Use default stats: 10 across the board (0 modifiers), AC 10, HP 10
- Equip a "Fists" weapon: 1d4 bludgeoning
- Still playable, just weaker — incentivizes linking their character

---

## Monster Data Model

```javascript
{
  id: 'dire_wolf',
  name: 'Dire Wolf',
  description: 'A massive grey wolf with glowing amber eyes',
  cr: 1,                        // Challenge Rating (for reward scaling)
  ac: 14,
  maxHp: 37,
  attacks: [
    {
      name: 'Bite',
      bonus: 5,                  // To-hit bonus
      damage: '2d6+3',          // Damage notation
      type: 'piercing',
      description: 'lunges forward and snaps its massive jaws'
    }
  ],
  multiattack: 1,               // How many attacks per round
  xpReward: 200,
  goldReward: 25,
  // Narration flavor
  spawnText: 'A Dire Wolf crashes through the underbrush, teeth bared!',
  deathText: 'The Dire Wolf collapses with a final whimper.',
  fleeText: 'The Dire Wolf slinks back into the shadows, wounded.',
  attackTexts: [                 // Random per attack for variety
    'The Dire Wolf lunges at {target} with snapping jaws!',
    'The beast pounces toward {target}, fangs bared!',
  ],
  missTexts: [
    '{target} rolls aside as the wolf snaps at empty air.',
    'The wolf\'s jaws clamp shut inches from {target}.',
  ]
}
```

### Starter Monster List (SRD-legal)

| Monster | CR | AC | HP | Attack | Damage | Setting |
|---------|----|----|-----|--------|--------|---------|
| Goblin | 1/4 | 15 | 7 | Scimitar +4 | 1d6+2 | Caves, forests |
| Wolf | 1/4 | 13 | 11 | Bite +4 | 2d4+2 | Forests, wilds |
| Skeleton | 1/4 | 13 | 13 | Shortsword +4 | 1d6+2 | Dungeons, ruins |
| Dire Wolf | 1 | 14 | 37 | Bite +5 | 2d6+3 | Forests, mountains |
| Ogre | 2 | 11 | 59 | Greatclub +6 | 2d8+4 | Caves, swamps |
| Owlbear | 3 | 13 | 59 | Claws +7 | 2d8+5 | Forests |
| Troll | 5 | 15 | 84 | Claws +7 | 2d6+4 | Swamps, caves |

Store in `data/monsters.json`. Start with 5-7 monsters, easy to add more.

---

## Encounter State

Server-side state for an active encounter. Stored in memory (not persisted — encounters are ephemeral):

```javascript
{
  id: 'enc_abc123',
  locationId: 'dragons_hollow',
  monster: {
    id: 'dire_wolf',
    name: 'Dire Wolf',
    ac: 14,
    maxHp: 37,
    currentHp: 37,
    attacks: [...]
  },
  round: 1,
  phase: 'action',              // 'action' | 'resolving' | 'monster_turn' | 'ended'
  participants: {
    'user123': {
      name: 'Tyren',
      maxHp: 23,
      currentHp: 23,
      ac: 14,
      attackBonus: 4,           // Pre-calculated: STR/DEX mod + prof bonus
      damageNotation: '1d6+2',  // From equipped weapon + modifier
      action: null,             // null | 'attack' | 'defend' | 'flee'
      totalDamage: 0,           // Running total for reward split
      knockedOut: false,
    }
  },
  actionDeadline: 1707600000000, // Timestamp: 30s from round start
  startedBy: 'dm_user_id',
  startedAt: '2026-02-12T...',
  log: []                       // Round-by-round results for replay
}
```

---

## API Routes

All under `/api/encounters/`:

### DM Controls
```
POST   /api/encounters/spawn
       Body: { locationId, monsterId }
       Auth: DM only
       → Creates encounter, broadcasts spawn message, returns encounter state

POST   /api/encounters/:encounterId/cancel
       Auth: DM only
       → Ends encounter early, no rewards
```

### Player Actions
```
POST   /api/encounters/:encounterId/join
       Auth: any authenticated player
       → Adds player to encounter, loads their combat stats from character sheet

POST   /api/encounters/:encounterId/action
       Body: { action: 'attack' | 'defend' | 'flee' }
       Auth: participant only
       → Records player's action for current round
       → If all players have acted, triggers round resolution

GET    /api/encounters/:encounterId
       Auth: any authenticated player at the location
       → Returns current encounter state (monster HP, participants, round, etc.)
```

### Active Encounter Lookup
```
GET    /api/encounters/active/:locationId
       → Returns the active encounter at a location (or null)
```

---

## Round Resolution Flow (Server)

```
1. All players submit actions (or 30s timer expires)
2. Set phase = 'resolving'
3. For each player with action = 'attack':
   a. Roll d20 + attackBonus
   b. If roll >= monster.ac → roll damage, subtract from monster HP
   c. Build narrator message with roll results
   d. Check for nat 20 (double damage dice) / nat 1 (fumble)
4. Broadcast all attack results as chat messages
5. Check: is monster dead?
   → Yes: broadcast victory, distribute rewards, end encounter
   → No: continue to monster turn
6. Monster counterattack phase:
   a. Pick targets (random, weighted by damage dealt)
   b. For each attack: roll d20 + monster.bonus vs target AC (+2 if defending)
   c. Hit: roll damage, subtract from player HP
   d. Broadcast results
   e. Check for knockouts (HP <= 0)
7. Check: all players knocked out or fled?
   → Yes: broadcast defeat, end encounter
   → No: advance to next round, set phase = 'action', reset 30s timer
```

---

## WebSocket Events

### Server → Client
```javascript
// Encounter spawned
{ type: 'encounter_spawn', locationId, encounter: { id, monster, round } }

// Round results (attack outcomes, damage, etc.)
{ type: 'encounter_round', encounterId, results: [...], monsterHp, round }

// Monster attacks
{ type: 'encounter_monster_turn', encounterId, attacks: [...] }

// Player knocked out
{ type: 'encounter_knockout', encounterId, playerId, playerName }

// Encounter ended
{ type: 'encounter_end', encounterId, outcome: 'victory' | 'defeat' | 'fled' | 'timeout',
  rewards: { userId: { xp, gold }, ... } }
```

### Client → Server
Actions are sent via REST (POST), not WebSocket. Simpler, reliable, auth-checked.

---

## Client UI

### Encounter Banner
When an encounter is active at the player's location, show a banner at the top of chat:

```
┌──────────────────────────────────────┐
│  ⚔️ DIRE WOLF          Round 3      │
│  HP: ████████░░░░  22/37    AC: 14   │
│                                      │
│  [⚔ Attack]  [🛡 Defend]  [🏃 Flee] │
│              0:18 remaining          │
└──────────────────────────────────────┘
```

- HP bar animates down when damage is dealt
- Action buttons disabled after choosing (shows "Waiting for others...")
- Timer counts down for the round
- Tapping Attack triggers the 3D dice overlay for the attack roll

### Chat Messages (Narration)
All combat results appear as chat messages from a narrator "NPC":

> **[Combat]** Round 2 — Player Attacks
> Tyren swings his scimitar... **18** vs AC 14 — **Hit!** Deals **7 slashing damage.**
> Nalyd looses an arrow... **8** vs AC 14 — **Miss!** The arrow sails wide.
>
> **[Combat]** The Dire Wolf Strikes Back
> The wolf lunges at Tyren... **16** vs AC 14 — **Hit!** Tyren takes **9 piercing damage.** (HP: 14/23)
> The wolf snaps at Nalyd... **7** vs AC 16 — **Miss!** Nalyd sidesteps the attack.

### Victory Screen
Quick overlay or banner when the monster dies:

```
┌──────────────────────────────────────┐
│           ⚔️ VICTORY! ⚔️            │
│      The Dire Wolf has fallen!       │
│                                      │
│   Tyren:  +120 XP  +15 gold  (63%)  │
│   Nalyd:  +80 XP   +10 gold  (37%)  │
│                                      │
│            [Continue]                │
└──────────────────────────────────────┘
```

---

## Reward Distribution

```javascript
// Total rewards from monster definition
const totalXp = monster.xpReward;
const totalGold = monster.goldReward;

// Split by damage contribution
for (const [userId, player] of participants) {
  if (player.totalDamage === 0) continue; // fled or never hit
  const share = player.totalDamage / totalDamageDealt;
  const xp = Math.round(totalXp * share);
  const gold = Math.round(totalGold * share);
  awardXp(userId, xp);
  awardGold(userId, gold);
}
```

Bonus rewards:
- **Killing blow:** +10% bonus XP
- **No damage taken:** "Untouchable" bonus +5% XP
- **Solo kill:** If only one participant, +25% XP (but it's risky)

---

## Achievements

| ID | Name | Condition | XP | Gold |
|----|------|-----------|-----|------|
| `first_blood` | First Blood | Participate in your first encounter | 15 | 0 |
| `monster_slayer` | Monster Slayer | Kill 10 monsters | 50 | 25 |
| `critical_strike` | Critical Strike | Land a critical hit (nat 20) in combat | 25 | 10 |
| `untouchable` | Untouchable | Complete an encounter without taking damage | 30 | 15 |
| `last_stand` | Last Stand | Be the last player standing and win | 40 | 20 |
| `dragon_slayer` | Dragon Slayer | Defeat a CR 5+ monster | 100 | 50 |
| `fumble_recovery` | Fumble Recovery | Roll a nat 1, then land the killing blow | 50 | 25 |

---

## Lifetime Stats to Track

Add to `LIFETIME_DEFAULTS` in `server/lib/xp.js`:

```javascript
encounters_joined: 0,
encounters_won: 0,
monsters_killed: 0,         // killing blows
total_combat_damage: 0,
combat_crits: 0,
combat_fumbles: 0,
times_knocked_out: 0,
```

---

## Phase 1 (MVP)

Build the minimum to make it playable:

1. **Monster data file** — 5 monsters in `data/monsters.json`
2. **Weapon damage lookup** — Map weapon names to damage dice (SRD table)
3. **Encounter state manager** — In-memory, handles round flow
4. **3 API routes** — spawn, join, action
5. **WebSocket broadcasts** — spawn, round results, end
6. **Encounter banner UI** — HP bar, 3 action buttons, timer
7. **Narrator chat messages** — Combat results in chat
8. **Reward distribution** — XP/gold split by damage

**Not in Phase 1:** Initiative order, spells, healing, multi-attack choices, monster special abilities, status effects.

## Phase 2 (Polish)

- Initiative order (DEX-based)
- Multiple weapon choice (pick which equipped weapon to use)
- Monster special abilities (pack tactics, regeneration, etc.)
- Encounter difficulty scaling based on number of players
- Random encounter spawns on a timer per location
- Encounter history / combat log replay

## Phase 3 (Expand)

- Spell casting (use spell slots, INT/WIS/CHA for attack modifier)
- Healing actions (potions, cleric spells)
- Status effects (poisoned, frightened, prone)
- Boss encounters with multiple phases
- Dungeon crawl mode (chain of encounters with rests between)
- PvP arena mode using the same combat engine

---

## File Structure

```
server/
  lib/
    encounters.js          — Encounter state manager, round resolution, reward calc
    monsters.js            — Monster data loader, stat lookups
    weapons.js             — Weapon damage table (SRD data)
  routes/
    encounters.js          — API routes (spawn, join, action, status)
data/
  monsters.json            — Monster definitions
client/
  src/
    components/
      EncounterBanner.jsx  — HP bar, action buttons, timer
      CombatNarration.jsx  — Styled combat message bubbles (optional, could reuse ChatBubble)
```

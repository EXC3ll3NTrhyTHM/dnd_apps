# Dungeon Exploration Design

The exploration phase is the connective tissue. Combat is punctuation.

---

## A Floor's Rhythm

Not back-to-back combat. More like:

```
[Enter Floor] → [Explore] → [Encounter] → [Explore] → [Encounter] → [Find Exit] → [Next Floor]
```

---

## The Exploration Phase

When you enter a floor, you don't immediately fight. You **explore**:

### 1. Room-by-Room Navigation

You see a mini-map with connected nodes:

```
         [?]─────[?]
          │
   [?]───[YOU]───[⚔️]
          │
         [?]───[💰]───[🚪 EXIT]
```

- **[?]** = Unexplored (could be anything)
- Click a connected room to move there
- Moving reveals what's inside
- Choose your path (risk vs reward)

**Choices:**
- Go toward the exit (safe, less loot)
- Explore every room (risky, more rewards)
- Avoid that skull icon? Or fight for the rare drop?

---

### 2. Room Discovery (Before Combat)

When you enter a room, you get a **moment of discovery** before anything happens:

```
┌─────────────────────────────────────────┐
│  You enter a damp stone chamber...      │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │   [Art: Dark cave with puddles] │   │
│  │   [Glowing mushrooms on walls]  │   │
│  │   [Something moves in corner]   │   │
│  └─────────────────────────────────┘   │
│                                         │
│  You notice:                            │
│  • Scratching sounds from the shadows   │
│  • An old chest against the far wall    │
│  • Strange runes carved into the floor  │
│                                         │
│  [ INVESTIGATE CHEST ]                  │
│  [ EXAMINE RUNES ]                      │
│  [ APPROACH THE SOUND ]                 │
│  [ LEAVE QUIETLY ]                      │
└─────────────────────────────────────────┘
```

**This isn't combat yet.** You're exploring the room. Your choice determines what happens:

- **Investigate chest** → Could be loot, could be trapped, could be mimic
- **Examine runes** → INT check: learn something useful or trigger trap
- **Approach sound** → Combat starts, but you get surprise round
- **Leave quietly** → DEX check: escape with nothing, or alert enemies

---

### 3. Environmental Interactions

Rooms have **interactable objects** beyond just enemies:

| Object | Interaction | Possible Outcomes |
|--------|-------------|-------------------|
| **Barrel** | Search | Food, junk, rat swarm |
| **Corpse** | Loot | Gold, curse, zombie rises |
| **Lever** | Pull | Open secret door, trigger trap, nothing |
| **Pool of water** | Drink | Heal, poison, vision (reveal map) |
| **Altar** | Pray/Offer | Buff, curse, summon enemy |
| **Bookshelf** | Read | Learn lore, find map, nothing |
| **Cracks in wall** | Inspect | Secret room, cave-in, escape route |
| **Campfire remains** | Rest | Short heal, but 30% ambush chance |

Not every room has these, but enough do that exploration feels active.

---

### 4. Exploration Events (Non-Combat)

20-30% of rooms are pure exploration/story:

**The Echoing Halls**
```
Your footsteps echo loudly. Too loudly.
You realize the acoustics here could alert enemies ahead.

[ Proceed carefully (slow, safe) ]
[ Sprint through (fast, might alert) ]
[ Search for another path (DEX check) ]
```

**The Locked Door**
```
A heavy iron door blocks the path. 
Through the keyhole, you glimpse treasure.

[ Pick lock (DEX 14) ] → Success: treasure room. Fail: alarm.
[ Break it down (STR 16) ] → Success: enter. Fail: take damage + noise.
[ Find another way ] → Skip this, continue exploring.
[ Use a key (if you have one) ] → Opens safely.
```

**The Whispering Walls**
```
Faint whispers emanate from the stones.
They seem to be... giving directions?

[ Listen closely ] → Reveals one hidden room on map
[ Ignore them ] → Nothing
[ Talk back ] → 50% helpful hint, 50% curse
```

**The Wounded Creature**
```
A small goblin lies bleeding, no threat to you.
It whimpers and points deeper into the dungeon.

[ Help it ] → Heals you later if you find it again
[ End its suffering ] → Small XP, nothing else
[ Interrogate ] → CHA check: reveals trap locations
[ Ignore ] → It dies. You feel nothing. (Or do you?)
```

---

## Pacing: A Sample Floor

Here's what Floor 3 might actually feel like:

| Step | What Happens | Time |
|------|--------------|------|
| 1 | Enter floor, see 5 rooms on map | 5 sec |
| 2 | Move to Room A (unknown) | 2 sec |
| 3 | **Discovery:** Dusty library, bookshelf, locked chest | 10 sec |
| 4 | Search bookshelf → Find dungeon map (reveals floor) | 5 sec |
| 5 | Pick lock on chest → Fail, trigger poison dart trap | 5 sec |
| 6 | Lose 10 HP, get gold anyway | 3 sec |
| 7 | Move to Room B (combat icon) | 2 sec |
| 8 | **Combat:** 2 skeletons | 60-90 sec |
| 9 | Loot: bone dust, 15 gold | 5 sec |
| 10 | Move to Room C (unknown) | 2 sec |
| 11 | **Event:** The Shrine (offer gold or pray) | 15 sec |
| 12 | Offer 50 gold → Get ATK buff for 3 rooms | 3 sec |
| 13 | Move to Room D (treasure icon) | 2 sec |
| 14 | **Treasure:** Chest with rare helmet | 5 sec |
| 15 | Exit found! Move to stairs | 2 sec |
| 16 | **Choice:** Descend or explore Room E? | 5 sec |
| 17 | Explore Room E (combat) | 60-90 sec |
| 18 | Descend to Floor 4 | 3 sec |

**Total floor time: ~4-5 minutes**
**Combat: ~2-3 minutes**
**Exploration/choices: ~2 minutes**

That's a 50/50 split, not a combat grind.

---

## Visual Exploration (Optional Upgrade)

If you want it to feel more like a game and less like menus:

### Simple Version: Node Map
```
    [?]───[💀]
     │
[🏕️]─[YOU]───[?]
     │
    [💰]───[🚪]
```

Click nodes to move. Icons hint at contents.

### Fancy Version: Tile-Based Movement

```
┌─────────────────────────────┐
│ ░░░░░░█░░░░░░█░░░░░░░░░░░░│
│ ░░░░░░█░░░░░░█░░░[?]░░░░░░│
│ ░░░░░░░░░░░░░█░░░░│░░░░░░░│
│ █████░░░██████░░░░░░░░░░░░│
│ ░░░░░░░░░░░░░░░░[YOU]─[⚔️] │
│ ░░[💰]░░░░░░░░░░░░│░░░░░░░│
│ ░░░│░░░░░░░░░░░░[🚪]░░░░░░│
└─────────────────────────────┘
```

Arrow keys or click to move through corridors. Still node-based under the hood.

### Full Phaser Version (Later)

Actual sprite walking through generated dungeon rooms. Big lift, but very cool.

---

## The Key Insight

Combat is the **climax**, not the whole experience.

Exploration creates:
- **Anticipation** (what's in that room?)
- **Tension** (I'm low on HP, should I risk it?)
- **Agency** (I chose to open that chest)
- **Story** (I helped that goblin and it paid off)

Without it, you have a combat simulator. With it, you have an adventure.

---

## Next Steps

1. The room generation system (with interaction objects)
2. A bank of 20+ exploration events
3. The map/navigation UI component

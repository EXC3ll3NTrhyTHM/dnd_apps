# Dice Roll Synchronization Update

## Overview
Update the Arena battle system to use predetermined dice rolls so all players see synchronized dice animations that land on the same results.

## Current System
- Player rolls dice locally → physics determines result → result sent to server → broadcasted to spectators
- Spectators see a "fake" roll that gets cut short and shows the forced total
- There's a delay between roller seeing result and spectators seeing it
- The `DiceOverlay` component already supports `forcedValues` prop for predetermined outcomes

## New System
1. **Server generates RNG first** - Before any dice animation plays
2. **Broadcast roll event with predetermined values** - All clients receive the same data
3. **All clients play synchronized animation** - Everyone sees dice land on the same numbers
4. **No waiting** - Roller and spectators see the animation at the same time

## Technical Details

### DiceOverlay Props (already implemented)
```jsx
<DiceOverlay
  notation="1d20"           // dice to roll
  colorset="fire"           // visual style
  material="plastic"        // material type
  forcedValues={[17]}       // predetermined results - dice WILL land on these
  onResult={(rolls) => {}}  // callback with final values
  onDone={() => {}}         // animation complete
/>
```

### Files to Update

**Server-side (server/src/routes or similar):**
- When a player initiates an attack/roll, generate the random values server-side
- Include the `rolls` array (individual die values) in the socket broadcast
- Example payload:
```js
{
  type: 'dice_roll',
  oderId,
  odion: '1d20',
  rolls: [17],           // predetermined values
  total: 17,
  modifier: 5,
  finalTotal: 22,
  label: 'Attack Roll',
  colorset: 'fire',      // roller's equipped dice
  material: 'plastic'
}
```

**Arena.jsx:**
- Update `spectatorRoll` handling to use `forcedValues` instead of `forcedTotal`
- The spectator overlay already passes `forcedValues={spectatorRoll.rolls}` (I added this)
- Remove any "early cut" timeout logic for spectator rolls - let them play naturally
- Both local roller and spectators should receive the same predetermined values

**Battle flow changes:**
1. Player clicks "Attack" 
2. Client sends attack intent to server (no local roll yet)
3. Server parses notation and generates appropriate rolls (see below)
4. Server broadcasts roll event to ALL participants (including the attacker)
5. ALL clients play `<DiceOverlay forcedValues={rolls} />` simultaneously
6. Server processes the result and broadcasts damage/effects

**Server-side RNG helper (generate rolls from notation):**
```js
function generateRolls(notation) {
  // Parse notation like "2d20", "4d6", "1d8+1d6"
  const rolls = [];
  const dicePattern = /(\d+)d(\d+)/gi;
  let match;
  
  while ((match = dicePattern.exec(notation)) !== null) {
    const count = parseInt(match[1], 10);  // number of dice
    const sides = parseInt(match[2], 10);  // sides per die (d20 = 20, d6 = 6, etc.)
    
    for (let i = 0; i < count; i++) {
      // Generate 1 to sides (inclusive)
      rolls.push(Math.floor(Math.random() * sides) + 1);
    }
  }
  
  return rolls;
}

// Examples:
// generateRolls("1d20")     → [17]           (1-20)
// generateRolls("2d20")     → [14, 8]        (two d20s)
// generateRolls("4d6")      → [3, 6, 2, 5]   (1-6 each)
// generateRolls("1d8+1d6")  → [7, 4]         (d8 then d6)
// generateRolls("2d10")     → [9, 3]         (1-10 each)
```

### Socket Events to Update

**Current flow:**
```
Player → server: "I want to attack"
Player: *rolls dice locally*
Player → server: "I rolled 17"
Server → others: "Player rolled 17" (spectators see fake roll)
```

**New flow:**
```
Player → server: "I want to attack"
Server: *generates roll: 17*
Server → ALL: "Attack roll happening: [17]"
ALL clients: *play synchronized dice animation landing on 17*
Server: *processes result*
Server → ALL: "Attack hit for 12 damage"
```

### Benefits
- True synchronization - everyone sees the same thing at the same time
- Fairer - RNG happens server-side, can't be manipulated
- Cleaner UX - no awkward delay for spectators
- Predetermined outcomes work perfectly with dice-box-threejs library

### Migration Notes
- Keep `forcedTotal` prop for backwards compatibility during transition
- The `onResult` callback will still fire with the landed values (useful for confirmation)
- Consider adding a brief "rolling..." state while waiting for server response

## Testing
1. Open Arena in two browser windows with different accounts
2. Start a battle with both players
3. Have one player attack
4. Both windows should show dice rolling at the same time, landing on the same number

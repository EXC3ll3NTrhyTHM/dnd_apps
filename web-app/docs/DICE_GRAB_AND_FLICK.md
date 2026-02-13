# Dice Grab-and-Flick: Research & Options

## Current Library: `@3d-dice/dice-box` v1.1.4

### What It Actually Uses (Not What We Expected)
- **Babylon.js** for 3D rendering (NOT Three.js)
- **Ammo.js** (Bullet physics wrapper) for physics (NOT Cannon-ES)
- Physics runs in a **separate Web Worker** — bodies are not on the main thread
- All internals locked behind **WeakMaps** — scene, meshes, camera, engine, physics world are completely inaccessible from the public API

### What's Exposed
- `diceBox.canvas` — DOM element
- `diceBox.config` — configuration
- `diceBox.roll(notation)` — programmatic roll
- `diceBox.updateConfig({ throwForce, spinForce, ... })` — update physics params
- `diceBox.clear()` — remove dice
- `onRollComplete(results)` — callback with roll values

### What's NOT Exposed
- Scene, camera, renderer, engine (Babylon.js)
- Dice mesh objects
- Physics bodies (in worker, can't touch them)
- No raycasting or picking API
- No way to set dice position/velocity directly

---

## Option A: Drag-and-Flick Overlay (Practical, Faster)

Layer a touch-interactive element on top of dice-box. The grabbed die is a visual stand-in; dice-box handles the real physics roll underneath.

### How It Works
1. When dice overlay opens, show a stylized die element (CSS 3D transform or canvas-rendered) centered on screen
2. User taps it → it "sticks" to their finger (position follows pointer with slight spring)
3. As they drag, the die follows and rotates based on movement direction
4. On pointer release, calculate flick velocity from the last N pointer positions
5. Animate the CSS die flying off screen in the flick direction
6. Call `updateConfig({ throwForce })` scaled to flick velocity, then `roll()` on dice-box
7. dice-box 3D dice appear and tumble with matching force
8. `onRollComplete` fires with result as normal

### Pros
- Fast to implement (days, not weeks)
- Reuses all existing dice-box rendering and physics
- Tactile feel: grab, drag, flick, tumble, result
- Harder flick = harder throw (maps to throwForce config)
- No new dependencies

### Cons
- The grabbed object is a CSS/canvas stand-in, not the actual 3D mesh
- Brief visual transition from CSS die → dice-box 3D dice
- Can't interact with dice mid-tumble

### Implementation Notes
- CSS 3D die: use `transform: rotateX() rotateY() rotateZ()` on a div with die face styling
- For non-cubic dice (d20, d8, etc.), use a circular/hexagonal shape with the die label — geometric accuracy of the grabbed object matters less than the tactile interaction
- Track pointer positions in a ring buffer (last 5-10 frames) to calculate velocity on release
- Spring physics for the follow: `position += (target - position) * 0.3` per frame

---

## Option B: Custom Three.js + Cannon-ES Dice Roller (Full Control)

Replace dice-box entirely with a custom implementation using Three.js and Cannon-ES where we own the physics bodies and can manipulate them directly.

### How It Works
1. Three.js scene with ground plane, camera, lights
2. Cannon-ES physics world with dice rigid bodies
3. On pointerdown: raycast to detect die under finger → create PointToPointConstraint attaching die body to a kinematic body that tracks the finger
4. On pointermove: update kinematic body position → die follows via constraint, accumulates velocity naturally
5. On pointerup: remove constraint → die flies with whatever velocity it had from the finger movement
6. Physics simulation continues: die bounces, tumbles, settles
7. Read final face orientation to determine result value

### Pros
- True physics grab-and-throw — die mesh literally follows your finger
- Full control over everything
- Can add effects (glow on grab, particle trails, etc.)
- No visual transitions or stand-ins

### Cons
- Significant implementation effort
- Need to create/source proper die geometries (d4, d6, d8, d10, d12, d20)
- Face detection (reading which face is up) requires per-die-type normal mapping
- Physics tuning (gravity, damping, restitution, ground friction)
- Two 3D libraries in the bundle (Babylon.js still loaded by dice-box for non-combat rolls, plus Three.js)
- Unless we also replace regular dice rolls, we'd have two different dice systems

### Implementation Notes
- Three.js built-in geometries: `IcosahedronGeometry` (d20), `OctahedronGeometry` (d8), `TetrahedronGeometry` (d4), `BoxGeometry` (d6), `DodecahedronGeometry` (d12)
- d10 requires custom geometry (pentagonal trapezohedron)
- Face value detection: store face normal → value mapping, after settle check which face normal points most upward
- Cannon-ES constraint approach: `new CANNON.PointToPointConstraint(dieBody, pivotA, kinematicBody, pivotB)`
- Consider: could replace dice-box for ALL dice rolls (not just combat) to avoid two systems

### Dependencies to Add
- `three` (~150KB gzipped)
- `cannon-es` (~45KB gzipped)
- Could remove `@3d-dice/dice-box` if fully replaced (~Babylon.js is heavy)

---

## Decision: Deferred

Parking this for now. Current auto-roll dice-box integration works. Will revisit after core combat gameplay is solid and fun.

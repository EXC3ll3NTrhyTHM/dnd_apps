# Particle Effects Integration Plan

## Overview

Add dynamic particle effects (smoke, fire, lightning, magic) to the Arena combat system using **three-nebula**, a WebGL particle engine built on Three.js.

---

## Current State

**What exists:**
- `EffectsOverlay.jsx` - Basic CSS effects (lightning, flash, smoke)
- `DiceOverlay.jsx` - 3D dice rolling (lazy loaded)
- Location scenes use CSS keyframe particles (embers, dust, wisps, sparks)
- No Three.js in dependencies yet

**Arena.jsx** (~1500 lines) includes:
- Turn-based combat, initiative system
- WebSocket real-time updates
- Dice rolling integration
- Monster/player sprites on a battle field

---

## Where to Add Particle Effects

### Tier 1: Arena Combat (High Impact)

| Trigger | Effect |
|---------|--------|
| Attack hits | Sparks/slash burst at monster position |
| Critical hit | Bigger explosion + screen shake |
| Attack misses | Subtle whiff/dodge wind |
| Player takes damage | Red hit flash + blood/impact particles |
| Monster dies | Dissolve/explosion particles |
| Spell cast | Magic aura building around caster |

### Tier 2: Status Effects

| Status | Effect |
|--------|--------|
| Burning | Fire particles around sprite |
| Poisoned | Green miasma cloud |
| Defending | Shield shimmer/bubble |
| Stunned | Stars orbiting head |

### Tier 3: Ambient (Lower Priority)

| Location | Effect |
|----------|--------|
| Dojo | Upgrade CSS embers → real fire particles |
| Arena entrance | Dust motes, torch flames |
| Victory screen | Celebratory sparks/confetti |

---

## Recommended Library

**three-nebula**
- Site + Editor: https://three-nebula.org/
- GitHub: https://github.com/creativelifeform/three-nebula
- Visual editor to design effects, export as JSON
- Built for games/RPGs

**What it handles:**
- Fire, smoke, sparks, magic auras
- Color shifts, alpha fade, gravity, forces
- Texture-based or geometry-based particles

---

## Implementation Plan

### Step 1: Install Dependencies

```bash
cd web-app/client
npm install three three-nebula
```

### Step 2: Create ArenaParticles Component

Create `src/components/ArenaParticles.jsx`:

```jsx
import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import System, { SpriteRenderer } from 'three-nebula';

// Import effect JSONs
import hitEffect from '../effects/hit.json';
import critEffect from '../effects/crit.json';
import deathEffect from '../effects/death.json';

const EFFECTS = {
  hit: hitEffect,
  crit: critEffect,
  death: deathEffect,
};

export default function ArenaParticles({ containerRef }) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const systemRef = useRef(null);

  // Initialize Three.js scene
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef?.current || document.body;
    const { width, height } = container.getBoundingClientRect();

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera (orthographic for 2D overlay)
    const camera = new THREE.OrthographicCamera(
      -width / 2, width / 2,
      height / 2, -height / 2,
      0.1, 1000
    );
    camera.position.z = 100;
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    rendererRef.current = renderer;

    // Animation loop
    let frameId;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      if (systemRef.current) {
        systemRef.current.update();
      }
      renderer.render(scene, camera);
    };
    animate();

    // Cleanup
    return () => {
      cancelAnimationFrame(frameId);
      renderer.dispose();
    };
  }, []);

  // Trigger an effect at a position
  const triggerEffect = useCallback(async (effectName, position = { x: 0, y: 0 }) => {
    const effectJson = EFFECTS[effectName];
    if (!effectJson || !sceneRef.current) return;

    try {
      const system = await System.fromJSONAsync(effectJson, THREE);
      const renderer = new SpriteRenderer(sceneRef.current, THREE);
      system.addRenderer(renderer);
      
      // Position the emitter
      system.emitters.forEach(emitter => {
        emitter.position.x = position.x;
        emitter.position.y = position.y;
      });

      systemRef.current = system;

      // Auto-cleanup after effect completes
      setTimeout(() => {
        system.destroy();
        if (systemRef.current === system) {
          systemRef.current = null;
        }
      }, 3000);
    } catch (err) {
      console.error('Failed to trigger effect:', err);
    }
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 50,
      }}
    />
  );
}
```

### Step 3: Create Effects Folder

```
src/effects/
├── hit.json        ← Sword slash sparks (design in Nebula editor)
├── crit.json       ← Big explosion burst
├── miss.json       ← Subtle wind/whiff
├── fire.json       ← Burning status loop
├── poison.json     ← Green miasma cloud
├── death.json      ← Monster dissolve/explosion
└── victory.json    ← Celebratory sparks
```

### Step 4: Integrate into Arena.jsx

```jsx
import ArenaParticles from '../components/ArenaParticles';

// In the component:
const particlesRef = useRef(null);
const battleFieldRef = useRef(null);

// When attack hits:
if (isHit) {
  particlesRef.current?.triggerEffect('hit', { x: monsterX, y: monsterY });
}

// When crit:
if (isNat20) {
  particlesRef.current?.triggerEffect('crit', { x: monsterX, y: monsterY });
}

// When monster dies:
if (monster.currentHp <= 0) {
  particlesRef.current?.triggerEffect('death', { x: monsterX, y: monsterY });
}

// In JSX:
<div className="arena-battle-field" ref={battleFieldRef}>
  <ArenaParticles ref={particlesRef} containerRef={battleFieldRef} />
  {/* ... existing battle field content */}
</div>
```

### Step 5: Keep CSS Fallback

Detect WebGL support and fall back gracefully:

```jsx
const hasWebGL = (() => {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && canvas.getContext('webgl'));
  } catch (e) {
    return false;
  }
})();

// Use ArenaParticles if WebGL, else use EffectsOverlay
{hasWebGL ? (
  <ArenaParticles ref={particlesRef} containerRef={battleFieldRef} />
) : (
  <EffectsOverlay effect={currentEffect} onDone={clearEffect} />
)}
```

---

## File Structure After Implementation

```
src/
├── components/
│   ├── ArenaParticles.jsx      ← Three.js particle canvas
│   └── EffectsOverlay.jsx      ← CSS fallback (keep existing)
├── effects/                     ← Nebula JSON exports
│   ├── hit.json
│   ├── crit.json
│   ├── miss.json
│   ├── fire.json
│   ├── poison.json
│   ├── death.json
│   └── victory.json
├── pages/
│   └── Arena.jsx               ← Integrate ArenaParticles
```

---

## Designing Effects

1. Go to https://three-nebula.org/
2. Use the visual editor to create effects
3. Export as JSON
4. Save to `src/effects/` folder
5. Import and use in ArenaParticles

**Tips for effect design:**
- **Fire:** Orange/red particles, rise upward, fade to transparent, flicker scale
- **Smoke:** Gray particles, slow rise, expand over time, low alpha
- **Lightning:** Fast spawn, bright white/blue, very short life, jagged spawn zone
- **Sparks:** Small particles, gravity pulling down, high initial velocity
- **Magic aura:** Orbit around a point, color cycling, glow texture

---

## Status

- [ ] Install three + three-nebula
- [ ] Create ArenaParticles.jsx component
- [ ] Create effects/ folder structure
- [ ] Design hit effect in Nebula editor
- [ ] Design crit effect
- [ ] Design death effect
- [ ] Integrate into Arena.jsx
- [ ] Test on mobile (performance)
- [ ] Add WebGL fallback detection

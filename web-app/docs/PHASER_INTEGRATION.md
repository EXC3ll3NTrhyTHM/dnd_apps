# Phaser Integration Design

*Adding Phaser 3 for fishing, combat particles, and smoke effects.*

---

## Overview

We're adding Phaser 3 as a **targeted game layer** for specific features, not replacing React. Phaser handles:
- **Fishing mini-game** — Physics-based casting and reeling
- **Combat particle effects** — Hits, crits, spell impacts
- **Smoke/atmosphere effects** — Ambient visuals, item use

React stays in charge of UI, chat, menus, and state management.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│         React App (UI Layer)                │
│  - Chat, menus, buttons, HP bars            │
│  - Controls game state                       │
│  - z-index: 100                             │
├─────────────────────────────────────────────┤
│         Phaser Canvas (Game Layer)          │
│  - Fishing scene                            │
│  - Combat particles                         │
│  - Smoke/atmosphere                         │
│  - z-index: 50 (behind UI, above bg)        │
├─────────────────────────────────────────────┤
│         Background (Location Art)           │
│  - Static images                            │
│  - z-index: 1                               │
└─────────────────────────────────────────────┘
```

React communicates with Phaser via:
- **Events** — React emits, Phaser listens (e.g., "play hit effect")
- **Refs** — React holds reference to Phaser game instance
- **Callbacks** — Phaser calls React functions (e.g., "fish caught")

---

## Installation

```bash
cd web-app/client
npm install phaser
```

---

## File Structure

```
client/src/
├── phaser/
│   ├── PhaserGame.jsx          # React wrapper component
│   ├── gameConfig.js           # Phaser config
│   ├── scenes/
│   │   ├── FishingScene.js     # Fishing mini-game
│   │   ├── CombatFXScene.js    # Combat particle effects
│   │   └── SmokeScene.js       # Smoke/atmosphere overlay
│   ├── particles/
│   │   ├── hit.json            # Hit particle config
│   │   ├── crit.json           # Crit particle config
│   │   ├── smoke.json          # Smoke particle config
│   │   └── sparkle.json        # Magic sparkle config
│   └── assets/
│       ├── fishing/
│       │   ├── rod.png
│       │   ├── bobber.png
│       │   ├── fish_shadow.png
│       │   └── splash.png
│       └── particles/
│           ├── smoke.png
│           ├── spark.png
│           ├── blood.png
│           └── star.png
```

---

## 1. React Wrapper Component

```jsx
// client/src/phaser/PhaserGame.jsx

import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import Phaser from 'phaser';
import { gameConfig } from './gameConfig';

const PhaserGame = forwardRef(({ scene, onReady, ...props }, ref) => {
  const gameRef = useRef(null);
  const containerRef = useRef(null);

  useImperativeHandle(ref, () => ({
    game: gameRef.current,
    scene: () => gameRef.current?.scene?.getScene(scene),
    emit: (event, data) => {
      gameRef.current?.events?.emit(event, data);
    },
  }));

  useEffect(() => {
    if (gameRef.current) return;

    const config = {
      ...gameConfig,
      parent: containerRef.current,
      scene: scene,
    };

    gameRef.current = new Phaser.Game(config);
    
    gameRef.current.events.once('ready', () => {
      onReady?.(gameRef.current);
    });

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return (
    <div 
      ref={containerRef} 
      className="phaser-container"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      {...props}
    />
  );
});

export default PhaserGame;
```

---

## 2. Game Config

```javascript
// client/src/phaser/gameConfig.js

import Phaser from 'phaser';

export const gameConfig = {
  type: Phaser.AUTO,
  transparent: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 300 },
      debug: false,
    },
  },
  audio: {
    disableWebAudio: false,
  },
};
```

---

## 3. Fishing Scene

### Game Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   IDLE      │────▶│   CASTING   │────▶│   WAITING   │
│  Tap to     │     │  Swipe to   │     │  Watch for  │
│  start      │     │  cast line  │     │  bite       │
└─────────────┘     └─────────────┘     └─────────────┘
                                              │
                    ┌─────────────┐           │ Fish bites!
                    │   CAUGHT    │◀──────────┤
                    │  Show fish  │           │
                    │  + rewards  │     ┌─────────────┐
                    └─────────────┘     │   HOOKED    │
                          ▲             │  Tap/reel   │
                          │             │  to catch   │
                          └─────────────┴─────────────┘
                                 Success!
```

### Scene Code

```javascript
// client/src/phaser/scenes/FishingScene.js

import Phaser from 'phaser';

export default class FishingScene extends Phaser.Scene {
  constructor() {
    super({ key: 'FishingScene' });
    this.state = 'idle'; // idle, casting, waiting, hooked, reeling, caught, escaped
    this.tension = 0;
    this.maxTension = 100;
  }

  preload() {
    this.load.image('rod', '/assets/fishing/rod.png');
    this.load.image('bobber', '/assets/fishing/bobber.png');
    this.load.image('splash', '/assets/fishing/splash.png');
    this.load.image('fish_shadow', '/assets/fishing/fish_shadow.png');
    this.load.spritesheet('fish', '/assets/fishing/fish_sheet.png', {
      frameWidth: 64,
      frameHeight: 32,
    });
    
    // Particle textures
    this.load.image('water_drop', '/assets/particles/water_drop.png');
    this.load.image('ripple', '/assets/particles/ripple.png');
  }

  create() {
    const { width, height } = this.scale;
    
    // Water surface line
    this.waterLine = height * 0.6;
    
    // Bobber
    this.bobber = this.add.sprite(width / 2, this.waterLine, 'bobber');
    this.bobber.setVisible(false);
    
    // Line (graphics)
    this.line = this.add.graphics();
    
    // Fish shadow (appears when waiting)
    this.fishShadow = this.add.sprite(0, 0, 'fish_shadow');
    this.fishShadow.setVisible(false);
    this.fishShadow.setAlpha(0.3);
    
    // Splash particles
    this.splashEmitter = this.add.particles(0, 0, 'water_drop', {
      speed: { min: 100, max: 200 },
      angle: { min: -120, max: -60 },
      scale: { start: 0.5, end: 0 },
      lifespan: 600,
      gravityY: 400,
      emitting: false,
    });
    
    // Ripple effect
    this.ripples = this.add.particles(0, 0, 'ripple', {
      scale: { start: 0.1, end: 1 },
      alpha: { start: 0.8, end: 0 },
      lifespan: 1000,
      emitting: false,
    });
    
    // Tension bar (UI overlay)
    this.tensionBar = this.add.graphics();
    this.tensionBar.setVisible(false);
    
    // Input
    this.input.on('pointerdown', this.onTap, this);
    this.input.on('pointerup', this.onRelease, this);
    
    // Swipe detection for casting
    this.swipeStart = null;
    this.input.on('pointerdown', (pointer) => {
      this.swipeStart = { x: pointer.x, y: pointer.y, time: Date.now() };
    });
    this.input.on('pointerup', (pointer) => {
      if (this.swipeStart && this.state === 'idle') {
        const dx = pointer.x - this.swipeStart.x;
        const dy = pointer.y - this.swipeStart.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const time = Date.now() - this.swipeStart.time;
        
        // Detect upward swipe
        if (dy < -50 && dist > 80 && time < 500) {
          const power = Math.min(dist / 200, 1); // 0-1 based on swipe length
          this.cast(power);
        }
      }
      this.swipeStart = null;
    });
    
    // Listen for React events
    this.game.events.on('startFishing', this.reset, this);
    this.game.events.on('stopFishing', this.cleanup, this);
  }

  cast(power) {
    this.state = 'casting';
    
    const { width } = this.scale;
    const targetX = width / 2 + (Math.random() - 0.5) * 100;
    const targetY = this.waterLine + 20 + power * 80;
    
    this.bobber.setPosition(width / 2, this.waterLine - 100);
    this.bobber.setVisible(true);
    
    // Animate cast
    this.tweens.add({
      targets: this.bobber,
      x: targetX,
      y: targetY,
      duration: 500 + power * 300,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.splash(targetX, targetY);
        this.state = 'waiting';
        this.waitForBite();
      },
    });
  }

  splash(x, y) {
    this.splashEmitter.setPosition(x, y);
    this.splashEmitter.explode(15);
    this.ripples.setPosition(x, y);
    this.ripples.explode(3);
  }

  waitForBite() {
    // Random wait time (3-10 seconds)
    const waitTime = 3000 + Math.random() * 7000;
    
    // Show fish shadow circling
    this.showFishShadow();
    
    this.time.delayedCall(waitTime, () => {
      if (this.state === 'waiting') {
        this.fishBites();
      }
    });
  }

  showFishShadow() {
    this.fishShadow.setVisible(true);
    const bobberX = this.bobber.x;
    const bobberY = this.bobber.y;
    
    // Circle around bobber
    this.tweens.add({
      targets: this.fishShadow,
      x: { from: bobberX - 60, to: bobberX + 60 },
      y: { from: bobberY + 30, to: bobberY + 50 },
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  fishBites() {
    this.state = 'hooked';
    this.tension = 50;
    
    // Bobber dips
    this.tweens.add({
      targets: this.bobber,
      y: this.bobber.y + 15,
      duration: 100,
      yoyo: true,
      repeat: 2,
    });
    
    // Vibrate/haptic feedback (if supported)
    if (navigator.vibrate) navigator.vibrate(200);
    
    // Show tension bar
    this.tensionBar.setVisible(true);
    
    // Fish fights — tension increases over time
    this.tensionTimer = this.time.addEvent({
      delay: 100,
      callback: () => {
        if (this.state === 'hooked') {
          this.tension += 2 + Math.random() * 3;
          if (this.tension >= this.maxTension) {
            this.fishEscapes();
          }
        }
      },
      loop: true,
    });
    
    // Must tap/reel within window
    this.time.delayedCall(3000, () => {
      if (this.state === 'hooked') {
        this.fishEscapes();
      }
    });
  }

  onTap() {
    if (this.state === 'hooked') {
      // Reduce tension
      this.tension -= 15;
      this.tension = Math.max(0, this.tension);
      
      // Progress toward catch
      this.reelProgress = (this.reelProgress || 0) + 10;
      
      if (this.reelProgress >= 100) {
        this.catchFish();
      }
    }
  }

  onRelease() {
    // Could add "hold to reel" mechanic here
  }

  catchFish() {
    this.state = 'caught';
    this.tensionTimer?.remove();
    this.tensionBar.setVisible(false);
    
    // Determine fish (rarity based on roll)
    const roll = Math.random();
    let fish;
    if (roll > 0.95) fish = { name: 'Golden Carp', rarity: 'legendary', gold: 50 };
    else if (roll > 0.8) fish = { name: 'Rainbow Trout', rarity: 'rare', gold: 20 };
    else if (roll > 0.5) fish = { name: 'Bass', rarity: 'uncommon', gold: 10 };
    else fish = { name: 'Small Fish', rarity: 'common', gold: 3 };
    
    // Emit to React
    this.game.events.emit('fishCaught', fish);
    
    // Play catch animation
    this.splash(this.bobber.x, this.bobber.y);
    
    // Reset after delay
    this.time.delayedCall(2000, () => this.reset());
  }

  fishEscapes() {
    this.state = 'escaped';
    this.tensionTimer?.remove();
    this.tensionBar.setVisible(false);
    
    // Line snaps animation
    this.tweens.add({
      targets: this.bobber,
      y: this.bobber.y + 50,
      alpha: 0,
      duration: 300,
    });
    
    this.game.events.emit('fishEscaped');
    
    this.time.delayedCall(1500, () => this.reset());
  }

  reset() {
    this.state = 'idle';
    this.tension = 0;
    this.reelProgress = 0;
    this.bobber.setVisible(false);
    this.fishShadow.setVisible(false);
    this.tensionBar.setVisible(false);
    this.tweens.killTweensOf(this.fishShadow);
  }

  cleanup() {
    this.reset();
  }

  update() {
    // Draw fishing line
    if (this.bobber.visible) {
      const { width } = this.scale;
      this.line.clear();
      this.line.lineStyle(2, 0xcccccc);
      this.line.beginPath();
      this.line.moveTo(width / 2 + 50, this.waterLine - 150); // Rod tip
      this.line.lineTo(this.bobber.x, this.bobber.y);
      this.line.strokePath();
    }
    
    // Draw tension bar
    if (this.tensionBar.visible) {
      const { width } = this.scale;
      const barWidth = 200;
      const barHeight = 20;
      const barX = (width - barWidth) / 2;
      const barY = 50;
      
      this.tensionBar.clear();
      
      // Background
      this.tensionBar.fillStyle(0x333333);
      this.tensionBar.fillRect(barX, barY, barWidth, barHeight);
      
      // Tension fill (green to red)
      const pct = this.tension / this.maxTension;
      const color = Phaser.Display.Color.Interpolate.ColorWithColor(
        { r: 0, g: 255, b: 0 },
        { r: 255, g: 0, b: 0 },
        100,
        pct * 100
      );
      this.tensionBar.fillStyle(Phaser.Display.Color.GetColor(color.r, color.g, color.b));
      this.tensionBar.fillRect(barX, barY, barWidth * pct, barHeight);
      
      // Border
      this.tensionBar.lineStyle(2, 0xffffff);
      this.tensionBar.strokeRect(barX, barY, barWidth, barHeight);
    }
  }
}
```

---

## 4. Combat FX Scene

Runs as an overlay during Arena combat. React tells it when to play effects.

```javascript
// client/src/phaser/scenes/CombatFXScene.js

import Phaser from 'phaser';

export default class CombatFXScene extends Phaser.Scene {
  constructor() {
    super({ key: 'CombatFXScene' });
  }

  preload() {
    this.load.image('spark', '/assets/particles/spark.png');
    this.load.image('smoke', '/assets/particles/smoke.png');
    this.load.image('blood', '/assets/particles/blood.png');
    this.load.image('star', '/assets/particles/star.png');
    this.load.image('slash', '/assets/particles/slash.png');
  }

  create() {
    // Hit particles (blood/impact)
    this.hitEmitter = this.add.particles(0, 0, 'blood', {
      speed: { min: 50, max: 150 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.4, end: 0 },
      lifespan: 400,
      gravityY: 200,
      emitting: false,
    });

    // Crit particles (stars/sparkles)
    this.critEmitter = this.add.particles(0, 0, 'star', {
      speed: { min: 100, max: 250 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.6, end: 0 },
      lifespan: 800,
      tint: [0xffff00, 0xffa500, 0xff6600],
      emitting: false,
    });

    // Miss particles (smoke puff)
    this.missEmitter = this.add.particles(0, 0, 'smoke', {
      speed: { min: 20, max: 60 },
      angle: { min: -90, max: -60 },
      scale: { start: 0.3, end: 0.8 },
      alpha: { start: 0.6, end: 0 },
      lifespan: 600,
      emitting: false,
    });

    // Slash effect
    this.slashEmitter = this.add.particles(0, 0, 'slash', {
      speed: 0,
      scale: { start: 0.8, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 200,
      emitting: false,
    });

    // Listen for React events
    this.game.events.on('combatHit', this.playHit, this);
    this.game.events.on('combatCrit', this.playCrit, this);
    this.game.events.on('combatMiss', this.playMiss, this);
    this.game.events.on('combatSlash', this.playSlash, this);
  }

  playHit(data) {
    const { x, y, damage } = data;
    this.hitEmitter.setPosition(x, y);
    this.hitEmitter.explode(10 + Math.min(damage, 20));
    
    // Screen shake
    this.cameras.main.shake(100, 0.01);
  }

  playCrit(data) {
    const { x, y, damage } = data;
    
    // Stars burst
    this.critEmitter.setPosition(x, y);
    this.critEmitter.explode(25);
    
    // Bigger shake
    this.cameras.main.shake(200, 0.02);
    
    // Flash
    this.cameras.main.flash(100, 255, 200, 0);
  }

  playMiss(data) {
    const { x, y } = data;
    this.missEmitter.setPosition(x, y);
    this.missEmitter.explode(8);
  }

  playSlash(data) {
    const { x, y, angle } = data;
    this.slashEmitter.setPosition(x, y);
    this.slashEmitter.setAngle(angle || -45);
    this.slashEmitter.explode(1);
  }
}
```

---

## 5. Smoke/Atmosphere Scene

Ambient overlay for locations or item effects.

```javascript
// client/src/phaser/scenes/SmokeScene.js

import Phaser from 'phaser';

export default class SmokeScene extends Phaser.Scene {
  constructor() {
    super({ key: 'SmokeScene' });
  }

  preload() {
    this.load.image('smoke', '/assets/particles/smoke.png');
    this.load.image('ember', '/assets/particles/ember.png');
    this.load.image('mist', '/assets/particles/mist.png');
  }

  create() {
    const { width, height } = this.scale;

    // Ambient smoke (rises slowly)
    this.ambientSmoke = this.add.particles(0, 0, 'smoke', {
      x: { min: 0, max: width },
      y: height + 50,
      speedY: { min: -30, max: -60 },
      speedX: { min: -10, max: 10 },
      scale: { start: 0.2, end: 0.6 },
      alpha: { start: 0.4, end: 0 },
      lifespan: 8000,
      frequency: 500,
      tint: 0x666666,
      emitting: false,
    });

    // Tavern smoke (thicker, warmer)
    this.tavernSmoke = this.add.particles(0, 0, 'smoke', {
      x: { min: width * 0.3, max: width * 0.7 },
      y: height * 0.7,
      speedY: { min: -20, max: -40 },
      speedX: { min: -5, max: 5 },
      scale: { start: 0.3, end: 0.8 },
      alpha: { start: 0.3, end: 0 },
      lifespan: 6000,
      frequency: 800,
      tint: 0x886644,
      emitting: false,
    });

    // Embers (for forge, campfire, arena)
    this.embers = this.add.particles(0, 0, 'ember', {
      x: { min: 0, max: width },
      y: height + 20,
      speedY: { min: -80, max: -150 },
      speedX: { min: -20, max: 20 },
      scale: { start: 0.3, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 3000,
      frequency: 200,
      tint: [0xff6600, 0xff3300, 0xffaa00],
      emitting: false,
    });

    // Mist (for mysterious locations)
    this.mist = this.add.particles(0, 0, 'mist', {
      x: { min: -100, max: width + 100 },
      y: { min: height * 0.5, max: height },
      speedX: { min: 10, max: 30 },
      scale: { start: 1, end: 1.5 },
      alpha: { start: 0.2, end: 0 },
      lifespan: 10000,
      frequency: 1000,
      emitting: false,
    });

    // Item use burst (blunt, potion, etc.)
    this.itemBurst = this.add.particles(0, 0, 'smoke', {
      speed: { min: 30, max: 80 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.2, end: 0.6 },
      alpha: { start: 0.7, end: 0 },
      lifespan: 1500,
      emitting: false,
    });

    // Listen for React events
    this.game.events.on('setAtmosphere', this.setAtmosphere, this);
    this.game.events.on('itemSmoke', this.playItemSmoke, this);
    this.game.events.on('clearAtmosphere', this.clearAll, this);
  }

  setAtmosphere(type) {
    this.clearAll();
    
    switch (type) {
      case 'tavern':
        this.tavernSmoke.start();
        break;
      case 'arena':
        this.embers.start();
        this.ambientSmoke.start();
        break;
      case 'forest':
        this.mist.start();
        break;
      case 'dungeon':
        this.ambientSmoke.start();
        break;
      default:
        break;
    }
  }

  playItemSmoke(data) {
    const { x, y, color, intensity } = data;
    
    this.itemBurst.setPosition(x, y);
    if (color) this.itemBurst.setTint(color);
    this.itemBurst.explode(intensity || 20);
  }

  clearAll() {
    this.ambientSmoke.stop();
    this.tavernSmoke.stop();
    this.embers.stop();
    this.mist.stop();
  }
}
```

---

## 6. React Integration Examples

### Fishing Page

```jsx
// client/src/pages/Fishing.jsx

import { useRef, useCallback, useState } from 'react';
import PhaserGame from '../phaser/PhaserGame';
import FishingScene from '../phaser/scenes/FishingScene';

export default function Fishing() {
  const gameRef = useRef(null);
  const [lastCatch, setLastCatch] = useState(null);
  const [message, setMessage] = useState('Swipe up to cast!');

  const handleReady = useCallback((game) => {
    game.events.on('fishCaught', (fish) => {
      setLastCatch(fish);
      setMessage(`You caught a ${fish.name}! +${fish.gold} gold`);
    });
    
    game.events.on('fishEscaped', () => {
      setMessage('The fish got away! Try again.');
    });
  }, []);

  return (
    <div className="fishing-page">
      <PhaserGame 
        ref={gameRef}
        scene={FishingScene}
        onReady={handleReady}
      />
      
      {/* React UI overlay */}
      <div className="fishing-ui">
        <div className="fishing-message">{message}</div>
        {lastCatch && (
          <div className={`catch-popup ${lastCatch.rarity}`}>
            🐟 {lastCatch.name}
          </div>
        )}
      </div>
    </div>
  );
}
```

### Arena Combat FX

```jsx
// In Arena.jsx, add to existing component

import PhaserGame from '../phaser/PhaserGame';
import CombatFXScene from '../phaser/scenes/CombatFXScene';

// Inside the component:
const fxRef = useRef(null);

// When attack hits:
const playHitEffect = (damage, isPlayer) => {
  const { width, height } = window;
  const x = isPlayer ? width * 0.7 : width * 0.3;
  const y = height * 0.4;
  
  if (attackResult.isNat20) {
    fxRef.current?.emit('combatCrit', { x, y, damage });
  } else {
    fxRef.current?.emit('combatHit', { x, y, damage });
  }
};

// In render:
<PhaserGame 
  ref={fxRef}
  scene={CombatFXScene}
  style={{ pointerEvents: 'none' }}
/>
```

### Location Atmosphere

```jsx
// In LocationChat.jsx or wherever location is rendered

import { useEffect, useRef } from 'react';
import PhaserGame from '../phaser/PhaserGame';
import SmokeScene from '../phaser/scenes/SmokeScene';

const atmosphereRef = useRef(null);

useEffect(() => {
  // Set atmosphere based on location
  const atmosphereMap = {
    'the_dragons_flagon': 'tavern',
    'the_arena': 'arena',
    'darkwood_forest': 'forest',
  };
  
  const type = atmosphereMap[locationId];
  if (type) {
    atmosphereRef.current?.emit('setAtmosphere', type);
  }
  
  return () => {
    atmosphereRef.current?.emit('clearAtmosphere');
  };
}, [locationId]);

// In render (behind chat, above background):
<PhaserGame 
  ref={atmosphereRef}
  scene={SmokeScene}
  style={{ pointerEvents: 'none', zIndex: 5 }}
/>
```

---

## 7. Particle Assets Needed

Simple 32x32 or 64x64 PNGs with transparency:

| Asset | Description |
|-------|-------------|
| `smoke.png` | Soft white/gray cloud |
| `spark.png` | Small bright dot |
| `blood.png` | Red droplet |
| `star.png` | 4 or 6 point star |
| `slash.png` | Diagonal slash mark |
| `ember.png` | Orange/red glow dot |
| `mist.png` | Wide soft cloud |
| `water_drop.png` | Blue droplet |
| `ripple.png` | Circular ring |

Can generate these with AI or grab from free asset packs (itch.io, OpenGameArt).

---

## 8. Implementation Phases

### Phase 1: Setup + Smoke
- [ ] Install Phaser
- [ ] Create wrapper component
- [ ] Build SmokeScene
- [ ] Add to tavern location
- [ ] Test atmosphere switching

### Phase 2: Combat FX
- [ ] Build CombatFXScene
- [ ] Integrate with Arena
- [ ] Hook up hit/crit/miss events
- [ ] Add screen shake
- [ ] Test with real combat

### Phase 3: Fishing
- [ ] Build FishingScene
- [ ] Create fishing assets
- [ ] Implement cast/wait/reel flow
- [ ] Add fish variety + rewards
- [ ] Replace current fishing overlay
- [ ] Add to proper location

---

## Notes

- **Performance**: Phaser is lightweight but watch particle counts on mobile. Keep emitter `quantity` reasonable (< 50 per burst).
- **Memory**: Destroy scenes when leaving locations. Don't leave emitters running.
- **Touch**: Phaser handles touch natively. `pointerdown` works for both mouse and touch.
- **Transparency**: Set `transparent: true` in config so React UI shows through.

# Location Scenes

Custom scene components for each location. Each location can have its own unique visual design, interactions, and effects.

## Structure

```
scenes/
├── index.js          # Scene registry - maps locationId to components
├── SceneBase.jsx     # Shared components & hooks for all scenes
├── DojoScene.jsx     # The Dojo custom scene
└── README.md         # This file
```

## Adding a New Scene

1. **Create the scene component** (e.g., `TavernScene.jsx`):

```jsx
import { useNavigate } from 'react-router-dom';
import { api } from '../../hooks/useApi';
import {
  NpcSprite,
  SceneHeader,
  GatheringSpot,
  EditPanel,
  useSceneEditor
} from './SceneBase';
import '../../styles/location-scene.css';

export default function TavernScene({ 
  location, 
  isAdmin, 
  onNpcClick, 
  onGatheringClick,
  onLocationUpdate,
  setToast 
}) {
  const navigate = useNavigate();
  const { scene } = location;
  const editor = useSceneEditor(scene.npcPlacements);
  
  // ... your custom scene implementation
}
```

2. **Register in `index.js`**:

```js
import TavernScene from './TavernScene';

const SCENE_REGISTRY = {
  'the_dojo': DojoScene,
  'dragons_hollow': TavernScene,  // Add this
};
```

3. **Add scene config to `locations.json`**:

```json
{
  "dragons_hollow": {
    "scene": {
      "background": "/images/scenes/tavern.png",
      "particles": {
        "enabled": true,
        "type": "embers",
        "color": "rgba(255, 150, 50, 0.8)",
        "count": 4,
        "speed": 4
      },
      "gatheringSpot": { ... },
      "npcPlacements": { ... }
    }
  }
}
```

## Available Particle Types

- `embers` - Rising flickering particles (fire, forges)
- `magic` - Sparkle and drift (arcane locations)
- `dust` - Slow drift (old ruins, libraries)
- `wisps` - Ethereal float (mystical locations)

## Shared Components (SceneBase.jsx)

- `<NpcSprite>` - NPC with sprite, particles, and hitbox
- `<SceneHeader>` - Header with back button, title, edit controls
- `<GatheringSpot>` - Clickable area for group chat
- `<EditPanel>` - Admin controls for positioning NPCs
- `<ParticleLayer>` - Configurable particle effects
- `useSceneEditor()` - Hook for edit mode state/handlers

## Props Passed to Scene Components

| Prop | Type | Description |
|------|------|-------------|
| `location` | Object | Location data including scene config |
| `isAdmin` | Boolean | Whether user can edit |
| `onNpcClick` | Function | Called when NPC clicked (npcId) |
| `onGatheringClick` | Function | Called when gathering spot clicked |
| `onLocationUpdate` | Function | Call to update location state |
| `setToast` | Function | Show toast notification |

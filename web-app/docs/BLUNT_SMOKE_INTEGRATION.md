# Blunt Smoke Effect Integration

## Install Dependencies

```bash
cd web-app/client
npm install three three-nebula
```

## Component Created

`src/components/BluntSmokeOverlay.jsx` - Three.js particle smoke effect that:
- Rises from bottom of screen
- Two emitter layers (dense smoke + wispy tendrils)
- Fills ~60% of screen
- Runs for ~7 seconds total (3s emit + 4s fade)
- Auto-cleans up

## Integration in LocationChat.jsx

### 1. Add imports and state

```jsx
// At top of file
import { useState, lazy, Suspense } from 'react';
const BluntSmokeOverlay = lazy(() => import('../components/BluntSmokeOverlay'));

// Inside component
const [showBluntSmoke, setShowBluntSmoke] = useState(false);
```

### 2. Modify handleUseItem

Find the existing `handleUseItem` function and update it:

```jsx
const handleUseItem = useCallback(async (itemId) => {
  try {
    const data = await api('/api/shop/use', {
      method: 'POST',
      body: JSON.stringify({ item_id: itemId, locationId })
    });
    if (data.success) {
      // Check if it's a blunt/smokeable item
      if (itemId === 'blunt' || itemId.includes('blunt') || itemId.includes('joint')) {
        setShowBluntSmoke(true); // Trigger Three.js smoke
      } else {
        triggerEffect('smoke'); // Regular CSS smoke for other items
      }
      
      const characterName = user?.characterName || user?.global_name || user?.username || 'You';
      const actionMsg = {
        role: 'system',
        text: `*${characterName} ${data.use_message}*`,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, actionMsg]);
    }
    return data.inventory;
  } catch (err) {
    setToast({ type: 'error', message: err.data?.error || err.message || 'Failed to use item' });
    throw err;
  }
}, [locationId, user, triggerEffect]);
```

### 3. Add the overlay to JSX

Add this near the end of the component's return, before the closing `</div>`:

```jsx
{/* Blunt smoke effect */}
{showBluntSmoke && (
  <Suspense fallback={null}>
    <BluntSmokeOverlay onDone={() => setShowBluntSmoke(false)} />
  </Suspense>
)}
```

## Customization

### Adjust smoke density
In `BluntSmokeOverlay.jsx`, find the `setRate` calls:
```jsx
.setRate(new Rate(new Span(8, 15), new Span(0.05, 0.1)))
//                     ^^^^^^^  particles per burst
//                                    ^^^^^^^^^^^^  seconds between bursts
```

### Adjust smoke color
Find the `Color` behavior:
```jsx
new Color(
  new THREE.Color('#a8a095'), // Start color (warm gray)
  new THREE.Color('#6b6560')  // End color (darker gray)
),
```

### Adjust duration
- `3000` ms - When to stop emitting new particles
- `7000` ms - When to call onDone and unmount

### Adjust rise speed
```jsx
new Force(0, 20, 0), // Y force - higher = faster rise
new Velocity(new Span(80, 150), ...) // Initial velocity range
```

## Testing

1. Make sure you have a "blunt" item in your shop/inventory
2. Use it from the chat keyboard inventory panel
3. Smoke should rise from bottom and fill screen

## Fallback

If WebGL isn't available or crashes, the component will just unmount after the timeout. You could add error boundary handling to fall back to the CSS smoke effect if needed.

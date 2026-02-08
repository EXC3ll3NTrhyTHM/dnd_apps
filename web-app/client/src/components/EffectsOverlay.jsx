import { useState, useEffect, useCallback } from 'react';

/**
 * Fullscreen effects overlay that renders ABOVE the custom keyboard.
 * Use triggerEffect() from parent to fire a named effect.
 *
 * z-index: 200 (keyboard is 100, effects layer covers everything)
 */
export default function EffectsOverlay({ effect, onDone }) {
  if (!effect) return null;

  return (
    <div className="fx-overlay" onAnimationEnd={onDone}>
      {effect === 'lightning' && <LightningEffect />}
      {effect === 'flash' && <FlashEffect />}
    </div>
  );
}

/* ── Built-in Effects ── */

function LightningEffect() {
  return (
    <>
      <div className="fx-lightning-bolt" />
      <div className="fx-lightning-flash" />
    </>
  );
}

function FlashEffect() {
  return <div className="fx-flash" />;
}

/**
 * Hook for parent to trigger effects.
 * Returns [currentEffect, triggerEffect, clearEffect].
 */
export function useEffects() {
  const [effect, setEffect] = useState(null);

  const trigger = useCallback((name) => {
    setEffect(null);
    // Force re-mount by clearing first
    requestAnimationFrame(() => setEffect(name));
  }, []);

  const clear = useCallback(() => setEffect(null), []);

  return [effect, trigger, clear];
}

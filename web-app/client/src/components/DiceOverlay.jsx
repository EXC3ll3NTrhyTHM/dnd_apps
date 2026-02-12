import { useEffect, useRef, useState } from 'react';
import DiceBox from '@3d-dice/dice-box';
import '../styles/dice-overlay.css';

/**
 * Full-screen overlay that renders 3D dice animation using @3d-dice/dice-box.
 * Captures the physics result and sends it back via onResult callback.
 */
export default function DiceOverlay({ notation, themeColor = '#F97316', onResult, onDone }) {
  const containerRef = useRef(null);
  const diceBoxRef = useRef(null);
  const initRef = useRef(false);
  const clearTimerRef = useRef(null);
  const mountedRef = useRef(true);
  const propsRef = useRef({ notation, themeColor, onResult, onDone });
  propsRef.current = { notation, themeColor, onResult, onDone };
  const [resultTotal, setResultTotal] = useState(null);

  useEffect(() => {
    mountedRef.current = true;

    if (initRef.current) return;
    initRef.current = true;

    function buildVisualNotation(n) {
      if (!n) return null;
      const parts = n.replace(/\s/g, '').match(/(\d+d\d+)/gi);
      if (!parts) return null;
      return parts.join('+');
    }

    const init = async () => {
      const { notation: n, themeColor: tc } = propsRef.current;
      try {
        if (!mountedRef.current || !containerRef.current) return;

        const box = new DiceBox({
          container: '#dice-overlay-canvas',
          assetPath: '/assets/dice-box/',
          theme: 'default',
          themeColor: tc,
          offscreen: false,
          scale: 6,
          gravity: 2,
          mass: 1,
          friction: 0.8,
          restitution: 0.5,
          linearDamping: 0.5,
          angularDamping: 0.4,
          settleTimeout: 5000,
          delay: 10,
          enableShadows: true,
          lightIntensity: 1,
          onRollComplete: (results) => {
            // Extract individual die values from dice-box results
            const rolls = [];
            let total = 0;
            if (results && results.length > 0) {
              for (const group of results) {
                if (group.rolls) {
                  for (const die of group.rolls) {
                    rolls.push(die.value);
                    total += die.value;
                  }
                }
              }
            }

            if (mountedRef.current) {
              setResultTotal(total);
              // Send the physics results back to be saved
              propsRef.current.onResult?.(rolls);
            }

            clearTimerRef.current = setTimeout(() => {
              if (mountedRef.current) {
                try { box.clear(); } catch {}
                propsRef.current.onDone?.();
              }
            }, 2000);
          },
        });

        await box.init();
        if (!mountedRef.current) return;

        diceBoxRef.current = box;

        const rollNotation = buildVisualNotation(n);
        if (rollNotation) {
          box.roll(rollNotation);
        } else {
          setTimeout(() => propsRef.current.onDone?.(), 500);
        }
      } catch (err) {
        console.error('[DiceOverlay] Failed:', err);
        setTimeout(() => propsRef.current.onDone?.(), 1000);
      }
    };

    const safetyTimer = setTimeout(() => {
      if (mountedRef.current && !diceBoxRef.current) {
        propsRef.current.onDone?.();
      }
    }, 10000);

    init();

    return () => {
      mountedRef.current = false;
      clearTimeout(clearTimerRef.current);
      clearTimeout(safetyTimer);
      if (diceBoxRef.current) {
        try { diceBoxRef.current.clear(); } catch {}
      }
    };
  }, []);

  return (
    <div className="dice-overlay">
      <div id="dice-overlay-canvas" ref={containerRef} className="dice-overlay-canvas" />
      {resultTotal != null && (
        <div className="dice-result-banner">
          <span className="dice-result-notation">{notation}</span>
          <span className="dice-result-total">{resultTotal}</span>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import DiceBox from '@3d-dice/dice-box-threejs';
import { preloadDiceSounds, handleDiceCollide } from '../lib/diceAudio';
import '../styles/dice-overlay.css';

// ── Persistent DiceBox singleton ───────────────────────────────────────
// One DiceBox, one WebGL context, reused for every roll. The library's
// own `updateConfig()` swaps colorset/material between rolls, and
// `roll()` internally calls `clearDice()` before spawning new dice.
// The canvas is reparented into whichever container is currently mounted.

let _box = null;
let _initPromise = null;
let _onRollComplete = null;
let _onContextLost = null;

// ── WebGL context tracking ──
// ── WebGL context tracking ──
const _stats = { created: 0, rolls: 0, configUpdates: 0, lost: 0 };
let _fatalError = false;
// Tracking current state to avoid redundant updates/leaks
let _currentConfig = { colorset: null, material: null };

function logStats(action, detail) {
  console.log(
    `%c[DiceBox] %c${action}%c  ${detail || ''}` +
    `\n  created: ${_stats.created}  rolls: ${_stats.rolls}  configUpdates: ${_stats.configUpdates}  lost: ${_stats.lost}`,
    'color: #888', 'color: #f5a623; font-weight: bold', 'color: #ccc'
  );
}

// Helper: aggressively clean up materials/textures from the scene
function disposeSceneMaterials() {
  if (!_box || !_box.scene) return;
  try {
    _box.scene.traverse((node) => {
      if (node.isMesh) {
        if (node.material) {
          // Dispose textures map, bumpMap, normalMap, etc.
          ['map', 'bumpMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap'].forEach(key => {
            if (node.material[key]) node.material[key].dispose();
          });
          node.material.dispose();
        }
        if (node.geometry) node.geometry.dispose();
      }
    });
    // Optional: force renderer to clear
    // _box.renderer.renderLists.dispose();
  } catch (e) {
    console.warn('[DiceBox] Cleanup error:', e);
  }
}

async function acquireBox(containerId, config) {
  if (_fatalError) throw new Error('DiceBox disabled due to previous error');

  const { onRollComplete, onContextLost, ...boxConfig } = config;

  _onRollComplete = onRollComplete;
  _onContextLost = onContextLost;

  // ── Hard Reset Check (iOS Memory Leak Protection) ──
  // If we've rolled many times, the library might have leaked textures or physics bodies.
  if (_box && _stats.rolls >= 9) {
    console.warn('[DiceBox] Executing periodic hard reset to free resources...');
    try {
      const gl = _box.renderer?.getContext();
      if (gl) {
        const ext = gl.getExtension('WEBGL_losing_context');
        if (ext) ext.loseContext();
      }
      _box.renderer?.dispose();
    } catch (e) {
      console.warn('[DiceBox] Disposal error:', e);
    }
    _box = null;
    _stats.rolls = 0;
    _currentConfig = { colorset: null, material: null };
  }

  // ── Reuse path: move canvas into new container, update colorset ──
  if (_box) {
    const container = document.getElementById(containerId);
    const canvas = _box.renderer?.domElement;
    if (container && canvas) {
      container.appendChild(canvas);
      _box.container = container;
    }

    // Determine target config
    const targetColorset = boxConfig.theme_colorset || (boxConfig.theme_customColorset ? 'custom' : null);
    const targetMaterial = boxConfig.theme_material;

    // Check if we actually need to update anything (PREVENT REDUNDANT TEXTURE LOADS)
    // Check if we actually need to update anything (PREVENT REDUNDANT TEXTURE LOADS)
    // For custom colorsets, we must compare the content, not just the string 'custom'
    const targetCustomJson = targetColorset === 'custom' ? JSON.stringify(boxConfig.theme_customColorset) : null;
    const currentCustomJson = (typeof _currentConfig !== 'undefined') ? _currentConfig.customJson : null;

    // Force update if we just disposed everything (which we always do now to be safe)
    const needsUpdate = true;
    /*
      targetColorset !== _currentConfig.colorset ||
      targetMaterial !== _currentConfig.material ||
      (targetColorset === 'custom' && targetCustomJson !== currentCustomJson);
    */

    if (needsUpdate) {
      // Clean up OLD textures before loading NEW ones
      // critical: We must do this while the dice are still in the scene (from previous roll)
      console.log('[DiceBox] Disposing old materials/textures...');
      disposeSceneMaterials();
      try { _box.clearDice(); } catch (e) { console.warn('Clear error', e); }

      const update = {};
      if (boxConfig.theme_colorset) update.theme_colorset = boxConfig.theme_colorset;
      if (boxConfig.theme_material) update.theme_material = boxConfig.theme_material;
      if (boxConfig.theme_customColorset) update.theme_customColorset = boxConfig.theme_customColorset;

      if (Object.keys(update).length) {
        try {
          await _box.updateConfig(update);
          _stats.configUpdates++;
          _currentConfig = {
            colorset: targetColorset,
            material: targetMaterial,
            customJson: targetCustomJson
          };
          logStats('CONFIG UPDATE', `colorset: ${targetColorset}`);
        } catch (err) {
          console.warn('[DiceBox] updateConfig failed:', err);
        }
      }
    } else {
      // logStats('SKIP UPDATE', 'Config identical to cache');
    }

    return _box;
  }

  // ── Wait if another init is in flight ──
  if (_initPromise) {
    try { await _initPromise; } catch { }
    if (_box) return acquireBox(containerId, config);
    // If init failed, fall through to create new or throw
  }

  // ── First-time creation with Safety Timeout ──
  _initPromise = (async () => {
    try {
      // Race creation against a 5s timeout to prevent hanging the app on mobile
      const boxPromise = new Promise(async (resolve, reject) => {
        try {
          const box = new DiceBox(`#${containerId}`, {
            ...boxConfig,
            // Delegate to the module-level variable, which is updated by every acquireBox call
            onRollComplete: (results) => _onRollComplete?.(results),
          });
          await box.initialize();
          resolve(box);
        } catch (e) { reject(e); }
      });

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('DiceBox init timed out')), 5000)
      );

      const box = await Promise.race([boxPromise, timeoutPromise]);

      box.eventCollide = handleDiceCollide;

      const canvas = box.renderer?.domElement;
      if (canvas) {
        canvas.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          _box = null;
          _stats.lost++;
          logStats('CONTEXT LOST', 'WebGL context was killed');
          _onContextLost?.();
        });
      }

      _box = box;
      _stats.created++;
      logStats('CREATE', `colorset: ${boxConfig.theme_colorset || boxConfig.theme_customColorset?.background?.[0] || '?'}`);
      return box;
    } catch (err) {
      console.error('[DiceBox] Init failed or timed out:', err);
      _fatalError = true; // Disable for future attempts in this session
      throw err;
    } finally {
      _initPromise = null;
    }
  })();

  return _initPromise;
}

// ────────────────────────────────────────────────────────────────────────

/**
 * Full-screen overlay that renders 3D dice animation using @3d-dice/dice-box-threejs.
 * Supports colorsets with textures (fire, ice, skulls, etc.) and predetermined outcomes.
 */
export default function DiceOverlay({
  notation,
  colorset = 'white',
  material = 'plastic',
  modifier,
  forcedValues,
  forcedTotal,
  advantageType,
  label,
  onResult,
  onDone
}) {
  const containerRef = useRef(null);
  const diceBoxRef = useRef(null);
  const initRef = useRef(false);
  const clearTimerRef = useRef(null);
  const mountedRef = useRef(true);
  const propsRef = useRef({ notation, colorset, material, forcedValues, forcedTotal, onResult, onDone, advantageType });
  propsRef.current = { notation, colorset, material, forcedValues, forcedTotal, onResult, onDone, advantageType };
  const [resultTotal, setResultTotal] = useState(null);
  const [resultRolls, setResultRolls] = useState(null);
  const [canvasId] = useState(() => `dice-overlay-canvas-${Date.now()}`);

  // Unique ID for this specific overlay instance to claim ownership of the global callback
  const overlayIdRef = useRef(Math.random().toString(36).substring(7));

  useEffect(() => {
    mountedRef.current = true;

    if (_fatalError) {
      // If 3D dice are broken/crashed, immediately finish (Arena will fallback to RNG)
      console.warn('[DiceOverlay] 3D dice disabled due to error, skipping...');
      propsRef.current.onDone?.();
      return;
    }

    if (initRef.current) return;
    initRef.current = true;

    function buildNotation(n, forced) {
      if (!n) return null;
      const parts = n.replace(/\s/g, '').match(/(\d+d\d+)/gi);
      if (!parts) return null;

      if (forced && forced.length > 0) {
        const firstPart = parts[0];
        const forcedStr = forced.join(',');
        parts[0] = `${firstPart}@${forcedStr}`;
      }

      return parts.join('+');
    }

    const init = async () => {
      preloadDiceSounds();
      const { notation: n, colorset: cs, material: mat, forcedValues: fv } = propsRef.current;
      try {
        if (!mountedRef.current || !containerRef.current) return;

        const isHex = typeof cs === 'string' && cs.startsWith('#');
        const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
          || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

        const config = {
          assetPath: '/assets/dice-box-threejs/',
          theme_material: mat,
          gravity_multiplier: 350,
          light_intensity: 0.8,
          baseScale: 100,
          strength: 2.5,
          iterationLimit: isiOS ? 1000 : 2000,
          shadows: !isiOS,
          sounds: false,
          volume: 100,
          sound_dieMaterial: mat || 'plastic',

          // CRITICAL FIX: Only run this callback if WE are still the active overlay owner.
          // This prevents race conditions where a previous overlay unmounts (nulling globals)
          // while this one is still initializing, or vice versa.
          onRollComplete: (results) => {
            if (!mountedRef.current) return;

            const rolls = [];
            let total = results?.total ?? 0;

            if (results?.sets) {
              for (const set of results.sets) {
                if (set.rolls) {
                  for (const die of set.rolls) {
                    rolls.push(die.value);
                  }
                }
              }
            }

            const advType = propsRef.current.advantageType;
            if (advType && rolls.length >= 2) {
              const selected = advType === 'advantage' ? Math.max(...rolls) : Math.min(...rolls);
              setResultTotal(selected);
              setResultRolls(rolls);
            } else {
              setResultTotal(total);
            }

            propsRef.current.onResult?.(rolls);

            // Log memory stats for debugging
            if (window.performance && window.performance.memory) {
              console.log(`[Memory] JS Heap: ${Math.round(window.performance.memory.usedJSHeapSize / 1024 / 1024)}MB / ${Math.round(window.performance.memory.jsHeapSizeLimit / 1024 / 1024)}MB`);
            }
            if (diceBoxRef.current?.renderer?.info) {
              console.log('[Memory] Three.js Textures:', diceBoxRef.current.renderer.info.memory.textures);
              console.log('[Memory] Three.js Geometries:', diceBoxRef.current.renderer.info.memory.geometries);
              console.log('[Memory] Render Calls:', diceBoxRef.current.renderer.info.render.calls);
            }
            if (diceBoxRef.current?.scene) {
              console.log('[Memory] Scene Children:', diceBoxRef.current.scene.children.length);
            }
            console.log('[Memory] DOM Canvases:', document.querySelectorAll('canvas').length);

            clearTimerRef.current = setTimeout(() => {
              if (mountedRef.current) {
                try { diceBoxRef.current?.clearDice?.(); } catch { }
                propsRef.current.onDone?.();
              }
            }, 1200);
          },
          onContextLost: () => {
            if (mountedRef.current) {
              propsRef.current.onDone?.();
            }
          },
          // Attach our ID to the config for tracking (passed to acquireBox)
          overlayId: overlayIdRef.current
        };

        if (isHex) {
          config.theme_customColorset = {
            name: `custom-${cs.replace('#', '')}`,
            category: 'Custom',
            foreground: '#ffffff',
            background: [cs],
            outline: '#ffffff',
            texture: mat || 'none',
          };
        } else {
          config.theme_colorset = cs;
        }

        const box = await acquireBox(canvasId, config);
        diceBoxRef.current = box;
        if (!mountedRef.current) return;

        // roll() internally calls clearDice() then spawns + animates new dice
        const rollNotation = buildNotation(n, fv);
        _stats.rolls++;
        logStats('ROLL', rollNotation || '(empty)');
        if (rollNotation) {
          box.roll(rollNotation);
        } else {
          setTimeout(() => propsRef.current.onDone?.(), 500);
        }
      } catch (err) {
        console.error('[DiceOverlay] Failed:', err);
        // On ANY error (init timeout, crash), finish immediately so Arena fallback takes over
        setTimeout(() => propsRef.current.onDone?.(), 100);
      }
    };

    // Safety net: dismiss overlay if physics stalls or WebGL fails
    const isiOSSafety = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
    const safetyTimer = setTimeout(() => {
      if (mountedRef.current) {
        propsRef.current.onDone?.();
      }
    }, isiOSSafety ? 6000 : 10000);

    init();

    return () => {
      mountedRef.current = false;
      clearTimeout(clearTimerRef.current);
      clearTimeout(safetyTimer);

      // CRITICAL FIX: Do NOT null out the global callbacks in cleanup.
      // The next overlay (if any) has already overwritten them in acquireBox.
      // If we null them here, we might kill the callback for a new roll that started
      // just as this one ended.
      // 
      // Instead, we just rely on `mountedRef.current` inside the callback to ignore 
      // events for unmounted components.

      // clearDice removes dice meshes + physics bodies; the box stays alive
      try { _box?.clearDice?.(); } catch { }
    };
  }, []);

  return (
    <div className="dice-overlay">
      <div id={canvasId} ref={containerRef} className="dice-overlay-canvas" />
      {label && resultTotal == null && (
        <div className="dice-rolling-label">{label}</div>
      )}
      {resultTotal != null && (
        <div className="dice-result-banner">
          {label && <span className="dice-result-label">{label}</span>}
          {advantageType && resultRolls && resultRolls.length >= 2 ? (
            <>
              <span className={`dice-result-adv-badge ${advantageType === 'advantage' ? 'dice-adv' : 'dice-dis'}`}>
                {advantageType === 'advantage' ? 'ADVANTAGE' : 'DISADVANTAGE'}
              </span>
              <span className="dice-result-adv-rolls">
                {resultRolls.map((r, i) => (
                  <span key={i} className={r === resultTotal ? 'dice-roll-used' : 'dice-roll-discarded'}>
                    {r}
                    {i < resultRolls.length - 1 && <span className="dice-roll-sep"> | </span>}
                  </span>
                ))}
              </span>
              {modifier ? (
                <>
                  <span className="dice-result-breakdown">{resultTotal} + {modifier}</span>
                  <span className="dice-result-total">{resultTotal + modifier}</span>
                </>
              ) : (
                <span className="dice-result-total">{resultTotal}</span>
              )}
            </>
          ) : (
            <>
              <span className="dice-result-notation">{notation}{modifier ? ` + ${modifier}` : ''}</span>
              {modifier ? (
                <>
                  <span className="dice-result-breakdown">{resultTotal} + {modifier}</span>
                  <span className="dice-result-total">{resultTotal + modifier}</span>
                </>
              ) : (
                <span className="dice-result-total">{resultTotal}</span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

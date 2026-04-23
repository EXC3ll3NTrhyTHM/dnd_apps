import { useEffect, useRef, useState } from 'react';
import DiceBox from '@3d-dice/dice-box-threejs';
import { preloadDiceSounds, handleDiceCollide } from '../lib/diceAudio';
import { registerProbe } from '../lib/memoryTracker';
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
const _stats = { created: 0, rolls: 0, configUpdates: 0, lost: 0 };
let _fatalError = false;
// Tracking current state to avoid redundant updates/leaks
let _currentConfig = { colorset: null, material: null };

// ── Memory leak diagnostic tracking ──
let _prevTexCount = 0;
let _prevGeoCount = 0;
let _totalTexturesCreated = 0;
let _totalTexturesDisposed = 0;

function logStats(/* action, detail */) {
  // Logging disabled
}

/**
 * Get WebGL/dice memory stats for memory monitoring overlay.
 */
export function getDiceWebGLStats() {
  const ri = _box?.renderer?.info;
  const gl = _box?.renderer?.getContext?.();
  const world = _box?.world;
  return {
    textures: ri?.memory?.textures || 0,
    geometries: ri?.memory?.geometries || 0,
    programs: ri?.programs?.length || 0,
    totalCreated: _totalTexturesCreated,
    totalDisposed: _totalTexturesDisposed,
    rolls: _stats.rolls,
    contextLost: _stats.lost,
    contextAlive: gl ? !gl.isContextLost() : false,
    fatalError: _fatalError,
    worldBodies: world?.bodies?.length || 0,
    worldContactMaterials: world?.contactmaterials?.length || 0,
    sceneChildren: _box?.scene?.children?.length || 0,
  };
}
registerProbe('webgl', getDiceWebGLStats);

function logMemoryDelta(label) {
  const ri = _box?.renderer?.info;
  if (!ri) return;
  const tex = ri.memory?.textures || 0;
  const geo = ri.memory?.geometries || 0;
  const texDelta = tex - _prevTexCount;
  const geoDelta = geo - _prevGeoCount;
  const cache = _box?.DiceFactory?.materials_cache
    ? Object.keys(_box.DiceFactory.materials_cache).length : 0;
  const triangles = ri.render?.triangles || 0;
  // Rough GPU memory estimate: each texture ~1MB (1024x1024 RGBA)
  const estimatedGpuMB = (tex * 4 * 1024 * 1024 / (1024 * 1024)).toFixed(1);
  // console.log(
  //   `[Memory] ${label}: textures ${_prevTexCount}→${tex} (${texDelta >= 0 ? '+' : ''}${texDelta}), ` +
  //   `geometries ${_prevGeoCount}→${geo} (${geoDelta >= 0 ? '+' : ''}${geoDelta}), ` +
  //   `cache: ${cache}, triangles: ${triangles}, ~GPU: ${estimatedGpuMB}MB, ` +
  //   `cumulative created/disposed: ${_totalTexturesCreated}/${_totalTexturesDisposed}`
  // );
  _prevTexCount = tex;
  _prevGeoCount = geo;
}

// ── Core memory leak fix ─────────────────────────────────────────────
// Three.js renderer internally tracks every texture that's been uploaded
// to the GPU. Removing a mesh from the scene does NOT free its textures.
// We must explicitly call .dispose() on each texture/material before
// clearing dice, otherwise they accumulate ~40 textures per roll until
// iOS kills the WebGL context.

function disposeDiceMeshTextures(target) {
  if (!target?.scene) return 0;
  let disposed = 0;
  target.scene.traverse((node) => {
    if (!node.isMesh) return;
    // Skip the floor plane (≤4 vertices) — only target dice meshes
    if ((node.geometry?.attributes?.position?.count || 0) <= 4) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    mats.forEach(mat => {
      if (!mat) return;
      if (mat.map) { mat.map.dispose(); disposed++; }
      if (mat.bumpMap) { mat.bumpMap.dispose(); disposed++; }
      if (mat.normalMap) { mat.normalMap.dispose(); disposed++; }
      if (mat.envMap) { mat.envMap.dispose(); disposed++; }
      mat.dispose();
    });
  });
  return disposed;
}

function disposeMatCache(target) {
  const cache = target?.DiceFactory?.materials_cache;
  if (!cache) return 0;
  const keys = Object.keys(cache);
  let disposed = 0;
  // Cache entries are { composite: CanvasTexture, bump: CanvasTexture|null }
  // NOT Material objects — so .map doesn't exist on them.
  keys.forEach(key => {
    const entry = cache[key];
    if (entry?.composite?.dispose) { entry.composite.dispose(); disposed++; }
    if (entry?.bump?.dispose) { entry.bump.dispose(); disposed++; }
  });
  target.DiceFactory.materials_cache = {};
  return disposed;
}

function disposeDiceMeshGeometries(target) {
  if (!target?.scene) return 0;
  // Collect shared geometry references from the DiceFactory cache — never dispose those
  const sharedGeos = new Set();
  const geoCache = target.DiceFactory?.geometries;
  if (geoCache) {
    Object.values(geoCache).forEach(g => { if (g) sharedGeos.add(g); });
  }
  let disposed = 0;
  target.scene.traverse((node) => {
    if (!node.isMesh) return;
    // Skip the floor plane (≤4 vertices)
    if ((node.geometry?.attributes?.position?.count || 0) <= 4) return;
    if (node.geometry && !sharedGeos.has(node.geometry)) {
      node.geometry.dispose();
      disposed++;
    }
  });
  return disposed;
}

function trackedClearDice(box, label) {
  const target = box || _box;
  if (!target) return;
  const texBefore = target.renderer?.info?.memory?.textures || 0;
  // Dispose textures and cloned geometries BEFORE clearDice removes meshes from scene
  const meshTexDisposed = disposeDiceMeshTextures(target);
  const cacheDisposed = disposeMatCache(target);
  const geosDisposed = disposeDiceMeshGeometries(target);
  _totalTexturesDisposed += meshTexDisposed + cacheDisposed;
  try { target.clearDice(); } catch (e) { console.warn('[DiceBox] clearDice error:', e); }
  const texAfter = target.renderer?.info?.memory?.textures || 0;
  // console.log(
  //   `[DiceBox] clearDice (${label}): textures ${texBefore}→${texAfter} (freed ${texBefore - texAfter}), ` +
  //   `mesh-tex: ${meshTexDisposed}, cache: ${cacheDisposed}, geos: ${geosDisposed}`
  // );
}

/**
 * Full teardown of the DiceBox singleton — releases the Three.js renderer,
 * physics world, all GPU resources. The next roll will lazily create a fresh instance.
 */
export function destroyBox() {
  if (!_box) return;
  logStats('DESTROY', 'Full teardown starting');

  try {
    // 1. Stop animations
    _box.running = false;
    _box.rolling = false;

    // 2. Dispose dice mesh textures and materials cache
    disposeDiceMeshTextures(_box);
    disposeMatCache(_box);

    // 3. Clear dice (removes meshes from scene, bodies from physics world)
    try { _box.clearDice(); } catch (e) { console.warn('[DiceBox] clearDice in destroy:', e); }

    // 4. Traverse remaining scene children (floor plane, lights, etc.) and dispose
    if (_box.scene) {
      const toRemove = [];
      _box.scene.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) {
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          mats.forEach(m => {
            if (!m) return;
            if (m.map) m.map.dispose();
            if (m.bumpMap) m.bumpMap.dispose();
            if (m.normalMap) m.normalMap.dispose();
            if (m.envMap) m.envMap.dispose();
            m.dispose();
          });
        }
        if (node !== _box.scene) toRemove.push(node);
      });
      toRemove.forEach(node => {
        try { node.parent?.remove(node); } catch {}
      });
    }

    // 5. Dispose DiceFactory shared geometry templates
    const geoCache = _box.DiceFactory?.geometries;
    if (geoCache) {
      Object.keys(geoCache).forEach(key => {
        try { geoCache[key]?.dispose(); } catch {}
      });
      _box.DiceFactory.geometries = {};
    }

    // 6. Dispose renderer
    if (_box.renderer) {
      try { _box.renderer.renderLists?.dispose(); } catch {}
      try { _box.renderer.dispose(); } catch {}
      // Remove canvas from DOM
      try { _box.renderer.domElement?.remove(); } catch {}
    }
  } catch (e) {
    console.warn('[DiceBox] Error during destroy:', e);
  }

  // 7. Reset all module-level state
  _box = null;
  _initPromise = null;
  _currentConfig = { colorset: null, material: null };
  _stats.rolls = 0;
  _prevTexCount = 0;
  _prevGeoCount = 0;
  _totalTexturesCreated = 0;
  _totalTexturesDisposed = 0;

  logStats('DESTROY', 'Complete — next roll will create fresh instance');
}

/**
 * Thorough GPU cleanup WITHOUT destroying the DiceBox singleton.
 * Disposes all dice meshes, textures, geometries, and renderer caches
 * while keeping the renderer + DiceColors alive (avoids library texture bug).
 */
export function deepCleanBox() {
  if (!_box) return;
  logStats('DEEP CLEAN', 'Thorough GPU cleanup (keeping singleton)');

  // Dispose dice mesh textures + materials cache + cloned geometries
  const meshTex = disposeDiceMeshTextures(_box);
  const cacheTex = disposeMatCache(_box);
  const geos = disposeDiceMeshGeometries(_box);
  _totalTexturesDisposed += meshTex + cacheTex;

  // Clear dice (removes meshes from scene, bodies from physics world)
  try { _box.clearDice(); } catch (e) { console.warn('[DiceBox] clearDice in deep clean:', e); }

  // Flush renderer internal caches
  try { _box.renderer?.renderLists?.dispose(); } catch {}

  // Reset tracking counters
  _stats.rolls = 0;
  _prevTexCount = _box.renderer?.info?.memory?.textures || 0;
  _prevGeoCount = _box.renderer?.info?.memory?.geometries || 0;

  logStats('DEEP CLEAN', `Done — mesh-tex: ${meshTex}, cache: ${cacheTex}, geos: ${geos}`);
}

async function acquireBox(containerId, config) {
  if (_fatalError) throw new Error('DiceBox disabled due to previous error');

  const { onRollComplete, onContextLost, ...boxConfig } = config;

  _onRollComplete = onRollComplete;
  _onContextLost = onContextLost;

  // ── Reuse path: move canvas into new container, update colorset ──
  if (_box) {
    // Proactive context health check — if context is lost, tear down and recreate
    const gl = _box.renderer?.getContext();
    if (!gl || gl.isContextLost()) {
      logStats('CONTEXT DEAD', 'Proactive destroy on stale context');
      destroyBox();
    }
  }

  if (_box) {
    const container = document.getElementById(containerId);
    const canvas = _box.renderer?.domElement;
    if (container && canvas) {
      container.appendChild(canvas);
      _box.container = container;
      // Fix: sync the WebGL render buffer to the new container's dimensions.
      // Without this, the canvas keeps whatever size it had at first creation,
      // which can be 0x0 if the container wasn't laid out yet (common on Android).
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
        _box.setDimensions({ x: w, y: h });
      }
    }

    // Determine target config
    const targetColorset = boxConfig.theme_colorset || (boxConfig.theme_customColorset ? 'custom' : null);
    const targetMaterial = boxConfig.theme_material;

    // Check if we actually need to update anything (PREVENT REDUNDANT TEXTURE LOADS)
    // For custom colorsets, we must compare the content, not just the string 'custom'
    const targetCustomJson = targetColorset === 'custom' ? JSON.stringify(boxConfig.theme_customColorset) : null;
    const currentCustomJson = (typeof _currentConfig !== 'undefined') ? _currentConfig.customJson : null;

    const needsUpdate =
      targetColorset !== _currentConfig.colorset ||
      targetMaterial !== _currentConfig.material ||
      (targetColorset === 'custom' && targetCustomJson !== currentCustomJson);

    // console.log(`[DiceDiag] REUSE PATH — needsUpdate: ${needsUpdate}, target: ${targetColorset}/${targetMaterial}, current: ${_currentConfig.colorset}/${_currentConfig.material}`);
    debugDiceState('REUSE PATH (before any update)', _box);

    if (needsUpdate) {
      // Config actually changed — clear dice and dispose all textures, then apply new theme.
      // trackedClearDice handles: mesh texture disposal + cache disposal + clearDice()
      trackedClearDice(_box, 'reuse-config-change');
      try { _box.renderer?.renderLists?.dispose(); } catch {}

      const update = {};
      if (boxConfig.theme_colorset) update.theme_colorset = boxConfig.theme_colorset;
      if (boxConfig.theme_material) update.theme_material = boxConfig.theme_material;
      if (boxConfig.theme_customColorset) update.theme_customColorset = boxConfig.theme_customColorset;

      if (Object.keys(update).length) {
        try {
          const texBeforeUpdate = _box.renderer?.info?.memory?.textures || 0;
          await _box.updateConfig(update);
          const texAfterUpdate = _box.renderer?.info?.memory?.textures || 0;
          const updateDelta = texAfterUpdate - texBeforeUpdate;
          _totalTexturesCreated += Math.max(0, updateDelta);
          // console.log(`[DiceBox] updateConfig: textures ${texBeforeUpdate}→${texAfterUpdate} (+${updateDelta})`);
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
          _stats.lost++;
          logStats('CONTEXT LOST', 'WebGL context was killed — cleaning up');
          // Dispose renderer internals before abandoning the dead context
          const renderer = _box?.renderer;
          if (renderer) {
            try { renderer.renderLists?.dispose(); } catch {}
            try { renderer.dispose(); } catch {}
          }
          _box = null;
          _initPromise = null;
          _currentConfig = { colorset: null, material: null };
          _onContextLost?.();
        });
      }

      _box = box;
      _stats.created++;
      // Track the config from initial creation so the second roll doesn't
      // unnecessarily trigger a config update (needsUpdate would be true
      // because _currentConfig was { colorset: null, material: null }).
      const initColorset = boxConfig.theme_colorset || (boxConfig.theme_customColorset ? 'custom' : null);
      _currentConfig = {
        colorset: initColorset,
        material: boxConfig.theme_material,
        customJson: initColorset === 'custom' ? JSON.stringify(boxConfig.theme_customColorset) : null
      };
      logStats('CREATE', `colorset: ${initColorset || '?'}`);
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

// ── DEBUG: Dice diagnostics ──────────────────────────────────────────
function debugDiceState(/* label, box */) {
  return; // Logging disabled
  // if (!box) { console.log(`[DiceDiag] ${label}: box is null`); return; }

  // Scene children
  const meshes = [];
  box.scene?.traverse((node) => {
    if (node.isMesh) {
      const mat = node.material;
      const mats = Array.isArray(mat) ? mat : [mat];
      meshes.push({
        name: node.name || '(unnamed)',
        visible: node.visible,
        geoValid: !!(node.geometry?.attributes?.position),
        geoVertices: node.geometry?.attributes?.position?.count || 0,
        materials: mats.map(m => ({
          type: m?.type,
          transparent: m?.transparent,
          opacity: m?.opacity,
          hasMap: !!m?.map,
          mapImage: m?.map?.image ? `${m.map.image.width}x${m.map.image.height}` : null,
          hasBumpMap: !!m?.bumpMap,
          needsUpdate: m?.needsUpdate,
          visible: m?.visible,
          side: m?.side, // 0=Front, 1=Back, 2=Double
        }))
      });
    }
  });

  // Texture loading state from colorData
  const colorData = box.colorData || box.DiceFactory?.colordata;
  let textureInfo = 'no colorData';
  if (colorData?.texture) {
    const texArr = Array.isArray(colorData.texture) ? colorData.texture : [colorData.texture];
    textureInfo = texArr.map((t, i) => {
      if (t?.texture instanceof HTMLImageElement) {
        return `tex[${i}]: ${t.texture.complete ? 'LOADED' : 'LOADING'} ${t.texture.naturalWidth}x${t.texture.naturalHeight} src=${t.texture.src?.split('/').pop()}`;
      }
      return `tex[${i}]: ${typeof t}`;
    }).join(', ');
  }

  // Renderer state
  const ri = box.renderer?.info;
  const rendererInfo = ri ? {
    textures: ri.memory?.textures,
    geometries: ri.memory?.geometries,
    programs: ri.programs?.length,
    contextLost: box.renderer?.getContext()?.isContextLost(),
  } : 'no renderer';

  // Materials cache
  const cacheSize = box.DiceFactory?.materials_cache ? Object.keys(box.DiceFactory.materials_cache).length : 'N/A';

  // Geometry cache
  const geoCache = box.DiceFactory?.geometries;
  let geoCacheInfo = 'N/A';
  if (geoCache) {
    geoCacheInfo = Object.entries(geoCache).map(([k, v]) => {
      const valid = !!(v?.attributes?.position);
      return `${k}: ${valid ? 'valid' : 'DISPOSED'}(${v?.attributes?.position?.count || 0} verts)`;
    }).join(', ');
  }

  // Renderer alpha settings
  const gl = box.renderer?.getContext();
  const glAlpha = gl ? {
    alpha: gl.getContextAttributes()?.alpha,
    premultipliedAlpha: gl.getContextAttributes()?.premultipliedAlpha,
    antialias: gl.getContextAttributes()?.antialias,
  } : 'no GL context';

  // Scan for problematic materials on dice meshes
  const matIssues = [];
  const matSummary = { total: 0, transparent: 0, lowOpacity: 0, noMap: 0, sides: {} };
  meshes.forEach((mesh) => {
    if (mesh.geoVertices <= 4) return; // skip floor
    mesh.materials.forEach((m, i) => {
      matSummary.total++;
      matSummary.sides[m.side] = (matSummary.sides[m.side] || 0) + 1;
      if (m.transparent) { matSummary.transparent++; matIssues.push(`mat[${i}]: transparent=true, opacity=${m.opacity}`); }
      if (m.opacity !== undefined && m.opacity < 1) { matSummary.lowOpacity++; matIssues.push(`mat[${i}]: opacity=${m.opacity}`); }
      if (!m.hasMap) { matSummary.noMap++; matIssues.push(`mat[${i}]: NO texture map`); }
    });
  });

  // Check canvas CSS state
  const canvasEl = box.renderer?.domElement;
  const canvasStyle = canvasEl ? window.getComputedStyle(canvasEl) : null;
  const parentStyle = canvasEl?.parentElement ? window.getComputedStyle(canvasEl.parentElement) : null;
  const cssInfo = {
    canvasOpacity: canvasStyle?.opacity,
    canvasVisibility: canvasStyle?.visibility,
    canvasDisplay: canvasStyle?.display,
    canvasSize: canvasEl ? `${canvasEl.width}x${canvasEl.height} (CSS: ${canvasStyle?.width}x${canvasStyle?.height})` : 'N/A',
    parentOpacity: parentStyle?.opacity,
    parentClass: canvasEl?.parentElement?.className,
  };

  console.group(`[DiceDiag] ${label}`);
  console.log('Renderer:', rendererInfo);
  console.log('GL context:', glAlpha);
  console.log('Textures:', textureInfo);
  console.log('Materials cache size:', cacheSize);
  console.log('Geometry cache:', geoCacheInfo);
  console.log(`D20 Material Summary:`, matSummary);
  if (matIssues.length) {
    console.warn('MATERIAL ISSUES FOUND:', matIssues);
  } else {
    console.log('Materials: ALL OK (no transparency/opacity/map issues)');
  }
  console.log('CSS state:', cssInfo);
  console.log('_currentConfig:', JSON.stringify(_currentConfig));

  const d20Mesh = meshes.find(m => m.geoVertices > 4);
  if (d20Mesh) {
    console.log('D20 first 3 materials (raw):', d20Mesh.materials.slice(0, 3));
    console.log('D20 last material (raw):', d20Mesh.materials[d20Mesh.materials.length - 1]);
  }
  console.groupEnd();
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
  const propsRef = useRef({ notation, colorset, material, modifier, forcedValues, forcedTotal, onResult, onDone, advantageType });
  propsRef.current = { notation, colorset, material, modifier, forcedValues, forcedTotal, onResult, onDone, advantageType };
  const [resultTotal, setResultTotal] = useState(null);
  const [resultRolls, setResultRolls] = useState(null);
  const [canvasId] = useState(() => `dice-overlay-canvas-${Date.now()}`);
  const [canvasReady, setCanvasReady] = useState(false);

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
          shadows: false,
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

            const { advantageType: advType, forcedTotal: ft, forcedValues: fv, modifier: mod } = propsRef.current;
            if (advType && fv && fv.length >= 2) {
              // Advantage/disadvantage with server-provided individual rolls
              const selected = advType === 'advantage' ? Math.max(...fv) : Math.min(...fv);
              setResultTotal(selected);
              setResultRolls(fv);
            } else if (ft != null) {
              // Server roll: use the server's actual total, not the random animation result.
              // forcedTotal includes modifier, but the UI adds modifier separately, so subtract it.
              const raw = ft - (mod || 0);
              setResultTotal(raw);
            } else if (advType && rolls.length >= 2) {
              const selected = advType === 'advantage' ? Math.max(...rolls) : Math.min(...rolls);
              setResultTotal(selected);
              setResultRolls(rolls);
            } else {
              setResultTotal(total);
            }

            propsRef.current.onResult?.(rolls);

            debugDiceState('ON ROLL COMPLETE', diceBoxRef.current);
            logMemoryDelta(`Roll #${_stats.rolls}`);

            clearTimerRef.current = setTimeout(() => {
              if (mountedRef.current) {
                trackedClearDice(diceBoxRef.current, 'post-roll-dismiss');
                // Flush renderer render-list cache to prevent accumulation across rolls
                try { diceBoxRef.current?.renderer?.renderLists?.dispose(); } catch {}
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

        // Custom colorsets for sets not in the dice-box library
        const CUSTOM_COLORSETS = {
          gold: {
            name: 'Gold',
            category: 'Custom',
            foreground: ['#FFFFFF', '#FFF8DC', '#FFFDE0'],
            background: ['#9B7A0C', '#A58510', '#8B6914', '#B8960B'],
            outline: ['#6B5503', '#7A6004', '#5C4800', '#6B4A04'],
            edge: ['#FFD700', '#FFCA00', '#FFE03D', '#FFC800'],
            texture: ['bronze01', 'bronze02', 'bronze03', 'bronze03a', 'bronze03b', 'bronze04'],
          },
        };

        const customDef = CUSTOM_COLORSETS[cs];
        if (customDef) {
          config.theme_customColorset = customDef;
        } else if (isHex) {
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

        // Safety: if the canvas render buffer is still 0x0 (container wasn't laid out
        // when DiceBox initialized), force a resize now that the DOM is settled.
        const diceCanvas = box.renderer?.domElement;
        const ctr = containerRef.current;
        if (diceCanvas && ctr && diceCanvas.width === 0 && ctr.clientWidth > 0) {
          box.setDimensions({ x: ctr.clientWidth, y: ctr.clientHeight });
        }

        debugDiceState('AFTER acquireBox', box);

        // Log colorset texture data to diagnose texture loading issues
        const cd = box.colorData || box.DiceFactory?.colordata;
        if (cd) {
          const texInfo = cd.texture;
          const texSummary = Array.isArray(texInfo)
            ? texInfo.map((t, i) => `[${i}]: name=${t?.name}, hasTexture=${!!t?.texture}, hasBump=${!!t?.bump}, src=${t?.source?.split('/').pop() || 'none'}`)
            : `name=${texInfo?.name}, hasTexture=${!!texInfo?.texture}, hasBump=${!!texInfo?.bump}, src=${texInfo?.source?.split('/').pop() || 'none'}`;
          // console.log(`[DiceDiag] Colorset texture data:`, texSummary, 'colorset:', cd.name || _currentConfig.colorset);
        }

        // Pre-compile shaders so the first rendered frame has valid materials
        try { box.renderer?.compile?.(box.scene, box.camera); } catch {}

        // roll() internally calls clearDice() then spawns + animates new dice.
        // CRITICAL: Dispose old dice textures BEFORE roll() — the library's
        // internal clearDice() removes meshes but never disposes their textures,
        // leaking ~40 CanvasTextures per roll into GPU memory.
        const preRollTexBefore = box.renderer?.info?.memory?.textures || 0;
        const preRollMeshTex = disposeDiceMeshTextures(box);
        const preRollCache = disposeMatCache(box);
        _totalTexturesDisposed += preRollMeshTex + preRollCache;
        const preRollTexAfter = box.renderer?.info?.memory?.textures || 0;
        if (preRollMeshTex + preRollCache > 0) {
          // console.log(
          //   `[DiceBox] Pre-roll cleanup: textures ${preRollTexBefore}→${preRollTexAfter} ` +
          //   `(freed ${preRollTexBefore - preRollTexAfter}), mesh-tex: ${preRollMeshTex}, cache: ${preRollCache}`
          // );
        }

        const rollNotation = buildNotation(n, fv);
        _stats.rolls++;
        logStats('ROLL', rollNotation || '(empty)');
        if (rollNotation) {
          box.roll(rollNotation);

          // FIX: The library sets transparent=true on all dice materials, which
          // causes alpha blending with the transparent WebGL canvas — making
          // dice look see-through. Fix: set transparent=false so dice render
          // fully opaque. Shadows are disabled (shadows:false in config) to
          // avoid shadow-plane-on-top-of-dice ordering issues on Android.
          box.scene?.traverse((node) => {
            if (node.isMesh && node.geometry?.attributes?.position?.count > 4) {
              const mats = Array.isArray(node.material) ? node.material : [node.material];
              mats.forEach(m => {
                if (m) {
                  m.transparent = false;
                  m.depthWrite = true;
                  m.needsUpdate = true;
                }
              });
            }
          });

          debugDiceState('AFTER roll()', box);

          // Wait a few frames for Three.js to upload textures to the GPU,
          // then reveal the canvas so the user never sees unloaded dice.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                debugDiceState('BEFORE reveal (3 frames after roll)', box);
                if (mountedRef.current) setCanvasReady(true);
              });
            });
          });
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
      trackedClearDice(_box, 'component-unmount');
    };
  }, []);

  return (
    <div className="dice-overlay" data-testid="dice-overlay">
      <div id={canvasId} ref={containerRef} className={`dice-overlay-canvas${canvasReady ? ' dice-canvas-visible' : ''}`} />
      {label && resultTotal == null && (
        <div className="dice-rolling-label">{label}</div>
      )}
      {resultTotal != null && (
        <div className="dice-result-banner" data-testid="dice-result-banner">
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
                  <span className="dice-result-total" data-testid="dice-result-total">{resultTotal + modifier}</span>
                </>
              ) : (
                <span className="dice-result-total" data-testid="dice-result-total">{resultTotal}</span>
              )}
            </>
          ) : (
            <>
              <span className="dice-result-notation">{notation}{modifier ? ` + ${modifier}` : ''}</span>
              {modifier ? (
                <>
                  <span className="dice-result-breakdown">{resultTotal} + {modifier}</span>
                  <span className="dice-result-total" data-testid="dice-result-total">{resultTotal + modifier}</span>
                </>
              ) : (
                <span className="dice-result-total" data-testid="dice-result-total">{resultTotal}</span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

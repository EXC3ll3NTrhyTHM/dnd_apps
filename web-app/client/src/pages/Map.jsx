import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import NpcPortrait from '../components/NpcPortrait';
import LocationTransition, { getTransitionSoundUrls } from '../components/LocationTransition';
import { preloadBuffers } from '../lib/sceneAudioEngine';
import SummonEffect from '../components/SummonEffect';
import FishingOverlay from '../components/FishingOverlay';
import { pauseAmbientAudio } from '../components/Layout';
import { useUiSounds } from '../hooks/useUiSounds';
import { createRecognizer } from '../lib/gestureRecognizer';
import '../styles/map.css';

const MAP_SRC = '/images/okhan_map.webp';
const ADMIN_IDS = ['424061511833747467'];
const DRAW_THRESHOLD = 30; // px before entering draw mode

export default function Map() {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [popupStyle, setPopupStyle] = useState(null);
  const [transitioning, setTransitioning] = useState(null);
  const [presence, setPresence] = useState({});
  const [unread, setUnread] = useState({});
  const [summoning, setSummoning] = useState(null); // { gesturePoints } or null
  const [fishingOpen, setFishingOpen] = useState(false);
  const [fishingBait, setFishingBait] = useState(null); // null = not loaded, [] = no bait

  const containerRef = useRef(null);
  const popupRef = useRef(null);
  const canvasRef = useRef(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const playSound = useUiSounds();
  const isDM = ADMIN_IDS.includes(user?.id || '');

  // Gesture tracking refs
  const gestureRef = useRef({
    isTracking: false,
    isDrawing: false,
    startPos: null,
    recognizer: null,
    points: [],       // raw screen points for trail + replay
    suppressClick: false,
  });

  // Check if Marcel has been summoned before (for hint visibility)
  const hasSummoned = useRef(localStorage.getItem('dh_marcel_summoned') === 'true');

  useEffect(() => {
    loadLocations();
  }, []);

  useEffect(() => {
    function fetchPresenceAndUnread() {
      api('/api/presence').then(data => {
        setPresence(data.presence || {});
      }).catch(() => {});
      api('/api/chat/unread').then(data => {
        setUnread(data.unread || {});
      }).catch(() => {});
    }
    fetchPresenceAndUnread();
    const interval = setInterval(fetchPresenceAndUnread, 5000);
    return () => clearInterval(interval);
  }, []);

  async function loadLocations() {
    try {
      const data = await api('/api/chat/locations');
      setLocations(data.locations);
    } catch (err) {
      console.error('Failed to load locations:', err);
    } finally {
      setLoading(false);
    }
  }

  // Calculate smart popup position
  const calcPopupPosition = useCallback((locId) => {
    const container = containerRef.current;
    if (!container) return null;

    const loc = locations.find(l => l.id === locId);
    if (!loc?.mapCoords) return null;

    const containerRect = container.getBoundingClientRect();
    const popupWidth = 210;
    const popupHeight = 160;
    const markerSize = 36;
    const padding = 12;

    const markerX = (loc.mapCoords.x / 100) * containerRect.width;
    const markerY = (loc.mapCoords.y / 100) * containerRect.height;

    let popupX = markerX - popupWidth / 2;
    let popupY = markerY - popupHeight - markerSize - 8;
    let arrowSide = 'bottom';

    if (popupY < padding) {
      popupY = markerY + markerSize + 8;
      arrowSide = 'top';
    }

    if (popupY + popupHeight > containerRect.height - padding) {
      popupY = markerY - popupHeight - markerSize - 8;
      arrowSide = 'bottom';
    }

    if (popupX < padding) {
      popupX = padding;
    } else if (popupX + popupWidth > containerRect.width - padding) {
      popupX = containerRect.width - popupWidth - padding;
    }

    const otherLocations = locations.filter(l => l.id !== locId && l.mapCoords && !l.isMarcelDm);
    for (const other of otherLocations) {
      const otherX = (other.mapCoords.x / 100) * containerRect.width;
      const otherY = (other.mapCoords.y / 100) * containerRect.height;

      const buffer = 8;
      const overlaps = (
        otherX > popupX - buffer &&
        otherX < popupX + popupWidth + buffer &&
        otherY > popupY - buffer &&
        otherY < popupY + popupHeight + buffer
      );

      if (overlaps) {
        if (otherX < markerX) {
          const shiftX = (popupX + popupWidth + buffer) - otherX;
          if (popupX + shiftX + popupWidth <= containerRect.width - padding) {
            popupX += shiftX;
          }
        } else {
          const shiftX = otherX - (popupX - buffer);
          if (popupX - shiftX >= padding) {
            popupX -= shiftX;
          }
        }

        if (arrowSide === 'bottom') {
          const altY = markerY + markerSize + 8;
          if (altY + popupHeight <= containerRect.height - padding) {
            popupY = altY;
            arrowSide = 'top';
          }
        } else {
          const altY = markerY - popupHeight - markerSize - 8;
          if (altY >= padding) {
            popupY = altY;
            arrowSide = 'bottom';
          }
        }
      }
    }

    const arrowX = markerX - popupX;
    const arrowClampedX = Math.max(20, Math.min(popupWidth - 20, arrowX));

    return {
      left: `${popupX}px`,
      top: `${popupY}px`,
      arrowSide,
      arrowOffset: arrowClampedX,
    };
  }, [locations]);

  useEffect(() => {
    if (selectedLocation) {
      requestAnimationFrame(() => {
        const style = calcPopupPosition(selectedLocation);
        setPopupStyle(style);
      });
    } else {
      setPopupStyle(null);
    }
  }, [selectedLocation, calcPopupPosition]);

  useEffect(() => {
    function handleResize() {
      if (selectedLocation) {
        const style = calcPopupPosition(selectedLocation);
        setPopupStyle(style);
      }
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [selectedLocation, calcPopupPosition]);

  // Fetch bait counts when fishing pin is selected
  useEffect(() => {
    if (selectedLocation === '__fishing__') {
      setFishingBait(null);
      api('/api/inventory').then(data => {
        const items = data.inventory?.items || data.items || [];
        const BAIT_IDS = ['basic_worm', 'enchanted_grub', 'abyssal_lure'];
        const bait = items.filter(i => BAIT_IDS.includes(i.item_id) && i.quantity > 0);
        setFishingBait(bait);
      }).catch(() => setFishingBait([]));
    }
  }, [selectedLocation]);

  const handleMarkerTap = useCallback((e, locId) => {
    e.stopPropagation();
    playSound('mapMarker');
    setSelectedLocation(prev => prev === locId ? null : locId);
    // Preload transition sounds so they're instant when user clicks Enter
    preloadBuffers(getTransitionSoundUrls(locId));
  }, [playSound]);

  const handleEnterLocation = useCallback((e, locId) => {
    e.stopPropagation();
    playSound('buttonTap');
    const loc = locations.find(l => l.id === locId);

    if (loc?.isMarcelDm) {
      const dmUserId = user?.id;
      setSelectedLocation(null);
      setTransitioning({ id: `marcel_dm_${dmUserId}`, name: 'Marcel DM' });
      pauseAmbientAudio();
      return;
    }

    setSelectedLocation(null);
    setTransitioning({ id: locId, name: loc?.name || locId });
    pauseAmbientAudio();
  }, [locations, playSound, user]);

  const handleMapTap = useCallback(() => {
    if (gestureRef.current.suppressClick) {
      gestureRef.current.suppressClick = false;
      return;
    }
    setSelectedLocation(null);
  }, []);

  // ---- Gesture drawing helpers ----

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawTrailSegment(from, to) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    ctx.save();
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 6 * dpr;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = '#a855f7';
    ctx.shadowBlur = 12 * dpr;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(from.x * dpr, from.y * dpr);
    ctx.lineTo(to.x * dpr, to.y * dpr);
    ctx.stroke();
    ctx.restore();
  }

  function resizeCanvas() {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
  }

  // ---- Pointer event handlers for gesture detection ----

  const handlePointerDown = useCallback((e) => {
    // Skip if target is inside a marker
    if (e.target.closest('.map-marker') || e.target.closest('.map-popup')) return;

    const g = gestureRef.current;
    g.recognizer = createRecognizer();
    g.isTracking = true;
    g.isDrawing = false;
    g.suppressClick = false;

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    g.startPos = { x, y };
    g.points = [{ x, y }];
    g.recognizer.addPoint(x, y);

    resizeCanvas();
    clearCanvas();
  }, []);

  const handlePointerMove = useCallback((e) => {
    const g = gestureRef.current;
    if (!g.isTracking) return;

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if past threshold to start drawing
    if (!g.isDrawing) {
      const dx = x - g.startPos.x;
      const dy = y - g.startPos.y;
      if (Math.sqrt(dx * dx + dy * dy) > DRAW_THRESHOLD) {
        g.isDrawing = true;
        g.suppressClick = true;
      } else {
        return;
      }
    }

    const segment = g.recognizer.addPoint(x, y);
    g.points.push({ x, y });
    if (segment) {
      drawTrailSegment({ x: segment[0].x, y: segment[0].y }, { x: segment[1].x, y: segment[1].y });
    }
  }, []);

  const handlePointerUp = useCallback((e) => {
    const g = gestureRef.current;
    if (!g.isTracking) return;
    console.log('[Gesture] pointerUp type:', e?.type, 'points:', g.points.length);
    g.isTracking = false;

    if (g.isDrawing && g.recognizer) {
      console.log('[Gesture] points:', g.points.length, 'drawing:', g.isDrawing);
      const result = g.recognizer.recognize();
      console.log('[Gesture] result:', result);
      if (result === 'M') {
        // Successful M gesture — trigger summoning
        const points = [...g.points];
        g.isDrawing = false;
        clearCanvas();

        const marcelLoc = locations.find(l => l.isMarcelDm);
        if (marcelLoc) {
          localStorage.setItem('dh_marcel_summoned', 'true');
          hasSummoned.current = true;

          if (isDM) {
            // DM: fetch player list for the picker
            api('/api/marcel-dm/players').then(data => {
              setSummoning({ gesturePoints: points, dmPlayers: data.players || [] });
            }).catch(() => {
              setSummoning({ gesturePoints: points, dmPlayers: [] });
            });
          } else {
            setSummoning({ gesturePoints: points });
          }
        }
        return;
      }
    }

    g.isDrawing = false;
    clearCanvas();
  }, [locations, isDM]);

  // Handle summoning completion → navigate to Marcel DM (regular players)
  const handleSummonComplete = useCallback((reason) => {
    setSummoning(null);
    if (reason === 'dismiss') return; // DM dismissed the picker
    const marcelLoc = locations.find(l => l.isMarcelDm);
    if (marcelLoc) {
      const dmUserId = user?.id;
      pauseAmbientAudio();
      navigate(`/location/marcel_dm_${dmUserId}`, { replace: true });
    }
  }, [locations, user, navigate]);

  // DM picks a player from the summoning picker
  const handlePickPlayer = useCallback((targetUserId) => {
    setSummoning(null);
    pauseAmbientAudio();
    navigate(`/location/marcel_dm_${targetUserId}`, { replace: true });
  }, [navigate]);

  const selectedLoc = locations.find(l => l.id === selectedLocation);

  if (loading) {
    return (
      <div className="page-loading">
        <div className="loading-spinner" />
        <p>Mapping the realm...</p>
      </div>
    );
  }

  return (
    <div className={`map-page ${transitioning ? 'transitioning' : ''}`} onClick={handleMapTap}>
      {/* Location transition overlay */}
      {transitioning && (
        <LocationTransition
          locationId={transitioning.id}
          locationName={transitioning.name}
          onComplete={() => navigate(`/location/${transitioning.id}`, { replace: true })}
        />
      )}

      {/* Summoning overlay */}
      {summoning && (
        <SummonEffect
          onComplete={handleSummonComplete}
          onPickPlayer={handlePickPlayer}
          gesturePoints={summoning.gesturePoints}
          isDM={isDM}
          dmPlayers={summoning.dmPlayers || []}
          unread={unread}
          presence={presence}
        />
      )}

      {/* Fishing overlay */}
      {fishingOpen && (
        <FishingOverlay onClose={() => setFishingOpen(false)} />
      )}

      {/* Header overlay */}
      <div className="map-overlay-header">
        <h1 className="map-title">Okhan</h1>
      </div>

      {/* Map container */}
      <div
        ref={containerRef}
        className="map-container"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Map image */}
        <img
          src={MAP_SRC}
          alt="Map of Okhan"
          className={`map-image ${mapLoaded ? 'loaded' : ''}`}
          onLoad={() => setMapLoaded(true)}
          draggable={false}
        />

        {/* Gesture draw trail canvas */}
        <canvas ref={canvasRef} className="map-gesture-canvas" />

        {/* Location markers — filter out Marcel DM pin */}
        {mapLoaded && locations.map(loc => {
          if (!loc.mapCoords) return null;
          if (loc.isMarcelDm) return null;

          const isSelected = selectedLocation === loc.id;
          const playerCount = (presence[loc.id] || []).length;

          return (
            <div
              key={loc.id}
              className={`map-marker ${isSelected ? 'selected' : ''}${loc.id === 'the_arena' ? ' arena-pin' : ''}`}
              data-testid={`map-marker-${loc.id}`}
              style={{
                left: `${loc.mapCoords.x}%`,
                top: `${loc.mapCoords.y}%`,
              }}
              onClick={(e) => handleMarkerTap(e, loc.id)}
            >
              <div className="map-marker-pin">
                <div className="map-marker-icon">
                  <span>{loc.mapIcon || '\uD83D\uDCCD'}</span>
                </div>
                <div className="map-marker-spike" />
                {!isSelected && <div className="map-marker-pulse" />}
              </div>
              {playerCount > 0 && (
                <div className="map-marker-player-badge">{playerCount}</div>
              )}
              {unread[loc.id] && (
                <div className="map-marker-unread" />
              )}
            </div>
          );
        })}

        {/* Fishing pin — bottom left */}
        {mapLoaded && (
          <div
            className={`map-marker fishing-pin ${selectedLocation === '__fishing__' ? 'selected' : ''}`}
            style={{ left: '12%', top: '88%' }}
            onClick={(e) => handleMarkerTap(e, '__fishing__')}
          >
            <div className="map-marker-pin">
              <div className="map-marker-icon fishing-marker-icon">
                <span>{'\ud83c\udfa3'}</span>
              </div>
              <div className="map-marker-spike fishing-marker-spike" />
              {selectedLocation !== '__fishing__' && <div className="map-marker-pulse fishing-marker-pulse" />}
            </div>
          </div>
        )}

        {/* Faint pulsing hint — draw M to summon Marcel */}
        {mapLoaded && (
          <div className="map-summon-hint">M</div>
        )}

        {/* Popup */}
        {selectedLoc && !selectedLoc.isMarcelDm && selectedLoc.id !== 'the_arena' && popupStyle && (
          <div
            ref={popupRef}
            className={`map-popup arrow-${popupStyle.arrowSide}`}
            style={{
              left: popupStyle.left,
              top: popupStyle.top,
              '--arrow-offset': `${popupStyle.arrowOffset}px`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="map-popup-name">{selectedLoc.name}</div>
            <div className="map-popup-desc">{selectedLoc.description}</div>

            {selectedLoc.npcs.length > 0 && (
              <div className="map-popup-npcs">
                {selectedLoc.npcs.slice(0, 4).map(npc => (
                  <div key={npc.id} className="map-popup-npc-thumb">
                    <NpcPortrait npcId={npc.id} size={24} />
                  </div>
                ))}
                {selectedLoc.npcs.length > 4 && (
                  <span className="map-popup-npc-more">+{selectedLoc.npcs.length - 4}</span>
                )}
              </div>
            )}

            {(presence[selectedLoc.id] || []).length > 0 && (
              <div className="map-popup-players">
                {presence[selectedLoc.id].map(player => (
                  <div key={player.id} className="map-popup-player" title={player.username}>
                    <img
                      src={player.avatar}
                      alt={player.username}
                      className="map-popup-player-avatar"
                    />
                    <span className="map-popup-player-name">{player.username}</span>
                  </div>
                ))}
              </div>
            )}

            <button
              className="map-popup-enter"
              data-testid="map-popup-enter"
              onClick={(e) => handleEnterLocation(e, selectedLoc.id)}
            >
              Enter
            </button>
          </div>
        )}

        {/* Arena popup */}
        {selectedLocation === 'the_arena' && mapLoaded && (() => {
          const container = containerRef.current;
          if (!container) return null;
          const rect = container.getBoundingClientRect();
          const markerX = 0.50 * rect.width;
          const markerY = 0.70 * rect.height;
          const popupW = 210;
          const popupH = 150;
          const pad = 12;
          let px = markerX - popupW / 2;
          if (px < pad) px = pad;
          if (px + popupW > rect.width - pad) px = rect.width - popupW - pad;
          const py = markerY - popupH - 10; // above the pin
          const arrowX = Math.max(20, Math.min(popupW - 20, markerX - px));

          return (
          <div
            className="map-popup arrow-bottom arena-popup"
            style={{
              left: `${px}px`,
              top: `${py}px`,
              '--arrow-offset': `${arrowX}px`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="map-popup-name" style={{ color: '#ef4444' }}>{'\u2694\uFE0F'} The Arena</div>
            <div className="map-popup-desc">Blood and glory await. Step into the pit and prove your worth.</div>
            {(presence['the_arena'] || []).length > 0 && (
              <div className="map-popup-players">
                {presence['the_arena'].map(player => (
                  <div key={player.id} className="map-popup-player" title={player.username}>
                    <img
                      src={player.avatar}
                      alt={player.username}
                      className="map-popup-player-avatar"
                    />
                    <span className="map-popup-player-name">{player.username}</span>
                  </div>
                ))}
              </div>
            )}
            <button
              className="map-popup-enter arena-popup-enter"
              onClick={(e) => handleEnterLocation(e, 'the_arena')}
            >
              Fight
            </button>
          </div>
          );
        })()}

        {/* Fishing popup */}
        {selectedLocation === '__fishing__' && mapLoaded && (() => {
          const container = containerRef.current;
          if (!container) return null;
          const rect = container.getBoundingClientRect();
          const markerX = 0.12 * rect.width;
          const markerY = 0.88 * rect.height;
          const popupW = 210;
          const pad = 12;
          let px = markerX - popupW / 2;
          if (px < pad) px = pad;
          if (px + popupW > rect.width - pad) px = rect.width - popupW - pad;
          const py = markerY - 200;
          const arrowX = Math.max(20, Math.min(popupW - 20, markerX - px));
          const totalBait = fishingBait ? fishingBait.reduce((s, b) => s + b.quantity, 0) : null;

          return (
            <div
              className="map-popup arrow-bottom fishing-popup"
              style={{
                left: `${px}px`,
                top: `${py}px`,
                '--arrow-offset': `${arrowX}px`,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="map-popup-name" style={{ color: '#4a9eff' }}>{'\ud83c\udfa3'} Fishing Hole</div>
              <div className="map-popup-desc">Cast your line and see what bites. Bring bait from the shop.</div>

              {fishingBait === null ? (
                <div className="fishing-popup-bait">Loading...</div>
              ) : totalBait > 0 ? (
                <div className="fishing-popup-bait">
                  {fishingBait.map(b => (
                    <span key={b.item_id} className="fishing-popup-bait-item">
                      {b.name} <strong>x{b.quantity}</strong>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="fishing-popup-bait fishing-popup-no-bait">No bait — visit the shop!</div>
              )}

              <button
                className="map-popup-enter fishing-popup-enter"
                onClick={(e) => {
                  e.stopPropagation();
                  playSound('buttonTap');
                  setSelectedLocation(null);
                  setFishingOpen(true);
                }}
              >
                Fish
              </button>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

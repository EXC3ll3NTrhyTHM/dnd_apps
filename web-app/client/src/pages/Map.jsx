import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../hooks/useApi';
import NpcPortrait from '../components/NpcPortrait';
import LocationTransition from '../components/LocationTransition';
import '../styles/map.css';

const MAP_SRC = '/images/okhan_map.svg';

export default function Map() {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [popupStyle, setPopupStyle] = useState(null);
  const [transitioning, setTransitioning] = useState(null); // { id, name } or null

  const containerRef = useRef(null);
  const popupRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    loadLocations();
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

  // Calculate smart popup position that stays on screen and avoids other markers
  const calcPopupPosition = useCallback((locId) => {
    const container = containerRef.current;
    if (!container) return null;

    const loc = locations.find(l => l.id === locId);
    if (!loc?.mapCoords) return null;

    const containerRect = container.getBoundingClientRect();
    const popupWidth = 210;
    const popupHeight = 160; // approximate
    const markerSize = 36;
    const padding = 12;

    // Marker position in pixels within the container
    const markerX = (loc.mapCoords.x / 100) * containerRect.width;
    const markerY = (loc.mapCoords.y / 100) * containerRect.height;

    // Default: popup above marker, centered horizontally
    let popupX = markerX - popupWidth / 2;
    let popupY = markerY - popupHeight - markerSize - 8;
    let arrowSide = 'bottom'; // arrow points down

    // If popup goes off the top, show below marker instead
    if (popupY < padding) {
      popupY = markerY + markerSize + 8;
      arrowSide = 'top'; // arrow points up
    }

    // If popup goes off the bottom (when shown below)
    if (popupY + popupHeight > containerRect.height - padding) {
      popupY = markerY - popupHeight - markerSize - 8;
      arrowSide = 'bottom';
    }

    // Clamp horizontal position to stay on screen
    if (popupX < padding) {
      popupX = padding;
    } else if (popupX + popupWidth > containerRect.width - padding) {
      popupX = containerRect.width - popupWidth - padding;
    }

    // Check if popup overlaps any other marker
    const otherLocations = locations.filter(l => l.id !== locId && l.mapCoords);
    for (const other of otherLocations) {
      const otherX = (other.mapCoords.x / 100) * containerRect.width;
      const otherY = (other.mapCoords.y / 100) * containerRect.height;

      // Check if the other marker falls inside the popup bounds (with some buffer)
      const buffer = 8;
      const overlaps = (
        otherX > popupX - buffer &&
        otherX < popupX + popupWidth + buffer &&
        otherY > popupY - buffer &&
        otherY < popupY + popupHeight + buffer
      );

      if (overlaps) {
        // Try to shift the popup to avoid the overlap
        // If marker is to the left of popup center, shift popup right
        if (otherX < markerX) {
          const shiftX = (popupX + popupWidth + buffer) - otherX;
          // Only shift if it doesn't push off screen
          if (popupX + shiftX + popupWidth <= containerRect.width - padding) {
            popupX += shiftX;
          }
        } else {
          // Shift popup left
          const shiftX = otherX - (popupX - buffer);
          if (popupX - shiftX >= padding) {
            popupX -= shiftX;
          }
        }

        // If horizontal shift didn't help, try flipping vertical
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

    // Calculate arrow horizontal offset to point at marker
    const arrowX = markerX - popupX;
    const arrowClampedX = Math.max(20, Math.min(popupWidth - 20, arrowX));

    return {
      left: `${popupX}px`,
      top: `${popupY}px`,
      arrowSide,
      arrowOffset: arrowClampedX,
    };
  }, [locations]);

  // Recalc popup position when selection changes
  useEffect(() => {
    if (selectedLocation) {
      // Small delay to ensure DOM is ready
      requestAnimationFrame(() => {
        const style = calcPopupPosition(selectedLocation);
        setPopupStyle(style);
      });
    } else {
      setPopupStyle(null);
    }
  }, [selectedLocation, calcPopupPosition]);

  // Recalc on resize
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

  const handleMarkerTap = useCallback((e, locId) => {
    e.stopPropagation();
    setSelectedLocation(prev => prev === locId ? null : locId);
  }, []);

  const handleEnterLocation = useCallback((e, locId) => {
    e.stopPropagation();
    const loc = locations.find(l => l.id === locId);
    setSelectedLocation(null);
    setTransitioning({ id: locId, name: loc?.name || locId });
  }, [locations]);

  const handleMapTap = useCallback(() => {
    setSelectedLocation(null);
  }, []);

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
          onComplete={() => navigate(`/location/${transitioning.id}`)}
        />
      )}
      {/* Header overlay */}
      <div className="map-overlay-header">
        <h1 className="map-title">Okhan</h1>
      </div>

      {/* Map container - static, no zoom/pan */}
      <div ref={containerRef} className="map-container">
        {/* Map image */}
        <img
          src={MAP_SRC}
          alt="Map of Okhan"
          className={`map-image ${mapLoaded ? 'loaded' : ''}`}
          onLoad={() => setMapLoaded(true)}
          draggable={false}
        />

        {/* Location markers */}
        {mapLoaded && locations.map(loc => {
          if (!loc.mapCoords) return null;
          const isSelected = selectedLocation === loc.id;

          return (
            <div
              key={loc.id}
              className={`map-marker ${isSelected ? 'selected' : ''}`}
              style={{
                left: `${loc.mapCoords.x}%`,
                top: `${loc.mapCoords.y}%`,
              }}
              onClick={(e) => handleMarkerTap(e, loc.id)}
            >
              <div className="map-marker-pin">
                <div className="map-marker-icon">
                  <span>{loc.mapIcon || '📍'}</span>
                </div>
                <div className="map-marker-spike" />
                {!isSelected && <div className="map-marker-pulse" />}
              </div>
            </div>
          );
        })}

        {/* Popup - positioned absolutely in container with smart placement */}
        {selectedLoc && popupStyle && (
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

            <button
              className="map-popup-enter"
              onClick={(e) => handleEnterLocation(e, selectedLoc.id)}
            >
              Enter
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

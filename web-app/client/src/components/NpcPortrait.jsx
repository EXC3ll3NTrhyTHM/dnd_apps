import { useState, useEffect, useRef } from 'react';

const FALLBACK_SILHOUETTE = '/portraits/default.svg';

/**
 * NPC Portrait with emotion-based image crossfade.
 * Uses two stacked <img> elements with opacity transitions.
 */
export default function NpcPortrait({ npcId, emotion = 'idle', size = 48, onClick, selected, className = '' }) {
  const [currentSrc, setCurrentSrc] = useState(null);
  const [prevSrc, setPrevSrc] = useState(null);
  const [transitioning, setTransitioning] = useState(false);
  const [manifest, setManifest] = useState(null);
  const timeoutRef = useRef(null);

  // Load manifest once
  useEffect(() => {
    fetch('/portraits/manifest.json')
      .then(r => r.json())
      .then(setManifest)
      .catch(() => setManifest({}));
  }, []);

  // Resolve portrait source based on emotion + manifest
  useEffect(() => {
    if (!manifest) return;

    const npcEmotions = manifest[npcId] || [];
    const hasEmotion = npcEmotions.includes(emotion);
    const hasIdle = npcEmotions.includes('idle');

    let src;
    if (hasEmotion) {
      src = `/portraits/${npcId}/${emotion}.webp`;
    } else if (hasIdle) {
      src = `/portraits/${npcId}/idle.webp`;
    } else {
      src = FALLBACK_SILHOUETTE;
    }

    if (src !== currentSrc) {
      setPrevSrc(currentSrc);
      setCurrentSrc(src);
      setTransitioning(true);

      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setTransitioning(false);
        setPrevSrc(null);
      }, 400);
    }
  }, [emotion, npcId, manifest]);

  const containerStyle = {
    width: size,
    height: size,
    position: 'relative',
    borderRadius: '50%',
    overflow: 'hidden',
    flexShrink: 0,
    cursor: onClick ? 'pointer' : 'default'
  };

  const imgStyle = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    position: 'absolute',
    top: 0,
    left: 0,
    transition: 'opacity 0.4s ease-in-out'
  };

  return (
    <div
      className={`npc-portrait ${selected ? 'npc-portrait-selected' : ''} ${className}`}
      style={containerStyle}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {/* Previous image (fading out) */}
      {prevSrc && transitioning && (
        <img
          src={prevSrc}
          alt=""
          style={{ ...imgStyle, opacity: 0 }}
          onError={(e) => { e.target.style.display = 'none'; }}
        />
      )}
      {/* Current image (fading in) */}
      {currentSrc && (
        <img
          src={currentSrc}
          alt={npcId}
          style={{ ...imgStyle, opacity: transitioning ? 1 : 1 }}
          onError={(e) => {
            if (e.target.src !== FALLBACK_SILHOUETTE) {
              e.target.src = FALLBACK_SILHOUETTE;
            }
          }}
        />
      )}
    </div>
  );
}

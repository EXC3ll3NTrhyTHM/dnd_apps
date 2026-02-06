/**
 * SceneAudio - Ambient audio player for location scenes
 * 
 * Handles background music and ambient sound loops with crossfading
 */

import { useEffect, useRef, useState } from 'react';

export function SceneAudio({ config, enabled = true }) {
  const musicRef = useRef(null);
  const ambientRefs = useRef([]);
  const [muted, setMuted] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!config || !enabled) return;

    const audioElements = [];

    // Create music track
    if (config.music) {
      const music = new Audio(config.music.src);
      music.loop = true;
      music.volume = muted ? 0 : (config.music.volume ?? 0.3);
      musicRef.current = music;
      audioElements.push(music);
    }

    // Create ambient sound layers
    if (config.ambient) {
      ambientRefs.current = config.ambient.map(amb => {
        const audio = new Audio(amb.src);
        audio.loop = true;
        audio.volume = muted ? 0 : (amb.volume ?? 0.5);
        return audio;
      });
      audioElements.push(...ambientRefs.current);
    }

    // Wait for all to load, then play
    let loadedCount = 0;
    const totalCount = audioElements.length;

    if (totalCount === 0) return;

    audioElements.forEach(audio => {
      audio.addEventListener('canplaythrough', () => {
        loadedCount++;
        if (loadedCount === totalCount) {
          setLoaded(true);
          // Stagger start times slightly for natural feel
          audioElements.forEach((a, i) => {
            setTimeout(() => {
              a.play().catch(() => {
                // Autoplay blocked - will play on first interaction
              });
            }, i * 200);
          });
        }
      }, { once: true });

      audio.addEventListener('error', (e) => {
        console.warn('Audio failed to load:', audio.src, e);
      });

      audio.load();
    });

    // Cleanup
    return () => {
      audioElements.forEach(audio => {
        audio.pause();
        audio.src = '';
      });
      musicRef.current = null;
      ambientRefs.current = [];
    };
  }, [config, enabled]);

  // Update volumes when muted changes
  useEffect(() => {
    if (musicRef.current) {
      musicRef.current.volume = muted ? 0 : (config?.music?.volume ?? 0.3);
    }
    ambientRefs.current.forEach((audio, i) => {
      audio.volume = muted ? 0 : (config?.ambient?.[i]?.volume ?? 0.5);
    });
  }, [muted, config]);

  // Try to resume audio on user interaction (for autoplay policy)
  useEffect(() => {
    const resumeAudio = () => {
      if (musicRef.current?.paused) {
        musicRef.current.play().catch(() => {});
      }
      ambientRefs.current.forEach(audio => {
        if (audio.paused) {
          audio.play().catch(() => {});
        }
      });
    };

    window.addEventListener('click', resumeAudio, { once: true });
    window.addEventListener('touchstart', resumeAudio, { once: true });

    return () => {
      window.removeEventListener('click', resumeAudio);
      window.removeEventListener('touchstart', resumeAudio);
    };
  }, [loaded]);

  if (!config) return null;

  return (
    <button 
      className="scene-audio-toggle"
      onClick={() => setMuted(!muted)}
      title={muted ? 'Unmute' : 'Mute'}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  );
}

export default SceneAudio;

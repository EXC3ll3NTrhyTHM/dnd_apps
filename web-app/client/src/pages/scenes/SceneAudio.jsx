/**
 * SceneAudio - Ambient audio player for location scenes
 *
 * Handles background music and ambient sound loops.
 * Mute is controlled globally via the audio setting in Profile.
 */

import { useEffect, useRef } from 'react';
import { useAudioMuted } from '../../hooks/useAudioSettings';

export function SceneAudio({ config, enabled = true }) {
  const musicRef = useRef(null);
  const ambientRefs = useRef([]);
  const muted = useAudioMuted();

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
          if (!muted) {
            audioElements.forEach((a, i) => {
              setTimeout(() => {
                a.play().catch(() => {});
              }, i * 200);
            });
          }
        }
      }, { once: true });

      audio.addEventListener('error', (e) => {
        console.warn('Audio failed to load:', audio.src, e);
      });

      audio.load();
    });

    // Try to resume audio on user interaction (for autoplay policy)
    const resumeAudio = () => {
      if (muted || document.hidden) return;
      if (musicRef.current?.paused) {
        musicRef.current.play().catch(() => {});
      }
      ambientRefs.current.forEach(audio => {
        if (audio.paused) audio.play().catch(() => {});
      });
    };

    // Pause when tab/app is hidden, resume when visible
    const onVisibility = () => {
      if (document.hidden) {
        audioElements.forEach(audio => audio.pause());
      } else if (!muted) {
        audioElements.forEach(audio => audio.play().catch(() => {}));
      }
    };

    window.addEventListener('click', resumeAudio);
    window.addEventListener('touchstart', resumeAudio);
    document.addEventListener('visibilitychange', onVisibility);

    // Cleanup
    return () => {
      audioElements.forEach(audio => {
        audio.pause();
        audio.src = '';
      });
      musicRef.current = null;
      ambientRefs.current = [];
      window.removeEventListener('click', resumeAudio);
      window.removeEventListener('touchstart', resumeAudio);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [config, enabled, muted]);

  return null;
}

export default SceneAudio;

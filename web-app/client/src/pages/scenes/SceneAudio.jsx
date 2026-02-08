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
    if (!config || !enabled) {
      console.log('[SceneAudio] Skipped — config:', !!config, 'enabled:', enabled);
      return;
    }

    console.log('[SceneAudio] Init with config:', JSON.stringify(config), 'muted:', muted);
    const audioElements = [];

    // Create music track
    if (config.music) {
      const music = new Audio(config.music.src);
      music.loop = true;
      music.volume = muted ? 0 : (config.music.volume ?? 0.3);
      musicRef.current = music;
      audioElements.push(music);
      console.log('[SceneAudio] Created music:', config.music.src, 'vol:', music.volume);
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

    if (audioElements.length === 0) return;

    // Play each track as soon as it's ready
    audioElements.forEach((audio, i) => {
      audio.addEventListener('canplaythrough', () => {
        console.log('[SceneAudio] canplaythrough:', audio.src, 'muted:', muted);
        if (!muted) {
          setTimeout(() => {
            audio.play().then(() => {
              console.log('[SceneAudio] Playing:', audio.src);
            }).catch((err) => {
              console.warn('[SceneAudio] Play blocked:', audio.src, err.message);
            });
          }, i * 200);
        }
      }, { once: true });

      audio.addEventListener('error', (e) => {
        console.warn('[SceneAudio] Load error:', audio.src, e);
      });

      audio.load();
    });

    // Try to resume audio on any user interaction (for autoplay policy)
    const resumeAudio = () => {
      if (muted || document.hidden) return;
      audioElements.forEach(audio => {
        if (audio.paused) {
          console.log('[SceneAudio] Resuming on interaction:', audio.src);
          audio.play().then(() => console.log('[SceneAudio] Resumed OK')).catch(e => console.warn('[SceneAudio] Resume failed:', e.message));
        }
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
    window.addEventListener('pointerdown', resumeAudio);
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
      window.removeEventListener('pointerdown', resumeAudio);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [config, enabled, muted]);

  return null;
}

export default SceneAudio;

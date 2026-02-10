/**
 * SceneAudio - Ambient audio player for location scenes
 *
 * Handles background music and ambient sound loops.
 * Mute is controlled globally via the audio setting in Profile.
 */

import { useEffect, useRef } from 'react';
import { useAudioMuted } from '../../hooks/useAudioSettings';

export function SceneAudio({ config, enabled = true }) {
  const mutedRef = useRef(false);
  const muted = useAudioMuted();
  mutedRef.current = muted;

  const audioRef = useRef([]);     // all Audio elements
  const configKeyRef = useRef(''); // serialized config for comparison
  const pausedRef = useRef(false); // true when tab hidden OR window not focused

  // Mute/unmute existing audio without recreating elements
  useEffect(() => {
    audioRef.current.forEach((entry) => {
      const { audio, volume, irregular, waiting } = entry;
      audio.volume = muted ? 0 : volume;
      if (muted || pausedRef.current) {
        audio.pause();
      } else if (!irregular && audio.readyState >= 3) {
        audio.play().catch(() => {});
      } else if (irregular && waiting && audio.readyState >= 3) {
        entry.waiting = false;
        audio.currentTime = 0;
        audio.play().catch(() => {});
      }
    });
  }, [muted]);

  // Create audio elements when config changes
  useEffect(() => {
    if (!config || !enabled) return;

    // Only recreate if config actually changed
    const key = JSON.stringify(config);
    if (key === configKeyRef.current && audioRef.current.length > 0) return;
    configKeyRef.current = key;

    // Clean up previous
    audioRef.current.forEach(({ audio }) => {
      audio.pause();
      audio.src = '';
    });
    audioRef.current = [];

    const entries = [];

    if (config.music) {
      entries.push({ src: config.music.src, volume: config.music.volume ?? 0.3 });
    }
    if (config.ambient) {
      config.ambient.forEach(amb => {
        entries.push({
          src: amb.src,
          volume: amb.volume ?? 0.5,
          delay: amb.delay ?? 0,
          irregular: amb.irregular ?? false,
          irregularPause: amb.irregularPause ?? [8, 20],
        });
      });
    }

    if (entries.length === 0) return;

    const timers = [];

    const audioElements = entries.map(({ src, volume, delay, irregular, irregularPause }, i) => {
      const audio = new Audio(src);
      audio.loop = !irregular;
      audio.volume = mutedRef.current ? 0 : volume;
      audio.preload = 'auto';
      return { audio, volume, delay, irregular, irregularPause, waiting: false };
    });
    audioRef.current = audioElements;

    const shouldPlay = () => !mutedRef.current && !pausedRef.current;

    // Schedule irregular playback: play once, pause for random interval, repeat
    function scheduleIrregular(entry) {
      const { audio, irregularPause } = entry;
      const [minPause, maxPause] = irregularPause;
      entry.waiting = true;

      audio.onended = () => {
        const pauseSec = minPause + Math.random() * (maxPause - minPause);
        const t = setTimeout(() => {
          if (shouldPlay()) {
            entry.waiting = false;
            audio.currentTime = 0;
            audio.play().catch(() => {});
          }
          // If muted/hidden/blurred, stay in waiting state — resumeAll will pick it up
        }, pauseSec * 1000);
        timers.push(t);
      };
    }

    // Try to play each track once loaded
    audioElements.forEach((entry, i) => {
      const { audio, delay, irregular } = entry;

      if (irregular) scheduleIrregular(entry);

      audio.addEventListener('canplaythrough', () => {
        if (shouldPlay()) {
          const startDelay = delay + i * 200;
          const t = setTimeout(() => {
            if (shouldPlay()) audio.play().catch(() => {});
          }, startDelay);
          timers.push(t);
        }
      }, { once: true });

      audio.addEventListener('error', (e) => {
        console.warn('[SceneAudio] Load error:', audio.src, e);
      });

      audio.load();
    });

    // Resume all audio (looping tracks + waiting irregular sounds)
    const resumeAll = () => {
      if (!shouldPlay()) return;
      audioRef.current.forEach((entry) => {
        const { audio, irregular, waiting } = entry;
        if (irregular) {
          // Only resume irregular sounds that are waiting (timer elapsed while paused)
          if (waiting && audio.paused && audio.readyState >= 3) {
            entry.waiting = false;
            audio.currentTime = 0;
            audio.play().catch(() => {});
          }
        } else {
          if (audio.paused && audio.readyState >= 3) {
            audio.play().catch(() => {});
          }
        }
      });
    };

    // Pause all audio
    const pauseAll = () => {
      audioRef.current.forEach(({ audio }) => audio.pause());
    };

    // Handle tab visibility + window focus/blur
    const onVisibility = () => {
      if (document.hidden) {
        pausedRef.current = true;
        pauseAll();
      } else if (document.hasFocus()) {
        pausedRef.current = false;
        resumeAll();
      }
    };

    const onBlur = () => {
      pausedRef.current = true;
      pauseAll();
    };

    const onFocus = () => {
      if (!document.hidden) {
        pausedRef.current = false;
        resumeAll();
      }
    };

    // Resume on user interaction (autoplay policy)
    const onInteraction = () => resumeAll();

    window.addEventListener('click', onInteraction);
    window.addEventListener('touchstart', onInteraction);
    window.addEventListener('pointerdown', onInteraction);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);

    return () => {
      timers.forEach(clearTimeout);
      audioRef.current.forEach(({ audio }) => {
        audio.onended = null;
        audio.pause();
        audio.src = '';
      });
      audioRef.current = [];
      configKeyRef.current = '';
      window.removeEventListener('click', onInteraction);
      window.removeEventListener('touchstart', onInteraction);
      window.removeEventListener('pointerdown', onInteraction);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [config, enabled]);

  return null;
}

export default SceneAudio;

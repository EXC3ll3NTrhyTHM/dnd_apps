/**
 * SceneAudio - Ambient audio player for location scenes
 *
 * Handles background music and ambient sound loops.
 * Mute is controlled globally via the audio setting in Profile.
 */

import { useEffect, useRef, useState } from 'react';
import { useAudioMuted } from '../../hooks/useAudioSettings';

export function SceneAudio({ config, enabled = true }) {
  const mutedRef = useRef(false);
  const muted = useAudioMuted();
  mutedRef.current = muted;

  const audioRef = useRef([]);     // all Audio elements
  const configKeyRef = useRef(''); // serialized config for comparison
  const pausedRef = useRef(false); // true when tab hidden OR window not focused
  const speechResetRef = useRef(false); // true while waiting for iOS mic session to release
  const [audioGeneration, setAudioGeneration] = useState(0); // bumped to force effect re-run

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
      audio.removeAttribute('src');
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
    let active = true;

    const audioElements = entries.map(({ src, volume, delay, irregular, irregularPause }, i) => {
      const audio = new Audio(src);
      audio.loop = !irregular;
      audio.volume = mutedRef.current ? 0 : volume;
      audio.preload = 'auto';
      return { audio, volume, delay, irregular, irregularPause, waiting: false };
    });
    audioRef.current = audioElements;

    const shouldPlay = () => active && !mutedRef.current && !pausedRef.current;

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
      if (!shouldPlay() || speechResetRef.current) return;
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

    // Pause audio while speech recognition is active.
    // On iOS, SpeechRecognition switches the audio session to "playAndRecord"
    // which routes audio through ringer volume / speaker. Existing Audio
    // objects stay bound to that session even after the mic stops — reload()
    // isn't enough. We must destroy and recreate every Audio element so iOS
    // creates them under a fresh media-playback session.
    // speechResetRef blocks resumeAll/onFocus/onInteraction from touching
    // audio during the cooldown window.
    const onSpeechChange = (e) => {
      if (e.detail) {
        // Mic on — immediately destroy audio so nothing can resume it
        // while iOS has the session in playAndRecord mode
        speechResetRef.current = true;
        pausedRef.current = true;

        // Save state then fully destroy
        const saved = audioRef.current.map((entry) => ({
          src: entry.audio.src,
          savedTime: entry.audio.currentTime,
          volume: entry.volume,
          irregular: entry.irregular,
          irregularPause: entry.irregularPause,
        }));
        audioRef.current.forEach(({ audio }) => {
          audio.onended = null;
          audio.pause();
          audio.removeAttribute('src');
        });
        audioRef.current = [];
        // Stash for recreation later
        audioRef._savedForSpeech = saved;
      } else {
        // Mic off — iOS keeps the page audio session in "playAndRecord"
        // mode which routes all audio through ringer volume. There is no
        // JS API to reset it. Instead of resuming into ringer volume, we
        // force a full SceneAudio remount by clearing the config key.
        // The next config effect run will recreate audio from scratch,
        // which happens when the user navigates to a new location.
        // Clear the reset lock so normal playback works on remount.
        // After a delay, clear locks and bump generation to trigger
        // a full effect re-run which recreates audio from scratch.
        // The delay + fresh Audio objects give iOS the best chance of
        // using a clean media-playback session.
        const t = setTimeout(() => {
          speechResetRef.current = false;
          pausedRef.current = false;
          configKeyRef.current = '';
          setAudioGeneration(g => g + 1);
        }, 1500);
        timers.push(t);
      }
    };

    window.addEventListener('click', onInteraction);
    window.addEventListener('touchstart', onInteraction);
    window.addEventListener('pointerdown', onInteraction);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('speech-recognition-change', onSpeechChange);

    return () => {
      active = false;
      timers.forEach(clearTimeout);
      audioRef.current.forEach(({ audio }) => {
        audio.onended = null;
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      });
      audioRef.current = [];
      configKeyRef.current = '';
      window.removeEventListener('click', onInteraction);
      window.removeEventListener('touchstart', onInteraction);
      window.removeEventListener('pointerdown', onInteraction);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('speech-recognition-change', onSpeechChange);
    };
  }, [config, enabled, audioGeneration]);

  return null;
}

export default SceneAudio;

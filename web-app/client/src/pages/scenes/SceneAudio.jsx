/**
 * SceneAudio - Ambient audio player for location scenes
 *
 * Thin React wrapper around sceneAudioEngine.js (Web Audio API).
 * Uses AudioContext instead of HTML5 Audio elements so that iOS Safari
 * can switch tracks without requiring a fresh user gesture each time.
 */

import { useEffect, useRef } from 'react';
import { useAudioMuted } from '../../hooks/useAudioSettings';
import {
  playSceneConfig, stopAll, stopPlayback, setSceneMuted,
  suspendScene, resumeScene, clearBufferCache,
} from '../../lib/sceneAudioEngine';

export function SceneAudio({ config, enabled = true, keepAudioOnUnmount = false }) {
  const muted = useAudioMuted();
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const cleanupRef = useRef(null);
  const configRef = useRef(config);
  configRef.current = config;
  const activeRef = useRef(true);
  const keepAudioRef = useRef(keepAudioOnUnmount);
  keepAudioRef.current = keepAudioOnUnmount;

  // Stable key so the effect only re-runs when config *content* changes
  const configKey = config ? JSON.stringify(config) : '';

  // Mute/unmute without re-creating audio
  useEffect(() => {
    setSceneMuted(muted);
  }, [muted]);

  // Main config effect — plays new config when content changes.
  // playSceneConfig already handles stopping old audio with crossfade internally,
  // so this cleanup does NOT call stopAll/clearBufferCache — that only happens
  // on unmount (see separate effect below). This prevents the race condition where
  // cleanup kills audio that the next config's playSceneConfig is trying to start.
  useEffect(() => {
    // console.warn('[SceneAudio] Effect fired', { configKey, enabled });
    if (!configKey || !enabled) { /* console.warn('[SceneAudio] Skipping — no config or disabled'); */ return; }

    activeRef.current = true;

    // Play the new config (engine handles stopping old audio with crossfade)
    playSceneConfig(configRef.current, { muted: mutedRef.current })
      .then(cleanup => {
        if (!activeRef.current) { cleanup(); return; }
        cleanupRef.current = cleanup;
      })
      .catch(() => {});

    // ── Visibility / focus handlers ──
    const onVisibility = () => {
      if (document.hidden) {
        suspendScene();
      } else if (document.hasFocus()) {
        resumeScene();
      }
    };

    const onBlur = () => suspendScene();
    const onFocus = () => { if (!document.hidden) resumeScene(); };

    // ── Speech recognition handler ──
    // On iOS, SpeechRecognition switches the audio session to "playAndRecord"
    // which routes audio through ringer volume. We stop audio during mic use
    // and recreate after a cooldown so iOS gets a fresh audio session.
    const timers = [];
    const onSpeechChange = (e) => {
      if (e.detail) {
        // Mic on — stop all audio
        stopAll(0);
      } else {
        // Mic off — wait for iOS to release the audio session, then replay
        const t = setTimeout(() => {
          if (!activeRef.current) return;
          playSceneConfig(configRef.current, { muted: mutedRef.current })
            .then(cleanup => {
              if (!activeRef.current) { cleanup(); return; }
              cleanupRef.current = cleanup;
            })
            .catch(() => {});
        }, 1500);
        timers.push(t);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('speech-recognition-change', onSpeechChange);

    return () => {
      // console.warn('[SceneAudio] Config change cleanup', { configKey });
      activeRef.current = false;
      timers.forEach(clearTimeout);
      cleanupRef.current = null;
      // Free old buffers but keep any URLs the incoming config needs.
      // configRef.current already points to the NEW config (refs update
      // during render, before cleanup runs), so we preserve those buffers
      // to avoid re-fetching. This prevents buffer accumulation without
      // the race condition that stopAll + clearBufferCache caused.
      const keepUrls = [];
      const next = configRef.current;
      if (next?.music) keepUrls.push(next.music.src);
      if (next?.ambient) next.ambient.forEach(a => keepUrls.push(a.src));
      clearBufferCache(keepUrls);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('speech-recognition-change', onSpeechChange);
    };
  }, [configKey, enabled]);

  // Unmount-only cleanup: stop audio and free buffer memory.
  // Uses stopPlayback (not stopAll) so it doesn't increment _generation —
  // this avoids making a sibling SceneAudio's in-flight playSceneConfig
  // go stale (e.g. arena unmounts while dojo's SceneAudio is loading buffers).
  // keepAudioOnUnmount: skips cleanup so a successor SceneAudio can continue
  // the same track seamlessly (e.g. result screen → chest scene).
  useEffect(() => {
    return () => {
      if (keepAudioRef.current) return;
      // console.warn('[SceneAudio] Unmount cleanup — stopping playback & clearing buffer cache');
      stopPlayback(300);
      clearBufferCache();
    };
  }, []);

  return null;
}

export default SceneAudio;

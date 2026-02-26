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
  playSceneConfig, stopAll, setSceneMuted,
  suspendScene, resumeScene,
} from '../../lib/sceneAudioEngine';

export function SceneAudio({ config, enabled = true }) {
  const muted = useAudioMuted();
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const configKeyRef = useRef('');
  const cleanupRef = useRef(null);
  const speechResetRef = useRef(false);

  // Mute/unmute without re-creating audio
  useEffect(() => {
    setSceneMuted(muted);
  }, [muted]);

  // Main config effect — plays new config when it changes
  useEffect(() => {
    if (!config || !enabled) return;

    const key = JSON.stringify(config);
    if (key === configKeyRef.current) return;
    configKeyRef.current = key;

    let active = true;

    // Play the new config (engine handles stopping old audio with crossfade)
    playSceneConfig(config, { muted: mutedRef.current })
      .then(cleanup => {
        if (!active) { cleanup(); return; }
        cleanupRef.current = cleanup;
      })
      .catch(err => console.warn('[SceneAudio] Play error:', err));

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
        speechResetRef.current = true;
        stopAll(0);
      } else {
        // Mic off — wait for iOS to release the audio session, then replay
        const t = setTimeout(() => {
          if (!active) return;
          speechResetRef.current = false;
          configKeyRef.current = ''; // force re-trigger
          playSceneConfig(config, { muted: mutedRef.current })
            .then(cleanup => {
              if (!active) { cleanup(); return; }
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
      active = false;
      timers.forEach(clearTimeout);
      stopAll(300);
      cleanupRef.current = null;
      configKeyRef.current = '';
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('speech-recognition-change', onSpeechChange);
    };
  }, [config, enabled]);

  return null;
}

export default SceneAudio;

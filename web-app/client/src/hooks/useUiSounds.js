import { useRef, useCallback } from 'react';
import { useAudioMuted } from './useAudioSettings';

const UI_SOUNDS = {
  messageSent:  '/sounds/ui/message-sent.wav',
  npcResponse:  '/sounds/ui/npc-response.wav',
  buttonTap:    '/sounds/ui/button-tap.wav',
  navTap:       '/sounds/ui/nav-tap.wav',
  purchase:     '/sounds/ui/purchase.wav',
  mapMarker:    '/sounds/ui/map-marker.wav',
  menuOpen:     '/sounds/ui/menu-open.wav',
  menuClose:    '/sounds/ui/menu-close.wav',
};

const VOLUMES = {
  messageSent:  0.4,
  npcResponse:  0.35,
  buttonTap:    0.3,
  navTap:       0.3,
  purchase:     0.5,
  mapMarker:    0.35,
  menuOpen:     0.3,
  menuClose:    0.25,
};

// Module-level cache — preloaded Audio elements shared across all hook instances
const audioCache = {};

function getAudio(key) {
  if (!audioCache[key]) {
    const audio = new Audio(UI_SOUNDS[key]);
    audio.preload = 'auto';
    audio.volume = VOLUMES[key] ?? 0.3;
    audioCache[key] = audio;
  }
  return audioCache[key];
}

// Preload all on first import
Object.keys(UI_SOUNDS).forEach(getAudio);

export function useUiSounds() {
  const muted = useAudioMuted();
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const play = useCallback((key) => {
    if (mutedRef.current) return;
    const audio = getAudio(key);
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }, []);

  return play;
}

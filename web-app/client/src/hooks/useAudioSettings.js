import { useState, useEffect } from 'react';

const STORAGE_KEY = 'audio_muted';
const EVENT_NAME = 'audio-muted-change';

export function getAudioMuted() {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function setAudioMuted(muted) {
  localStorage.setItem(STORAGE_KEY, muted ? 'true' : 'false');
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: muted }));
}

export function useAudioMuted() {
  const [muted, setMuted] = useState(getAudioMuted);

  useEffect(() => {
    const handler = (e) => setMuted(e.detail);
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  return muted;
}

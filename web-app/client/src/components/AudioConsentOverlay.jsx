import { useState } from 'react';
import { unlockAllAudio } from '../hooks/useUiSounds';
import { setAudioMuted } from '../hooks/useAudioSettings';

const STORAGE_KEY = 'ios_audio_consented';

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * One-time overlay shown to iOS users on first visit.
 * The user's tap on "Enable" gives iOS Safari the user gesture it needs
 * to unlock both Web Audio API (AudioContext) and HTML5 Audio (new Audio()).
 */
export default function AudioConsentOverlay() {
  const [dismissed, setDismissed] = useState(() => {
    return !isIOS() || localStorage.getItem(STORAGE_KEY) === 'true';
  });

  if (dismissed) return null;

  function handleEnable() {
    unlockAllAudio();
    setAudioMuted(false);
    localStorage.setItem(STORAGE_KEY, 'true');
    setDismissed(true);
  }

  function handleDecline() {
    setAudioMuted(true);
    localStorage.setItem(STORAGE_KEY, 'true');
    setDismissed(true);
  }

  return (
    <div className="audio-consent-overlay">
      <div className="audio-consent-card">
        <div className="audio-consent-icon">🔊</div>
        <h2 className="audio-consent-title">Enable Audio?</h2>
        <p className="audio-consent-desc">
          Dragon's Hollow features ambient sounds, dice rolls, and UI audio.
          Would you like to enable sounds?
        </p>
        <button className="audio-consent-btn audio-consent-enable" onClick={handleEnable}>
          Enable Sounds
        </button>
        <button className="audio-consent-btn audio-consent-decline" onClick={handleDecline}>
          No Thanks
        </button>
        <p className="audio-consent-hint">You can change this later in your profile settings.</p>
      </div>
    </div>
  );
}

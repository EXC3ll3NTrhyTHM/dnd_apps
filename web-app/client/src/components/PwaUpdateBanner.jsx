import { useState, useEffect, useRef } from 'react';
import { registerSW } from 'virtual:pwa-register';

const POLL_INTERVAL_MS = 60_000;

export default function PwaUpdateBanner() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const updateSWRef = useRef(null);

  useEffect(() => {
    updateSWRef.current = registerSW({
      immediate: true,
      onNeedRefresh() {
        setNeedRefresh(true);
      },
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;
        setInterval(() => {
          if (registration.installing) return;
          if (!('onLine' in navigator) || navigator.onLine) {
            registration.update();
          }
        }, POLL_INTERVAL_MS);
      },
      onOfflineReady() {
        // silently ready for offline
      }
    });
  }, []);

  if (!needRefresh) return null;

  return (
    <div className="pwa-update-banner">
      <span className="pwa-update-text">A new version is available</span>
      <div className="pwa-update-actions">
        <button
          className="pwa-update-btn-secondary"
          onClick={() => setNeedRefresh(false)}
        >
          Later
        </button>
        <button
          className="pwa-update-btn"
          onClick={() => updateSWRef.current?.(true)}
        >
          Reload
        </button>
      </div>
    </div>
  );
}

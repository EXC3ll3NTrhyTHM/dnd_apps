import { useState, useEffect } from 'react';
import { registerSW } from 'virtual:pwa-register';

export default function PwaUpdateBanner() {
  const [needRefresh, setNeedRefresh] = useState(false);

  useEffect(() => {
    registerSW({
      immediate: true,
      onNeedRefresh() {
        setNeedRefresh(true);
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
      <button
        className="pwa-update-btn"
        onClick={() => window.location.reload()}
      >
        Refresh
      </button>
    </div>
  );
}

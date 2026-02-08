import { useState, useEffect } from 'react';
import { registerSW } from 'virtual:pwa-register';

export default function PwaUpdateBanner() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateSW, setUpdateSW] = useState(null);

  useEffect(() => {
    const update = registerSW({
      onNeedRefresh() {
        setNeedRefresh(true);
      },
      onOfflineReady() {
        // silently ready for offline
      }
    });
    setUpdateSW(() => update);
  }, []);

  if (!needRefresh) return null;

  return (
    <div className="pwa-update-banner">
      <span className="pwa-update-text">A new version is available</span>
      <button
        className="pwa-update-btn"
        onClick={() => updateSW?.(true)}
      >
        Update
      </button>
    </div>
  );
}

/**
 * Push Notification Hook
 *
 * Toggle = user intent (flips immediately).
 * Actual push subscription happens in the background whenever the
 * service worker becomes ready — could be seconds or minutes later.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from './useApi';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

const pushSupported =
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

export function usePushNotifications() {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const [isEnabled, setIsEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const retryRef = useRef(null);

  // Load user's saved preference from server
  useEffect(() => {
    if (!pushSupported) return;
    api('/api/notifications/settings')
      .then(data => {
        setIsEnabled(!!data.pushDesired);
        // If desired but not yet subscribed, try completing subscription
        if (data.pushDesired && !data.pushSubscribed) {
          backgroundSubscribe();
        }
      })
      .catch(() => {});

    return () => { if (retryRef.current) clearTimeout(retryRef.current); };
  }, []);

  /**
   * Try to complete the actual push subscription in the background.
   * Retries every 5s for up to 60s. If SW never becomes ready,
   * the user still has in-app WS notifications — push will complete
   * on a future app open when the SW is active.
   */
  function backgroundSubscribe(attempt = 0) {
    if (attempt > 12) return; // give up after ~60s

    async function tryOnce() {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg || !reg.pushManager) throw new Error('no SW yet');

        const { publicKey } = await api('/api/notifications/vapid-public-key');
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
        await api('/api/notifications/subscribe', {
          method: 'POST',
          body: JSON.stringify({ subscription: sub.toJSON() })
        });
        console.log('[push] Background subscription complete');
      } catch {
        // Retry after delay
        retryRef.current = setTimeout(() => backgroundSubscribe(attempt + 1), 5000);
      }
    }

    tryOnce();
  }

  const enable = useCallback(async () => {
    try {
      setLoading(true);

      // Request notification permission
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        setLoading(false);
        return false;
      }

      // Record intent on server — toggle flips NOW
      await api('/api/notifications/enable-push', { method: 'POST' });
      setIsEnabled(true);
      setLoading(false);

      // Complete actual push subscription in background
      backgroundSubscribe();
      return true;
    } catch (err) {
      console.error('[push] Enable error:', err);
      setLoading(false);
      return false;
    }
  }, []);

  const disable = useCallback(async () => {
    try {
      setLoading(true);
      if (retryRef.current) clearTimeout(retryRef.current);

      // Unsubscribe from push manager if possible
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          const sub = await reg.pushManager.getSubscription();
          if (sub) await sub.unsubscribe();
        }
      } catch {
        // fine — server-side cleanup still happens
      }

      await api('/api/notifications/disable-push', { method: 'POST' });
      setIsEnabled(false);
    } catch (err) {
      console.error('[push] Disable error:', err);
    }
    setLoading(false);
  }, []);

  return {
    permission,
    isEnabled,
    loading,
    supported: pushSupported,
    enable,
    disable
  };
}

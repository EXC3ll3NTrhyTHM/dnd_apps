/**
 * Push notification handlers for the service worker.
 * Loaded via importScripts in the Workbox-generated SW.
 */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  const title = payload.title || 'Dragon\'s Hollow';
  const options = {
    body: payload.body || '',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    data: {
      locationId: payload.locationId || null,
      locationName: payload.locationName || null
    },
    tag: 'mention-' + (payload.locationId || 'default'),
    renotify: true
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const locationId = event.notification.data?.locationId;
  const url = locationId ? '/#/location/' + locationId : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Try to focus an existing window
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin)) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Open new window
      return clients.openWindow(url);
    })
  );
});

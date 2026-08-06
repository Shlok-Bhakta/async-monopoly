/* Crabopoly service worker — offline shell + push notifications.
   iOS (16.4+) terminates push subscriptions after ~3 "silent pushes", i.e.
   push events that finish without the notification being shown. The push
   handler MUST keep the event alive with event.waitUntil() until
   showNotification() resolves — see
   https://dev.to/progressier/how-to-fix-ios-push-subscriptions-being-terminated-after-3-notifications-39a7 */
const CACHE = "crabopoly-v2";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"])
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first with cache fallback: always try fresh, fall back to cache when offline.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match("/"))
      )
  );
});

// EVERYTHING runs inside waitUntil, and showNotification is awaited before the
// event settles. A push event that resolves without showing a notification
// counts as a "silent push" on iOS and gets the subscription killed.
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      try {
        let data = { title: "Crabopoly", body: "", url: "/", tag: "crabopoly" };
        if (event.data) {
          try {
            data = { ...data, ...event.data.json() };
          } catch (e) {
            data.body = event.data.text();
          }
        }
        await self.registration.showNotification(data.title, {
          body: data.body,
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
          tag: data.tag,
          data: { url: data.url },
        });
      } catch (err) {
        // Never reject the event: a rejected waitUntil can also look like a
        // failed/silent push to the browser.
        console.error("push handler failed:", err);
      }
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      })
  );
});

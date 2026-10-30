// Pushes arrive empty (the server skips payload encryption to save CPU); ask the server what to show.
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let msg = { title: "Bawaan", body: "Ada kabar baru untuk pesananmu.", url: "/" };
      try {
        const sub = await self.registration.pushManager.getSubscription();
        const res = await fetch("/api/push/inbox", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub ? sub.endpoint : "" }),
        });
        if (res.ok) msg = await res.json();
      } catch (e) {}
      // iOS revokes push permission if a push doesn't show a notification, so always show one.
      await self.registration.showNotification(msg.title, { body: msg.body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { url: msg.url } });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if ("focus" in w) {
          await w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});

// Offline support for Shopping Mode: the app shell, hashed bundles, photos, and the few API reads the
// seller needs to open the checklist without signal. Writes go through the IndexedDB outbox instead.
const CACHE = "bawaan-v2";
const SHELL = "/__shell";
const API_READS = [/^\/api\/auth\/me$/, /^\/api\/t\/[^/]+\/shopping$/, /^\/api\/t\/[^/]+\/settings$/, /^\/api\/store$/];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);

async function networkFirst(request, key, timeoutMs) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([fetch(request), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs))]);
    if (res.ok) await cache.put(key, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw e;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) await cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") return event.respondWith(networkFirst(req, SHELL, 5000));
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/media/") || url.pathname.startsWith("/icons/")) return event.respondWith(cacheFirst(req));
  if (API_READS.some((r) => r.test(url.pathname)) && !url.search) return event.respondWith(networkFirst(req, url.pathname, 6000));
});

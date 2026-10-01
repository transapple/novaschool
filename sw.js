/* My School service worker
   - Opens the app instantly from the saved copy, with or without signal, and refreshes it quietly in the background.
   - Wakes the app to upload offline changes when the browser says the connection is back (Background Sync).
   - Shows staff push notifications ({ title, body } payload). */

const CACHE_PREFIX = "my-school-";
const CACHE = CACHE_PREFIX + "v2";
const SHELL = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((u) => cache.add(new Request(u, { cache: "reload" })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        // Only touch our own caches; other sites on the same github.io origin share Cache Storage.
        keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function refresh(req, key) {
  return fetch(req).then((res) => {
    if (res && res.status === 200) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(key || req, copy)).catch(() => {});
    }
    return res;
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Database calls, CDNs, fonts, etc. go straight to the network; the app keeps its own data copy in IndexedDB.
  if (url.origin !== self.location.origin) return;

  // Opening the app: saved copy first (instant, works with no signal); a fresh copy is fetched in the
  // background and used the next time the app opens. First ever visit has no saved copy, so it uses the network.
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = (await cache.match("./index.html", { ignoreSearch: true })) || (await cache.match("./", { ignoreSearch: true }));
      const update = refresh(new Request("./index.html", { cache: "reload" }), "./index.html").catch(() => null);
      if (cached) { event.waitUntil(update); return cached; }
      const fresh = await update;
      return fresh || Response.error();
    })());
    return;
  }

  // Icons, manifest and other same-site files: cached copy first, refreshed in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = refresh(req).catch(() => cached);
      return cached || network;
    })
  );
});

// The browser calls this when the connection returns after the app queued changes. The app does the upload
// (it holds the sign-in), so we wake any open window; if none is open the browser retries later.
self.addEventListener("sync", (event) => {
  if (event.tag !== "nova-sync") return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      if (!list.length) throw new Error("no open window yet");
      list.forEach((c) => c.postMessage({ type: "nova-sync" }));
    })
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "My School", {
      body: data.body || "",
      icon: "./icon-192.png",
      data: { url: data.url || "./" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "./", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.registration.scope) && "focus" in c) return c.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});

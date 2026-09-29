const CACHE_NAME = "mva-contour-v1";

const APP_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  // APIs e recursos externos sempre tentam a rede primeiro.
  if (
    request.url.includes("open-meteo.com") ||
    request.url.includes("tile.openstreetmap.org") ||
    request.url.includes("server.arcgisonline.com") ||
    request.url.includes("unpkg.com") ||
    request.url.includes("cdn.jsdelivr.net")
  ) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // Arquivos do próprio aplicativo:
  // tenta rede primeiro e mantém uma cópia funcionando offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (
          response &&
          response.status === 200 &&
          response.type === "basic"
        ) {
          const responseClone = response.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }

        return response;
      })
      .catch(() => caches.match(request))
  );
});
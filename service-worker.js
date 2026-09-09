// Deliberately minimal: this site changes often (new products, fixes),
// so we always try the network FIRST and only fall back to a cached
// copy when there's no connection at all. This avoids the classic PWA
// bug where visitors get stuck seeing an old cached version after an
// update — cache is a safety net for offline use, not the main path.
const CACHE_NAME = "venom-cache-v1"

self.addEventListener("install", event => {
self.skipWaiting()
})

self.addEventListener("activate", event => {
event.waitUntil(
caches.keys().then(names =>
Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
)
)
self.clients.claim()
})

self.addEventListener("fetch", event => {
if(event.request.method !== "GET") return

event.respondWith(
fetch(event.request, { cache: "no-store" })
.then(response => {
const copy = response.clone()
caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy))
return response
})
.catch(() => caches.match(event.request))
)
})

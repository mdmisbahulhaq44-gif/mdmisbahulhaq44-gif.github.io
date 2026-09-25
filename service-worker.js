// Two different strategies, split by resource type:
//
// - The app shell (this page itself) and Supabase API calls: NETWORK
//   FIRST, exactly as before. This catalog changes often (new products,
//   price/stock fixes), so correctness matters more than raw speed here —
//   a stale API/app response silently shown to a visitor is the classic
//   PWA bug this file was written to avoid, and that guarantee doesn't
//   change.
//
// - Product photos (Cloudinary), Google Fonts, and the pinned Supabase
//   client library: CACHE FIRST. These are safe to serve straight from
//   cache because their URLs are versioned/content-addressed — a
//   Cloudinary image's URL only changes if the image itself changes, a
//   font file never changes in place, and the Supabase library URL is
//   pinned to a fixed CDN path. So there's no staleness risk on these,
//   only real speed to gain: a product or category page already seen
//   once (online) now reopens instantly — including with no connection
//   at all — instead of re-fetching every photo again.
const CACHE_NAME = "venom-cache-v2"

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

function isCacheFirst(url){
return url.hostname === "res.cloudinary.com"
|| url.hostname === "fonts.gstatic.com"
|| url.hostname === "fonts.googleapis.com"
|| (url.hostname === "cdn.jsdelivr.net" && url.pathname.includes("supabase-js"))
}

self.addEventListener("fetch", event => {
if(event.request.method !== "GET") return
const url = new URL(event.request.url)

if(isCacheFirst(url)){
event.respondWith(
caches.match(event.request).then(cached => {
if(cached) return cached
return fetch(event.request).then(response => {
const copy = response.clone()
caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy))
return response
})
})
)
return
}

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

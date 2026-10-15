const CACHE='photondrop-v4';
const APP_BASE=new URL(self.registration.scope).pathname;
self.addEventListener('install', event=>event.waitUntil((async()=>{const c=await caches.open(CACHE);await c.addAll([APP_BASE,`${APP_BASE}manifest.webmanifest`]);await self.skipWaiting()})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const k of await caches.keys())if(k!==CACHE)await caches.delete(k);await self.clients.claim()})()));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;event.respondWith((async()=>{const cached=await caches.match(event.request);if(cached)return cached;try{const response=await fetch(event.request);if(response.ok&&new URL(event.request.url).origin===location.origin){const c=await caches.open(CACHE);c.put(event.request,response.clone())}return response}catch{return cached||Response.error()}})())});

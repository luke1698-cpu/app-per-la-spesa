'use strict';

const cacheName = 'app-per-la-spesa-v8';
const assets = ['./', './index.html', './style.css', './model.js', './storage.js', './app.js',
  './app.webmanifest', './icon-192.png', './icon-512.png'];
const cachedUrls = new Set(assets.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets)));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('app-per-la-spesa-') && key !== cacheName)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || !cachedUrls.has(request.url)) return;
  event.respondWith(caches.open(cacheName).then(async cache => {
    return (await cache.match(request)) || fetch(request);
  }));
});

// Basic Service Worker for PWA compliance and offline fallback
const CACHE_NAME = 'eduplus-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => {
      return new Response('You are currently offline.', {
        headers: { 'Content-Type': 'text/html' }
      });
    })
  );
});

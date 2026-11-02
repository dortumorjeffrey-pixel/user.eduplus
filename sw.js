// Basic Service Worker for PWA compliance and offline fallback
const CACHE_NAME = 'eduplus-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Import Firebase scripts for background message handling in sw.js
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

firebase.initializeApp({
  apiKey: "AIzaSyD4cilr7LTZcl8uCTgWECi82kcdipzEMfo",
  authDomain: "jr-anonymous-questions.firebaseapp.com",
  projectId: "jr-anonymous-questions",
  storageBucket: "jr-anonymous-questions.firebasestorage.app",
  messagingSenderId: "966568815274",
  appId: "1:966568815274:web:92f27d8f06efa775513ed3"
});

const messaging = firebase.messaging();

// Handle background notifications when app is closed or in another tab
messaging.onBackgroundMessage((payload) => {
  const notificationTitle = payload.notification ? payload.notification.title : 'Eduplus Alert';
  const notificationOptions = {
    body: payload.notification ? payload.notification.body : 'New student activity received.',
    icon: '/icon.png',
    badge: '/icon.png',
    data: { url: '/lecturer-dashboard.html' }
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle click event on the notification popup to open the app window
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : '/lecturer-dashboard.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Check if there is already a window open; if so, focus it
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes('lecturer-dashboard') && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise, open a new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
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

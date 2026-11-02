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
    icon: '/icon.png'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
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

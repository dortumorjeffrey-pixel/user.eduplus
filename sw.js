// Service Worker for Background Push Notifications
const CACHE_NAME = 'eduplus-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

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

// Handle background notifications and force top-screen display
messaging.onBackgroundMessage((payload) => {
  const notificationTitle = payload.notification ? payload.notification.title : 'Eduplus Alert';
  const notificationOptions = {
    body: payload.notification ? payload.notification.body : 'New student message received.',
    icon: '/icon.png', // Ensure you have an icon.png in your root folder
    badge: '/icon.png',
    vibrate: [200, 100, 200], // Triggers phone vibration for attention
    tag: 'eduplus-alert',
    renotify: true,
    priority: 'high', // Requests high priority for top-screen display
    data: { url: '/lecturer-dashboard.html' }
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle tap on the notification banner to open the website/app
self.addEventListener('notificationclick', (event) => {
  event.notification.close(); // Dismisses the notification banner

  // Define the exact page you want to open when tapped
  const targetUrl = self.location.origin + '/lecturer-dashboard.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // 1. Check if the app is already open in a tab or window; if so, focus it
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes('lecturer-dashboard') && 'focus' in client) {
          return client.focus();
        }
      }
      
      // 2. If no window is open, open a new window/tab to your dashboard
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

/**
 * Service Worker for IndexerChain PWA
 * 
 * This service worker enables:
 * - Background sync and keepalive
 * - Offline support
 * - Persistent connections when screen is locked
 */

const CACHE_NAME = 'indexerchain-v1';
const KEEPALIVE_INTERVAL = 30000; // 30 seconds
const KEEPALIVE_ENDPOINT = '/keepalive';

// Install event - cache essential resources
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  self.skipWaiting(); // Activate immediately
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  return self.clients.claim(); // Take control of all pages immediately
});

// Fetch event - serve from cache when offline, with keepalive support
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle keepalive requests
  if (url.pathname === KEEPALIVE_ENDPOINT) {
    event.respondWith(
      new Response('ok', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain',
          'Cache-Control': 'no-cache',
        },
      })
    );
    return;
  }

  // For other requests, try network first, fallback to cache
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache successful responses (only for GET requests and http/https protocols)
        // Skip caching for POST, PUT, DELETE, etc. and non-http(s) schemes
        if (response.status === 200 && 
            request.method === 'GET' && 
            (url.protocol === 'http:' || url.protocol === 'https:')) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            try {
              cache.put(request, responseToCache);
            } catch (error) {
              // Ignore cache errors (e.g., unsupported scheme, POST requests)
              console.warn('[Service Worker] Failed to cache request:', error);
            }
          });
        }
        return response;
      })
      .catch(() => {
        // Offline: serve from cache
        return caches.match(request).then((response) => {
          return response || new Response('Offline', { status: 503 });
        });
      })
  );
});

// Background sync for periodic keepalive
self.addEventListener('sync', (event) => {
  if (event.tag === 'keepalive-sync') {
    event.waitUntil(performKeepalive());
  }
});

// Periodic background sync (Chrome 80+)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'keep-chain-sync') {
    event.waitUntil(performKeepalive());
  }
});

// Keepalive function
async function performKeepalive() {
  try {
    // Use GET instead of POST to avoid cache issues
    const response = await fetch(KEEPALIVE_ENDPOINT, {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache',
      },
      keepalive: true, // Critical: keeps connection alive
    });
    
    if (response.ok) {
      console.log('[Service Worker] Keepalive successful');
      
      // Notify all clients
      const clients = await self.clients.matchAll();
      clients.forEach((client) => {
        client.postMessage({
          type: 'keepalive-success',
          timestamp: Date.now(),
        });
      });
    }
  } catch (error) {
    console.error('[Service Worker] Keepalive failed:', error);
  }
}

// Start periodic keepalive when service worker is active
let keepaliveInterval;

self.addEventListener('message', (event) => {
  const { type, data } = event.data;

  if (type === 'start-keepalive') {
    // Start periodic keepalive
    if (keepaliveInterval) {
      clearInterval(keepaliveInterval);
    }
    keepaliveInterval = setInterval(() => {
      performKeepalive();
    }, KEEPALIVE_INTERVAL);
    
    console.log('[Service Worker] Keepalive started');
  } else if (type === 'stop-keepalive') {
    // Stop periodic keepalive
    if (keepaliveInterval) {
      clearInterval(keepaliveInterval);
      keepaliveInterval = null;
    }
    console.log('[Service Worker] Keepalive stopped');
  } else if (type === 'ping') {
    // Respond to ping from main thread
    event.ports[0].postMessage({ type: 'pong', timestamp: Date.now() });
  }
});

// Initialize keepalive on activation
self.addEventListener('activate', () => {
  // Start keepalive automatically
  keepaliveInterval = setInterval(() => {
    performKeepalive();
  }, KEEPALIVE_INTERVAL);
});

console.log('[Service Worker] Loaded and ready');


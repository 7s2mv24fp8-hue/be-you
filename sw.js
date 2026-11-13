/**
 * FL Studio Clone — Service Worker
 * Enables offline caching, background resilience, and desktop PWA installation.
 */

const CACHE_NAME = 'fl-studio-daw-v20261113';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/main.css?v=20261113',
  './js/mpg123-decoder.min.js',
  './js/audio-engine.js?v=20261113',
  './js/sequencer.js?v=20261113',
  './js/piano-roll.js?v=20261113',
  './js/mixer.js?v=20261113',
  './js/playlist.js?v=20261113',
  './js/ui.js?v=20261113',
  './js/auto-tune.js?v=20261113',
  './js/recorder.js?v=20261113',
  './js/ai-suggester.js?v=20261113',
  './js/music-tag-engine.js?v=20261113',
  './js/music-ai.js?v=20261113',
  './js/ai-producer.js?v=20261113',
  './js/backend-api.js?v=20261113',
  './js/sound-importer.js?v=20261113',
  './js/preset-samples.js?v=20261113',
  './js/song-trainer.js?v=20261113',
  './js/platform.js?v=20261113',
  './js/fl-features.js?v=20261113',
  './js/fl-graph-editor.js?v=20261113',
  './js/fl-piano-extras.js?v=20261113',
  './js/fl-parametric-eq.js?v=20261113',
  './js/fl-soundgoodizer.js?v=20261113',
  './js/fl-pattern-picker.js?v=20261113',
  './js/max-3d-avatar.js?v=20261113',
  './js/max-knowledge-engine.js?v=20261113',
  './js/max-ai-copilot.js?v=20261113',
  './js/drum-machine.js?v=20261113',
  './js/audio-editor.js?v=20261113',
  './js/app.js?v=20261113'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.warn('[SW] Pre-caching partial failure (expected during dev):', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Cache first for static local assets, network fallback
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
          return response;
        });
      })
    );
  }
});


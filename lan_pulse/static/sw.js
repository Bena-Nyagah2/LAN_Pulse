const CACHE_NAME = 'lan-pulse-v1';
const ASSETS_TO_CACHE = [
    '/',
    '/static/css/style.css',
    '/static/js/script.js',
    '/static/vendor/fontawesome/css/all.min.css',
    '/static/vendor/socket.io/socket.io.min.js',
    '/static/vendor/marked/marked.min.js',
    '/static/vendor/highlight/highlight.min.js',
    '/static/vendor/qrcode/qrcode.min.js',
    '/static/vendor/highlight/github-dark.min.css',
    '/static/vendor/fontawesome/webfonts/fa-solid-900.woff2',
    '/static/vendor/fontawesome/webfonts/fa-regular-400.woff2',
    '/static/vendor/fontawesome/webfonts/fa-brands-400.woff2'
];

self.addEventListener('install', (event) => {
    console.log('[Service Worker] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[Service Worker] Caching all assets');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

self.addEventListener('activate', (event) => {
    console.log('[Service Worker] Activating...');
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    console.log('[Service Worker] Removing old cache', key);
                    return caches.delete(key);
                }
            }));
        })
    );
    return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    // Only handle GET requests
    if (event.request.method !== 'GET') return;

    // Skip socket.io polling requests (let them fail or be handled by client)
    if (event.request.url.includes('/socket.io/')) return;

    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request).catch(() => {
                // If offline and request is for page, return index (SPA-like)
                // Actually for / it returns index, but for others?
                if (event.request.mode === 'navigate') {
                    return caches.match('/');
                }
            });
        })
    );
});

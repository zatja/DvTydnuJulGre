// === v1.5: i18n manifesty v cache ===
const CACHE_NAME = 'calendar-calculator-v1.5';

const URLS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  // i18n manifesty:
  './manifest.en.json',
  './manifest.de.json',
  './manifest.fr.json',
  './manifest.es.json',
  './manifest.uk.json',
  './manifest.ru.json',
  // (ponecháme i absolutní cesty kvůli různým hostům)
  '/',
  '/index.html',
  '/manifest.json',
  '/manifest.en.json',
  '/manifest.de.json',
  '/manifest.fr.json',
  '/manifest.es.json',
  '/manifest.uk.json',
  '/manifest.ru.json'
];

// Install event - cache EVERYTHING needed for offline
self.addEventListener('install', function(event) {
 console.log('SW: Installing v1.5 - Smart offline mode');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function(cache) {
                console.log('SW: Caching all app resources');
                
                return fetch(self.location.href)
                    .then(function(response) {
                        if (response.ok) {
                            return Promise.all([
                                cache.put('./', response.clone()),
                                cache.put('./index.html', response.clone()),
                                cache.put('/', response.clone()),
                                cache.put('/index.html', response.clone()),
                                cache.put(self.location.href, response.clone())
                            ]);
                        }
                        throw new Error('Failed to fetch main page');
                    })
                    .then(function() {
                        return Promise.all(
    ['manifest.json','manifest.en.json','manifest.de.json','manifest.fr.json','manifest.es.json','manifest.uk.json','manifest.ru.json']
    .map(function(name){
        return fetch('./' + name)
            .then(function(response){
                if (response.ok){
                    return Promise.all([
                        cache.put('./' + name, response.clone()),
                        cache.put('/' + name, response.clone())
                    ]);
                }
            })
            .catch(function(error){
                console.log('SW: Manifest caching failed (non-critical):', name, error);
            });
    })
);
                    });
            })
            .then(function() {
                console.log('SW: All resources cached successfully');
                return self.skipWaiting();
            })
            .catch(function(error) {
                console.log('SW: Installation failed:', error);
            })
    );
});

// Activate event - take control immediately
self.addEventListener('activate', function(event) {
    console.log('SW: Activating and taking control');
    
    event.waitUntil(
        Promise.all([
            caches.keys().then(function(cacheNames) {
                return Promise.all(
                    cacheNames.map(function(cacheName) {
                        if (cacheName !== CACHE_NAME) {
                            console.log('SW: Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            }),
            self.clients.claim()
        ]).then(function() {
            console.log('SW: Activated - smart offline mode enabled');
        })
    );
});

// Fetch event - SMART CACHING with offline detection
self.addEventListener('fetch', function(event) {
    if (event.request.method !== 'GET') {
        return;
    }
    
    if (event.request.url.startsWith('chrome-extension://') || 
        event.request.url.includes('devtools') ||
        event.request.url.includes('chrome://') ||
        event.request.url.includes('moz-extension://')) {
        return;
    }
    
    console.log('SW: Handling request for:', event.request.url);
    
    event.respondWith(
        // ALWAYS check cache first
        caches.match(event.request)
            .then(function(cachedResponse) {
                if (cachedResponse) {
                    console.log('SW: ✅ Serving from cache instantly');
                    
                    // For HTML requests, check for updates in background (only if online)
                    if (isHTMLRequest(event.request)) {
                        checkForUpdatesInBackground(event.request);
                    }
                    
                    return cachedResponse;
                }
                
                // Not in cache - try alternative cache keys for HTML
                if (isHTMLRequest(event.request)) {
                    return tryAlternativeCacheKeys(event.request)
                        .then(function(altCachedResponse) {
                            if (altCachedResponse) {
                                console.log('SW: ✅ Found alternative cached version');
                                checkForUpdatesInBackground(event.request);
                                return altCachedResponse;
                            }
                            
                            // No cache found - try network only if online
                            return tryNetworkIfOnline(event.request);
                        });
                }
                
                // For non-HTML requests
                return tryNetworkIfOnline(event.request);
            })
    );
});

// Check if request is for HTML content
function isHTMLRequest(request) {
    return request.destination === 'document' || 
           request.mode === 'navigate' ||
           (request.headers.get('accept') && 
            request.headers.get('accept').includes('text/html')) ||
           request.url.endsWith('/') ||
           request.url.endsWith('/index.html') ||
           request.url.includes('index.html');
}

// Try alternative cache keys
function tryAlternativeCacheKeys(request) {
    var alternativeKeys = [
        './',
        './index.html', 
        '/',
        '/index.html',
        self.location.href
    ];
    
    return alternativeKeys.reduce(function(promise, key) {
        return promise.then(function(response) {
            if (response) {
                return response;
            }
            return caches.match(key);
        });
    }, Promise.resolve(null));
}

// Smart network checking - only try if likely online
function tryNetworkIfOnline(request) {
    // Quick online check - if we're definitely offline, don't even try
    /* Removed unreliable onLine check in SW: always try network with timeout */
    
    console.log('SW: 🌐 Attempting network request (smart mode)');
    
    // Set a quick timeout to avoid long waits
    var controller = new AbortController();
    var timeoutId = setTimeout(function() {
        controller.abort();
    }, 3000); // 3 second timeout
    
    return fetch(request, { 
        signal: controller.signal,
        cache: 'no-cache' // Force fresh check
    })
    .then(function(response) {
        clearTimeout(timeoutId);
        
        if (response && response.ok) {
            console.log('SW: ✅ Network success - updating cache');
            
            var responseToCache = response.clone();
            caches.open(CACHE_NAME)
                .then(function(cache) {
                    cache.put(request, responseToCache);
                });
            
            // Notify main app about update
            self.clients.matchAll().then(function(clients) {
                clients.forEach(function(client) {
                    client.postMessage({
                        type: 'CONTENT_UPDATED',
                        url: request.url
                    });
                });
            });
            
            return response;
        }
        
        throw new Error('Network response not ok');
    })
    .catch(function(error) {
        clearTimeout(timeoutId);
        console.log('SW: 📱 Network failed (timeout or offline) - serving cache');
        return handleOfflineRequest(request);
    });
}

// Background update check (non-blocking)
function checkForUpdatesInBackground(request) {
    // Only check if we're likely online
    /* Removed unreliable onLine check in SW */
    
    console.log('SW: 🔄 Checking for updates in background...');
    
    // Use a very short timeout for background checks
    var controller = new AbortController();
    setTimeout(function() {
        controller.abort();
    }, 1500);
    
    fetch(request, { 
        signal: controller.signal,
        cache: 'no-cache'
    })
    .then(function(response) {
        if (response && response.ok) {
            return response.text().then(function(newContent) {
                // Compare with cached content
                return caches.match(request).then(function(cachedResponse) {
                    if (cachedResponse) {
                        return cachedResponse.text().then(function(cachedContent) {
                            if (newContent !== cachedContent) {
                                console.log('SW: 🆕 New content detected - updating cache');
                                
                                // Update cache
                                caches.open(CACHE_NAME).then(function(cache) {
                                    cache.put(request, new Response(newContent, {
                                        status: 200,
                                        headers: response.headers
                                    }));
                                });
                                
                                // Notify main app
                                self.clients.matchAll().then(function(clients) {
                                    clients.forEach(function(client) {
                                        client.postMessage({
                                            type: 'UPDATE_AVAILABLE',
                                            url: request.url
                                        });
                                    });
                                });
                            }
                        });
                    }
                });
            });
        }
    })
    .catch(function(error) {
        // Silent fail for background checks
        console.log('SW: Background update check failed (normal when offline)');
    });
}

// Handle offline requests
function handleOfflineRequest(request) {
    if (isHTMLRequest(request)) {
        return tryAlternativeCacheKeys(request)
            .then(function(cachedHTML) {
                if (cachedHTML) {
                    return cachedHTML;
                }
                
                return new Response(createOfflineMessage(), {
                    status: 200,
                    statusText: 'OK',
                    headers: { 'Content-Type': 'text/html; charset=utf-8' }
                });
            });
    }
    
    return new Response('Offline - content not available', {
        status: 503,
        statusText: 'Service Unavailable'
    });
}

// Create user-friendly offline message
function createOfflineMessage() {
    return `<!DOCTYPE html>
<html lang="cs">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kalendářní kalkulátor - Offline</title>
    <style>
        body { 
            font-family: Arial, sans-serif; 
            background: linear-gradient(135deg, #8B7355 0%, #4A4A3A 100%);
            color: #F5E6D3; margin: 0; padding: 20px; min-height: 100vh;
            display: flex; align-items: center; justify-content: center; text-align: center;
        }
        .container { background: rgba(0,0,0,0.3); padding: 40px; border-radius: 20px; max-width: 500px; }
        h1 { margin-bottom: 20px; color: #CDBA96; }
        .status { background: #f59e0b; color: white; padding: 15px 25px; border-radius: 25px; margin: 20px 0; font-weight: bold; }
        button { background: #8B7355; color: white; border: none; padding: 15px 30px; border-radius: 10px; font-size: 16px; cursor: pointer; margin: 10px; }
        button:hover { background: #6B5B47; }
        .info { font-size: 14px; opacity: 0.8; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📅 Kalendářní kalkulátor</h1>
        <div class="status">📱 Aplikace nebyla nalezena v cache</div>
        <p>Pro offline použití je potřeba nejprve načíst aplikaci s připojením k internetu.</p>
        <button onclick="window.location.reload()">🔄 Zkusit znovu</button>
        <div class="info">
            <p>Po prvním načtení online bude aplikace plně funkční offline.</p>
        </div>
    </div>
</body>
</html>`;
}

// Handle messages from main app
self.addEventListener('message', function(event) {
    console.log('SW: Message received:', event.data);
    
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data && event.data.type === 'CHECK_UPDATES') {
        // Force check for updates
        self.clients.matchAll().then(function(clients) {
            clients.forEach(function(client) {
                checkForUpdatesInBackground(new Request('./'));
            });
        });
    }
});
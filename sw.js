// 離線快取：網頁本身先試網路、沒網路用快取；圖片、字體、Firebase 程式庫先用快取
// 每次更新網站都要改 VERSION，大家重新整理後才會拿到新版
const VERSION = 'lb-v74';
const AVATAR_CACHE = 'lb-avatars'; // Google 頭像（跨版本保留，離線也看得到）
const SHELL = ['./', './index.html', './app.js', './firebase-config.js', './manifest.webmanifest',
  './modules/ui.js', './modules/color.js', './modules/profile.js', './modules/trips.js', './modules/places.js', './modules/plan.js', './modules/book.js', './modules/checklist.js', './modules/money.js', './modules/shop.js', './modules/weather.js',
  './img/icon-192.png', './img/icon-512.png', './img/apple-touch-icon.png', './img/favicon-48.png',
  './img/avatars/qi.webp', './img/avatars/xuan.webp', './img/avatars/yun.webp', './img/avatars/yue.webp', './img/avatars/zhen.webp'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== AVATAR_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  const isLib = url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  // Google 頭像：先用快取，沒有才上網抓
  if (!sameOrigin && req.destination === 'image' && url.hostname.endsWith('googleusercontent.com')) {
    e.respondWith(caches.open(AVATAR_CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(r => {
      if (r.ok || r.type === 'opaque') c.put(req, r.clone());
      return r;
    }))));
    return;
  }
  if (!sameOrigin && !isLib && !isFont) return; // Firestore、登入等請求不經過快取
  const isPage = sameOrigin && (req.mode === 'navigate' || /\.(html|js|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/'));
  if (isPage) {
    e.respondWith(fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); } return r; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
  } else {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r.ok || r.type === 'opaque') { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); }
      return r;
    })));
  }
});

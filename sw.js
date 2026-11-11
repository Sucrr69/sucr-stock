/* Sucr Stock — service worker : permet d'ouvrir l'appli sans réseau.
 * Stratégie « réseau d'abord » : avec du réseau, on charge toujours la dernière version ;
 * sans réseau, on ressort la dernière version gardée sur l'appareil.
 * Les échanges avec Google (données) ne passent jamais par ce cache. */
const CACHE = 'sucr-stock-202611111855';
const FICHIERS = ['./', 'index.html', 'style.css', 'calculs.js', 'tableau.js', 'saisie.js', 'horsligne.js', 'app.js',
  'manifest.webmanifest', 'icones/icone-192.png', 'icones/icone-512.png', 'icones/icone-180.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((cles) => Promise.all(cles.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const requete = e.request;
  if (requete.method !== 'GET' || new URL(requete.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cle = requete.url.split('?')[0];
    try {
      const reponse = await fetch(requete, { cache: 'no-store' });
      if (reponse.ok) cache.put(cle, reponse.clone());
      return reponse;
    } catch (erreur) {
      const garde = await cache.match(cle) || (requete.mode === 'navigate' ? await cache.match('index.html') : null);
      if (garde) return garde;
      throw erreur;
    }
  })());
});

/* Sucr_tcg — service worker : permet d'ouvrir l'appli sans réseau.
 * Stratégie « réseau d'abord » : avec du réseau, on charge toujours la dernière version ;
 * sans réseau, on ressort la dernière version gardée sur l'appareil.
 * Les échanges avec Google (données) ne passent jamais par ce cache. */
const CACHE = 'sucr-stock-202611131410';
const CACHE_IMAGES = 'sucr-tcg-images-v1';   // images des cartes : gardées d'une version de l'appli à l'autre
const MAX_IMAGES = 2500;
const FICHIERS = ['./', 'index.html', 'style.css', 'calculs.js', 'tableau.js', 'saisie.js', 'horsligne.js', 'verifier.js', 'photos.js', 'cartes.js', 'app.js',
  'manifest.webmanifest', 'icone-32.png', 'icone-96.png', 'icone-180.png', 'icone-192.png', 'icone-512.png', 'icone-maskable-512.png',
  'logo-horizontal.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((cles) => Promise.all(cles.filter((c) => c !== CACHE && c !== CACHE_IMAGES).map((c) => caches.delete(c))))
    .then(() => self.clients.claim()));
});

/* Images des cartes (TCGdex) : « cache d'abord ». Une image ne change jamais : une fois vue, elle
 * s'affiche sans réseau et sans nouveau téléchargement. */
async function imageCarte(requete) {
  const cache = await caches.open(CACHE_IMAGES);
  const gardee = await cache.match(requete.url);
  if (gardee) return gardee;
  const reponse = await fetch(requete);
  if (reponse.ok && reponse.type === 'cors') {
    cache.put(requete.url, reponse.clone());
    cache.keys().then((cles) => {   // on borne la place occupée : les plus anciennes partent d'abord
      if (cles.length > MAX_IMAGES) cles.slice(0, cles.length - MAX_IMAGES).forEach((c) => cache.delete(c));
    });
  }
  return reponse;
}

self.addEventListener('fetch', (e) => {
  const requete = e.request;
  if (requete.method === 'GET' && requete.url.startsWith('https://assets.tcgdex.net/')) {
    e.respondWith(imageCarte(requete));
    return;
  }
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

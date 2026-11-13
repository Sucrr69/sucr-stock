/* Sucr_tcg — photos personnelles.
 * Les photos sont rangées dans l'onglet « Photos » du tableur. Le Stock ne contient qu'un repère
 * « photo:<horodatage> ». L'appli télécharge chaque photo une seule fois, puis la garde sur l'appareil
 * (IndexedDB : pas de limite à 5 Mo, contrairement à la copie des données). */
'use strict';

const BASE_PHOTOS = 'sucr-tcg-photos';
const photosLocales = new Map();          // N° d'article -> { photo, modifie }
let basePhotos = null;

const estRepereePhoto = (url) => typeof url === 'string' && /^photo:/.test(url);
const horodatageRepere = (url) => Number(String(url).slice(6)) || 0;

function ouvrirBasePhotos() {
  if (basePhotos) return basePhotos;
  basePhotos = new Promise((ok, ko) => {
    if (!('indexedDB' in window)) return ko(new Error('Stockage indisponible'));
    const demande = indexedDB.open(BASE_PHOTOS, 1);
    demande.onupgradeneeded = () => demande.result.createObjectStore('photos', { keyPath: 'numero' });
    demande.onsuccess = () => ok(demande.result);
    demande.onerror = () => ko(demande.error);
  });
  return basePhotos;
}

function transactionPhotos(mode, action) {
  return ouvrirBasePhotos().then((base) => new Promise((ok, ko) => {
    const transaction = base.transaction('photos', mode);
    const resultat = action(transaction.objectStore('photos'));
    transaction.oncomplete = () => ok(resultat && resultat.result);
    transaction.onerror = () => ko(transaction.error);
  }));
}

/** Au démarrage : recharge en mémoire les photos déjà gardées sur l'appareil. */
async function chargerPhotosLocales() {
  try {
    const toutes = await transactionPhotos('readonly', (magasin) => magasin.getAll());
    (toutes || []).forEach((p) => photosLocales.set(p.numero, { photo: p.photo, modifie: p.modifie }));
  } catch (e) { /* stockage refusé (navigation privée…) : les photos seront seulement en mémoire */ }
}

function garderPhoto(numero, photo, modifie) {
  photosLocales.set(numero, { photo, modifie });
  return transactionPhotos('readwrite', (magasin) => magasin.put({ numero, photo, modifie })).catch(() => {});
}

function oublierPhotos() {
  photosLocales.clear();
  return transactionPhotos('readwrite', (magasin) => magasin.clear()).catch(() => {});
}

/** Photo d'un article si elle est déjà sur l'appareil, sinon null. */
function photoDe(a) {
  const p = photosLocales.get(a.numero);
  return p ? p.photo : null;
}

/** Articles dont la photo manque sur l'appareil, ou y est plus ancienne que celle du tableur. */
function photosManquantes() {
  return etat.articles.filter((a) => {
    if (!estRepereePhoto(a.image) || a._attente) return false;
    const p = photosLocales.get(a.numero);
    return !p || p.modifie < horodatageRepere(a.image);
  });
}

let telechargementPhotos = false;
/** Après une synchro : télécharge uniquement les photos nouvelles ou modifiées, par paquets. */
async function synchroniserPhotos() {
  if (telechargementPhotos || versionApi() < 8 || !photosManquantes().length) return;
  telechargementPhotos = true;
  try {
    // On repart de la plus ancienne photo manquante : inutile de redemander celles qu'on a déjà.
    let depuis = Math.min(...photosManquantes().map((a) => horodatageRepere(a.image))) - 1;
    for (let tour = 0; tour < 40; tour++) {
      const reponse = await api('photos', { depuis });
      for (const p of reponse.photos || []) {
        await garderPhoto(p.numero, p.photo, p.modifie);
        if (p.modifie > depuis) depuis = p.modifie;
      }
      afficherStock();
      afficherDiagnostic();
      if (!reponse.reste || !(reponse.photos || []).length) break;
    }
  } catch (e) { /* pas de réseau : on réessaiera à la prochaine synchro */ }
  telechargementPhotos = false;
}

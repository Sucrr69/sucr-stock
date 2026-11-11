/* Sucr Stock — Jalon 5 : file d'attente des saisies faites sans réseau.
 * Une saisie qui n'a pas pu partir est gardée sur l'appareil, affichée tout de suite dans l'appli,
 * puis envoyée dès que le réseau revient. Son identifiant ne change pas : jamais de doublon. */
'use strict';

const CLE_FILE = 'sucr-stock.file';

function lireFile() { return lireLocal(CLE_FILE) || []; }
function ecrireFile(file) { ecrireLocal(CLE_FILE, file); }
function enAttente() { return lireFile().filter((x) => !x.erreur); }

function mettreEnFile(id, action, donnees, libelle) {
  const file = lireFile();
  if (!file.some((x) => x.id === id)) {
    file.push({ id, action, donnees, libelle, date: new Date().toISOString() });
    ecrireFile(file);
  }
  rafraichirLocal();
}

/** Recalcule l'affichage à partir de la dernière lecture du Sheet + les saisies en attente. */
function rafraichirLocal() {
  if (etat.donnees) chargerDonnees(etat.donnees);
  else afficherFile();
}

/* ------------------------------------------------------------------ */
/* Envoi de la file                                                     */
/* ------------------------------------------------------------------ */
let envoiFileEnCours = false;

/** Envoie les saisies en attente, dans l'ordre. Renvoie false si le réseau manque encore. */
async function envoyerFile() {
  if (envoiFileEnCours) return false;
  envoiFileEnCours = true;
  try {
    for (const element of enAttente()) {
      try {
        await api(element.action, Object.assign({ idRequete: element.id }, element.donnees));
        ecrireFile(lireFile().filter((x) => x.id !== element.id));
      } catch (e) {
        if (e.reseau) return false;               // toujours pas de réseau : on réessaiera
        // Le tableur a refusé cette saisie : on la garde de côté avec son motif.
        ecrireFile(lireFile().map((x) => (x.id === element.id ? Object.assign(x, { erreur: e.message }) : x)));
      }
    }
    return true;
  } finally {
    envoiFileEnCours = false;
    afficherFile();
  }
}

/* ------------------------------------------------------------------ */
/* Effet local des saisies en attente                                   */
/* ------------------------------------------------------------------ */
function majBrut(a) {
  a._brut = etat.donnees.stock.colonnes.map((col, i) => {
    for (const champ in CHAMPS) if (etat.index[champ] === i) return a[champ] == null ? '' : a[champ];
    return '';
  });
  a._recherche = sansAccent(a.article + ' ' + a.numero);
}

function provisoire(champs, rang) {
  const a = { _ligne: -rang, _attente: true };
  for (const champ in CHAMPS) a[champ] = '';
  Object.assign(a, champs);
  majBrut(a);
  return a;
}

/** Applique à `articles` les saisies pas encore envoyées, pour qu'elles se voient tout de suite. */
function appliquerFile(articles) {
  let rang = 0;
  const trouver = (cible) => articles.find((a) => a._ligne === cible.ligne && a.numero === cible.numero);
  const modifier = (cible, champs) => {
    const a = trouver(cible);
    if (!a) return;
    Object.assign(a, champs);
    a._attente = true;
    majBrut(a);
  };
  for (const { action, donnees: d } of enAttente()) {
    if (action === 'modifier') modifier(d, d.champs);
    if (action === 'ajouter') d.articles.forEach((x) => articles.push(provisoire(x, ++rang)));
    if (action === 'echanger') {
      let total = 0;
      d.donnes.forEach((x) => {
        const a = trouver(x);
        if (a) total += Calculs.n(a.prixAchat);
        modifier(x, { statut: 'Échangé' });
      });
      const somme = d.recus.reduce((t, r) => t + Calculs.n(r.valeurEstimee), 0);
      d.recus.forEach((r) => articles.push(provisoire({
        article: r.article, categorie: r.categorie, etat: r.etat, prixDemande: r.prixDemande,
        moisAchat: d.mois, anneeAchat: d.annee, origine: 'Échange', statut: 'En stock',
        prixAchat: somme > 0 ? total * Calculs.n(r.valeurEstimee) / somme : total / d.recus.length
      }, ++rang)));
    }
    if (action === 'ouvrir') {
      modifier(d, { statut: 'Ouvert', moisVente: d.mois, anneeVente: d.annee });
      d.cartes.forEach((c) => articles.push(provisoire({
        article: c.article, categorie: c.categorie, etat: c.etat, prixDemande: c.prixDemande, listeSur: c.listeSur,
        moisAchat: d.mois, anneeAchat: d.annee, origine: 'Ouverture', prixAchat: 0,
        statut: c.listeSur ? 'Listé' : 'En stock'
      }, ++rang)));
    }
  }
}

/* ------------------------------------------------------------------ */
/* Affichage (carte dans Réglages)                                      */
/* ------------------------------------------------------------------ */
function afficherFile() {
  const zone = $('carte-file');
  if (!zone) return;
  const file = lireFile();
  if (!file.length) { zone.hidden = true; zone.innerHTML = ''; return; }
  zone.hidden = false;
  const attente = file.filter((x) => !x.erreur).length;
  zone.innerHTML = `<h2>Saisies en attente</h2>
    <p class="aide">${attente ? `${attente} saisie(s) gardée(s) sur cet appareil, envoyée(s) automatiquement au retour du réseau.` : ''}
      ${file.length - attente ? `${file.length - attente} saisie(s) refusée(s) par le tableur : corrige puis ressaisis, ou abandonne-les.` : ''}</p>
    ${file.map((x) => `<div class="lot-ligne">
      <span>${esc(x.libelle)} <small>${esc(fmtDate.format(new Date(x.date)))}</small>
        ${x.erreur ? `<br><small class="manquant">Refusée : ${esc(x.erreur)}</small>` : ''}</span>
      <button type="button" class="btn" data-abandonner="${esc(x.id)}">Abandonner</button></div>`).join('')}
    ${attente ? '<button type="button" class="btn btn-accent btn-large" id="btn-envoyer-file">Envoyer maintenant</button>' : ''}`;
}

function brancherFile() {
  $('carte-file').addEventListener('click', (e) => {
    const b = e.target.closest('[data-abandonner]');
    if (b) {
      const element = lireFile().find((x) => x.id === b.dataset.abandonner);
      if (!element) return;
      if (!confirm(`Abandonner cette saisie ?\n\n${element.libelle}\n\nElle ne sera pas envoyée au tableur.`)) return;
      ecrireFile(lireFile().filter((x) => x.id !== element.id));
      rafraichirLocal();
      return;
    }
    if (e.target.id === 'btn-envoyer-file') lancerSynchro('Synchro terminée');
  });
  // Dès que le réseau revient : on envoie ce qui attend, puis on relit le Sheet.
  window.addEventListener('online', () => { if (reglages().url) lancerSynchro('Synchro terminée'); });
  window.addEventListener('offline', () => afficherSynchro('erreur', 'Hors ligne'));
}

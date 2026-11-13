/* Sucr_tcg — Jalon 1 : lecture du Google Sheet (aucune écriture). */
'use strict';

/* ------------------------------------------------------------------ */
/* Mapping : champ de l'appli -> titre exact de la colonne dans Stock   */
/* L'appli retrouve les colonnes par leur TITRE, pas par leur lettre :  */
/* si tu déplaces une colonne dans le Sheet, ça continue de marcher.    */
/* ------------------------------------------------------------------ */
const CHAMPS = {
  numero: 'N°',
  categorie: 'Catégorie',
  article: 'Article',
  etat: 'État',
  moisAchat: "Mois d'achat",
  anneeAchat: "Année d'achat",
  prixAchat: "Prix d'achat (€)",
  origine: 'Origine',
  refEchange: 'Réf. échange',
  statut: 'Statut',
  listeSur: 'Listé sur',
  moisVente: 'Mois de vente / ouverture',
  anneeVente: 'Année de vente',
  venduSur: 'Vendu sur',
  prixVenteBrut: 'Prix de vente brut (€)',
  commission: 'Commission (€)',
  prixVenteNet: 'Prix de vente net (€)',
  benefice: "Bénéfice net (€) (hors cartes d'ouverture)",
  marge: 'Marge nette %',
  prixAchatInitial: "Prix d'achat initial (échange)",
  controle: 'Contrôle (à vérifier)',
  rang: 'Rang (technique)',
  prixDemande: 'Prix demandé (€)',
  netAttendu: 'Net attendu (€)',
  margeAttendue: 'Marge attendue (€)',
  anciennete: 'Ancienneté (mois)',
  note: 'Note',
  idTcgdex: 'ID TCGdex',   // colonnes des images (étape 7)
  image: 'Image'
};
const CHAMPS_OPTIONNELS = ['note', 'idTcgdex', 'image'];
const CHAMPS_EUROS = ['prixAchat', 'prixVenteBrut', 'commission', 'prixVenteNet', 'benefice',
  'prixAchatInitial', 'prixDemande', 'netAttendu', 'margeAttendue'];

// Couleurs par défaut (utilisées si le Sheet n'en fournit pas)
const COULEURS_ETAT = { MT: '#5bc8dc', NM: '#3caf56', EX: '#a8b820', GD: '#f0c419', LP: '#f39c35', PL: '#f0778c', PO: '#e04848' };
const COULEURS_CATEGORIE = { 'Pokémon': '#ffe082', 'One Piece': '#ffab91', 'Scellé': '#b39ddb', "Ultra's": '#80cbc4', 'Collection': '#90caf9', 'Équipement': '#cfd8dc', 'Autre': '#e0e0e0' };

// Remplacé par la date de publication quand le dossier « publication » est généré.
const VERSION_APPLI = '202611131410';
const CLE_REGLAGES = 'sucr-stock.reglages';
const CLE_DONNEES = 'sucr-stock.donnees';
const PAR_PAGE = 150;

const etat = { donnees: null, index: {}, articles: [], affiches: PAR_PAGE, enCours: false };
const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ */
/* Stockage local                                                       */
/* ------------------------------------------------------------------ */
function lireLocal(cle) {
  try { return JSON.parse(localStorage.getItem(cle)); } catch (e) { return null; }
}
function ecrireLocal(cle, valeur) {
  try { localStorage.setItem(cle, JSON.stringify(valeur)); return true; } catch (e) { return false; }
}
function reglages() { return lireLocal(CLE_REGLAGES) || { url: '', jeton: '' }; }

/* ------------------------------------------------------------------ */
/* Formats français                                                     */
/* ------------------------------------------------------------------ */
const fmtEuro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const fmtNombre = new Intl.NumberFormat('fr-FR');
const fmtPourcent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });
const fmtDate = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
function euros(v) { return typeof v === 'number' ? fmtEuro.format(v) : '—'; }
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function sansAccent(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/* ------------------------------------------------------------------ */
/* API Apps Script                                                      */
/* ------------------------------------------------------------------ */
async function api(action, donnees) {
  const { url, jeton } = reglages();
  if (!url || !jeton) throw new Error("Renseigne l'URL de l'API et le jeton dans Réglages.");
  let reponse;
  try {
    // text/plain : évite la pré-requête CORS que Apps Script ne gère pas.
    reponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({}, donnees, { action, jeton })),
      redirect: 'follow'
    });
  } catch (e) {
    const erreur = new Error(navigator.onLine
      ? "Impossible de joindre le tableur. Si ça dure : vérifie que le déploiement Apps Script est réglé sur « Qui a accès : Tout le monde »."
      : "Pas de connexion Internet.");
    erreur.reseau = true; // la requête n'est pas partie : une saisie peut être mise en attente
    throw erreur;
  }
  let json;
  try { json = await reponse.json(); } catch (e) {
    throw new Error("L'API n'a pas répondu comme prévu. Vérifie que l'URL finit par /exec et que le déploiement est réglé sur « Tout le monde ».");
  }
  if (!json.ok) {
    if (json.erreur === 'JETON_INVALIDE') throw new Error('Jeton refusé : vérifie le jeton secret.');
    if (json.erreur === 'REFUS') throw new Error(json.detail);
    if (json.erreur === 'ACTION_INCONNUE') throw new Error("Le script Apps Script n'est pas à jour (voir GUIDE-JALON-3.md).");
    throw new Error('Erreur du script : ' + (json.detail || json.erreur || 'inconnue'));
  }
  return json;
}

function afficherSynchro(type, texte) {
  const el = $('etat-synchro');
  const n = enAttente().length;
  if (n && type !== 'attente') { type = 'attente'; texte = `${n} en attente`; }
  el.className = 'nav-etat ' + type;
  el.textContent = texte;
}

async function synchroniser() {
  if (etat.enCours) return;
  etat.enCours = true;
  afficherSynchro('attente', 'Synchro…');
  try {
    // D'abord envoyer les saisies faites hors ligne, ensuite relire le Sheet.
    if (enAttente().length && !(await envoyerFile())) {
      const erreur = new Error('Pas de réseau : les saisies en attente partiront plus tard.');
      erreur.reseau = true;
      throw erreur;
    }
    const donnees = await api('lire');
    etat.cacheRefuse = !ecrireLocal(CLE_DONNEES, donnees);
    chargerDonnees(donnees);
    afficherSynchro('ok', 'Synchronisé');
    synchroniserPhotos();   // en arrière-plan : seulement les photos nouvelles
  } catch (e) {
    afficherSynchro('erreur', etat.donnees ? 'Hors ligne' : 'Non connecté');
    throw e;
  } finally {
    etat.enCours = false;
  }
}

/* ------------------------------------------------------------------ */
/* Données                                                              */
/* ------------------------------------------------------------------ */
function chargerDonnees(donnees) {
  etat.donnees = donnees;
  const titres = donnees.stock.colonnes.map((c) => c.titre);
  etat.index = {};
  for (const champ in CHAMPS) etat.index[champ] = titres.indexOf(CHAMPS[champ]);
  etat.articles = donnees.stock.valeurs.map((ligne, i) => {
    const a = { _ligne: donnees.stock.lignes[i], _brut: ligne };
    for (const champ in CHAMPS) {
      const k = etat.index[champ];
      a[champ] = k >= 0 ? ligne[k] : '';
    }
    a._recherche = sansAccent(a.article + ' ' + a.numero);
    return a;
  });
  appliquerFile(etat.articles); // saisies hors ligne pas encore envoyées
  Calculs.enrichir(etat.articles, donnees.parametres, new Date());
  afficherFile();
  remplirFiltres();
  afficherStock();
  afficherTableau();
  afficherMapping();
  afficherCache();
  afficherAjout();
  afficherVerifier();
  afficherCarteImages();
}

function seuilsMois() {
  const s = { moyen: 3, vieux: 6 };
  const liste = (etat.donnees && etat.donnees.parametres.seuils) || [];
  for (const x of liste) {
    if (/baisser/i.test(x.libelle) && Number(x.valeur) > 0) s.moyen = Number(x.valeur);
    if (/liquider/i.test(x.libelle) && Number(x.valeur) > 0) s.vieux = Number(x.valeur);
  }
  return s;
}

function couleur(valeur, defauts) {
  const duSheet = (etat.donnees && etat.donnees.stock.couleurs) || {};
  return duSheet[valeur] || defauts[valeur] || '';
}

/* ------------------------------------------------------------------ */
/* Vue Stock                                                            */
/* ------------------------------------------------------------------ */
function remplirFiltres() {
  const listes = etat.donnees.parametres.listes || {};
  const statuts = [...new Set([...(listes['Statuts'] || []), ...(listes['Statuts Scellé'] || [])])];
  remplirSelect($('f-statut'), 'Tous les statuts', statuts);
  remplirSelect($('f-categorie'), 'Toutes les catégories', listes['Catégories'] || []);
}
function remplirSelect(select, libelleTous, valeurs) {
  const avant = select.value;
  select.innerHTML = `<option value="">${esc(libelleTous)}</option>` +
    valeurs.map((v) => `<option>${esc(v)}</option>`).join('');
  select.value = valeurs.includes(avant) ? avant : '';
}

function articlesFiltres() {
  const q = sansAccent($('f-recherche').value.trim());
  const mots = q ? q.split(/\s+/) : [];
  const statut = $('f-statut').value;
  const categorie = $('f-categorie').value;
  const liste = etat.articles.filter((a) =>
    (!statut || a.statut === statut) &&
    (!categorie || a.categorie === categorie) &&
    mots.every((m) => a._recherche.includes(m)));
  const num = (v) => (typeof v === 'number' ? v : -Infinity);
  const tris = {
    'num-desc': (a, b) => num(b.numero) - num(a.numero),
    'num-asc': (a, b) => num(a.numero) - num(b.numero),
    'achat-desc': (a, b) => num(b.prixAchat) - num(a.prixAchat),
    'demande-desc': (a, b) => num(b.prixDemande) - num(a.prixDemande),
    'anciennete-desc': (a, b) => num(b.anciennete) - num(a.anciennete)
  };
  return liste.sort(tris[$('f-tri').value] || tris['num-desc']);
}

function afficherStock() {
  if (!etat.donnees) {
    $('resume-stock').innerHTML = '';
    $('compteur-stock').textContent = '';
    $('liste-stock').innerHTML = '<p class="vide">Aucune donnée pour l\'instant.<br>Va dans <b>Réglages</b> pour connecter ton Google Sheet.</p>';
    $('btn-plus').hidden = true;
    return;
  }
  const enVente = etat.articles.filter((a) => a.statut === 'En stock' || a.statut === 'Listé');
  const somme = (l, champ) => l.reduce((t, a) => t + (typeof a[champ] === 'number' ? a[champ] : 0), 0);
  const aVerifier = articlesAVerifier().length;
  $('resume-stock').innerHTML = [
    [fmtNombre.format(enVente.filter((a) => a.statut === 'En stock').length), 'En stock'],
    [fmtNombre.format(enVente.filter((a) => a.statut === 'Listé').length), 'Listés'],
    [euros(somme(enVente, 'prixAchat')), "Valeur d'achat du stock"],
    [fmtNombre.format(aVerifier), 'À vérifier']
  ].map(([n, t]) => `<div class="chiffre"><b>${esc(n)}</b><span>${esc(t)}</span></div>`).join('');

  const liste = articlesFiltres();
  const seuils = seuilsMois();
  $('compteur-stock').textContent =
    `${fmtNombre.format(liste.length)} article${liste.length > 1 ? 's' : ''} sur ${fmtNombre.format(etat.articles.length)}`;
  $('liste-stock').innerHTML = liste.slice(0, etat.affiches).map((a) => {
    let age = '';
    if (typeof a.anciennete === 'number') {
      const cl = a.anciennete >= seuils.vieux ? 'age-vieux' : a.anciennete >= seuils.moyen ? 'age-moyen' : 'age-ok';
      age = `<span class="puce ${cl}">${a.anciennete} mois</span>`;
    }
    const cEtat = couleur(a.etat, COULEURS_ETAT);
    const cCat = couleur(a.categorie, COULEURS_CATEGORIE);
    return `<button class="article avec-vignette" data-ligne="${a._ligne}">
      ${vignette(a)}
      <span class="a-nom"><small>${a.numero === '' ? 'Nouveau' : 'N° ' + esc(a.numero)}</small>${esc(a.article)}</span>
      <span class="a-prix">${esc(euros(a.prixAchat))}<small>${typeof a.prixDemande === 'number' ? 'demandé ' + esc(euros(a.prixDemande)) : ''}</small></span>
      <span class="a-infos">
        ${a.categorie ? `<span class="puce cat" style="background:${esc(cCat)}">${esc(a.categorie)}</span>` : ''}
        ${a.etat ? `<span class="puce etat" style="background:${esc(cEtat)}">${esc(a.etat)}</span>` : ''}
        <span class="puce">${esc(a.statut || 'Sans statut')}</span>
        ${a._attente ? '<span class="puce age-moyen">En attente d\'envoi</span>' : ''}
        ${a.listeSur ? `<span>${esc(a.listeSur)}</span>` : ''}
        <span>${esc(a.moisAchat)} ${esc(a.anneeAchat)}</span>
        ${age}
      </span>
    </button>`;
  }).join('') || '<p class="vide">Aucun article ne correspond.</p>';
  $('btn-plus').hidden = liste.length <= etat.affiches;
}

function ouvrirFiche(ligne) {
  const a = etat.articles.find((x) => x._ligne === ligne);
  if (!a) return;
  const colonnes = etat.donnees.stock.colonnes;
  const titresEuros = CHAMPS_EUROS.map((c) => CHAMPS[c]);
  const lignes = colonnes.map((col, i) => {
    let v = a._brut[i];
    if (v === '' || v == null || col.titre === CHAMPS.image) return '';
    if (typeof v === 'number') {
      if (titresEuros.includes(col.titre)) v = euros(v);
      else if (col.titre === CHAMPS.marge) v = fmtPourcent.format(v);
      else v = String(v);
    }
    return `<tr><td>${esc(col.titre)}</td><td>${esc(v)}</td></tr>`;
  }).join('');
  $('fiche-contenu').innerHTML =
    `<h2>${esc(a.article)}</h2><p class="aide">${a._ligne > 0 ? `Ligne ${a._ligne} de l'onglet Stock` : 'Pas encore dans le tableur'}</p>
     ${attributsImage(a, true) ? `<img class="fiche-image" ${attributsImage(a, true)} alt="">` : ''}
     ${boutonsFiche(a)}<table>${lignes}</table>`;
  $('fiche').showModal();
}

/* ------------------------------------------------------------------ */
/* Vue Mapping                                                          */
/* ------------------------------------------------------------------ */
function afficherMapping() {
  const zone = $('contenu-mapping');
  if (!etat.donnees) {
    zone.innerHTML = '<p class="vide">Connecte d\'abord ton Google Sheet dans <b>Réglages</b>.</p>';
    return;
  }
  const { stock, parametres, echanges } = etat.donnees;
  const champParTitre = {};
  for (const champ in CHAMPS) champParTitre[CHAMPS[champ]] = champ;
  const libelles = { saisie: 'Saisie (bleu)', formule: 'Formule (gris)', auto: 'Numéro automatique' };
  const exemple = stock.valeurs[0] || [];

  const lignes = stock.colonnes.map((col, i) => {
    const champ = champParTitre[col.titre];
    let ex = exemple[i];
    if (typeof ex === 'number' && CHAMPS_EUROS.map((c) => CHAMPS[c]).includes(col.titre)) ex = euros(ex);
    return `<tr>
      <td><b>${esc(col.lettre)}</b></td>
      <td>${esc(col.titre)}</td>
      <td class="type-${esc(col.type)}">${esc(libelles[col.type] || col.type)}</td>
      <td>${champ ? esc(champ) : '<span class="manquant">non reconnue</span>'}</td>
      <td>${esc(ex === '' || ex == null ? '—' : String(ex).length > 60 ? String(ex).slice(0, 60) + '…' : ex)}</td>
    </tr>`;
  }).join('');

  const absents = Object.keys(CHAMPS).filter((c) => etat.index[c] < 0);
  const absentsGenants = absents.filter((c) => !CHAMPS_OPTIONNELS.includes(c));
  let alerte = '';
  if (absentsGenants.length) {
    alerte = `<p class="manquant">Colonnes attendues mais introuvables : ${absentsGenants.map((c) => esc(CHAMPS[c])).join(', ')}</p>`;
  } else {
    alerte = '<p class="message ok">Toutes les colonnes attendues sont reconnues.</p>';
  }
  if (absents.includes('note')) {
    alerte += '<p class="aide">La colonne « Note » n\'existe pas encore : elle sera ajoutée au jalon 3 (sur la copie d\'abord).</p>';
  }

  const listes = Object.entries(parametres.listes || {}).map(([titre, valeurs]) =>
    `<div><h3>${esc(titre)}</h3><ul>${valeurs.map((v) => `<li>${esc(v)}</li>`).join('')}</ul></div>`).join('');
  const commissions = (parametres.commissions || []).map((c) =>
    `<li>${esc(c.plateforme)} : ${esc(fmtPourcent.format(c.taux))}</li>`).join('');
  const seuils = (parametres.seuils || []).map((s) =>
    `<li>${esc(s.libelle)} : ${esc(typeof s.valeur === 'number' && s.valeur < 1 ? fmtPourcent.format(s.valeur) : s.valeur)}</li>`).join('');

  zone.innerHTML = `
    <div class="carte">
      <h2>Onglet Stock — ${esc(etat.donnees.fichier)}</h2>
      ${alerte}
      <div class="defile"><table>
        <tr><th>Col.</th><th>En-tête dans le Sheet</th><th>Type</th><th>Champ de l'appli</th><th>Exemple (1<sup>re</sup> ligne)</th></tr>
        ${lignes}
      </table></div>
      <p class="aide">En-têtes en ligne ${esc(stock.ligneEntetes)} · ${fmtNombre.format(stock.valeurs.length)} articles ·
        dernier article en ligne ${esc(stock.derniereLigneArticle)} ·
        formules grises déjà présentes sur la ligne vide suivante : <b>${stock.formulesPreremplies ? 'oui' : 'non'}</b></p>
    </div>
    <div class="carte">
      <h2>Onglet Paramètres</h2>
      <div class="listes">
        <div><h3>Commissions</h3><ul>${commissions}</ul></div>
        <div><h3>Seuils</h3><ul>${seuils}</ul></div>
        ${listes}
      </div>
    </div>
    <div class="carte">
      <h2>Onglet Échanges</h2>
      <p class="aide">${fmtNombre.format((echanges.valeurs || []).length)} ligne(s) lue(s). Colonnes : ${esc((echanges.colonnes || []).join(' · '))}</p>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Vue Réglages                                                         */
/* ------------------------------------------------------------------ */
function messageReglages(type, texte) {
  const el = $('r-message');
  el.className = 'message ' + type;
  el.textContent = texte;
}
/** Ligne de diagnostic dans Réglages : permet de voir d'un coup d'œil pourquoi une fonction est masquée. */
function afficherDiagnostic() {
  const zone = $('r-diagnostic');
  if (!zone) return;
  const d = etat.donnees;
  const ouiNon = (v) => (v ? 'oui' : 'non');
  zone.textContent = 'Appli : ' + VERSION_APPLI + (d
    ? ' · Script : ' + (d.version || 'ancien') + ' · Fichier : ' + d.fichier + ' · Écriture : ' + ouiNon(d.ecriture === true) +
      ' · Colonnes images : ' + ouiNon(etat.index.idTcgdex >= 0 && etat.index.image >= 0) + ' · Colonne Note : ' + ouiNon(etat.index.note >= 0) +
      ' · Photos sur cet appareil : ' + photosLocales.size + (photosManquantes().length ? ' (' + photosManquantes().length + ' à télécharger)' : '')
    : ' · pas encore connecté au tableur');
}

function afficherCache() {
  afficherDiagnostic();
  if (etat.cacheRefuse && etat.donnees) {
    $('r-cache').textContent = "Attention : tes données sont trop volumineuses pour être gardées sur cet appareil (trop de photos personnelles, sans doute). L'appli fonctionne, mais pas hors ligne.";
    return;
  }
  $('r-cache').textContent = etat.donnees
    ? `Dernière lecture du Sheet : ${fmtDate.format(new Date(etat.donnees.luLe))} (${fmtNombre.format(etat.articles.length)} articles gardés sur cet appareil).`
    : "Aucune donnée gardée sur cet appareil.";
}

async function enregistrerEtTester() {
  const url = $('r-url').value.trim();
  const jeton = $('r-jeton').value.trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url)) {
    messageReglages('erreur', "L'URL doit ressembler à https://script.google.com/macros/s/…/exec");
    return;
  }
  if (!jeton) { messageReglages('erreur', 'Colle le jeton secret.'); return; }
  ecrireLocal(CLE_REGLAGES, { url, jeton });
  await lancerSynchro('Connexion réussie');
}

async function lancerSynchro(texteOk) {
  const boutons = [$('btn-enregistrer'), $('btn-synchro'), $('btn-rafraichir')];
  boutons.forEach((b) => { b.disabled = true; });
  messageReglages('', 'Lecture du Sheet en cours…');
  try {
    await synchroniser();
    messageReglages('ok', `${texteOk} : ${fmtNombre.format(etat.articles.length)} articles lus dans « ${etat.donnees.fichier} ».`);
  } catch (e) {
    messageReglages('erreur', e.message);
    if (!$('vue-reglages').hidden) return;
    $('compteur-stock').textContent = e.message;
  } finally {
    boutons.forEach((b) => { b.disabled = false; });
  }
}

/* ------------------------------------------------------------------ */
/* Thème clair / sombre / automatique                                   */
/* ------------------------------------------------------------------ */
const CLE_THEME = 'sucr-stock.theme';

function themeChoisi() {
  try {
    const t = localStorage.getItem(CLE_THEME);
    return t === 'clair' || t === 'sombre' ? t : 'auto';
  } catch (e) { return 'auto'; }
}

function appliquerTheme(theme) {
  if (theme === 'clair' || theme === 'sombre') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;   // automatique : suit le système
  try {
    if (theme === 'auto') localStorage.removeItem(CLE_THEME);
    else localStorage.setItem(CLE_THEME, theme);
  } catch (e) { /* stockage indisponible : le choix vaut pour cette ouverture seulement */ }
}

function brancherTheme() {
  const actuel = themeChoisi();
  document.querySelectorAll('#r-theme input').forEach((radio) => {
    radio.checked = radio.value === actuel;
    radio.addEventListener('change', () => { if (radio.checked) appliquerTheme(radio.value); });
  });
}

/* ------------------------------------------------------------------ */
/* Navigation et démarrage                                              */
/* ------------------------------------------------------------------ */
function montrer(vue) {
  if (!$('vue-' + vue)) vue = 'ajout';
  document.querySelectorAll('.vue').forEach((s) => { s.hidden = s.id !== 'vue-' + vue; });
  document.querySelectorAll('.nav-lien').forEach((b) => b.classList.toggle('actif', b.dataset.vue === vue));
  document.body.dataset.vue = vue;   // sert au style propre à chaque écran
  if (location.hash !== '#' + vue) history.replaceState(null, '', '#' + vue);
}

function demarrer() {
  document.querySelectorAll('.nav-lien').forEach((b) => b.addEventListener('click', () => montrer(b.dataset.vue)));
  ['f-recherche', 'f-statut', 'f-categorie', 'f-tri'].forEach((id) =>
    $(id).addEventListener('input', () => { etat.affiches = PAR_PAGE; afficherStock(); }));
  $('btn-plus').addEventListener('click', () => { etat.affiches += PAR_PAGE; afficherStock(); });
  // Clic : ouvre la fiche. Appui long (mobile) ou clic droit (PC) : menu d'actions, dont Supprimer.
  let appui = null, appuiLongFait = false;
  const articleDe = (e) => {
    const b = e.target.closest('.article');
    return b ? etat.articles.find((x) => x._ligne === Number(b.dataset.ligne)) : null;
  };
  const annulerAppui = () => { clearTimeout(appui); appui = null; };
  $('liste-stock').addEventListener('click', (e) => {
    if (appuiLongFait) { appuiLongFait = false; return; }
    const b = e.target.closest('.article');
    if (b) ouvrirFiche(Number(b.dataset.ligne));
  });
  $('liste-stock').addEventListener('pointerdown', (e) => {
    const a = articleDe(e);
    appuiLongFait = false;
    annulerAppui();
    if (!a || e.pointerType === 'mouse') return;
    const x = e.clientX, y = e.clientY;
    appui = setTimeout(() => { appuiLongFait = true; if (navigator.vibrate) navigator.vibrate(15); menuArticle(a); }, 550);
    const bouge = (ev) => { if (Math.hypot(ev.clientX - x, ev.clientY - y) > 10) annulerAppui(); };
    e.target.addEventListener('pointermove', bouge, { passive: true });
    setTimeout(() => e.target.removeEventListener('pointermove', bouge), 700);
  });
  ['pointerup', 'pointercancel', 'pointerleave', 'scroll'].forEach((type) =>
    $('liste-stock').addEventListener(type, annulerAppui, { passive: true }));
  $('liste-stock').addEventListener('contextmenu', (e) => {
    const a = articleDe(e);
    if (!a) return;
    e.preventDefault();
    appuiLongFait = false;
    menuArticle(a);
  });
  brancherTheme();
  brancherVerifier();
  brancherCartes();
  brancherSaisie();
  brancherFile();
  afficherFile();

  // Appli installable + utilisable hors ligne
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  let invitation = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    invitation = e;
    $('btn-installer').hidden = false;
  });
  $('btn-installer').addEventListener('click', async () => {
    if (!invitation) return;
    invitation.prompt();
    await invitation.userChoice;
    invitation = null;
    $('btn-installer').hidden = true;
  });
  window.addEventListener('appinstalled', () => { $('btn-installer').hidden = true; });
  ['t-annee', 't-mois'].forEach((id) => $(id).addEventListener('change', afficherTableau));
  $('btn-enregistrer').addEventListener('click', enregistrerEtTester);
  $('btn-synchro').addEventListener('click', () => lancerSynchro('Synchro terminée'));
  $('btn-rafraichir').addEventListener('click', () => lancerSynchro('Synchro terminée'));
  $('btn-oublier').addEventListener('click', () => {
    if (lireFile().length) {
      alert("Des saisies sont encore en attente sur cet appareil. Envoie-les ou abandonne-les d'abord (carte « Saisies en attente »).");
      return;
    }
    if (!confirm("Effacer l'URL, le jeton et la copie locale de cet appareil ? Ton Google Sheet n'est pas touché.")) return;
    try { localStorage.removeItem(CLE_REGLAGES); localStorage.removeItem(CLE_DONNEES); } catch (e) { /* rien */ }
    oublierPhotos().then(() => location.reload());
  });

  const r = reglages();
  $('r-url').value = r.url;
  $('r-jeton').value = r.jeton;

  const cache = lireLocal(CLE_DONNEES);
  if (cache && cache.stock) {
    try { chargerDonnees(cache); } catch (e) { etat.donnees = null; }
  }
  if (!etat.donnees) { afficherStock(); afficherTableau(); afficherMapping(); afficherCache(); afficherAjout(); afficherVerifier(); afficherCarteImages(); }

  chargerPhotosLocales().then(() => { if (photosLocales.size && etat.donnees) { afficherStock(); afficherDiagnostic(); } });

  const connecte = r.url && r.jeton;
  montrer(connecte ? (location.hash.slice(1) || 'ajout') : 'reglages');
  if (connecte) {
    afficherSynchro('attente', 'Synchro…');
    lancerSynchro('Synchro terminée');
  } else {
    afficherSynchro('erreur', 'Non connecté');
  }
}

demarrer();

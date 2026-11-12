/* Sucr_tcg — images et noms officiels des cartes.
 * Source : TCGdex (https://api.tcgdex.net), API gratuite, sans clé, en français.
 * Aucune donnée personnelle n'est envoyée : seulement le nom et le numéro de la carte cherchée. */
'use strict';

const TCGDEX = 'https://api.tcgdex.net/v2/fr';
const HOTE_IMAGES = 'https://assets.tcgdex.net/';
const CLE_SETS = 'sucr-stock.sets';

/* Une « source » sait chercher une carte et dire à quelles catégories elle s'applique.
 * Pour brancher One Piece plus tard : ajouter une source ici avec les mêmes fonctions. */
const SOURCES_CARTES = [
  { nom: 'TCGdex', categories: ['Pokémon', "Ultra's", 'Collection'], chercher: chercherTcgdex, infosExtension: infosSetTcgdex }
];
function sourcePour(categorie) {
  return SOURCES_CARTES.find((s) => s.categories.includes(categorie)) || null;
}
function colonnesImagesPresentes() {
  return etat.index.idTcgdex >= 0 && etat.index.image >= 0;
}

const normaliser = (s) => sansAccent(s == null ? '' : s).replace(/[^a-z0-9]/g, '');
const memeNumero = (a, b) => normaliser(a).replace(/^0+/, '') === normaliser(b).replace(/^0+/, '');
const idSetDe = (idCarte) => String(idCarte).slice(0, String(idCarte).lastIndexOf('-'));

/* ------------------------------------------------------------------ */
/* Accès à TCGdex (avec mémoire pour ne jamais demander deux fois)      */
/* ------------------------------------------------------------------ */
const memoireRecherches = new Map();
let memoireSets = null;

async function tcgJson(url) {
  const reponse = await fetch(url);
  if (!reponse.ok) throw new Error('TCGdex ne répond pas (' + reponse.status + ').');
  return reponse.json();
}

function setsConnus() {
  if (!memoireSets) memoireSets = lireLocal(CLE_SETS) || {};
  return memoireSets;
}

/** Nom et abréviation officielle d'une extension (ex. sv01 -> « Écarlate et Violet », « SVI »). */
async function infosSetTcgdex(idSet) {
  const sets = setsConnus();
  if (sets[idSet]) return sets[idSet];
  let infos = { nom: idSet, abbr: '' };
  try {
    const d = await tcgJson(`${TCGDEX}/sets/${encodeURIComponent(idSet)}`);
    infos = { nom: d.name || idSet, abbr: (d.abbreviation && d.abbreviation.official) || '' };
    sets[idSet] = infos;
    ecrireLocal(CLE_SETS, sets);
  } catch (e) { /* extension inconnue : on garde l'identifiant brut */ }
  return infos;
}

/** Cherche des cartes par nom (+ numéro facultatif). Renvoie [{ id, nom, numero, image }]. */
async function chercherTcgdex(nom, numero) {
  const mots = String(nom).split(/[\s\-]+/).filter((m) => m.length >= 3 && !/^\d+$/.test(m));
  if (!mots.length) return [];
  const mot = mots.reduce((a, b) => (b.length > a.length ? b : a));   // le mot le plus long est le plus discriminant
  const num = String(numero || '').trim();
  const cle = normaliser(mot) + '|' + normaliser(num).replace(/^0+/, '');
  if (!memoireRecherches.has(cle)) {
    const url = `${TCGDEX}/cards?name=${encodeURIComponent(mot)}` +
      (num ? `&localId=${encodeURIComponent(num.replace(/^0+(?=.)/, ''))}` : '');
    memoireRecherches.set(cle, tcgJson(url).then((liste) => (Array.isArray(liste) ? liste : []).map((c) =>
      ({ id: c.id, nom: c.name, numero: c.localId, image: c.image || '' }))));
  }
  let resultats;
  try { resultats = await memoireRecherches.get(cle); } catch (e) { memoireRecherches.delete(cle); throw e; }
  // Le filtre de TCGdex est « contient » : on resserre nous-mêmes.
  if (num) resultats = resultats.filter((c) => memeNumero(c.numero, num));
  const attendus = mots.map(normaliser);
  return resultats.filter((c) => attendus.every((m) => normaliser(c.nom).includes(m)));
}

/* ------------------------------------------------------------------ */
/* Affichage : vignette d'un article                                    */
/* ------------------------------------------------------------------ */
const ICONES_CATEGORIE = {
  carte: '<rect x="6" y="3" width="12" height="18" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  boite: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>',
  outil: '<path d="M14 6a4 4 0 0 0 5 5l-8 8a2.1 2.1 0 0 1-3-3z"/>',
  autre: '<circle cx="12" cy="12" r="7"/><path d="M12 9v3.5M12 15v.5"/>'
};
function iconeCategorie(categorie) {
  if (categorie === 'Scellé') return ICONES_CATEGORIE.boite;
  if (categorie === 'Équipement') return ICONES_CATEGORIE.outil;
  if (categorie === 'Autre' || !categorie) return ICONES_CATEGORIE.autre;
  return ICONES_CATEGORIE.carte;
}
function imageValide(url) {
  return typeof url === 'string' && url.startsWith(HOTE_IMAGES);
}
/** Image de la carte si elle est connue, sinon une icône propre à la catégorie. */
function vignette(a) {
  if (imageValide(a.image)) {
    return `<img class="vignette" src="${esc(a.image)}/low.webp" alt="" loading="lazy" decoding="async" crossorigin="anonymous" width="44" height="61">`;
  }
  return `<span class="vignette sans-image" style="--c:${esc(couleur(a.categorie, COULEURS_CATEGORIE) || 'var(--bord)')}">
    <svg viewBox="0 0 24 24" aria-hidden="true">${iconeCategorie(a.categorie)}</svg></span>`;
}

/* ------------------------------------------------------------------ */
/* Saisie d'un achat : propositions de cartes officielles               */
/* ------------------------------------------------------------------ */
let minuteurSuggestions = null;
let dernierTexteCherche = '';

function suggererCartes() {
  const zone = $('a-suggestions');
  if (!zone) return;
  const texte = $('a-nom').value.trim();
  const source = sourcePour($('a-categorie').value);
  clearTimeout(minuteurSuggestions);
  // Si le nom a changé depuis le choix d'une carte, l'association ne vaut plus.
  if (saisie.tcg && !texte.startsWith(saisie.tcg.nomChoisi)) saisie.tcg = null;
  if (!source || texte.length < 3 || (saisie.tcg && texte.startsWith(saisie.tcg.nomChoisi))) { zone.innerHTML = ''; return; }
  minuteurSuggestions = setTimeout(async () => {
    dernierTexteCherche = texte;
    const numero = (texte.match(/\b(\d{1,3}[a-z]?)\b(?!.*\d)/i) || [])[1] || '';
    const nom = texte.replace(/\([^)]*\)?/g, ' ').replace(/\b\d+\b/g, ' ');
    let cartes;
    try { cartes = await source.chercher(nom, numero); } catch (e) { zone.innerHTML = ''; return; }   // hors ligne : saisie manuelle
    if (dernierTexteCherche !== $('a-nom').value.trim()) return;
    // Les cartes dont le nom correspond le mieux à ce qui est tapé passent en premier (« ex », « V »… compris).
    const tape = normaliser(nom);
    const note = (x) => (normaliser(x.nom) === tape ? 2 : normaliser(x.nom).includes(tape) ? 1 : 0);
    cartes = cartes.filter((c) => c.image).sort((x, y) => note(y) - note(x)).slice(0, 8);
    if (!cartes.length) { zone.innerHTML = ''; return; }
    saisie.suggestions = cartes;
    zone.innerHTML = `<p class="aide">Cartes officielles correspondantes : touche la bonne, ou continue à taper.</p>
      <div class="suggestions">${cartes.map((c, i) => `<button type="button" class="suggestion" data-suggestion="${i}">
        <img src="${esc(c.image)}/low.webp" alt="" crossorigin="anonymous" width="66" height="92">
        <span><b>${esc(c.nom)}</b><small>${esc(idSetDe(c.id).toUpperCase())} · n° ${esc(c.numero)}</small></span>
      </button>`).join('')}</div>`;
  }, 350);
}

async function choisirSuggestion(rang) {
  const carte = (saisie.suggestions || [])[rang];
  const source = sourcePour($('a-categorie').value);
  if (!carte || !source) return;
  const extension = await source.infosExtension(idSetDe(carte.id));
  const nomComplet = `${carte.nom} (${extension.abbr || idSetDe(carte.id).toUpperCase()} ${carte.numero})`;
  $('a-nom').value = nomComplet;
  saisie.tcg = { idTcgdex: carte.id, image: carte.image, nomChoisi: nomComplet };
  $('a-suggestions').innerHTML = `<div class="carte-choisie">
    <img src="${esc(carte.image)}/low.webp" alt="" crossorigin="anonymous" width="66" height="92">
    <span><b>${esc(carte.nom)}</b><small>${esc(extension.nom)} · n° ${esc(carte.numero)}</small>
      <small>Image et nom officiel enregistrés avec l'achat.</small></span>
  </div>`;
  $('a-prix').focus();
}

/* ------------------------------------------------------------------ */
/* Stock existant : « Associer les images »                             */
/* ------------------------------------------------------------------ */
const association = { enCours: false, arret: false, sures: [], incertaines: [], introuvables: 0 };

/** Découpe « Miraidon ex (SVI 244) » en nom, code d'extension et numéro. */
function decouperArticle(article) {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(String(article));
  const nom = (m ? m[1] : String(article)).trim();
  const jetons = (m ? m[2] : '').trim().split(/\s+/).filter(Boolean);
  if (!jetons.length) return { nom, code: '', numero: '' };
  if (jetons.length === 1) return /\d/.test(jetons[0]) && !/[a-z]{2}/i.test(jetons[0]) ? { nom, code: '', numero: jetons[0] } : { nom, code: jetons[0], numero: '' };
  return { nom, code: jetons.slice(0, -1).join(' '), numero: jetons[jetons.length - 1] };
}

/** Cherche la carte d'un article. « sur » seulement si nom, numéro ET code d'extension concordent. */
async function trouverCarte(a) {
  const source = sourcePour(a.categorie);
  if (!source) return { etat: 'introuvable' };
  const { nom, code, numero } = decouperArticle(a.article);
  const candidats = (await source.chercher(nom, numero)).filter((c) => c.image);
  if (!candidats.length) return { etat: 'introuvable' };
  const memeNom = candidats.filter((c) => normaliser(c.nom) === normaliser(nom));
  if (code && numero) {
    const concordantes = [];
    for (const c of memeNom.slice(0, 8)) {
      const extension = await source.infosExtension(idSetDe(c.id));
      if (extension.abbr && normaliser(extension.abbr) === normaliser(code)) concordantes.push(c);
    }
    if (concordantes.length === 1) return { etat: 'sur', carte: concordantes[0] };   // une seule carte possible
    if (concordantes.length > 1) return { etat: 'incertain', candidats: concordantes.slice(0, 6) };
  }
  return { etat: 'incertain', candidats: (memeNom.length ? memeNom : candidats).slice(0, 6) };
}

function articlesSansImage() {
  return etat.articles.filter((a) => !a._attente && a._ligne > 0 && sourcePour(a.categorie) && !imageValide(a.image));
}

function afficherCarteImages() {
  const zone = $('carte-images');
  if (!zone) return;
  if (!etat.donnees) { zone.hidden = true; return; }
  zone.hidden = false;
  const sans = articlesSansImage().length;
  const avec = etat.articles.filter((a) => imageValide(a.image)).length;
  let action;
  if (!colonnesImagesPresentes()) {
    action = '<p class="bandeau alerte">Les colonnes « ID TCGdex » et « Image » n\'existent pas encore dans ton tableur (voir GUIDE-ETAPE-7-IMAGES.md).</p>';
  } else if (!peutEcrire() || versionApi() < 6) {
    action = '<p class="aide">L\'association demande un tableur en écriture et le script à jour.</p>';
  } else if (!sans) {
    action = '<p class="message ok">Toutes tes cartes ont une image.</p>';
  } else {
    action = `<button type="button" class="btn btn-accent" id="btn-associer">Associer les images (${fmtNombre.format(sans)} cartes)</button>`;
  }
  zone.innerHTML = `<h2>Images des cartes</h2>
    <p class="aide">${fmtNombre.format(avec)} carte(s) avec image, ${fmtNombre.format(sans)} sans. Images et noms officiels fournis par TCGdex (Pokémon uniquement pour l'instant).</p>
    ${action}`;
}

async function lancerAssociation() {
  const cibles = articlesSansImage();
  Object.assign(association, { enCours: true, arret: false, sures: [], incertaines: [], introuvables: 0 });
  $('fiche-contenu').innerHTML = `<h2>Associer les images</h2>
    <p class="aide" id="as-etat">Recherche en cours…</p>
    <div class="progression"><span id="as-barre"></span></div>
    <button type="button" class="btn" id="as-arreter">Arrêter la recherche</button>`;
  $('fiche').showModal();
  let fait = 0, erreurs = 0;
  const file = cibles.slice();
  const ouvrier = async () => {
    while (file.length && !association.arret) {
      const a = file.shift();
      try {
        const r = await trouverCarte(a);
        if (r.etat === 'sur') association.sures.push({ a, carte: r.carte });
        else if (r.etat === 'incertain') association.incertaines.push({ a, candidats: r.candidats });
        else association.introuvables++;
      } catch (e) {
        if (++erreurs >= 5) association.arret = true;   // plus de réseau, ou TCGdex indisponible
      }
      fait++;
      if ($('as-barre')) {
        $('as-barre').style.width = (100 * fait / cibles.length).toFixed(1) + '%';
        $('as-etat').textContent = `${fmtNombre.format(fait)} / ${fmtNombre.format(cibles.length)} cartes examinées…`;
      }
    }
  };
  await Promise.all([ouvrier(), ouvrier(), ouvrier()]);   // 3 recherches à la fois : rapide sans surcharger TCGdex
  association.enCours = false;
  afficherResultatAssociation(erreurs >= 5);
}

function afficherResultatAssociation(interrompu) {
  const { sures, incertaines, introuvables } = association;
  const visibles = incertaines.slice(0, 40);
  $('fiche-contenu').innerHTML = `<h2>Associer les images</h2>
    ${interrompu ? '<p class="bandeau alerte">Recherche interrompue (réseau ou TCGdex indisponible). Tu peux enregistrer ce qui a été trouvé.</p>' : ''}
    <p class="aide"><b>${fmtNombre.format(sures.length)}</b> correspondance(s) sûre(s) (nom, numéro et extension identiques) ·
      <b>${fmtNombre.format(incertaines.length)}</b> à valider · <b>${fmtNombre.format(introuvables)}</b> introuvable(s).</p>
    ${visibles.length ? `<h3>À valider (${visibles.length}${incertaines.length > visibles.length ? ' sur ' + incertaines.length : ''})</h3>
      <p class="aide">Touche la bonne carte pour chaque article. Sans choix, l'article reste sans image.</p>
      <div id="as-liste">${visibles.map((x, i) => `<div class="a-valider" data-rang="${i}">
        <b>${esc(x.a.article)}</b>
        <div class="suggestions">${x.candidats.map((c, k) => `<button type="button" class="suggestion" data-candidat="${k}">
          <img src="${esc(c.image)}/low.webp" alt="" crossorigin="anonymous" width="66" height="92">
          <span><b>${esc(c.nom)}</b><small>${esc(idSetDe(c.id).toUpperCase())} · n° ${esc(c.numero)}</small></span>
        </button>`).join('')}</div>
      </div>`).join('')}</div>` : ''}
    <p class="message erreur" id="as-erreur"></p>
    <button type="button" class="btn btn-accent grand" id="as-enregistrer">${sures.length ? `Enregistrer ${fmtNombre.format(sures.length)} association(s)` : 'Enregistrer mes choix'}</button>`;
}

function majBoutonAssociation() {
  const choisies = association.incertaines.filter((x) => x.choix).length;
  const total = association.sures.length + choisies;
  $('as-enregistrer').textContent = total ? `Enregistrer ${fmtNombre.format(total)} association(s)` : 'Enregistrer mes choix';
}

async function enregistrerAssociations(bouton) {
  const toutes = association.sures.map((x) => ({ a: x.a, carte: x.carte }))
    .concat(association.incertaines.filter((x) => x.choix).map((x) => ({ a: x.a, carte: x.choix })));
  if (!toutes.length) { $('as-erreur').textContent = 'Aucune association à enregistrer.'; return; }
  bouton.disabled = true;
  let enregistrees = 0;
  try {
    for (let i = 0; i < toutes.length; i += 150) {
      const lot = toutes.slice(i, i + 150);
      bouton.textContent = `Enregistrement… ${fmtNombre.format(enregistrees)} / ${fmtNombre.format(toutes.length)}`;
      const reponse = await api('associer', { idRequete: crypto.randomUUID(),
        associations: lot.map((x) => ({ numero: x.a.numero, articleAttendu: x.a.article, idTcgdex: x.carte.id, image: x.carte.image })) });
      lot.forEach((x) => { x.a.idTcgdex = x.carte.id; x.a.image = x.carte.image; });
      enregistrees += reponse.nb;
    }
  } catch (e) {
    bouton.disabled = false;
    bouton.textContent = 'Réessayer';
    $('as-erreur').textContent = `${fmtNombre.format(enregistrees)} enregistrée(s), puis : ${e.message}`;
    afficherStock(); afficherCarteImages();
    return;
  }
  $('fiche').close();
  toast(`${fmtNombre.format(enregistrees)} image(s) associée(s).`);
  afficherStock(); afficherCarteImages();
  synchroniser().catch(() => {});
}

function brancherCartes() {
  $('contenu-ajout').addEventListener('input', (e) => {
    if (e.target.id === 'a-nom' || e.target.id === 'a-categorie') suggererCartes();
  });
  $('contenu-ajout').addEventListener('click', (e) => {
    const s = e.target.closest('[data-suggestion]');
    if (s) choisirSuggestion(Number(s.dataset.suggestion));
  });
  $('carte-images').addEventListener('click', (e) => { if (e.target.id === 'btn-associer') lancerAssociation(); });
  $('fiche-contenu').addEventListener('click', (e) => {
    if (e.target.id === 'as-arreter') { association.arret = true; return; }
    if (e.target.id === 'as-enregistrer') return enregistrerAssociations(e.target);
    const candidat = e.target.closest('[data-candidat]');
    if (!candidat) return;
    const bloc = candidat.closest('.a-valider');
    const x = association.incertaines[Number(bloc.dataset.rang)];
    const carte = x.candidats[Number(candidat.dataset.candidat)];
    const dejaChoisie = x.choix === carte;
    x.choix = dejaChoisie ? null : carte;                       // retoucher la carte choisie annule le choix
    bloc.querySelectorAll('.suggestion').forEach((b) => b.classList.toggle('choisie', !dejaChoisie && b === candidat));
    majBoutonAssociation();
  });
  // Fermer la fenêtre arrête une recherche en cours.
  $('fiche').addEventListener('close', () => { association.arret = true; });
}

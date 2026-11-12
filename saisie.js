/* Sucr_tcg — Jalon 3 : saisie (achat, lot, vente, mise en vente, modification). */
'use strict';

const CLE_MEMO = 'sucr-stock.memo';
const saisie = { mode: 'menu', lot: [], article: null, idEnCours: null };

const memo = () => lireLocal(CLE_MEMO) || {};
const retenir = (obj) => ecrireLocal(CLE_MEMO, Object.assign(memo(), obj));
const peutEcrire = () => !!(etat.donnees && etat.donnees.ecriture === true);
const listeParam = (nom) => (etat.donnees.parametres.listes && etat.donnees.parametres.listes[nom]) || [];
const plateformesVente = () => (etat.donnees.parametres.commissions || []).map((c) => c.plateforme);
const aColonneNote = () => etat.index.note >= 0;

function dateDuJour() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** « 2026-11-11 » -> { mois: 'Novembre', annee: 2026 } */
function moisAnnee(dateIso) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(dateIso || '');
  if (!m) return null;
  const mois = listeMois()[Number(m[2]) - 1];
  return mois ? { mois, annee: Number(m[1]) } : null;
}
/** '' -> null ; « 12,5 » -> 12.5 ; texte invalide -> NaN */
function lirePrix(texte) {
  const t = String(texte).trim().replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  return Math.round(parseFloat(t) * 100) / 100;
}
function options(liste, choisi, libelleVide) {
  return (libelleVide != null ? `<option value="">${esc(libelleVide)}</option>` : '') +
    liste.map((v) => `<option${v === choisi ? ' selected' : ''}>${esc(v)}</option>`).join('');
}
function toast(texte, erreur, action) {
  const t = $('toast');
  if (saisie.messageForce) { texte = saisie.messageForce; erreur = false; action = null; saisie.messageForce = null; }
  t.textContent = texte;
  if (action) {
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'toast-action';
    bouton.textContent = action.libelle;
    bouton.addEventListener('click', () => { t.hidden = true; action.fn(); });
    t.appendChild(bouton);
  }
  t.className = 'toast' + (erreur ? ' erreur' : '');
  t.hidden = false;
  clearTimeout(toast.minuteur);
  toast.minuteur = setTimeout(() => { t.hidden = true; }, action ? 9000 : erreur ? 7000 : 3500);
}

/** Envoie une écriture. Le même identifiant est réutilisé en cas de nouvel essai : pas de doublon. */
async function envoyer(action, donnees, bouton, libelle) {
  // Même contenu renvoyé (après une coupure réseau) = même identifiant ; contenu modifié = nouvel identifiant.
  const empreinte = action + JSON.stringify(donnees);
  if (!saisie.idEnCours || saisie.empreinte !== empreinte) {
    saisie.idEnCours = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    saisie.empreinte = empreinte;
  }
  const texte = bouton.textContent;
  bouton.disabled = true;
  bouton.textContent = 'Envoi…';
  afficherSynchro('attente', 'Envoi…');
  try {
    const reponse = await api(action, Object.assign({ idRequete: saisie.idEnCours }, donnees));
    saisie.idEnCours = null;
    afficherSynchro('ok', 'Enregistré');
    synchroniser().catch(() => {});
    return reponse;
  } catch (e) {
    if (e.reseau) {
      // Pas de réseau : la saisie est gardée sur l'appareil et partira toute seule plus tard.
      mettreEnFile(saisie.idEnCours, action, donnees, libelle || action);
      saisie.idEnCours = null;
      saisie.messageForce = 'Pas de réseau : saisie gardée sur cet appareil, elle partira dès le retour de la connexion.';
      afficherSynchro('erreur', 'Hors ligne'); // affichera « N en attente »
      return { ok: true, enAttente: true, resultats: [] };
    }
    afficherSynchro('erreur', 'Non enregistré');
    toast(e.message, true);
    return null;
  } finally {
    bouton.disabled = false;
    bouton.textContent = texte;
  }
}

function resumeControle(reponse) {
  const soucis = (reponse.resultats || []).filter((r) => r.controle);
  return soucis.length ? ' À vérifier : ' + soucis.map((r) => r.controle).join(' ') : '';
}

/* ------------------------------------------------------------------ */
/* Écran Ajout rapide                                                   */
/* ------------------------------------------------------------------ */
function afficherAjout() {
  const zone = $('contenu-ajout');
  if (!etat.donnees) {
    $('titre-ajout').textContent = 'Ajout rapide';
    zone.innerHTML = '<p class="vide">Connecte d\'abord ton Google Sheet dans <b>Réglages</b>.</p>';
    return;
  }
  // Pendant une saisie, une synchro en arrière-plan ne doit pas effacer le formulaire.
  if (zone.dataset.rendu === saisie.mode && saisie.mode !== 'menu') return;
  zone.dataset.rendu = saisie.mode;
  if (saisie.mode === 'achat') return afficherAchat(zone);
  if (saisie.mode === 'vente') return afficherVente(zone);
  if (saisie.mode === 'echange') return afficherEchange(zone);
  if (saisie.mode === 'ouverture') return afficherOuverture(zone);
  $('titre-ajout').textContent = 'Ajout rapide';
  const jalon4 = peutEcrire() && versionApi() >= 4;
  const aFaire = peutEcrire() ? 'Script à mettre à jour (GUIDE-JALON-4.md)' : 'Lecture seule';
  zone.innerHTML = `${bandeauFichier()}
    <div class="gros-boutons">
      <button class="gros principal" data-mode="achat" ${peutEcrire() ? '' : 'disabled'}><b>J'ai acheté</b><span>Ajouter une carte ou un lot</span></button>
      <button class="gros principal" data-mode="vente" ${peutEcrire() ? '' : 'disabled'}><b>J'ai vendu</b><span>Enregistrer une vente</span></button>
      <button class="gros" data-mode="echange" ${jalon4 ? '' : 'disabled'}><b>Échange</b><span>${jalon4 ? 'Donner et recevoir des articles' : aFaire}</span></button>
      <button class="gros" data-mode="ouverture" ${jalon4 ? '' : 'disabled'}><b>Ouverture de scellé</b><span>${jalon4 ? 'Ouvrir un scellé et ajouter ses cartes' : aFaire}</span></button>
    </div>`;
}

function versionApi() {
  const m = /jalon-(\d+)/.exec((etat.donnees && etat.donnees.version) || '');
  return m ? Number(m[1]) : 0;
}

function bandeauFichier() {
  const nom = etat.donnees.fichier;
  if (!peutEcrire()) {
    return `<p class="bandeau alerte">Lecture seule sur « ${esc(nom)} ». Pour tester l'écriture, connecte l'appli à une <b>copie</b> du Sheet (voir GUIDE-JALON-3.md).</p>`;
  }
  const copie = /^(Copie|Copy)\b/i.test(nom);
  return `<p class="bandeau ${copie ? 'ok' : 'alerte'}">${copie ? 'Fichier de test' : 'Attention, vrai fichier'} : les saisies s'écrivent dans « ${esc(nom)} ».</p>`;
}

function changerMode(mode) {
  saisie.mode = mode;
  saisie.article = null;
  saisie.idEnCours = null;
  if (mode !== 'achat') saisie.lot = [];
  saisie.donnes = [];
  saisie.recus = [];
  saisie.cartes = [];
  $('contenu-ajout').dataset.rendu = '';
  afficherAjout();
  scrollTo(0, 0);
}

/* ---------------------------- Achat ------------------------------- */
function afficherAchat(zone) {
  $('titre-ajout').textContent = "J'ai acheté";
  const m = memo();
  const noms = [...new Set(etat.articles.map((a) => String(a.article)))].slice(-1500);
  const etats = listeParam('États');
  zone.innerHTML = `
    <button class="retour" data-mode="menu">← Retour</button>
    <form class="carte formulaire" id="form-achat" autocomplete="off">
      <label>Nom de l'article <small>avec l'extension et le numéro, ex. « Miraidon ex (SVI 244) »</small>
        <input id="a-nom" list="a-noms" maxlength="200" enterkeyhint="next"></label>
      <datalist id="a-noms">${noms.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      <div id="a-suggestions"></div>
      <div class="deux">
        <label>Catégorie<select id="a-categorie">${options(listeParam('Catégories'), m.categorie || 'Pokémon')}</select></label>
        <label>Origine<select id="a-origine">${options(listeParam('Origines'), 'Achat')}</select></label>
      </div>
      <div class="champ">État
        <div class="pastilles" id="a-etat">
          ${etats.map((e) => `<label class="pastille" style="--c:${esc(couleur(e, COULEURS_ETAT))}"><input type="radio" name="a-etat" value="${esc(e)}"${e === (m.etat || 'NM') ? ' checked' : ''}><span>${esc(e)}</span></label>`).join('')}
          <label class="pastille"><input type="radio" name="a-etat" value=""><span>Aucun</span></label>
        </div>
      </div>
      <div class="deux">
        <label>Prix d'achat (€)<input id="a-prix" inputmode="decimal" placeholder="0,00"></label>
        <label>Date d'achat<input id="a-date" type="date" value="${dateDuJour()}"></label>
      </div>
      <div class="deux">
        <label>Listé sur <small>optionnel</small><select id="a-liste">${options(listeParam('Listé sur'), '', 'Pas encore listé')}</select></label>
        <label>Prix demandé (€) <small>optionnel</small><input id="a-demande" inputmode="decimal" placeholder="0,00"></label>
      </div>
      <label class="case"><input type="checkbox" id="a-horsvente"> Hors vente (collection perso, équipement)</label>
      ${aColonneNote() ? '<label>Note <small>optionnel</small><input id="a-note" maxlength="300"></label>' : ''}
      <p class="message erreur" id="a-erreur"></p>
      <div id="a-lot"></div>
      <div class="rangee">
        <button type="submit" class="btn btn-accent grand" id="a-valider">Enregistrer</button>
        <button type="button" class="btn grand" id="a-ajouter-lot">+ Ajouter au lot</button>
      </div>
    </form>`;
  ajusterHorsVente();
  afficherLot();
  $('a-nom').focus();
}

function ajusterHorsVente() {
  const c = $('a-categorie').value;
  $('a-horsvente').checked = c === 'Collection' || c === 'Équipement';
}

/** Lit le formulaire d'achat. Renvoie l'article, ou null (et affiche l'erreur). */
function lireAchat() {
  const erreur = (t) => { $('a-erreur').textContent = t; return null; };
  $('a-erreur').textContent = '';
  const article = $('a-nom').value.trim();
  if (!article) return erreur("Indique le nom de l'article.");
  const prixAchat = lirePrix($('a-prix').value);
  if (prixAchat === null) return erreur("Indique le prix d'achat (0 pour une ouverture ou un cadeau).");
  if (isNaN(prixAchat)) return erreur("Prix d'achat invalide.");
  const prixDemande = lirePrix($('a-demande').value);
  if (prixDemande !== null && isNaN(prixDemande)) return erreur('Prix demandé invalide.');
  const date = moisAnnee($('a-date').value);
  if (!date) return erreur("Indique la date d'achat.");
  const origine = $('a-origine').value;
  if (prixAchat === 0 && origine === 'Achat') return erreur("Prix à 0 € : choisis l'origine « Ouverture » ou « Cadeau / Gratuit ».");
  if (prixAchat > 0 && origine === 'Ouverture') return erreur("Origine « Ouverture » : le prix d'achat doit être 0 €.");
  const horsVente = $('a-horsvente').checked;
  const listeSur = horsVente ? '' : $('a-liste').value;
  const etatCarte = (document.querySelector('input[name="a-etat"]:checked') || {}).value || '';
  const a = {
    categorie: $('a-categorie').value, article, etat: etatCarte,
    moisAchat: date.mois, anneeAchat: date.annee, prixAchat, origine,
    statut: horsVente ? 'Hors vente' : (listeSur ? 'Listé' : 'En stock'),
    listeSur, prixDemande: horsVente || prixDemande === null ? '' : prixDemande
  };
  if (aColonneNote()) a.note = $('a-note').value.trim();
  // Carte officielle choisie dans les propositions : on enregistre son identifiant et son image.
  if (saisie.tcg && colonnesImagesPresentes() && article.startsWith(saisie.tcg.nomChoisi)) {
    a.idTcgdex = saisie.tcg.idTcgdex;
    a.image = saisie.tcg.image;
  }
  retenir({ categorie: a.categorie, etat: etatCarte });
  return a;
}

function afficherLot() {
  const bloc = $('a-lot');
  if (!bloc) return;
  if (!saisie.lot.length) { bloc.innerHTML = ''; $('a-valider').textContent = 'Enregistrer'; return; }
  const total = saisie.lot.reduce((t, a) => t + a.prixAchat, 0);
  bloc.innerHTML = `<div class="lot">
    <h2>Lot en cours : ${saisie.lot.length} article${saisie.lot.length > 1 ? 's' : ''} · ${esc(euros(total))}</h2>
    ${saisie.lot.map((a, i) => `<div class="lot-ligne"><span>${esc(a.article)} <small>${esc(a.etat)}</small></span>
      <b>${esc(euros(a.prixAchat))}</b><button type="button" class="btn-mini" data-retirer="${i}" aria-label="Retirer du lot">×</button></div>`).join('')}
    <div class="deux">
      <label>Prix total payé pour le lot (€)<input id="a-total" inputmode="decimal" placeholder="${esc(String(total.toFixed(2)).replace('.', ','))}"></label>
      <button type="button" class="btn" id="a-repartir">Répartir ce total</button>
    </div>
    <p class="aide">Répartition au prorata des prix saisis (à parts égales si tous sont à 0).</p>
  </div>`;
  $('a-valider').textContent = `Enregistrer le lot (${saisie.lot.length})`;
}

/** Répartit un total en centimes : au prorata des prix déjà saisis, sinon à parts égales. */
function repartir(total, poids) {
  const centimes = Math.round(total * 100);
  const somme = poids.reduce((t, p) => t + p, 0);
  const parts = poids.map((p) => Math.floor(centimes * (somme > 0 ? p / somme : 1 / poids.length)));
  let reste = centimes - parts.reduce((t, p) => t + p, 0);
  for (let i = 0; reste > 0; i = (i + 1) % parts.length, reste--) parts[i]++;
  return parts.map((p) => p / 100);
}

async function validerAchat(bouton) {
  let articles = saisie.lot.slice();
  if (!articles.length || $('a-nom').value.trim() !== '') {
    const a = lireAchat();
    if (!a) return;
    articles.push(a);
  }
  const reponse = await envoyer('ajouter', { articles }, bouton,
    articles.length > 1 ? `Achat : lot de ${articles.length} articles` : `Achat : ${articles[0].article}`);
  if (!reponse) return;
  const n = reponse.resultats.length;
  toast(reponse.enAttente ? '' : (n > 1 ? `${n} articles ajoutés` : `Ajouté : N° ${reponse.resultats[0].numero}, ligne ${reponse.resultats[0].ligne}`) +
    resumeControle(reponse) + (reponse.avertissement ? ' ' + reponse.avertissement : ''), !!reponse.avertissement);
  saisie.lot = [];
  viderAchat();
  afficherLot();
}

function viderAchat() {
  ['a-nom', 'a-prix', 'a-demande', 'a-note', 'a-liste'].forEach((id) => { if ($(id)) $(id).value = ''; });
  saisie.tcg = null;
  if ($('a-suggestions')) $('a-suggestions').innerHTML = '';
  $('a-nom').focus();
}

/* ---------------------------- Vente ------------------------------- */
function distanceAuPlus1(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, ecarts = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++ecarts > 1) return false;
    if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
  }
  return ecarts + (a.length - i) + (b.length - j) <= 1;
}
/** Recherche floue : chaque mot tapé doit être contenu dans le nom, ou à une faute de frappe près. */
function correspond(recherche, mots) {
  return mots.every((m) => recherche.includes(m) || (m.length >= 4 &&
    recherche.split(/[^a-z0-9]+/).some((w) => distanceAuPlus1(m, w.slice(0, m.length)) || distanceAuPlus1(m, w.slice(0, m.length + 1)))));
}

function afficherVente(zone) {
  $('titre-ajout').textContent = "J'ai vendu";
  zone.innerHTML = `
    <button class="retour" data-mode="menu">← Retour</button>
    <div class="carte formulaire">
      <label>Article vendu<input type="search" id="v-recherche" placeholder="Nom ou numéro…" autocomplete="off"></label>
      <div class="liste" id="v-resultats"></div>
      <div id="v-detail"></div>
    </div>`;
  if (saisie.article) choisirArticleVendu(saisie.article); else $('v-recherche').focus();
}

function chercherVente() {
  const q = sansAccent($('v-recherche').value.trim());
  const bloc = $('v-resultats');
  $('v-detail').innerHTML = '';
  saisie.article = null;
  if (q.length < 2) { bloc.innerHTML = ''; return; }
  const mots = q.split(/\s+/);
  const trouves = etat.articles
    .filter((a) => !a._attente && (a.statut === 'En stock' || a.statut === 'Listé') && correspond(a._recherche, mots))
    .sort((a, b) => Calculs.n(b.numero) - Calculs.n(a.numero)).slice(0, 8);
  bloc.innerHTML = trouves.map((a) => `<button type="button" class="article" data-choisir="${a._ligne}">
      <span class="a-nom"><small>N° ${esc(a.numero)}</small>${esc(a.article)}</span>
      <span class="a-prix">${esc(euros(a.prixAchat))}<small>${typeof a.prixDemande === 'number' ? 'demandé ' + esc(euros(a.prixDemande)) : ''}</small></span>
      <span class="a-infos"><span class="puce">${esc(a.statut)}</span>${a.etat ? `<span>${esc(a.etat)}</span>` : ''}<span>${esc(a.listeSur || '')}</span></span>
    </button>`).join('') || '<p class="vide">Aucun article en stock ne correspond.</p>';
}

function choisirArticleVendu(a) {
  saisie.article = a;
  saisie.idEnCours = null;
  $('v-resultats').innerHTML = '';
  $('v-recherche').value = a.article;
  const m = memo();
  const plateformes = plateformesVente();
  const defaut = plateformes.includes(a.listeSur) ? a.listeSur : (m.venduSur || plateformes[0]);
  $('v-detail').innerHTML = `
    <p class="aide">N° ${esc(a.numero)} · ${esc(a.categorie)} · ${esc(a.etat || 'sans état')} · acheté ${esc(euros(a.prixAchat))} (${esc(a.moisAchat)} ${esc(a.anneeAchat)})</p>
    <div class="deux">
      <label>Prix de vente BRUT (€)<input id="v-prix" inputmode="decimal" placeholder="0,00" value="${typeof a.prixDemande === 'number' ? String(a.prixDemande).replace('.', ',') : ''}"></label>
      <label>Vendu sur<select id="v-plateforme">${options(plateformes, defaut)}</select></label>
    </div>
    <label>Date de vente<input id="v-date" type="date" value="${dateDuJour()}"></label>
    <div class="apercu" id="v-apercu"></div>
    <p class="message erreur" id="v-erreur"></p>
    <button type="button" class="btn btn-accent grand" id="v-valider">Valider la vente</button>`;
  apercuVente();
  $('v-prix').focus();
  $('v-prix').select();
}

function apercuVente() {
  const a = saisie.article;
  if (!a || !$('v-apercu')) return;
  const brut = lirePrix($('v-prix').value);
  if (brut === null || isNaN(brut)) { $('v-apercu').innerHTML = ''; return; }
  const plateforme = $('v-plateforme').value;
  const c = (etat.donnees.parametres.commissions || []).find((x) => x.plateforme === plateforme);
  const taux = c ? Calculs.n(c.taux) : 0;
  const commission = brut * taux;
  const net = brut - commission;
  const ouverture = a.origine === 'Ouverture';
  const benefice = net - Calculs.n(a.prixAchat);
  $('v-apercu').innerHTML = `
    <div><span>Commission ${esc(plateforme)} (${esc(fmtPourcent.format(taux))})</span><b>${esc(euros(commission))}</b></div>
    <div><span>Prix net</span><b>${esc(euros(net))}</b></div>
    <div class="total"><span>Bénéfice</span><b class="${!ouverture && benefice < 0 ? 'negatif' : ''}">${ouverture ? "Carte d'ouverture : non compté" : esc(euros(benefice))}</b></div>`;
}

async function validerVente(bouton) {
  const a = saisie.article;
  const erreur = (t) => { $('v-erreur').textContent = t; };
  erreur('');
  const brut = lirePrix($('v-prix').value);
  if (brut === null || isNaN(brut) || brut <= 0) return erreur('Indique un prix de vente brut supérieur à 0.');
  const date = moisAnnee($('v-date').value);
  if (!date) return erreur('Indique la date de vente.');
  const venduSur = $('v-plateforme').value;
  const reponse = await envoyer('modifier', { ligne: a._ligne, numero: a.numero, articleAttendu: a.article,
    champs: { statut: 'Vendu', moisVente: date.mois, anneeVente: date.annee, venduSur, prixVenteBrut: brut } }, bouton,
    `Vente : ${a.article} (${euros(brut)})`);
  if (!reponse) return;
  retenir({ venduSur });
  // L'article est marqué vendu tout de suite en local, sans attendre la synchro.
  a.statut = 'Vendu';
  toast(`Vente enregistrée : ${a.article}` + resumeControle(reponse));
  saisie.article = null;
  $('contenu-ajout').dataset.rendu = '';
  afficherAjout();
}

/* ------------------------------------------------------------------ */
/* Outils communs aux échanges et aux ouvertures                        */
/* ------------------------------------------------------------------ */
function rechercherArticles(texte, filtre) {
  const q = sansAccent(String(texte).trim());
  if (q.length < 2) return null;
  const mots = q.split(/\s+/);
  return etat.articles.filter((a) => !a._attente && filtre(a) && correspond(a._recherche, mots))
    .sort((a, b) => Calculs.n(b.numero) - Calculs.n(a.numero)).slice(0, 8);
}
function htmlResultats(liste, attribut) {
  if (liste === null) return '';
  return liste.map((a) => `<button type="button" class="article" data-${attribut}="${a._ligne}">
      <span class="a-nom"><small>N° ${esc(a.numero)}</small>${esc(a.article)}</span>
      <span class="a-prix">${esc(euros(a.prixAchat))}</span>
      <span class="a-infos"><span class="puce">${esc(a.statut)}</span>${a.etat ? `<span>${esc(a.etat)}</span>` : ''}<span>${esc(a.categorie)}</span></span>
    </button>`).join('') || '<p class="vide">Aucun article ne correspond.</p>';
}
/** Petit formulaire « nouvel article » (reçu en échange, ou tiré d'un scellé). */
function htmlMini(p, avecValeur) {
  const m = memo();
  const noms = [...new Set(etat.articles.map((a) => String(a.article)))].slice(-1500);
  return `<label>Nom de l'article<input id="${p}-nom" list="${p}-noms" maxlength="200"></label>
    <datalist id="${p}-noms">${noms.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
    <div class="deux">
      <label>Catégorie<select id="${p}-categorie">${options(listeParam('Catégories'), 'Pokémon')}</select></label>
      <label>État<select id="${p}-etat">${options(listeParam('États'), m.etat || 'NM', 'Aucun')}</select></label>
    </div>
    <div class="deux">
      ${avecValeur ? `<label>Valeur estimée (€) <small>sert à répartir le coût</small><input id="${p}-valeur" inputmode="decimal" placeholder="0,00"></label>` : ''}
      <label>Prix demandé (€) <small>optionnel</small><input id="${p}-demande" inputmode="decimal" placeholder="0,00"></label>
      ${avecValeur ? '' : `<label>Listé sur <small>optionnel</small><select id="${p}-liste">${options(listeParam('Listé sur'), '', 'Pas encore listé')}</select></label>`}
    </div>
    <p class="message erreur" id="${p}-erreur"></p>`;
}
function lireMini(p, avecValeur) {
  const erreur = (t) => { $(p + '-erreur').textContent = t; return null; };
  $(p + '-erreur').textContent = '';
  const article = $(p + '-nom').value.trim();
  if (!article) return erreur("Indique le nom de l'article.");
  const demande = lirePrix($(p + '-demande').value);
  if (demande !== null && isNaN(demande)) return erreur('Prix demandé invalide.');
  const a = { article, categorie: $(p + '-categorie').value, etat: $(p + '-etat').value,
    prixDemande: demande === null ? '' : demande, listeSur: avecValeur ? '' : $(p + '-liste').value };
  if (avecValeur) {
    const valeur = lirePrix($(p + '-valeur').value);
    if (valeur !== null && isNaN(valeur)) return erreur('Valeur estimée invalide.');
    a.valeurEstimee = valeur === null ? '' : valeur;
  }
  ['nom', 'demande', 'valeur', 'liste'].forEach((c) => { if ($(p + '-' + c)) $(p + '-' + c).value = ''; });
  $(p + '-nom').focus();
  return a;
}

/* ---------------------------- Échange ----------------------------- */
function afficherEchange(zone) {
  $('titre-ajout').textContent = 'Échange';
  zone.innerHTML = `
    <button class="retour" data-mode="menu">← Retour</button>
    <div class="carte formulaire">
      <h2>Ce que je donne</h2>
      <label>Chercher dans mon stock<input type="search" id="e-recherche" placeholder="Nom ou numéro…" autocomplete="off"></label>
      <div class="liste" id="e-resultats"></div>
      <div id="e-donnes"></div>
    </div>
    <div class="carte formulaire">
      <h2>Ce que je reçois</h2>
      ${htmlMini('e', true)}
      <button type="button" class="btn" id="e-ajouter-recu">+ Ajouter cet article reçu</button>
      <div id="e-recus"></div>
    </div>
    <div class="carte formulaire">
      <div class="deux">
        <label>Date de l'échange<input id="e-date" type="date" value="${dateDuJour()}"></label>
        <label>Remarque <small>optionnel</small><input id="e-remarque" maxlength="200"></label>
      </div>
      <p class="aide">Chaque article reçu est créé avec l'origine « Échange » et, comme prix d'achat, son coût reporté : le bénéfice à la revente en tient compte.</p>
      <button type="button" class="btn btn-accent grand" id="e-valider">Enregistrer l'échange</button>
    </div>`;
  majEchange();
}

/** Coût reporté sur chaque article reçu : prorata de la valeur estimée, sinon parts égales. */
function coutsReportes(total, recus) {
  const somme = recus.reduce((t, r) => t + Calculs.n(r.valeurEstimee), 0);
  return recus.map((r) => (somme > 0 ? total * Calculs.n(r.valeurEstimee) / somme : total / recus.length));
}

function majEchange() {
  const total = saisie.donnes.reduce((t, a) => t + Calculs.n(a.prixAchat), 0);
  $('e-donnes').innerHTML = saisie.donnes.length ? `<div class="lot">
      ${saisie.donnes.map((a, i) => `<div class="lot-ligne"><span>${esc(a.article)} <small>N° ${esc(a.numero)}</small></span>
        <b>${esc(euros(a.prixAchat))}</b><button type="button" class="btn-mini" data-retirer-donne="${i}" aria-label="Retirer">×</button></div>`).join('')}
      <div class="lot-ligne"><span>Coût total donné</span><b>${esc(euros(total))}</b></div>
    </div>` : '<p class="aide">Aucun article donné pour l\'instant.</p>';
  const couts = coutsReportes(total, saisie.recus);
  $('e-recus').innerHTML = saisie.recus.length ? `<div class="lot">
      ${saisie.recus.map((r, i) => `<div class="lot-ligne"><span>${esc(r.article)} <small>${esc(r.etat)} · estimé ${r.valeurEstimee === '' ? '—' : esc(euros(r.valeurEstimee))}</small></span>
        <b title="Coût reporté">${esc(euros(couts[i]))}</b><button type="button" class="btn-mini" data-retirer-recu="${i}" aria-label="Retirer">×</button></div>`).join('')}
      <p class="aide">À droite : le coût reporté sur chaque article reçu. Pour changer la répartition, retire l'article et rajoute-le avec une autre valeur estimée.</p>
    </div>` : '';
  $('e-valider').textContent = saisie.donnes.length && saisie.recus.length
    ? `Enregistrer l'échange (${saisie.donnes.length} contre ${saisie.recus.length})` : "Enregistrer l'échange";
}

async function validerEchange(bouton) {
  if ($('e-nom').value.trim() !== '') {
    const r = lireMini('e', true);
    if (!r) return;
    saisie.recus.push(r);
    majEchange();
  }
  if (!saisie.donnes.length) return toast('Ajoute au moins un article donné.', true);
  if (!saisie.recus.length) return toast('Ajoute au moins un article reçu.', true);
  const date = moisAnnee($('e-date').value);
  if (!date) return toast("Indique la date de l'échange.", true);
  const reponse = await envoyer('echanger', { mois: date.mois, annee: date.annee, remarque: $('e-remarque').value.trim(),
    donnes: saisie.donnes.map((a) => ({ ligne: a._ligne, numero: a.numero, articleAttendu: a.article })),
    recus: saisie.recus }, bouton, `Échange : ${saisie.donnes.length} donné(s) contre ${saisie.recus.length} reçu(s)`);
  if (!reponse) return;
  saisie.donnes.forEach((a) => { a.statut = 'Échangé'; });
  toast(`Échange n° ${reponse.ref} enregistré : ${saisie.donnes.length} donné(s), ${reponse.resultats.length} reçu(s).` +
    resumeControle(reponse) + (reponse.avertissement ? ' ' + reponse.avertissement : ''), !!reponse.avertissement);
  changerMode('menu');
}

/* ----------------------- Ouverture de scellé ---------------------- */
function afficherOuverture(zone) {
  $('titre-ajout').textContent = 'Ouverture de scellé';
  zone.innerHTML = `
    <button class="retour" data-mode="menu">← Retour</button>
    <div class="carte formulaire">
      <label>Scellé ouvert<input type="search" id="o-recherche" placeholder="Nom ou numéro du scellé…" autocomplete="off"></label>
      <div class="liste" id="o-resultats"></div>
      <div id="o-detail"></div>
    </div>`;
  $('o-recherche').focus();
}

function choisirScelle(a) {
  saisie.article = a;
  saisie.cartes = [];
  $('o-resultats').innerHTML = '';
  $('o-recherche').value = a.article;
  $('o-detail').innerHTML = `
    <p class="aide">N° ${esc(a.numero)} · acheté ${esc(euros(a.prixAchat))} (${esc(a.moisAchat)} ${esc(a.anneeAchat)}). Il passera au statut « Ouvert ».</p>
    <label>Date d'ouverture<input id="o-date" type="date" value="${dateDuJour()}"></label>
    <h2>Cartes à garder dans le stock</h2>
    <p class="aide">Chaque carte est créée à 0 €, origine « Ouverture » : aucun bénéfice n'est calculé dessus.</p>
    ${htmlMini('o', false)}
    <button type="button" class="btn" id="o-ajouter-carte">+ Ajouter cette carte</button>
    <div id="o-cartes"></div>
    <button type="button" class="btn btn-accent grand" id="o-valider">Ouvrir le scellé</button>`;
  majOuverture();
  $('o-nom').focus();
}

function majOuverture() {
  $('o-cartes').innerHTML = saisie.cartes.length ? `<div class="lot">
      ${saisie.cartes.map((c, i) => `<div class="lot-ligne"><span>${esc(c.article)} <small>${esc(c.etat)}${c.listeSur ? ' · ' + esc(c.listeSur) : ''}</small></span>
        <b>${c.prixDemande === '' ? '' : esc(euros(c.prixDemande))}</b><button type="button" class="btn-mini" data-retirer-carte="${i}" aria-label="Retirer">×</button></div>`).join('')}
    </div>` : '';
  const n = saisie.cartes.length;
  $('o-valider').textContent = n ? `Ouvrir le scellé et ajouter ${n} carte${n > 1 ? 's' : ''}` : 'Ouvrir le scellé sans ajouter de carte';
}

async function validerOuverture(bouton) {
  const a = saisie.article;
  if ($('o-nom').value.trim() !== '') {
    const c = lireMini('o', false);
    if (!c) return;
    saisie.cartes.push(c);
    majOuverture();
  }
  const date = moisAnnee($('o-date').value);
  if (!date) return toast("Indique la date d'ouverture.", true);
  const reponse = await envoyer('ouvrir', { ligne: a._ligne, numero: a.numero, articleAttendu: a.article,
    mois: date.mois, annee: date.annee, cartes: saisie.cartes }, bouton, `Ouverture : ${a.article}`);
  if (!reponse) return;
  a.statut = 'Ouvert';
  toast(`Scellé ouvert : ${a.article}. ${reponse.resultats.length} carte(s) ajoutée(s).` +
    resumeControle(reponse) + (reponse.avertissement ? ' ' + reponse.avertissement : ''), !!reponse.avertissement);
  changerMode('menu');
}

/* ------------------------------------------------------------------ */
/* Fiche article : Marquer vendu / Marquer listé / Modifier             */
/* ------------------------------------------------------------------ */
function boutonsFiche(a) {
  if (!peutEcrire()) return '';
  if (a._attente) return '<p class="bandeau alerte">Saisie en attente d\'envoi : modifiable après la prochaine synchro.</p>';
  const enVente = a.statut === 'En stock' || a.statut === 'Listé';
  return `<div class="rangee actions-fiche" data-ligne="${a._ligne}">
    ${enVente ? '<button type="button" class="btn btn-accent" data-fiche="vendre">Marquer vendu</button>' : ''}
    ${enVente ? `<button type="button" class="btn" data-fiche="lister">${a.statut === 'Listé' ? 'Changer la mise en vente' : 'Marquer listé'}</button>` : ''}
    <button type="button" class="btn" data-fiche="modifier">Modifier</button>
    ${versionApi() >= 5 ? '<button type="button" class="btn btn-danger" data-fiche="supprimer">Supprimer</button>' : ''}
  </div>`;
}

function ficheLister(a) {
  $('fiche-contenu').innerHTML = `<h2>Mettre en vente</h2><p class="aide">${esc(a.article)}</p>
    <div class="formulaire" data-ligne="${a._ligne}">
      <label>Listé sur<select id="l-liste">${options(listeParam('Listé sur'), a.listeSur || 'Cardmarket')}</select></label>
      <label>Prix demandé (€)<input id="l-prix" inputmode="decimal" value="${typeof a.prixDemande === 'number' ? String(a.prixDemande).replace('.', ',') : ''}"></label>
      <p class="message erreur" id="l-erreur"></p>
      <button type="button" class="btn btn-accent grand" data-fiche="valider-lister">Enregistrer</button>
    </div>`;
}

function ficheModifier(a) {
  const prix = (v) => (typeof v === 'number' ? String(v).replace('.', ',') : '');
  $('fiche-contenu').innerHTML = `<h2>Modifier</h2><p class="aide">N° ${esc(a.numero)} · ligne ${a._ligne}</p>
    <div class="formulaire" data-ligne="${a._ligne}">
      <label>Nom de l'article<input id="m-article" maxlength="200" value="${esc(a.article)}"></label>
      <div class="deux">
        <label>Catégorie<select id="m-categorie">${options(listeParam('Catégories'), a.categorie, '—')}</select></label>
        <label>État<select id="m-etat">${options(listeParam('États'), a.etat, 'Aucun')}</select></label>
      </div>
      <div class="deux">
        <label>Prix d'achat (€)<input id="m-prixAchat" inputmode="decimal" value="${prix(a.prixAchat)}"></label>
        <label>Origine<select id="m-origine">${options(listeParam('Origines'), a.origine, '—')}</select></label>
      </div>
      <div class="deux">
        <label>Listé sur<select id="m-listeSur">${options(listeParam('Listé sur'), a.listeSur, 'Aucun')}</select></label>
        <label>Prix demandé (€)<input id="m-prixDemande" inputmode="decimal" value="${prix(a.prixDemande)}"></label>
      </div>
      ${a.statut === 'Vendu' ? `<div class="deux">
        <label>Prix de vente brut (€)<input id="m-prixVenteBrut" inputmode="decimal" value="${prix(a.prixVenteBrut)}"></label>
        <label>Vendu sur<select id="m-venduSur">${options(plateformesVente(), a.venduSur, '—')}</select></label>
      </div>
      <div class="deux">
        <label>Mois de vente<select id="m-moisVente">${options(listeMois(), a.moisVente, '—')}</select></label>
        <label>Année de vente<input id="m-anneeVente" inputmode="numeric" maxlength="4" value="${esc(a.anneeVente)}"></label>
      </div>` : ''}
      ${a.statut ? '' : `<label>Statut<select id="m-statut">${options(['En stock', 'Listé', 'Hors vente'], '', 'À choisir')}</select></label>`}
      ${aColonneNote() ? `<label>Note<input id="m-note" maxlength="300" value="${esc(a.note)}"></label>` : ''}
      <p class="aide">Le statut se change avec « Marquer vendu » ou « Marquer listé ».</p>
      <p class="message erreur" id="m-erreur"></p>
      <button type="button" class="btn btn-accent grand" data-fiche="valider-modifier">Enregistrer les modifications</button>
    </div>`;
}

async function actionFiche(action, a, bouton) {
  if (action === 'vendre') {
    $('fiche').close();
    saisie.mode = 'vente';
    saisie.article = a;
    $('contenu-ajout').dataset.rendu = '';
    montrer('ajout');
    afficherAjout();
    return;
  }
  if (action === 'supprimer') return ficheSupprimer(a);
  if (action === 'annuler-suppression') return ouvrirFiche(a._ligne);
  if (action === 'valider-supprimer') return supprimerArticle(a, bouton);
  if (action === 'lister') { saisie.idEnCours = null; return ficheLister(a); }
  if (action === 'modifier') { saisie.idEnCours = null; return ficheModifier(a); }

  let champs = {};
  if (action === 'valider-lister') {
    const prix = lirePrix($('l-prix').value);
    if (prix !== null && isNaN(prix)) { $('l-erreur').textContent = 'Prix demandé invalide.'; return; }
    champs = { statut: 'Listé', listeSur: $('l-liste').value, prixDemande: prix === null ? '' : prix };
  }
  if (action === 'valider-modifier') {
    const erreur = (t) => { $('m-erreur').textContent = t; };
    const lus = { article: $('m-article').value.trim(), categorie: $('m-categorie').value, etat: $('m-etat').value,
      origine: $('m-origine').value, listeSur: $('m-listeSur').value };
    const champsPrix = ['prixAchat', 'prixDemande'];
    if ($('m-prixVenteBrut')) {
      champsPrix.push('prixVenteBrut');
      lus.venduSur = $('m-venduSur').value;
      lus.moisVente = $('m-moisVente').value;
      const annee = $('m-anneeVente').value.trim();
      if (annee !== '' && !/^20\d\d$/.test(annee)) return erreur('Année de vente invalide.');
      lus.anneeVente = annee === '' ? '' : Number(annee);
    }
    if ($('m-statut') && $('m-statut').value) lus.statut = $('m-statut').value;
    for (const cle of champsPrix) {
      const p = lirePrix($('m-' + cle).value);
      if (p !== null && isNaN(p)) return erreur('Prix invalide.');
      lus[cle] = p === null ? '' : p;
    }
    if (aColonneNote()) lus.note = $('m-note').value.trim();
    if (!lus.article) return erreur("Le nom de l'article est obligatoire.");
    // On n'envoie que ce qui a réellement changé.
    for (const cle in lus) {
      const avant = a[cle] == null ? '' : a[cle];
      if (lus[cle] !== avant) champs[cle] = lus[cle];
    }
    if (!Object.keys(champs).length) return erreur('Aucun changement.');
  }
  const reponse = await envoyer('modifier', { ligne: a._ligne, numero: a.numero, articleAttendu: a.article, champs }, bouton,
    `Modification : ${a.article}`);
  if (!reponse) return;
  Object.assign(a, champs);
  if (!reponse.enAttente && reponse.resultats[0]) a.controle = reponse.resultats[0].controle || '';
  $('fiche').close();
  toast('Modification enregistrée.' + resumeControle(reponse));
  afficherStock();
  afficherVerifier();
}

/* ------------------------------------------------------------------ */
/* Suppression d'un article (vers l'onglet « Corbeille » du tableur)    */
/* ------------------------------------------------------------------ */
function estDansUnEchange(a) {
  if (a.refEchange !== '' && a.refEchange != null) return true;
  if (a.statut === 'Échangé') return true;
  const e = etat.donnees.echanges || {};
  const col = (e.colonnes || []).indexOf('N° Stock');
  return col >= 0 && (e.valeurs || []).some((l) => l[col] === a.numero);
}

function peutSupprimer(a) {
  return peutEcrire() && versionApi() >= 5 && !a._attente && a._ligne > 0;
}

/** Fenêtre de confirmation : nom, prix et date de l'article, et alerte s'il fait partie d'un échange. */
function ficheSupprimer(a) {
  const echange = estDansUnEchange(a);
  $('fiche-contenu').innerHTML = `<h2>Supprimer cet article ?</h2>
    <div class="formulaire" data-ligne="${a._ligne}">
      <table>
        <tr><td>Article</td><td><b>${esc(a.article)}</b></td></tr>
        <tr><td>N°</td><td>${esc(a.numero)}</td></tr>
        <tr><td>Prix d'achat</td><td>${esc(euros(a.prixAchat))}</td></tr>
        <tr><td>Date d'achat</td><td>${esc(a.moisAchat)} ${esc(a.anneeAchat)}</td></tr>
        <tr><td>Statut</td><td>${esc(a.statut || 'Sans statut')}${a.statut === 'Vendu' ? ' · ' + esc(euros(a.prixVenteBrut)) : ''}</td></tr>
      </table>
      ${echange ? `<p class="bandeau alerte"><b>Attention : cet article fait partie d'un échange${a.refEchange !== '' ? ' (réf. ' + esc(a.refEchange) + ')' : ''}.</b><br>
        Le supprimer affichera « N° introuvable » dans l'onglet Échanges et faussera le coût reporté de cet échange.</p>
        <label class="case"><input type="checkbox" id="s-echange"> Je supprime quand même cet article</label>` : ''}
      ${a.statut === 'Vendu' ? '<p class="bandeau alerte">Cet article est vendu : le supprimer retire sa vente de ton chiffre d\'affaires et de ton bénéfice.</p>' : ''}
      <p class="aide">L'article est d'abord recopié dans l'onglet « Corbeille » du tableur, puis retiré du Stock. Tu peux annuler juste après.</p>
      <p class="message erreur" id="s-erreur"></p>
      <div class="rangee">
        <button type="button" class="btn grand" data-fiche="annuler-suppression">Garder l'article</button>
        <button type="button" class="btn grand btn-supprimer" data-fiche="valider-supprimer">Supprimer</button>
      </div>
    </div>`;
  if (!$('fiche').open) $('fiche').showModal();
}

async function supprimerArticle(a, bouton) {
  const erreur = (t) => { $('s-erreur').textContent = t; };
  erreur('');
  if (!navigator.onLine) return erreur('Pas de connexion : la suppression se fait uniquement avec du réseau.');
  const echange = estDansUnEchange(a);
  if (echange && !$('s-echange').checked) return erreur('Coche la case pour confirmer la suppression d\'un article échangé.');
  bouton.disabled = true;
  afficherSynchro('attente', 'Suppression…');
  try {
    // Envoi direct : une suppression n'est jamais mise en file d'attente.
    await api('deleteRow', { idRequete: crypto.randomUUID(), numero: a.numero, articleAttendu: a.article, confirmeEchange: echange });
  } catch (e) {
    afficherSynchro('erreur', 'Non supprimé');
    bouton.disabled = false;
    return erreur(e.message);
  }
  const position = etat.articles.indexOf(a);
  if (position >= 0) etat.articles.splice(position, 1);
  $('fiche').close();
  afficherStock(); afficherVerifier(); afficherTableau();
  afficherSynchro('ok', 'Supprimé');
  toast(`Supprimé : ${a.article}`, false, { libelle: 'Annuler', fn: () => restaurerArticle(a, position) });
  synchroniser().catch(() => {});
}

async function restaurerArticle(a, position) {
  afficherSynchro('attente', 'Restauration…');
  try {
    await api('restoreRow', { idRequete: crypto.randomUUID(), numero: a.numero });
  } catch (e) {
    afficherSynchro('erreur', 'Non restauré');
    return toast('Restauration impossible : ' + e.message + ' L\'article reste dans l\'onglet Corbeille du tableur.', true);
  }
  if (!etat.articles.includes(a)) etat.articles.splice(position >= 0 ? position : etat.articles.length, 0, a);
  afficherStock(); afficherVerifier(); afficherTableau();
  afficherSynchro('ok', 'Restauré');
  toast(`Restauré : ${a.article}`);
  synchroniser().catch(() => {});
}

/** Menu d'actions d'une ligne du Stock (appui long sur mobile, clic droit sur PC). */
function menuArticle(a) {
  $('fiche-contenu').innerHTML = `<h2>${esc(a.article)}</h2><p class="aide">${a.numero === '' ? 'Nouveau' : 'N° ' + esc(a.numero)} · ${esc(a.statut || 'Sans statut')}</p>
    <div class="menu-actions" data-ligne="${a._ligne}">
      <button type="button" class="btn grand" data-fiche="annuler-suppression">Ouvrir la fiche</button>
      ${peutSupprimer(a) ? '<button type="button" class="btn grand btn-danger" data-fiche="supprimer">Supprimer…</button>' : ''}
    </div>`;
  if (!$('fiche').open) $('fiche').showModal();
}

/* ------------------------------------------------------------------ */
/* Événements                                                           */
/* ------------------------------------------------------------------ */
function brancherSaisie() {
$('contenu-ajout').addEventListener('click', (e) => {
  const mode = e.target.closest('[data-mode]');
  if (mode && !mode.disabled) return changerMode(mode.dataset.mode);
  const retirer = e.target.closest('[data-retirer]');
  if (retirer) { saisie.lot.splice(Number(retirer.dataset.retirer), 1); saisie.idEnCours = null; return afficherLot(); }
  const choisir = e.target.closest('[data-choisir]');
  if (choisir) return choisirArticleVendu(etat.articles.find((a) => a._ligne === Number(choisir.dataset.choisir)));
  if (e.target.id === 'a-ajouter-lot') {
    const a = lireAchat();
    if (!a) return;
    saisie.lot.push(a);
    saisie.idEnCours = null;
    viderAchat();
    return afficherLot();
  }
  if (e.target.id === 'a-repartir') {
    const total = lirePrix($('a-total').value);
    if (total === null || isNaN(total)) return toast('Indique le prix total payé pour le lot.', true);
    const parts = repartir(total, saisie.lot.map((a) => a.prixAchat));
    saisie.lot.forEach((a, i) => { a.prixAchat = parts[i]; });
    saisie.idEnCours = null;
    return afficherLot();
  }
  if (e.target.id === 'v-valider') return validerVente(e.target);

  // Échange
  const parLigne = (el, attribut) => etat.articles.find((a) => a._ligne === Number(el.dataset[attribut]));
  const donner = e.target.closest('[data-donner]');
  if (donner) {
    const a = parLigne(donner, 'donner');
    if (a && !saisie.donnes.includes(a)) saisie.donnes.push(a);
    $('e-recherche').value = '';
    $('e-resultats').innerHTML = '';
    return majEchange();
  }
  const rd = e.target.closest('[data-retirer-donne]');
  if (rd) { saisie.donnes.splice(Number(rd.dataset.retirerDonne), 1); return majEchange(); }
  const rr = e.target.closest('[data-retirer-recu]');
  if (rr) { saisie.recus.splice(Number(rr.dataset.retirerRecu), 1); return majEchange(); }
  if (e.target.id === 'e-ajouter-recu') {
    const r = lireMini('e', true);
    if (r) { saisie.recus.push(r); majEchange(); }
    return;
  }
  if (e.target.id === 'e-valider') return validerEchange(e.target);

  // Ouverture de scellé
  const ouvrir = e.target.closest('[data-ouvrir]');
  if (ouvrir) return choisirScelle(parLigne(ouvrir, 'ouvrir'));
  const rc = e.target.closest('[data-retirer-carte]');
  if (rc) { saisie.cartes.splice(Number(rc.dataset.retirerCarte), 1); return majOuverture(); }
  if (e.target.id === 'o-ajouter-carte') {
    const c = lireMini('o', false);
    if (c) { saisie.cartes.push(c); majOuverture(); }
    return;
  }
  if (e.target.id === 'o-valider') return validerOuverture(e.target);
});
$('contenu-ajout').addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'form-achat') validerAchat($('a-valider'));
});
$('contenu-ajout').addEventListener('input', (e) => {
  if (e.target.id === 'v-recherche') chercherVente();
  if (e.target.id === 'v-prix' || e.target.id === 'v-plateforme') apercuVente();
  if (e.target.id === 'a-categorie') ajusterHorsVente();
  if (e.target.id === 'e-recherche') {
    $('e-resultats').innerHTML = htmlResultats(rechercherArticles(e.target.value,
      (a) => ['En stock', 'Listé', 'Hors vente'].includes(a.statut) && !saisie.donnes.includes(a)), 'donner');
  }
  if (e.target.id === 'o-recherche') {
    saisie.article = null;
    $('o-detail').innerHTML = '';
    $('o-resultats').innerHTML = htmlResultats(rechercherArticles(e.target.value,
      (a) => a.categorie === 'Scellé' && (a.statut === 'En stock' || a.statut === 'Listé')), 'ouvrir');
  }
});
$('fiche-contenu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-fiche]');
  if (!b) return;
  const ligne = Number(b.closest('[data-ligne]').dataset.ligne);
  const a = etat.articles.find((x) => x._ligne === ligne);
  if (a) actionFiche(b.dataset.fiche, a, b);
});
}

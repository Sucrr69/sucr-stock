/* Sucr_tcg — onglet « À vérifier » : articles incomplets ou incohérents, avec un accès direct à la correction. */
'use strict';

// Catégories de cartes à l'unité : un état (MT, NM, EX…) y est attendu.
const CATEGORIES_AVEC_ETAT = ['Pokémon', 'One Piece', "Ultra's"];

/** Liste des problèmes d'un article : ceux signalés par le tableur (colonne « Contrôle ») + ceux vus par l'appli. */
function problemesDe(a) {
  const problemes = String(a.controle == null ? '' : a.controle).split('•').map((p) => p.trim()).filter(Boolean);
  if (CATEGORIES_AVEC_ETAT.includes(a.categorie) && String(a.etat || '').trim() === '') problemes.push('État manquant');
  return problemes;
}

function articlesAVerifier() {
  return etat.articles.map((a) => ({ a, problemes: problemesDe(a) })).filter((x) => x.problemes.length);
}

function afficherVerifier() {
  const zone = $('contenu-verifier');
  const badge = $('badge-verifier');
  if (!etat.donnees) {
    badge.hidden = true;
    zone.innerHTML = '<p class="vide">Connecte d\'abord ton Google Sheet dans <b>Réglages</b>.</p>';
    return;
  }
  const liste = articlesAVerifier().sort((x, y) => Calculs.n(y.a.numero) - Calculs.n(x.a.numero));
  badge.hidden = liste.length === 0;
  badge.textContent = liste.length > 99 ? '99+' : String(liste.length);
  $('lien-verifier').setAttribute('aria-label',
    liste.length ? `À vérifier (${liste.length} article${liste.length > 1 ? 's' : ''})` : 'À vérifier');
  if (!liste.length) {
    zone.innerHTML = '<p class="vide fete">Aucun article à vérifier 🎉<small>Tout ton stock est complet et cohérent.</small></p>';
    return;
  }
  const corriger = peutEcrire();
  zone.innerHTML = `<p class="compteur">${fmtNombre.format(liste.length)} article${liste.length > 1 ? 's' : ''} à vérifier</p>
    <div class="liste">${liste.slice(0, 300).map(({ a, problemes }) => `<div class="article a-verifier">
      <span class="a-nom"><small>${a.numero === '' ? 'Nouveau' : 'N° ' + esc(a.numero)}</small>${esc(a.article)}</span>
      <button type="button" class="btn ${corriger && !a._attente ? 'btn-accent' : ''}" data-corriger="${a._ligne}">${corriger && !a._attente ? 'Corriger' : 'Voir la fiche'}</button>
      <span class="a-infos">
        ${problemes.map((p) => `<span class="puce probleme">${esc(p)}</span>`).join('')}
        ${a.categorie ? `<span>${esc(a.categorie)}</span>` : ''}<span>${esc(a.statut || 'Sans statut')}</span>
      </span>
    </div>`).join('')}</div>
    ${liste.length > 300 ? '<p class="aide">Seuls les 300 premiers sont affichés.</p>' : ''}`;
}

function brancherVerifier() {
  $('contenu-verifier').addEventListener('click', (e) => {
    const b = e.target.closest('[data-corriger]');
    if (!b) return;
    const a = etat.articles.find((x) => x._ligne === Number(b.dataset.corriger));
    if (!a) return;
    // Ouvre directement la fiche en modification quand l'écriture est possible, sinon en lecture.
    if (peutEcrire() && !a._attente) {
      saisie.idEnCours = null;
      ficheModifier(a);
      const raisons = problemesDe(a);
      $('fiche-contenu').querySelector('.aide').insertAdjacentHTML('afterend',
        `<p class="bandeau alerte">À corriger : ${raisons.map(esc).join(' · ')}</p>`);
      $('fiche').showModal();
    } else {
      ouvrirFiche(a._ligne);
    }
  });
}

/* Sucr_tcg — écran Tableau de bord (jalon 2). Utilise calculs.js et les utilitaires de app.js. */
'use strict';

const MOIS_COURTS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];
const pourcent = (v) => (v == null ? '—' : fmtPourcent.format(v));
const eurosOuTiret = (v) => (v == null ? '—' : fmtEuro.format(v));
/** Classe de couleur selon le sens d'un montant : gain (vert), perte (orange), rien si nul. */
const sens = (v) => (v > 0.004 ? 'gain' : v < -0.004 ? 'perte' : '');

function listeMois() {
  return (etat.donnees.parametres.listes && etat.donnees.parametres.listes['Mois']) || [];
}

function afficherTableau() {
  const zone = $('contenu-tableau');
  if (!etat.donnees) {
    zone.innerHTML = '<p class="vide">Connecte d\'abord ton Google Sheet dans <b>Réglages</b>.</p>';
    return;
  }
  const selAnnee = $('t-annee');
  const selMois = $('t-mois');
  const annees = Calculs.annees(etat.articles);
  if (!annees.length) annees.push(new Date().getFullYear());
  const anneeAvant = Number(selAnnee.value);
  selAnnee.innerHTML = annees.map((a) => `<option>${a}</option>`).join('');
  const anneeCourante = new Date().getFullYear();
  selAnnee.value = annees.includes(anneeAvant) ? anneeAvant : (annees.includes(anneeCourante) ? anneeCourante : annees[0]);
  const moisAvant = selMois.value;
  selMois.innerHTML = '<option value="">Toute l\'année</option>' + listeMois().map((m) => `<option>${esc(m)}</option>`).join('');
  selMois.value = listeMois().includes(moisAvant) ? moisAvant : '';

  const annee = Number(selAnnee.value);
  const mois = selMois.value;
  const p = Calculs.periode(etat.articles, annee, mois);
  const e = Calculs.ensemble(etat.articles, seuilsMois().vieux);
  const parMois = listeMois().map((m) => Calculs.periode(etat.articles, annee, m));
  const libellePeriode = (mois ? mois + ' ' : '') + annee;

  const kpi = (valeur, titre, note, classe) =>
    `<div class="kpi verre"><span>${esc(titre)}</span><b class="${classe || ''}">${esc(valeur)}</b>${note ? `<small>${esc(note)}</small>` : ''}</div>`;

  const lignesMois = parMois.map((m, i) => `<tr>
      <td>${esc(listeMois()[i])}</td><td>${euros(m.achats)}</td><td>${euros(m.brut)}</td><td>${euros(m.commissions)}</td>
      <td>${euros(m.equipement)}</td><td><b class="${sens(m.benefice)}">${euros(m.benefice)}</b></td><td>${euros(m.netOuvertures)}</td>
      <td>${fmtNombre.format(m.nbVentes)}</td><td>${pourcent(m.marge)}</td></tr>`).join('');
  const total = Calculs.periode(etat.articles, annee, '');

  // Anneaux : part de chaque plateforme dans la valeur vendue (toutes années)
  const lignesPlateformes = Calculs.parPlateforme(etat.articles, etat.donnees.parametres).filter((l) => l.nb > 0);
  const totalVendu = lignesPlateformes.reduce((t, l) => t + l.brut, 0);
  const anneaux = lignesPlateformes.map((l) => {
    const part = totalVendu > 0 ? l.brut / totalVendu : 0;
    const tour = 2 * Math.PI * 34;
    return `<div class="anneau verre">
      <svg viewBox="0 0 84 84" role="img" aria-label="${esc(l.plateforme)} : ${esc(pourcent(part))} de la valeur vendue">
        <circle class="piste" cx="42" cy="42" r="34"></circle>
        <circle class="arc" cx="42" cy="42" r="34" style="--arc:${(tour * part).toFixed(1)};--tour:${tour.toFixed(1)}"></circle>
        <text x="42" y="47" text-anchor="middle">${esc(fmtPourcent.format(Math.round(part * 100) / 100))}</text>
      </svg>
      <div>
        <h3>${esc(l.plateforme)}</h3>
        <b class="${sens(l.benefice)}">${euros(l.benefice)}</b>
        <small>${fmtNombre.format(l.nb)} vente${l.nb > 1 ? 's' : ''} · ${euros(l.brut)} vendus · ROI ${pourcent(l.roi)}</small>
      </div>
    </div>`;
  }).join('') || '<p class="vide">Aucune vente pour l\'instant.</p>';

  // Ancienneté du stock : trois tranches, d'après les seuils de l'onglet Paramètres
  const seuils = seuilsMois();
  const tranches = [0, 0, 0];
  for (const a of etat.articles) {
    if (a.c_anciennete == null) continue;
    tranches[a.c_anciennete >= seuils.vieux ? 2 : a.c_anciennete >= seuils.moyen ? 1 : 0]++;
  }
  const libellesTranches = [`Moins de ${seuils.moyen} mois`, `${seuils.moyen} à ${seuils.vieux - 1} mois`, `${seuils.vieux} mois et plus`];
  const classesTranches = ['age-ok', 'age-moyen', 'age-vieux'];
  const barreAge = tranches.some((n) => n > 0)
    ? `<div class="barre-age" role="img" aria-label="Ancienneté du stock">${tranches.map((n, i) =>
        n ? `<span class="${classesTranches[i]}" style="flex:${n}"></span>` : '').join('')}</div>
       <ul class="legende">${tranches.map((n, i) =>
        `<li><i class="${classesTranches[i]}"></i>${esc(libellesTranches[i])}<b>${fmtNombre.format(n)}</b></li>`).join('')}</ul>`
    : '';

  const categories = Calculs.parCategorie(etat.articles, etat.donnees.parametres)
    .filter((l) => l.nb > 0)
    .map((l) => `<tr><td><span class="puce cat" style="background:${esc(couleur(l.categorie, COULEURS_CATEGORIE))}">${esc(l.categorie)}</span></td>
      <td>${fmtNombre.format(l.nb)}</td><td>${euros(l.investi)}</td><td>${fmtNombre.format(l.nbVendus)}</td><td>${euros(l.brut)}</td>
      <td><b class="${sens(l.benefice)}">${euros(l.benefice)}</b></td><td>${fmtNombre.format(l.nbStock)}</td><td>${euros(l.valeurStock)}</td></tr>`).join('');

  let cumul = 0;
  const cumuls = parMois.map((m) => (cumul += m.benefice));

  zone.className = 'v2';
  zone.innerHTML = `
    <section class="hero verre">
      <div class="hero-chiffres">
        <span class="sur-titre">Bénéfice net · ${esc(libellePeriode)}</span>
        <b class="hero-valeur ${sens(p.benefice)}" data-compte="${p.benefice}">${euros(p.benefice)}</b>
        <small>après équipement, hors cartes d'ouverture</small>
        <div class="hero-faits">
          <span><b>${eurosOuTiret(p.panierMoyen)}</b>panier moyen</span>
          <span><b>${fmtNombre.format(p.nbVentes)}</b>vente${p.nbVentes > 1 ? 's' : ''}</span>
          <span><b class="${sens(p.beneficeApresScelles)}">${euros(p.beneficeApresScelles)}</b>après scellés ouverts</span>
        </div>
      </div>
      <div class="hero-graphique">
        <h3>Bénéfice net par mois · ${annee}</h3>
        ${graphique(parMois.map((m) => m.benefice), 'barres')}
      </div>
    </section>

    <div class="grille-kpi">
      ${kpi(euros(p.brut), 'CA brut')}
      ${kpi(euros(p.commissions), 'Commissions')}
      ${kpi(euros(p.net), 'CA net')}
      ${kpi(pourcent(p.roi), 'ROI', 'hors ouvertures')}
    </div>

    <h2 class="titre-section">Par plateforme <small>toutes années</small></h2>
    <div class="grille-anneaux">${anneaux}</div>

    <div class="deux-colonnes">
      <section class="carte verre">
        <h2>Stock aujourd'hui</h2>
        <div class="grille-stock">
          <div><b>${fmtNombre.format(e.nbStock)}</b><span>articles, dont ${fmtNombre.format(e.nbListes)} listés</span></div>
          <div><b>${euros(e.valeurAchatStock)}</b><span>valeur d'achat</span></div>
          <div><b>${euros(e.valeurDemandee)}</b><span>prix demandés (${euros(e.netAttendu)} net)</span></div>
          <div><b>${euros(e.valeurDormants)}</b><span>immobilisés dans ${fmtNombre.format(e.nbDormants)} dormants</span></div>
        </div>
        ${barreAge}
      </section>
      <section class="carte verre">
        <h2>Bénéfice net cumulé · ${annee}</h2>
        ${graphique(cumuls, 'ligne')}
      </section>
    </div>

    <section class="carte verre">
      <h2>Détail par mois · ${annee}</h2>
      <div class="defile"><table class="chiffres">
        <tr><th>Mois</th><th>Achats</th><th>Ventes brutes</th><th>Commissions</th><th>Équipement</th><th>Bénéfice net</th><th>Net cartes d'ouverture</th><th>Ventes</th><th>Marge</th></tr>
        ${lignesMois}
        <tr class="total"><td>Total</td><td>${euros(total.achats)}</td><td>${euros(total.brut)}</td><td>${euros(total.commissions)}</td>
          <td>${euros(total.equipement)}</td><td class="${sens(total.benefice)}">${euros(total.benefice)}</td><td>${euros(total.netOuvertures)}</td>
          <td>${fmtNombre.format(total.nbVentes)}</td><td>${pourcent(total.marge)}</td></tr>
      </table></div>
    </section>

    <section class="carte verre">
      <h2>Par catégorie <small>toutes années, hors « Hors vente »</small></h2>
      <div class="defile"><table class="chiffres">
        <tr><th>Catégorie</th><th>Articles</th><th>Investi</th><th>Vendus</th><th>Ventes brutes</th><th>Bénéfice</th><th>En stock</th><th>Valeur du stock</th></tr>
        ${categories}
      </table></div>
    </section>

    <section class="carte verre">
      <h2>Ouvertures de scellés <small>toutes années</small></h2>
      <table class="chiffres">
        <tr><td>Ventes nettes des cartes d'ouverture</td><td>${euros(e.netOuvertures)}</td></tr>
        <tr><td>Coût des scellés ouverts (${fmtNombre.format(e.nbScellesOuverts)})</td><td>${euros(e.coutScellesOuverts)}</td></tr>
        <tr><td>Résultat des ouvertures</td><td><b class="${sens(e.resultatOuvertures)}">${euros(e.resultatOuvertures)}</b></td></tr>
        <tr><td>Bénéfice net total après équipement</td><td>${euros(e.benefice)}</td></tr>
        <tr class="total"><td>Bénéfice net après équipement et scellés ouverts</td><td class="${sens(e.beneficeApresScelles)}">${euros(e.beneficeApresScelles)}</td></tr>
      </table>
    </section>

    ${comparaison(e)}`;
  brancherInfobulles(zone);
  animerCompteurs(zone);
}

/** Fait monter les grands chiffres de 0 à leur valeur (désactivé si l'appareil demande moins d'animations). */
function animerCompteurs(zone) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  zone.querySelectorAll('[data-compte]').forEach((el) => {
    const cible = Number(el.dataset.compte);
    if (!isFinite(cible) || cible === 0) return;
    const debut = performance.now(), duree = 600;
    const pas = (t) => {
      const k = Math.min(1, (t - debut) / duree);
      el.textContent = euros(cible * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(pas); else el.textContent = euros(cible);
    };
    requestAnimationFrame(pas);
  });
}

/* ------------------------------------------------------------------ */
/* Graphiques SVG (une série, un seul axe)                              */
/* ------------------------------------------------------------------ */
function graphique(valeurs, type) {
  const L = 560, H = 220, g = 8, d = 8, h = 14, b = 24;
  const max = Math.max(0, ...valeurs), min = Math.min(0, ...valeurs);
  const etendue = (max - min) || 1;
  const y = (v) => h + (max - v) / etendue * (H - h - b);
  const pas = (L - g - d) / valeurs.length;
  const x = (i) => g + pas * i + pas / 2;
  const y0 = y(0);
  let marques = '';
  if (type === 'barres') {
    const l = Math.min(28, pas - 6);
    marques = valeurs.map((v, i) => {
      const haut = Math.min(y(v), y0), taille = Math.max(Math.abs(y(v) - y0), v === 0 ? 0 : 1);
      return `<rect class="barre${v < 0 ? ' negative' : ''}" x="${x(i) - l / 2}" y="${haut}" width="${l}" height="${taille}" rx="4"></rect>`;
    }).join('');
  } else {
    marques = `<polygon class="aire" points="${x(0)},${y0} ${valeurs.map((v, i) => `${x(i)},${y(v)}`).join(' ')} ${x(valeurs.length - 1)},${y0}"></polygon>` +
      `<polyline class="courbe" points="${valeurs.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"></polyline>` +
      valeurs.map((v, i) => `<circle class="point" cx="${x(i)}" cy="${y(v)}" r="4"></circle>`).join('');
  }
  const zones = valeurs.map((v, i) =>
    `<rect class="zone" x="${g + pas * i}" y="0" width="${pas}" height="${H - b}" tabindex="0"
      data-info="${esc(listeMois()[i] || MOIS_COURTS[i])} : ${esc(euros(v))}"></rect>`).join('');
  const etiquettes = valeurs.map((v, i) => `<text class="axe" x="${x(i)}" y="${H - 6}" text-anchor="middle">${MOIS_COURTS[i].slice(0, 1)}</text>`).join('');
  return `<div class="graphique">
    <svg viewBox="0 0 ${L} ${H}" role="img" aria-label="Graphique, détail dans le tableau par mois">
      <text class="axe" x="${g}" y="10">${esc(euros(max))}</text>
      <line class="base" x1="${g}" x2="${L - d}" y1="${y0}" y2="${y0}"></line>
      ${marques}${etiquettes}${zones}
    </svg>
    <div class="infobulle" hidden></div>
  </div>`;
}

function brancherInfobulles(zone) {
  zone.querySelectorAll('.graphique').forEach((bloc) => {
    const bulle = bloc.querySelector('.infobulle');
    const montrer = (ev) => {
      const cible = ev.target.closest('.zone');
      if (!cible) { bulle.hidden = true; return; }
      bulle.textContent = cible.dataset.info;
      bulle.hidden = false;
      const cadre = bloc.getBoundingClientRect(), r = cible.getBoundingClientRect();
      const centre = r.left + r.width / 2 - cadre.left;
      bulle.style.left = Math.max(60, Math.min(cadre.width - 60, centre)) + 'px';
    };
    bloc.addEventListener('pointermove', montrer);
    bloc.addEventListener('focusin', montrer);
    bloc.addEventListener('pointerleave', () => { bulle.hidden = true; });
  });
}

/* ------------------------------------------------------------------ */
/* Comparaison avec l'onglet « Tableau de bord » du tableur             */
/* ------------------------------------------------------------------ */
function comparaison(e) {
  const tdb = etat.donnees.tableauDeBord;
  if (!tdb || !tdb.grille) {
    return `<div class="carte"><h2>Comparaison avec le tableur</h2>
      <p class="aide">Pour afficher la comparaison ici, mets à jour le script Apps Script (voir GUIDE-JALON-2.md).</p></div>`;
  }
  const g = tdb.grille;
  const num = (v) => (typeof v === 'number' ? v : 0);
  const texte = (v) => String(v == null ? '' : v).trim();
  const lignesComparees = [];
  const ajouter = (libelle, appli, tableur) => lignesComparees.push({ libelle, appli: appli || 0, tableur: num(tableur) });

  // Année affichée dans le tableur
  const ligneAnnee = g.find((l) => texte(l[0]) === 'Année affichée');
  const annee = ligneAnnee ? Number(ligneAnnee[1]) : null;
  const colonnesMois = [['Achats', 'achats'], ['Ventes brutes', 'brut'], ['Commissions', 'commissions'],
    ['Équipement', 'equipement'], ['Bénéfice net', 'benefice'], ["Net cartes d'ouverture", 'netOuvertures'], ['Nb vendus', 'nbVentes']];
  if (annee) {
    for (const l of g) {
      const nom = texte(l[0]);
      const estMois = listeMois().includes(nom);
      if (!estMois && nom !== 'Total année') continue;
      const p = Calculs.periode(etat.articles, annee, estMois ? nom : '');
      colonnesMois.forEach(([titre, champ], k) => ajouter(`${estMois ? nom : 'Total'} ${annee} · ${titre}`, p[champ], l[k + 1]));
    }
  }
  // Blocs « par catégorie » et « par plateforme »
  const bloc = (entete, lignesAppli, cle, champs) => {
    const debut = g.findIndex((l) => texte(l[0]) === entete);
    if (debut < 0) return;
    for (let i = debut + 1; i < g.length && texte(g[i][0]) !== 'Total' && texte(g[i][0]) !== ''; i++) {
      const nom = texte(g[i][0]);
      const a = lignesAppli.find((x) => x[cle] === nom) || {};
      champs.forEach(([titre, champ], k) => ajouter(`${nom} · ${titre}`, a[champ], g[i][k + 1]));
    }
  };
  bloc('Catégorie', Calculs.parCategorie(etat.articles, etat.donnees.parametres), 'categorie',
    [['Nb articles', 'nb'], ['Investi', 'investi'], ['Nb vendus', 'nbVendus'], ['Ventes brutes', 'brut'],
      ['Bénéfice', 'benefice'], ['En stock / listés', 'nbStock'], ['Valeur du stock', 'valeurStock']]);
  bloc('Plateforme', Calculs.parPlateforme(etat.articles, etat.donnees.parametres), 'plateforme',
    [['Nb vendus', 'nb'], ['Ventes brutes', 'brut'], ['Commissions', 'commissions'], ['Ventes nettes', 'net'],
      ["Coût d'achat des vendus", 'cout'], ['Bénéfice', 'benefice']]);
  // Vue d'ensemble
  const ensemble = [
    ["Dépenses d'équipement", e.equipement], ['Bénéfice net total après équipement', e.benefice], ['ROI global', e.roi],
    ["Ventes nettes des cartes d'ouverture", e.netOuvertures], ['Coût des scellés ouverts', e.coutScellesOuverts],
    ['Résultat des ouvertures', e.resultatOuvertures], ['Bénéfice net après équipement et scellés ouverts', e.beneficeApresScelles],
    ['Ventes brutes totales', e.brut], ['Commissions totales', e.commissions], ['Ventes nettes totales', e.net],
    ['Articles vendus', e.nbVentes], ['Scellés ouverts', e.nbScellesOuverts], ['Articles en stock ou listés sans prix demandé', e.sansPrixDemande],
    ['Articles en stock ou listés', e.nbStock], ['dont actuellement listés', e.nbListes], ['Argent immobilisé en stock', e.valeurAchatStock],
    ['Dépenses hors vente', e.horsVente], ['Points à vérifier', e.aVerifier],
    ['Valeur de revente potentielle du stock', e.netAttendu], ['Marge attendue sur le stock', e.margeAttendue]
  ];
  const dejaPris = new Set();
  for (const [debut, valeur] of ensemble) {
    const i = g.findIndex((l, k) => !dejaPris.has(k) && texte(l[0]).startsWith(debut));
    if (i < 0) continue;
    dejaPris.add(i);
    ajouter(debut, valeur, g[i][1]);
  }

  const ecarts = lignesComparees.filter((l) => Math.abs(l.appli - l.tableur) >= 0.01);
  const fmt = (v) => fmtNombre.format(Math.round(v * 100) / 100);
  const lignes = ecarts.map((l) => `<tr><td>${esc(l.libelle)}</td><td>${fmt(l.appli)}</td><td>${fmt(l.tableur)}</td>
    <td class="manquant">${fmt(l.appli - l.tableur)}</td></tr>`).join('');
  return `<div class="carte">
    <h2>Comparaison avec le tableur</h2>
    <p class="message ${ecarts.length ? 'erreur' : 'ok'}">${fmtNombre.format(lignesComparees.length)} valeurs comparées avec l'onglet « Tableau de bord »${annee ? ` (année ${annee})` : ''} :
      ${ecarts.length ? fmtNombre.format(ecarts.length) + ' écart(s).' : 'aucun écart.'}</p>
    ${ecarts.length ? `<div class="defile"><table class="chiffres"><tr><th>Valeur</th><th>Appli</th><th>Tableur</th><th>Écart</th></tr>${lignes}</table></div>` : ''}
  </div>`;
}

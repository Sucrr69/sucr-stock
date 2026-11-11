/* Sucr Stock — calculs métier.
 * Tout est recalculé à partir des colonnes SAISIES (bleues), avec les mêmes règles
 * que les formules du tableur. Les colonnes grises du Sheet ne servent qu'à comparer. */
'use strict';

const Calculs = (() => {
  const n = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const estVide = (v) => v === '' || v == null;

  function tauxPlateforme(parametres, plateforme) {
    const c = (parametres.commissions || []).find((x) => x.plateforme === plateforme);
    return c ? n(c.taux) : 0;
  }

  /** Ancienneté en mois entiers depuis le 1er du mois d'achat (comme DATEDIF … "M"). */
  function ancienneteMois(a, mois, aujourdhui) {
    const m = mois.indexOf(a.moisAchat);
    const annee = Number(a.anneeAchat);
    if (m < 0 || !annee) return null;
    return (aujourdhui.getFullYear() - annee) * 12 + (aujourdhui.getMonth() - m);
  }

  /** Ajoute à chaque article ses valeurs calculées (préfixe c_). */
  function enrichir(articles, parametres, aujourdhui) {
    const mois = (parametres.listes && parametres.listes['Mois']) || [];
    for (const a of articles) {
      const vendu = a.statut === 'Vendu';
      const enVente = a.statut === 'En stock' || a.statut === 'Listé';
      const ouverture = a.origine === 'Ouverture';
      a.c_commission = vendu ? n(a.prixVenteBrut) * tauxPlateforme(parametres, a.venduSur) : 0;
      a.c_net = vendu ? n(a.prixVenteBrut) - a.c_commission : 0;
      a.c_benefice = vendu && !ouverture ? a.c_net - n(a.prixAchat) : 0;
      a.c_netAttendu = null;
      a.c_margeAttendue = null;
      if (enVente && !estVide(a.prixDemande)) {
        const plateforme = a.listeSur === 'Les deux' ? 'Cardmarket' : a.listeSur;
        a.c_netAttendu = n(a.prixDemande) * (1 - tauxPlateforme(parametres, plateforme));
        if (!ouverture) a.c_margeAttendue = a.c_netAttendu - n(a.prixAchat);
      }
      a.c_anciennete = enVente ? ancienneteMois(a, mois, aujourdhui) : null;
    }
    return articles;
  }

  const memeAnnee = (v, annee) => Number(v) === Number(annee) && !estVide(v);

  /** Chiffres d'une période : une année, et un mois précis ou toute l'année (mois = ''). */
  function periode(articles, annee, mois) {
    const r = { achats: 0, brut: 0, commissions: 0, net: 0, equipement: 0, beneficeBrut: 0,
      netOuvertures: 0, brutOuvertures: 0, coutVendus: 0, coutScellesOuverts: 0, nbVentes: 0 };
    for (const a of articles) {
      const achatDansPeriode = memeAnnee(a.anneeAchat, annee) && (!mois || a.moisAchat === mois);
      const sortieDansPeriode = memeAnnee(a.anneeVente, annee) && (!mois || a.moisVente === mois);
      if (achatDansPeriode) {
        // Un article reçu en échange n'est pas une dépense : son coût a déjà été compté à l'achat de ce qui a été donné.
        if (a.statut !== 'Hors vente' && a.origine !== 'Échange') r.achats += n(a.prixAchat);
        if (a.categorie === 'Équipement') r.equipement += n(a.prixAchat);
      }
      if (sortieDansPeriode && a.statut === 'Vendu') {
        r.nbVentes++;
        r.brut += n(a.prixVenteBrut);
        r.commissions += a.c_commission;
        r.net += a.c_net;
        r.beneficeBrut += a.c_benefice;
        if (a.origine === 'Ouverture') {
          r.netOuvertures += a.c_net;
          r.brutOuvertures += n(a.prixVenteBrut);
        } else {
          r.coutVendus += n(a.prixAchat);
        }
      }
      if (sortieDansPeriode && a.statut === 'Ouvert') r.coutScellesOuverts += n(a.prixAchat);
    }
    r.benefice = r.beneficeBrut - r.equipement;                       // bénéfice net après équipement
    r.beneficeApresScelles = r.benefice + r.netOuvertures - r.coutScellesOuverts;
    r.roi = r.coutVendus > 0 ? r.benefice / r.coutVendus : null;
    const base = r.brut - r.brutOuvertures;
    r.marge = base !== 0 ? r.benefice / base : null;
    r.panierMoyen = r.nbVentes > 0 ? r.brut / r.nbVentes : null;
    return r;
  }

  /** Vue d'ensemble, toutes années confondues (mêmes lignes que le tableur). */
  function ensemble(articles, seuilDormant) {
    const e = { equipement: 0, beneficeBrut: 0, coutVendus: 0, netOuvertures: 0, coutScellesOuverts: 0,
      brut: 0, commissions: 0, net: 0, nbVentes: 0, nbScellesOuverts: 0, nbEnStock: 0, nbListes: 0,
      valeurAchatStock: 0, horsVente: 0, valeurDemandee: 0, netAttendu: 0, margeAttendue: 0,
      sansPrixDemande: 0, nbDormants: 0, valeurDormants: 0, aVerifier: 0 };
    for (const a of articles) {
      if (a.categorie === 'Équipement') e.equipement += n(a.prixAchat);
      if (a.statut === 'Vendu') {
        e.nbVentes++;
        e.brut += n(a.prixVenteBrut);
        e.commissions += a.c_commission;
        e.net += a.c_net;
        e.beneficeBrut += a.c_benefice;
        if (a.origine === 'Ouverture') e.netOuvertures += a.c_net;
        else e.coutVendus += n(a.prixAchat);
      } else if (a.statut === 'Ouvert') {
        e.nbScellesOuverts++;
        e.coutScellesOuverts += n(a.prixAchat);
      } else if (a.statut === 'Hors vente') {
        e.horsVente += n(a.prixAchat);
      } else if (a.statut === 'En stock' || a.statut === 'Listé') {
        if (a.statut === 'Listé') e.nbListes++; else e.nbEnStock++;
        e.valeurAchatStock += n(a.prixAchat);
        if (estVide(a.prixDemande)) e.sansPrixDemande++;
        else e.valeurDemandee += n(a.prixDemande);
        e.netAttendu += n(a.c_netAttendu);
        e.margeAttendue += n(a.c_margeAttendue);
        if (a.c_anciennete != null && a.c_anciennete >= seuilDormant) {
          e.nbDormants++;
          e.valeurDormants += n(a.prixAchat);
        }
      }
      if (String(a.controle == null ? '' : a.controle).trim() !== '') e.aVerifier++;
    }
    e.nbStock = e.nbEnStock + e.nbListes;
    e.benefice = e.beneficeBrut - e.equipement;
    e.roi = e.coutVendus > 0 ? e.benefice / e.coutVendus : null;
    e.resultatOuvertures = e.netOuvertures - e.coutScellesOuverts;
    e.beneficeApresScelles = e.benefice + e.resultatOuvertures;
    return e;
  }

  /** Par plateforme de vente, toutes années. */
  function parPlateforme(articles, parametres) {
    const noms = (parametres.commissions || []).map((c) => c.plateforme);
    const lignes = {};
    const vide = () => ({ nb: 0, brut: 0, commissions: 0, net: 0, cout: 0, benefice: 0 });
    noms.forEach((p) => { lignes[p] = vide(); });
    for (const a of articles) {
      if (a.statut !== 'Vendu') continue;
      const cle = estVide(a.venduSur) ? 'Non renseignée' : a.venduSur;
      const l = lignes[cle] || (lignes[cle] = vide());
      l.nb++; l.brut += n(a.prixVenteBrut); l.commissions += a.c_commission;
      l.net += a.c_net; l.cout += n(a.prixAchat); l.benefice += a.c_benefice;
    }
    return Object.entries(lignes).map(([plateforme, l]) =>
      Object.assign({ plateforme, roi: l.cout > 0 ? l.benefice / l.cout : null }, l));
  }

  /** Par catégorie, toutes années, hors « Hors vente ». */
  function parCategorie(articles, parametres) {
    const noms = (parametres.listes && parametres.listes['Catégories']) || [];
    const lignes = {};
    const vide = () => ({ nb: 0, investi: 0, nbVendus: 0, brut: 0, benefice: 0, nbStock: 0, valeurStock: 0 });
    noms.forEach((c) => { lignes[c] = vide(); });
    for (const a of articles) {
      const l = lignes[a.categorie] || (lignes[a.categorie] = vide());
      if (a.statut !== 'Hors vente') { l.nb++; if (a.origine !== 'Échange') l.investi += n(a.prixAchat); }
      if (a.statut === 'Vendu') { l.nbVendus++; l.brut += n(a.prixVenteBrut); }
      l.benefice += a.c_benefice;
      if (a.statut === 'En stock' || a.statut === 'Listé') { l.nbStock++; l.valeurStock += n(a.prixAchat); }
    }
    return Object.entries(lignes).map(([categorie, l]) => Object.assign({ categorie }, l));
  }

  function annees(articles) {
    const s = new Set();
    for (const a of articles) {
      if (Number(a.anneeAchat)) s.add(Number(a.anneeAchat));
      if (Number(a.anneeVente)) s.add(Number(a.anneeVente));
    }
    return [...s].sort((x, y) => y - x);
  }

  return { enrichir, periode, ensemble, parPlateforme, parCategorie, annees, n };
})();

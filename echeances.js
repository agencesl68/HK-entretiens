/* =============================================================================
   HK ENTRETIENS — CALCUL DES ÉCHÉANCES
   Un seul fichier, utilisé à la fois par l'app (navigateur) et par la
   GitHub Action qui envoie les notifications : les deux voient donc
   exactement les mêmes dates.
   ============================================================================= */
(function (racine, fabrique) {
  if (typeof module === "object" && module.exports) module.exports = fabrique();
  else racine.Echeances = fabrique();
})(this, function () {
  "use strict";

  /* Prévenir 1,5 semaine à l'avance : 10,5 jours, arrondi à 11. */
  var ALERTE_JOURS = 11;
  var JOUR = 86400000;

  function iso(d) {
    var m = d.getUTCMonth() + 1, j = d.getUTCDate();
    return d.getUTCFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (j < 10 ? "0" : "") + j;
  }
  function versDate(s) {
    if (!s) return null;
    var p = String(s).slice(0, 10).split("-");
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  }
  function aujourdhui() {
    var n = new Date();
    return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
  }
  function ecartJours(a, b) { return Math.round((b - a) / JOUR); }
  function ajouterJours(d, n) { return new Date(d.getTime() + n * JOUR); }
  function ajouterMois(s, n) {
    var d = versDate(s); if (!d) return null;
    var j = d.getUTCDate();
    var r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
    var fin = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
    r.setUTCDate(Math.min(j, fin));
    return r;
  }
  function num(v) { return v === null || v === undefined || v === "" || isNaN(+v) ? null : +v; }

  /* Utilisation moyenne par jour (heures ou km), d'après les relevés des
     120 derniers jours. Il faut au moins deux relevés espacés d'une semaine. */
  function tauxJour(releves, auj) {
    auj = auj || aujourdhui();
    var limite = ajouterJours(auj, -120);
    var r = (releves || [])
      .filter(function (x) { var d = versDate(x.date); return d && d >= limite && num(x.valeur) !== null; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    if (r.length < 2) return null;
    var a = r[0], b = r[r.length - 1];
    var jours = ecartJours(versDate(a.date), versDate(b.date));
    if (jours < 7) return null;
    var t = (num(b.valeur) - num(a.valeur)) / jours;
    return t > 0 ? t : null;
  }

  /* Calcule l'état d'un programme d'entretien.
     statut : "retard" | "bientot" | "ok" | "inconnu" */
  function calculer(plan, engin, taux, auj) {
    auj = auj || aujourdhui();
    var parCompteur = num(plan.intervalle_cpt) > 0 && engin && engin.compteur_type !== "aucun";
    var parDate = num(plan.intervalle_mois) > 0;
    var r = {
      parCompteur: parCompteur, parDate: parDate,
      prochaineDate: null, prochainCpt: null, resteCpt: null,
      resteJours: null, echeance: null, estimee: false,
      progression: 0, statut: "inconnu"
    };

    var joursDate = null, joursCpt = null, fracs = [];

    if (parDate && plan.derniere_date) {
      var der = versDate(plan.derniere_date);
      r.prochaineDate = ajouterMois(plan.derniere_date, +plan.intervalle_mois);
      joursDate = ecartJours(auj, r.prochaineDate);
      var total = ecartJours(der, r.prochaineDate) || 1;
      fracs.push(ecartJours(der, auj) / total);
    }
    if (parCompteur && num(plan.dernier_cpt) !== null) {
      r.prochainCpt = num(plan.dernier_cpt) + num(plan.intervalle_cpt);
      var actuel = num(engin.compteur);
      if (actuel === null) actuel = num(plan.dernier_cpt);
      r.resteCpt = r.prochainCpt - actuel;
      fracs.push((actuel - num(plan.dernier_cpt)) / num(plan.intervalle_cpt));
      if (taux > 0) joursCpt = Math.ceil(Math.max(r.resteCpt, 0) / taux);
    }

    var connu = (parDate && plan.derniere_date) || (parCompteur && num(plan.dernier_cpt) !== null);
    if (!connu) return r;

    var cands = [joursDate, joursCpt].filter(function (x) { return x !== null; });
    if (cands.length) {
      r.resteJours = Math.min.apply(null, cands);
      r.estimee = joursCpt !== null && (joursDate === null || joursCpt < joursDate);
      r.echeance = ajouterJours(auj, r.resteJours);
    }
    r.progression = fracs.length ? Math.max.apply(null, fracs) : 0;

    var retard = (joursDate !== null && joursDate < 0) || (r.resteCpt !== null && r.resteCpt <= 0);
    var bientot = (r.resteJours !== null && r.resteJours <= ALERTE_JOURS) ||
      (r.resteCpt !== null && joursCpt === null && r.resteCpt <= 0.1 * num(plan.intervalle_cpt));
    r.statut = retard ? "retard" : bientot ? "bientot" : "ok";
    return r;
  }

  /* Clé d'alerte : une notification « bientôt » puis une « retard » par cycle
     d'entretien, jamais tous les jours. */
  function cleAlerte(plan, etat) {
    return etat.statut + ":" + (plan.derniere_date || "") + ":" + (plan.dernier_cpt == null ? "" : plan.dernier_cpt);
  }

  var ORDRE = { retard: 0, bientot: 1, inconnu: 2, ok: 3 };

  return {
    ALERTE_JOURS: ALERTE_JOURS, calculer: calculer, tauxJour: tauxJour, cleAlerte: cleAlerte,
    ajouterMois: ajouterMois, ajouterJours: ajouterJours, versDate: versDate, iso: iso,
    aujourdhui: aujourdhui, ecartJours: ecartJours, ORDRE: ORDRE
  };
});

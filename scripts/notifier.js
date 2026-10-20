/* HK Entretiens — envoi quotidien des alertes (GitHub Action)
   Lit le parc dans Supabase (clé service_role), calcule les échéances avec
   le MÊME fichier que l'app (echeances.js) et prévient chaque téléphone
   abonné. Une notification « bientôt » (1,5 semaine avant) puis une
   « retard » par cycle d'entretien : jamais de rappel en boucle. */
const webpush = require("web-push");
const E = require("../echeances.js");

const URL_SB = process.env.SUPABASE_URL.replace(/\/+$/, "");
const CLE = process.env.SUPABASE_SERVICE_KEY;
const APP = process.env.APP_URL;
webpush.setVapidDetails(process.env.SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

async function sb(chemin, opt = {}) {
  const r = await fetch(URL_SB + "/rest/v1/" + chemin, {
    method: opt.method || "GET", body: opt.body ? JSON.stringify(opt.body) : undefined,
    headers: { apikey: CLE, Authorization: "Bearer " + CLE, "Content-Type": "application/json" } });
  if (!r.ok) throw new Error(chemin + " -> HTTP " + r.status + " " + (await r.text()));
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

async function envoyer(abonnes, message) {
  let ok = 0;
  for (const a of abonnes) {
    try {
      await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, message, { TTL: 86400 });
      ok++;
    } catch (err) {
      console.log("Échec " + (a.employe_id || "?") + " (" + err.statusCode + ")");
      if (err.statusCode === 404 || err.statusCode === 410)
        await sb("entretien_abonnements?endpoint=eq." + encodeURIComponent(a.endpoint), { method: "DELETE" });
    }
  }
  console.log(`Envoyé à ${ok}/${abonnes.length} téléphone(s)`);
  return ok;
}

(async () => {
  if (process.env.TEST === "true") {
    const abonnes = await sb("entretien_abonnements?select=*");
    console.log("Mode test : " + abonnes.length + " téléphone(s) abonné(s)");
    await envoyer(abonnes, JSON.stringify({ title: "HK Entretiens", body: "Test : les alertes fonctionnent sur ce téléphone.", url: APP + "#/parc", tag: "hke-test" }));
    return;
  }
  const depuis = E.iso(E.ajouterJours(E.aujourdhui(), -130));
  const [engins, plans, releves, abonnes] = await Promise.all([
    sb("engins?select=*&actif=eq.true"),
    sb("entretien_plans?select=*"),
    sb("entretien_releves?select=engin_id,date,valeur&date=gte." + depuis),
    sb("entretien_abonnements?select=*")
  ]);
  const parId = new Map(engins.map(e => [e.id, e]));
  const taux = {};
  for (const e of engins) taux[e.id] = E.tauxJour(releves.filter(r => r.engin_id === e.id));

  const nouveaux = [];
  for (const p of plans) {
    const e = parId.get(p.engin_id); if (!e) continue;
    const s = E.calculer(p, e, taux[e.id]);
    if (s.statut !== "bientot" && s.statut !== "retard") continue;
    const cle = E.cleAlerte(p, s);
    if (p.alerte_cle === cle) continue;
    nouveaux.push({ p, e, s, cle });
  }
  console.log(`${engins.length} engins, ${plans.length} suivis -> ${nouveaux.length} nouvelle(s) alerte(s)`);
  if (!nouveaux.length) return;

  nouveaux.sort((a, b) => E.ORDRE[a.s.statut] - E.ORDRE[b.s.statut] || (a.s.resteJours ?? 1e9) - (b.s.resteJours ?? 1e9));
  const quand = s => s.statut === "retard" ? "en retard"
    : s.resteJours <= 0 ? "aujourd'hui" : s.resteJours === 1 ? "demain" : "dans " + s.resteJours + " j";
  const lignes = nouveaux.slice(0, 4).map(x => `${x.e.nom} : ${x.p.libelle} ${quand(x.s)}`);
  const message = JSON.stringify({
    title: nouveaux.length > 1 ? `${nouveaux.length} entretiens à prévoir` : "Entretien à prévoir",
    body: lignes.join("\n") + (nouveaux.length > 4 ? "\n…" : ""),
    url: APP + "#/planning", tag: "hke-" + E.iso(E.aujourdhui())
  });

  const ok = await envoyer(abonnes, message);

  // on ne marque « prévenu » que si au moins un téléphone a reçu le message
  if (ok) for (const x of nouveaux)
    await sb("entretien_plans?id=eq." + x.p.id, { method: "PATCH", body: { alerte_cle: x.cle } });
})().catch(e => { console.error(e); process.exit(1); });

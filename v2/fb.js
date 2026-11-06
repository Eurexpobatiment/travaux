/* Demandes de travaux – Eurexpo · couche Firebase (projet partagé avec l'appli Équipe)
 * Données : Firestore. Le script Google (Code.gs) ne sert plus qu'aux e-mails et aux pièces jointes (Drive).
 *  - Demandes/{cle}            la fiche (la clé secrète du lien de suivi sert d'identifiant)
 *  - Demandes/{cle}/Suivi/{id} les échanges et changements de statut
 *  - DemandesInt/{cle}         la note interne du Bâtiment
 *  - Compteurs/dt-AAAA         la numérotation DT-AAAA-NNN
 * Le demandeur n'a pas de compte ; le service Bâtiment se connecte avec son compte de l'appli Équipe.
 */
const V = '10.14.1';
const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
const A = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`);
const F = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);

const CHAMPS = [
  'demandeur', 'service', 'email', 'telephone', 'dateDemande', 'lieu',
  'intitule', 'description', 'motifs', 'types', 'typeAutre', 'objectif', 'resultat',
  'contraintes', 'horairesPrecis', 'delaisPrecis', 'contrainteAutre', 'processus', 'besoinAnnexe',
  'coloris', 'materiaux', 'references',
  'dateDebut', 'dateFin', 'dateImperative', 'impact', 'impactPrecis',
  'budget', 'servicePayeur', 'budgetStatut', 'devis',
  'responsable', 'referent',
  'pjPlans', 'pjPhotos', 'pjCroquis', 'pjAutres'
];
const BAT = CHAMPS.map(k => 'b_' + k);
const SUIVI_BAT = ['statut', 'priorite', 'chargeDe', 'datePrevue'];
const STATUTS = ['Nouvelle', "À l'étude", 'Chiffrage', 'Validée', 'Planifiée', 'En cours', 'Terminée', 'Refusée'];
const LONGS = ['description', 'objectif', 'resultat', 'processus', 'besoinAnnexe', 'references'];

let app, auth, db, CFG;
let me = '', meEmail = '', meRole = '';
const CLES = new Map(); // id court → clé (espace Bâtiment)

export function init(cfg) {
  CFG = cfg;
  app = initializeApp(cfg.firebase);
  auth = A.getAuth(app);
  db = F.getFirestore(app);
}

/* ---------- Outils ---------- */
const MSG = {
  'auth/invalid-email': 'Adresse e-mail invalide',
  'auth/invalid-credential': 'E-mail ou mot de passe incorrect',
  'auth/wrong-password': 'E-mail ou mot de passe incorrect',
  'auth/user-not-found': 'Aucun compte avec cette adresse',
  'auth/too-many-requests': 'Trop d\'essais : patiente quelques minutes',
  'auth/network-request-failed': 'Pas de connexion internet',
  'permission-denied': 'Accès refusé',
  'unavailable': 'Serveur injoignable (pas de connexion ?)',
  'not-found': 'Demande introuvable'
};
export const errMsg = e => MSG[e && e.code] || (e && e.message) || String(e);
const wrap = p => p.catch(e => { throw new Error(errMsg(e)); });
const hex = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
const clean = (v, max) => String(v === null || v === undefined ? '' : v).trim().slice(0, max || 300);
const parse = s => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
export function now_() {
  const p = {};
  new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
const dRef = cle => F.doc(db, 'Demandes', cle);
const sRef = (cle, sid) => F.doc(db, 'Demandes', cle, 'Suivi', sid);
const appUrl = () => location.href.split('#')[0];

// Appel au script Google (e-mails, pièces jointes)
async function script(action, p) {
  if (!CFG.apiUrl) throw new Error('Adresse du script Google non renseignée');
  const r = await fetch(CFG.apiUrl, { method: 'POST', body: JSON.stringify(Object.assign({ action, appUrl: appUrl() }, p)) });
  if (!r.ok) throw new Error('Serveur Google injoignable (' + r.status + ')');
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'Erreur du serveur Google');
  return j.data;
}
const quiet = p => p.catch(e => { console.warn(e); return null; });

function journal(action, numero, detail) {
  if (!me) return;
  F.addDoc(F.collection(db, 'Journal'), { date: now_(), auteur: me, action, feuille: 'Demandes', id: String(numero || ''), detail: String(detail || '').slice(0, 200) }).catch(() => {});
}

function pub(d, noteInterne) {
  const o = Object.assign({}, d);
  o.fichiers = parse(d.fichiers);
  if (noteInterne !== undefined) o.noteInterne = noteInterne;
  return o;
}

/* ---------- Connexion du service Bâtiment (comptes de l'appli Équipe) ---------- */
export const login = (email, pw) => wrap(A.signInWithEmailAndPassword(auth, email.trim(), pw));
export const resetPw = email => wrap(A.sendPasswordResetEmail(auth, email.trim()));
export const resendVerif = () => wrap(A.sendEmailVerification(auth.currentUser));
export async function logout() { me = ''; meRole = ''; CLES.clear(); await A.signOut(auth); }
export const whoami = () => ({ nom: me, email: meEmail, role: meRole });

/* cb({etat, email, nom, role}) · etat : 'deconnecte' | 'non-verifie' | 'sans-acces' | 'ok' */
export function onAuth(cb) {
  A.onAuthStateChanged(auth, async u => {
    if (!u) { me = ''; meEmail = ''; meRole = ''; return cb({ etat: 'deconnecte' }); }
    meEmail = String(u.email || '').toLowerCase();
    if (!u.emailVerified) {
      await u.reload().catch(() => {});
      if (!auth.currentUser || !auth.currentUser.emailVerified) return cb({ etat: 'non-verifie', email: meEmail });
    }
    try { const r = await u.getIdTokenResult(); if (r.claims.email_verified !== true) await u.getIdToken(true); } catch (e) {}
    for (let i = 0; i < 2; i++) {
      try {
        const s = await F.getDoc(F.doc(db, 'Acces', meEmail));
        const a = s.exists() ? s.data() : null;
        if (a && a.actif !== 'non') { me = a.nom; meRole = a.role || ''; return cb({ etat: 'ok', email: meEmail, nom: me, role: meRole }); }
        me = ''; return cb({ etat: 'sans-acces', email: meEmail });
      } catch (e) {
        if (e.code === 'permission-denied' && !i) { await u.getIdToken(true).catch(() => {}); continue; }
        me = ''; return cb({ etat: 'sans-acces', email: meEmail, err: errMsg(e) });
      }
    }
  });
}

/* ---------- Demandeur ---------- */

// Nouvelle demande : numéro attribué au moment de l'enregistrement, puis pièces jointes et e-mails
export async function create(item, files) {
  if (!clean(item.demandeur)) throw new Error('Nom du demandeur obligatoire');
  if (!clean(item.intitule)) throw new Error('Intitulé du projet obligatoire');
  if (!clean(item.email) && !clean(item.telephone)) throw new Error('Indique un e-mail ou un téléphone');
  if (!navigator.onLine) throw new Error('Connexion internet nécessaire pour envoyer la demande');
  const o = {};
  CHAMPS.forEach(k => { if (k in item) o[k] = clean(item[k], LONGS.includes(k) ? 5000 : 500); });
  const cle = hex(16), id = hex(5), sid = hex(5), t = now_();
  const annee = String(new Date().getUTCFullYear());
  o.dateDemande = o.dateDemande || t.slice(0, 10);
  Object.assign(o, { id, cle, annee, creeLe: t, majLe: t, majPar: o.demandeur, statut: 'Nouvelle', fichiers: '[]' });
  let numero = '';
  await wrap(F.runTransaction(db, async tx => {
    const cref = F.doc(db, 'Compteurs', 'dt-' + annee);
    const c = await tx.get(cref);
    const n = (c.exists() ? Number(c.data().n) || 0 : 0) + 1;
    numero = 'DT-' + annee + '-' + String(n).padStart(3, '0');
    tx.set(cref, { n });
    tx.set(dRef(cle), Object.assign({}, o, { seq: n, numero }));
    tx.set(sRef(cle, sid), { id: sid, demandeId: id, date: t, auteur: o.demandeur, type: 'statut', texte: 'Demande déposée', public: 'oui' });
  }));
  let warn = '';
  if (files && files.length) {
    try { await upload({ cle, files }, o.demandeur); }
    catch (e) { warn = 'Demande enregistrée, mais les pièces jointes n\'ont pas pu être envoyées (' + e.message + '). Ajoutez-les depuis la page de suivi.'; }
  }
  await quiet(script('fbNouvelle', { cle }));
  return { id, numero, cle, warn };
}

export async function getPublic(id, cle) {
  const s = await wrap(F.getDoc(dRef(cle)));
  if (!s.exists() || s.data().id !== String(id)) throw new Error('Lien de suivi invalide');
  const q = await wrap(F.getDocs(F.query(F.collection(db, 'Demandes', cle, 'Suivi'), F.where('public', '==', 'oui'))));
  return { demande: pub(s.data()), suivi: q.docs.map(d => d.data()), bat: false };
}

/* ---------- Espace Bâtiment ---------- */
function needBat() { if (!me) throw new Error('Connexion nécessaire'); }

export async function list() {
  needBat();
  const s = await wrap(F.getDocs(F.collection(db, 'Demandes')));
  CLES.clear();
  return s.docs.map(x => { const d = x.data(); CLES.set(d.id, x.id); return Object.assign({}, d, { fichiers: undefined, nbFichiers: parse(d.fichiers).length }); });
}

async function cleOf(id) {
  needBat();
  if (CLES.has(String(id))) return CLES.get(String(id));
  const s = await wrap(F.getDocs(F.query(F.collection(db, 'Demandes'), F.where('id', '==', String(id)), F.limit(1))));
  if (s.empty) throw new Error('Demande introuvable');
  CLES.set(String(id), s.docs[0].id);
  return s.docs[0].id;
}

export async function getBat(id) {
  const cle = await cleOf(id);
  const [s, n, q] = await Promise.all([
    wrap(F.getDoc(dRef(cle))),
    wrap(F.getDoc(F.doc(db, 'DemandesInt', cle))),
    wrap(F.getDocs(F.collection(db, 'Demandes', cle, 'Suivi')))
  ]);
  if (!s.exists()) throw new Error('Demande introuvable (supprimée ?)');
  return { demande: pub(s.data(), n.exists() ? n.data().noteInterne || '' : ''), suivi: q.docs.map(d => d.data()), bat: true };
}

async function mailBat(cle, sid) {
  const idToken = await auth.currentUser.getIdToken();
  return script('fbMail', { idToken, cle, sid });
}

export async function update(id, item, message, prevenir) {
  const cle = await cleOf(id);
  const s = await wrap(F.getDoc(dRef(cle)));
  if (!s.exists()) throw new Error('Demande introuvable (supprimée ?)');
  const d = s.data(), avant = d.statut;
  const up = {};
  CHAMPS.concat(BAT, SUIVI_BAT).forEach(k => { if (k in item) up[k] = clean(item[k], (LONGS.includes(k) || /^b_/.test(k)) ? 5000 : 500); });
  if (up.statut && STATUTS.indexOf(up.statut) < 0) throw new Error('Statut inconnu : ' + up.statut);
  up.majLe = now_(); up.majPar = me;
  const b = F.writeBatch(db);
  b.update(dRef(cle), up);
  if ('noteInterne' in item) b.set(F.doc(db, 'DemandesInt', cle), { noteInterne: clean(item.noteInterne, 5000), majLe: up.majLe, majPar: me });
  let sid = '';
  const msg = clean(message, 2000);
  if (up.statut && up.statut !== avant) {
    sid = hex(5);
    b.set(sRef(cle, sid), { id: sid, demandeId: d.id, date: up.majLe, auteur: me, type: 'statut', texte: up.statut + (msg ? ' — ' + msg : ''), public: 'oui' });
  }
  await wrap(b.commit());
  if (sid) journal('statut', d.numero, avant + ' → ' + up.statut); else journal('modification', d.numero, d.intitule);
  let warn = '';
  if (sid && prevenir && d.email) { try { await mailBat(cle, sid); } catch (e) { warn = 'E-mail non envoyé : ' + e.message; } }
  return Object.assign(pub(Object.assign({}, d, up)), { warn });
}

/* ---------- Échanges et pièces jointes (demandeur ou Bâtiment) ---------- */

// p : {id, cle?, texte, public?, prevenir?} — sans clé, c'est le Bâtiment qui écrit
export async function comment(p) {
  const bat = !p.cle;
  const cle = bat ? await cleOf(p.id) : p.cle;
  const texte = clean(p.texte, 3000);
  if (!texte) throw new Error('Message vide');
  const s = await wrap(F.getDoc(dRef(cle)));
  if (!s.exists() || s.data().id !== String(p.id)) throw new Error('Demande introuvable');
  const d = s.data(), sid = hex(5);
  const o = { id: sid, demandeId: d.id, date: now_(), auteur: bat ? me : (d.demandeur || 'Demandeur'),
    type: bat ? 'batiment' : 'demandeur', texte, public: bat ? (p.public ? 'oui' : 'non') : 'oui' };
  await wrap(F.setDoc(sRef(cle, sid), o));
  if (bat) journal('message', d.numero, texte.slice(0, 80));
  let warn = '';
  try {
    if (!bat) await script('fbMsgDem', { cle, sid });
    else if (o.public === 'oui' && p.prevenir && d.email) await mailBat(cle, sid);
  } catch (e) { warn = 'Message enregistré, e-mail non envoyé : ' + e.message; }
  return Object.assign(o, { warn });
}

// p : {id?, cle?, files:[{cat,name,type,data(base64)}]}
export async function upload(p, auteurDem) {
  const bat = !p.cle;
  const cle = bat ? await cleOf(p.id) : p.cle;
  if (!p.files || !p.files.length) return [];
  const auteur = bat ? me : (auteurDem || '');
  const ajout = await script('fbUpload', { cle, files: p.files, auteur });
  const sid = hex(5), t = now_();
  let L = [];
  await wrap(F.runTransaction(db, async tx => {
    const s = await tx.get(dRef(cle));
    if (!s.exists()) throw new Error('Demande introuvable');
    const d = s.data();
    L = parse(d.fichiers).concat(ajout);
    tx.update(dRef(cle), { fichiers: JSON.stringify(L), majLe: t });
    tx.set(sRef(cle, sid), { id: sid, demandeId: d.id, date: t, auteur: auteur || d.demandeur || 'Demandeur', type: 'fichier',
      texte: ajout.map(f => f.nom).join(', ').slice(0, 3000) || 'fichier', public: 'oui' });
  }));
  return L;
}

export async function remove(id) {
  const cle = await cleOf(id);
  const s = await wrap(F.getDoc(dRef(cle)));
  const q = await wrap(F.getDocs(F.collection(db, 'Demandes', cle, 'Suivi')));
  const b = F.writeBatch(db);
  q.docs.forEach(x => b.delete(x.ref));
  b.delete(F.doc(db, 'DemandesInt', cle));
  b.delete(dRef(cle));
  await wrap(b.commit());
  CLES.delete(String(id));
  if (s.exists()) journal('suppression', s.data().numero, s.data().intitule);
  return { id };
}

/* ---------- Reprise des demandes du Google Sheet (responsable, avec le code Bâtiment de l'ancienne version) ----------
 * Peut être relancée : le Sheet fait foi pour les demandes qu'il contient. */
export async function reprise(code, progress = () => {}) {
  needBat();
  if (meRole !== 'Responsable') throw new Error('Réservé aux responsables');
  const old = async (action, p = {}) => {
    const r = await fetch(CFG.apiUrl, { method: 'POST', body: JSON.stringify(Object.assign({ action, code }, p)) });
    if (!r.ok) throw new Error('Ancien serveur injoignable (' + r.status + ')');
    const j = await r.json(); if (!j.ok) throw new Error(j.error || 'Erreur de l\'ancien serveur'); return j.data;
  };
  progress('Lecture du Google Sheet…');
  const L = await old('list');
  const all = [];
  for (let i = 0; i < L.length; i += 4) {
    progress(`Lecture des fiches : ${Math.min(i + 4, L.length)}/${L.length}…`);
    const r = await Promise.all(L.slice(i, i + 4).map(x => old('get', { id: x.id })));
    all.push(...r);
  }
  const max = {};
  let b = F.writeBatch(db), n = 0, nbS = 0;
  const flush = async () => { if (n) { await wrap(b.commit()); b = F.writeBatch(db); n = 0; } };
  for (const r of all) {
    const d = r.demande;
    if (!d || !/^[0-9a-f]{32}$/.test(String(d.cle || ''))) continue;
    const m = String(d.numero || '').match(/^DT-(\d{4})-(\d+)$/);
    const o = {};
    Object.keys(d).forEach(k => { if (k && !['noteInterne', 'fichiers', 'nbFichiers', '_row'].includes(k)) o[k] = d[k] === null || d[k] === undefined ? '' : String(d[k]); });
    o.fichiers = JSON.stringify(Array.isArray(d.fichiers) ? d.fichiers : parse(d.fichiers));
    o.seq = m ? Number(m[2]) : 0; o.annee = m ? m[1] : '';
    if (m) max[m[1]] = Math.max(max[m[1]] || 0, o.seq);
    b.set(dRef(d.cle), o); n++;
    b.set(F.doc(db, 'DemandesInt', d.cle), { noteInterne: String(d.noteInterne || ''), majLe: o.majLe || '', majPar: o.majPar || '' }); n++;
    for (const s of (r.suivi || [])) {
      if (!s.id) continue;
      b.set(sRef(d.cle, String(s.id)), { id: String(s.id), demandeId: String(s.demandeId || d.id), date: String(s.date || ''), auteur: String(s.auteur || '?'),
        type: String(s.type || ''), texte: String(s.texte || '—'), public: s.public === 'non' ? 'non' : 'oui' });
      n++; nbS++;
      if (n >= 400) await flush();
    }
    if (n >= 400) await flush();
    progress(`Copie dans Firebase…`);
  }
  await flush();
  for (const an of Object.keys(max)) {
    const cref = F.doc(db, 'Compteurs', 'dt-' + an);
    const c = await wrap(F.getDoc(cref));
    const cur = c.exists() ? Number(c.data().n) || 0 : 0;
    if (max[an] > cur) await wrap(F.setDoc(cref, { n: max[an] }));
  }
  journal('reprise', '', all.length + ' demandes, ' + nbS + ' échanges');
  return { demandes: all.length, suivi: nbS };
}

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
const S = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-storage.js`);
/* App Check (Fraud Defense / reCAPTCHA Enterprise) : prouve à Firebase que les requêtes viennent bien de nos pages.
   Sans réseau ou si le module ne se charge pas, l'appli continue normalement. */
const AC_SITE = '6Le3lBguAAAAAGb774RgCJp5Gd_jfG38Tks9out3';
const AC = await Promise.race([import(`https://www.gstatic.com/firebasejs/${V}/firebase-app-check.js`), new Promise(r => setTimeout(() => r(null), 4000))]).catch(() => null);
let acInst = null;
function appCheck(app) { if (!AC) return; try { acInst = AC.initializeAppCheck(app, { provider: new AC.ReCaptchaEnterpriseProvider(AC_SITE), isTokenAutoRefreshEnabled: true }); } catch (e) { console.warn('App Check :', e); } }
// Jeton App Check transmis au script Google (e-mails) : il le renvoie à Firestore quand il relit les données
async function acJeton() {
  if (!acInst) return '';
  try { const r = await Promise.race([AC.getToken(acInst, false), new Promise(ok => setTimeout(() => ok(null), 4000))]); return (r && r.token) || ''; } catch (e) { return ''; }
}

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

let app, auth, db, st, CFG;
let me = '', meEmail = '', meRole = '';
const CLES = new Map(); // id court → clé (espace Bâtiment)

export function init(cfg) {
  CFG = cfg;
  app = initializeApp(cfg.firebase);
  appCheck(app);
  // Connexion partagée entre toutes les applis eurexpobatiment.github.io : même rangement partout (sinon elles se « volent » la session)
  try { auth = A.initializeAuth(app, { persistence: [A.browserLocalPersistence, A.indexedDBLocalPersistence] }); } catch (e) { auth = A.getAuth(app); }
  db = F.getFirestore(app);
  st = S.getStorage(app);
}

/* ---------- Outils ---------- */
const MSG = {
  'auth/invalid-email': 'Adresse e-mail invalide',
  'auth/invalid-credential': 'E-mail ou mot de passe incorrect',
  'auth/wrong-password': 'E-mail ou mot de passe incorrect',
  'auth/user-not-found': 'Aucun compte avec cette adresse',
  'auth/email-already-in-use': 'Un compte existe déjà avec cette adresse : connectez-vous (ou « Mot de passe oublié »)',
  'auth/weak-password': 'Mot de passe trop court (6 caractères minimum)',
  'auth/too-many-requests': 'Trop d\'essais : patiente quelques minutes',
  'auth/network-request-failed': 'Pas de connexion internet',
  'permission-denied': 'Accès refusé',
  'unavailable': 'Serveur injoignable (pas de connexion ?)',
  'not-found': 'Demande introuvable',
  'storage/unauthorized': 'Accès refusé à la pièce jointe',
  'storage/retry-limit-exceeded': 'Envoi du fichier interrompu (connexion ?)',
  'storage/quota-exceeded': 'Espace de stockage plein',
  'storage/canceled': 'Envoi annulé'
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
  const r = await fetch(CFG.apiUrl, { method: 'POST', body: JSON.stringify(Object.assign({ action, appUrl: appUrl(), appCheck: await acJeton() }, p)) });
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
// Demandeurs : adresses de l'entreprise seulement (liste dans CONFIG.domaines, à garder identique aux règles Firebase)
const domaineOk = e => (CFG.domaines || []).some(d => String(e || '').toLowerCase().endsWith('@' + d.toLowerCase()));
export async function signup(email, pw) {
  email = String(email || '').trim().toLowerCase();
  if (!domaineOk(email)) throw new Error('Adresse non autorisée : utilisez votre adresse ' + (CFG.domaines || []).map(d => '@' + d).join(' ou '));
  const c = await wrap(A.createUserWithEmailAndPassword(auth, email, pw));
  await wrap(A.sendEmailVerification(c.user, { url: location.href.split('#')[0] }));
}
const jeton = () => auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve('');
function needUser() { if (!auth.currentUser || !meEmail) throw new Error('Connectez-vous d\'abord'); }
export const login = (email, pw) => wrap(A.signInWithEmailAndPassword(auth, email.trim(), pw));
export const resetPw = email => wrap(A.sendPasswordResetEmail(auth, email.trim()));
export const resendVerif = () => wrap(A.sendEmailVerification(auth.currentUser));
export async function logout() { me = ''; meRole = ''; CLES.clear(); await A.signOut(auth); }
export const whoami = () => ({ nom: me, email: meEmail, role: meRole });

/* cb({etat, email, nom, role}) · etat : 'deconnecte' | 'non-verifie' | 'sans-acces' | 'ok' */
export function onAuth(cb) {
  A.onAuthStateChanged(auth, async u => {
    if (!u || u.isAnonymous) { me = ''; meEmail = ''; meRole = ''; return cb({ etat: 'deconnecte' }); } // anonyme = session des applis de saisie
    meEmail = String(u.email || '').toLowerCase();
    if (!u.emailVerified) {
      await u.reload().catch(() => {});
      if (!auth.currentUser || !auth.currentUser.emailVerified) return cb({ etat: 'non-verifie', email: meEmail });
    }
    try { const r = await u.getIdTokenResult(); if (r.claims.email_verified !== true) await u.getIdToken(true); } catch (e) {}
    for (let i = 0; i < 5; i++) {
      try {
        const s = await F.getDoc(F.doc(db, 'Acces', meEmail));
        const a = s.exists() ? s.data() : null;
        if (a && a.actif !== 'non') { me = a.nom; meRole = a.role || ''; return cb({ etat: 'ok', email: meEmail, nom: me, role: meRole }); }
        me = ''; meRole = '';
        return cb(domaineOk(meEmail) ? { etat: 'demandeur', email: meEmail } : { etat: 'sans-acces', email: meEmail });
      } catch (e) {
        // Refus passager (jeton expiré pendant que l'onglet était en arrière-plan, réseau…) : jetons renouvelés, jusqu'à 5 essais espacés
        if (i < 4 && auth.currentUser === u) {
          if (e.code === 'permission-denied' || e.code === 'unauthenticated') { await u.getIdToken(true).catch(() => {}); if (acInst) await AC.getToken(acInst, true).catch(() => {}); }
          await new Promise(r => setTimeout(r, 800 * 2 ** i)); continue;
        }
        me = ''; meRole = '';
        return cb(domaineOk(meEmail) ? { etat: 'demandeur', email: meEmail } : { etat: 'sans-acces', email: meEmail, err: errMsg(e) });
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
  needUser();
  const o = {};
  CHAMPS.forEach(k => { if (k in item) o[k] = clean(item[k], LONGS.includes(k) ? 5000 : 500); });
  const cle = hex(16), id = hex(5), sid = hex(5), t = now_();
  const annee = String(new Date().getUTCFullYear());
  o.dateDemande = o.dateDemande || t.slice(0, 10);
  Object.assign(o, { id, cle, annee, compte: meEmail, creeLe: t, majLe: t, majPar: o.demandeur, statut: 'Nouvelle', fichiers: '[]' });
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
  await quiet(jeton().then(idToken => script('fbNouvelle', { cle, idToken })));
  return { id, numero, cle, warn };
}

// Demandes du compte connecté (accueil)
export async function mesDemandes() {
  needUser();
  const s = await wrap(F.getDocs(F.query(F.collection(db, 'Demandes'), F.where('compte', '==', meEmail))));
  return s.docs.map(x => { const d = x.data(); return { id: d.id, cle: x.id, numero: d.numero, intitule: d.intitule, statut: d.statut, date: d.creeLe }; })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export async function getPublic(id, cle) {
  needUser();
  const s = await F.getDoc(dRef(cle)).catch(e => { if (e.code === 'permission-denied') throw new Error('Cette demande n\'est pas liée à votre compte (' + meEmail + ')'); throw new Error(errMsg(e)); });
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
    if (!bat) await script('fbMsgDem', { cle, sid, idToken: await jeton() });
    else if (o.public === 'oui' && p.prevenir && d.email) await mailBat(cle, sid);
  } catch (e) { warn = 'Message enregistré, e-mail non envoyé : ' + e.message; }
  return Object.assign(o, { warn });
}

/* Pièces jointes : gardées dans Firebase Storage (demandes/{cle}/{fid}, bucket à Paris),
 * en attendant que le Bâtiment les enregistre dans le dossier de son choix. Rien n'est envoyé dans Drive.
 * Les pièces jointes plus anciennes (avant le 10 nov. 2026) restent lisibles dans Firestore (Fichiers/{fid}/Parts). */
const pjRef = (cle, fid) => S.ref(st, `demandes/${cle}/${fid}`);
async function stocker(cle, f, auteur, t) {
  const fid = hex(8), data = String(f.data || '');
  const nom = clean(f.name, 150) || 'fichier', type = clean(f.type, 100) || 'application/octet-stream';
  await wrap(S.uploadString(pjRef(cle, fid), data, 'base64', { contentType: type, customMetadata: { nom: encodeURIComponent(nom) } }));
  return { cat: clean(f.cat, 30) || 'Autres', nom, fid, type: clean(f.type, 100), par: auteur, le: t, taille: Math.round(data.length * 0.75), st: 1 };
}
async function effacerPj(cle, fid) {
  try { await S.deleteObject(pjRef(cle, fid)); } catch (e) { if (e && e.code !== 'storage/object-not-found') throw new Error(errMsg(e)); }
}

// Contenu d'une pièce jointe (Blob)
export async function fichier(cle, fid) {
  try {
    const r = pjRef(cle, fid);
    const [blob, md] = await Promise.all([S.getBlob(r), S.getMetadata(r)]);
    let nom = (md.customMetadata && md.customMetadata.nom) || 'fichier';
    try { nom = decodeURIComponent(nom); } catch (e) {}
    return { blob, nom };
  } catch (e) { if (!e || e.code !== 'storage/object-not-found') throw new Error(errMsg(e)); }
  // ancienne pièce jointe, gardée en morceaux dans Firestore
  const m = await wrap(F.getDoc(F.doc(db, 'Demandes', cle, 'Fichiers', fid)));
  if (!m.exists()) throw new Error('Fichier introuvable (retiré de l\'appli ?)');
  const q = await wrap(F.getDocs(F.collection(db, 'Demandes', cle, 'Fichiers', fid, 'Parts')));
  const b64 = q.docs.map(d => d.data()).sort((a, b) => a.i - b.i).map(x => x.data).join('');
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return { blob: new Blob([u], { type: m.data().type || 'application/octet-stream' }), nom: m.data().nom };
}
export const cleDe = id => cleOf(id);

// Bâtiment : note où les fichiers ont été enregistrés · retirer = efface aussi la copie gardée dans l'appli
export async function classer(id, fids, dossier, retirer) {
  const cle = await cleOf(id);
  const t = now_();
  await wrap(F.runTransaction(db, async tx => {
    const s = await tx.get(dRef(cle));
    if (!s.exists()) throw new Error('Demande introuvable');
    const L = parse(s.data().fichiers).map(f => fids.includes(f.fid) ? Object.assign({}, f, { classe: dossier, classeLe: t, classePar: me }, retirer ? { retire: 'oui' } : {}) : f);
    tx.update(dRef(cle), { fichiers: JSON.stringify(L), majLe: t, majPar: me });
  }));
  if (retirer) for (const fid of fids) {
    await effacerPj(cle, fid);
    const q = await wrap(F.getDocs(F.collection(db, 'Demandes', cle, 'Fichiers', fid, 'Parts')));
    const b = F.writeBatch(db);
    q.docs.forEach(d => b.delete(d.ref));
    b.delete(F.doc(db, 'Demandes', cle, 'Fichiers', fid));
    await wrap(b.commit());
  }
}

// p : {id?, cle?, files:[{cat,name,type,data(base64)}]}
export async function upload(p, auteurDem) {
  const bat = !p.cle;
  const cle = bat ? await cleOf(p.id) : p.cle;
  if (!p.files || !p.files.length) return [];
  const sid = hex(5), t = now_();
  let auteur = bat ? me : (auteurDem || '');
  if (!auteur) { const s = await wrap(F.getDoc(dRef(cle))); auteur = (s.exists() && s.data().demandeur) || 'Demandeur'; }
  const ajout = [];
  for (const f of p.files) ajout.push(await stocker(cle, f, auteur, t));
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
  // pièces jointes gardées dans l'appli : Storage, puis anciennes en morceaux dans Firestore
  if (s.exists()) for (const f of parse(s.data().fichiers)) if (f.fid) await effacerPj(cle, f.fid);
  const fq = await wrap(F.getDocs(F.collection(db, 'Demandes', cle, 'Fichiers')));
  for (const f of fq.docs) {
    const pq = await wrap(F.getDocs(F.collection(db, 'Demandes', cle, 'Fichiers', f.id, 'Parts')));
    const bb = F.writeBatch(db); pq.docs.forEach(x => bb.delete(x.ref)); bb.delete(f.ref); await wrap(bb.commit());
  }
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
export async function reprise(progress = () => {}) {
  needBat();
  if (meRole !== 'Responsable') throw new Error('Réservé aux responsables');
  progress('Lecture du Google Sheet…');
  const all = await script('fbExport', { idToken: await jeton() });
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
    o.compte = domaineOk(d.email) ? String(d.email).trim().toLowerCase() : '';
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

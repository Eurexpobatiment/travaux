/**
 * Demandes de travaux – Eurexpo · API (Google Apps Script lié au Google Sheet)
 *
 * Onglets créés automatiquement : Demandes, Suivi (échanges et changements de statut), Journal.
 * Pièces jointes : rangées dans le dossier Drive « Demandes de travaux – pièces jointes ».
 *
 * Réglages (Apps Script > ⚙️ Paramètres du projet > Propriétés du script) :
 *   CODE_BATIMENT : code d'accès à l'espace Bâtiment (obligatoire)
 *   EMAILS_NOTIF  : adresse(s) prévenue(s) à chaque nouvelle demande, séparées par des virgules (facultatif)
 *   APP_URL       : adresse de l'appli (par défaut https://eurexpobatiment.github.io/travaux/)
 *
 * Installation : coller ce fichier dans Extensions > Apps Script du Google Sheet,
 * exécuter une fois la fonction « installer », puis Déployer > Application Web
 * (Exécuter en tant que : moi · Accès : tout le monde).
 */

const TZ = 'Europe/Paris';
const APP_URL_DEFAUT = 'https://eurexpobatiment.github.io/travaux/';
const DOSSIER = 'Demandes de travaux – pièces jointes';

// Champs du formulaire (colonne « A remplir par le Demandeur »). Chacun a son pendant « b_… » côté Bâtiment.
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
const BAT = CHAMPS.map(function (k) { return 'b_' + k; });
const SUIVI_BAT = ['statut', 'priorite', 'chargeDe', 'datePrevue', 'noteInterne'];

const STATUTS = ['Nouvelle', "À l'étude", 'Chiffrage', 'Validée', 'Planifiée', 'En cours', 'Terminée', 'Refusée'];

const SCHEMA = {
  Demandes: ['id', 'numero', 'cle', 'creeLe', 'majLe', 'majPar'].concat(SUIVI_BAT, CHAMPS, BAT, ['fichiers']),
  Suivi: ['id', 'demandeId', 'date', 'auteur', 'type', 'texte', 'public']
};
const JOURNAL = ['date', 'auteur', 'action', 'numero', 'detail'];
const LONGS = ['description', 'objectif', 'resultat', 'processus', 'besoinAnnexe', 'texte', 'noteInterne', 'fichiers'];
const MAX_FICHIER = 15 * 1024 * 1024;

/* ---------- Installation ---------- */

function installer() {
  Object.keys(SCHEMA).forEach(sheet_);
  sheet_('Journal');
  dossier_();
  const pr = PropertiesService.getScriptProperties();
  if (!pr.getProperty('CODE_BATIMENT')) pr.setProperty('CODE_BATIMENT', 'a-changer-' + Math.floor(1000 + Math.random() * 9000));
  // Ligne utile pour déclencher l'autorisation d'envoi d'e-mails dès l'installation
  Logger.log('E-mails restants aujourd\'hui : ' + MailApp.getRemainingDailyQuota());
  Logger.log('Code Bâtiment actuel : ' + pr.getProperty('CODE_BATIMENT') + ' (à changer dans Propriétés du script)');
}

/* ---------- Points d'entrée Web ---------- */

function doGet(e) {
  const p = (e && e.parameter && e.parameter.action) ? e.parameter : { action: 'ping' };
  return handle_(p);
}

function doPost(e) {
  let p;
  try {
    p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return out_({ ok: false, error: 'Requête illisible' });
  }
  return handle_(p);
}

function handle_(p) {
  try {
    switch (p.action) {
      case 'ping':    return out_({ ok: true, data: 'pong' });
      case 'login':   bat_(p); return out_({ ok: true, data: true });
      case 'create':  return out_({ ok: true, data: withLock_(function () { return create_(p); }) });
      case 'get':     return out_({ ok: true, data: get_(p) });
      case 'list':    bat_(p); return out_({ ok: true, data: list_() });
      case 'update':  bat_(p); return out_({ ok: true, data: withLock_(function () { return update_(p); }) });
      case 'comment': return out_({ ok: true, data: withLock_(function () { return comment_(p); }) });
      case 'upload':  return out_({ ok: true, data: withLock_(function () { return upload_(p); }) });
      case 'delete':  bat_(p); return out_({ ok: true, data: withLock_(function () { return remove_(p); }) });
      // Version Firebase : e-mails et pièces jointes
      case 'fbNouvelle': fbUrl_(p); return out_({ ok: true, data: fbNouvelle_(p) });
      case 'fbMsgDem':   fbUrl_(p); return out_({ ok: true, data: fbMsgDem_(p) });
      case 'fbMail':     fbUrl_(p); return out_({ ok: true, data: fbMail_(p) });
      case 'fbUpload':   return out_({ ok: true, data: fbUpload_(p) });
      default: throw new Error('Action inconnue : ' + p.action);
    }
  } catch (err) {
    return out_({ ok: false, error: String((err && err.message) || err) });
  }
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Serveur occupé, réessaie dans quelques secondes');
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ---------- Droits ---------- */

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }

function bat_(p) {
  const code = prop_('CODE_BATIMENT');
  if (!code) throw new Error('Code Bâtiment non configuré (Propriétés du script)');
  if (String(p.code || '') !== code) {
    Utilities.sleep(800);
    throw new Error('Code Bâtiment incorrect');
  }
  return true;
}
function isBat_(p) { try { return bat_(p); } catch (e) { return false; } }

// Retourne la demande si l'appelant y a droit (code Bâtiment ou clé de suivi du demandeur)
function demandeAutorisee_(p) {
  const d = find_(p.id);
  if (!d) throw new Error('Demande introuvable');
  const bat = p.code ? isBat_(p) : false;
  if (!bat && String(p.cle || '') !== d.cle) throw new Error('Lien de suivi invalide');
  return { d: d, bat: bat };
}

/* ---------- Actions ---------- */

function create_(p) {
  const item = p.item || {};
  if (!clean_(item.demandeur)) throw new Error('Nom du demandeur obligatoire');
  if (!clean_(item.intitule)) throw new Error('Intitulé du projet obligatoire');
  if (!clean_(item.email) && !clean_(item.telephone)) throw new Error('Indique un e-mail ou un téléphone');

  const sh = sheet_('Demandes');
  const rows = rows_(sh);
  const o = {};
  CHAMPS.forEach(function (k) { if (k in item) o[k] = clean_(item[k], LONGS.indexOf(k) >= 0 ? 5000 : 500); });
  o.id = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  o.cle = Utilities.getUuid().replace(/-/g, '');
  o.numero = numero_(rows);
  o.creeLe = o.majLe = now_();
  o.majPar = o.demandeur;
  o.dateDemande = o.dateDemande || o.creeLe.slice(0, 10);
  o.statut = 'Nouvelle';
  o.fichiers = JSON.stringify(saveFiles_(o, p.files, o.demandeur, []));

  append_(sh, SCHEMA.Demandes.map(function (h) { return safe_(o[h]); }));
  addSuivi_(o.id, o.demandeur, 'statut', 'Demande déposée', true);
  journal_(o.demandeur, 'nouvelle demande', o.numero, o.intitule);

  mailNouvelle_(o);
  return { id: o.id, numero: o.numero, cle: o.cle };
}

function get_(p) {
  const a = demandeAutorisee_(p);
  const d = pub_(a.d, a.bat);
  const suivi = rows_(sheet_('Suivi'))
    .filter(function (s) { return s.demandeId === a.d.id && (a.bat || s.public === 'oui'); })
    .map(function (s) { delete s._row; return s; });
  return { demande: d, suivi: suivi, bat: a.bat };
}

function list_() {
  return rows_(sheet_('Demandes')).map(function (d) {
    return {
      id: d.id, numero: d.numero, creeLe: d.creeLe, majLe: d.majLe, statut: d.statut, priorite: d.priorite,
      chargeDe: d.chargeDe, datePrevue: d.datePrevue, demandeur: d.demandeur, service: d.service,
      lieu: d.lieu, intitule: d.intitule, dateDebut: d.dateDebut, dateFin: d.dateFin,
      dateImperative: d.dateImperative, impact: d.impact, budget: d.budget, nbFichiers: parse_(d.fichiers).length
    };
  });
}

function update_(p) {
  const item = p.item || {};
  const user = clean_(p.user, 80) || 'Bâtiment';
  const sh = sheet_('Demandes');
  const d = find_(p.id);
  if (!d) throw new Error('Demande introuvable');
  const avant = d.statut;

  // Le Bâtiment peut aussi corriger la colonne Demandeur
  CHAMPS.concat(BAT, SUIVI_BAT).forEach(function (k) {
    if (k in item) d[k] = clean_(item[k], (LONGS.indexOf(k) >= 0 || /^b_/.test(k)) ? 5000 : 500);
  });
  if (d.statut && STATUTS.indexOf(d.statut) < 0) throw new Error('Statut inconnu : ' + d.statut);
  d.majLe = now_();
  d.majPar = user;
  write_(sh, d);

  if (avant !== d.statut) {
    const msg = clean_(p.message, 2000);
    addSuivi_(d.id, user, 'statut', d.statut + (msg ? ' — ' + msg : ''), true);
    journal_(user, 'statut', d.numero, avant + ' → ' + d.statut);
    if (p.prevenir) mailStatut_(d, msg);
  } else {
    journal_(user, 'modification', d.numero, d.intitule);
  }
  return pub_(d, true);
}

function comment_(p) {
  const a = demandeAutorisee_(p);
  const texte = clean_(p.texte, 3000);
  if (!texte) throw new Error('Message vide');
  const auteur = a.bat ? (clean_(p.user, 80) || 'Bâtiment') : (a.d.demandeur || 'Demandeur');
  const pub = a.bat ? (p.public ? 'oui' : 'non') : 'oui';
  const s = addSuivi_(a.d.id, auteur, a.bat ? 'batiment' : 'demandeur', texte, pub === 'oui');
  journal_(auteur, 'message', a.d.numero, texte.slice(0, 80));
  if (a.bat && pub === 'oui' && p.prevenir) mailMessage_(a.d, texte);
  if (!a.bat) mailMessageBat_(a.d, texte);
  return s;
}

function upload_(p) {
  const a = demandeAutorisee_(p);
  const auteur = a.bat ? (clean_(p.user, 80) || 'Bâtiment') : (a.d.demandeur || 'Demandeur');
  const liste = parse_(a.d.fichiers);
  saveFiles_(a.d, p.files, auteur, liste);
  a.d.fichiers = JSON.stringify(liste);
  a.d.majLe = now_();
  write_(sheet_('Demandes'), a.d);
  addSuivi_(a.d.id, auteur, 'fichier', (p.files || []).map(function (f) { return f.name; }).join(', '), true);
  return liste;
}

function remove_(p) {
  const sh = sheet_('Demandes');
  const d = find_(p.id);
  if (!d) throw new Error('Demande introuvable');
  sh.deleteRow(d._row);
  const ss = sheet_('Suivi');
  rows_(ss).filter(function (s) { return s.demandeId === d.id; })
    .map(function (s) { return s._row; }).sort(function (x, y) { return y - x; })
    .forEach(function (r) { ss.deleteRow(r); });
  journal_(clean_(p.user, 80), 'suppression', d.numero, d.intitule);
  return { id: d.id };
}

/* ---------- Fichiers ---------- */

function dossier_() {
  const it = DriveApp.getFoldersByName(DOSSIER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DOSSIER);
}

function saveFiles_(d, files, auteur, liste) {
  if (!files || !files.length) return liste;
  const racine = dossier_();
  const nom = d.numero + ' – ' + String(d.intitule || '').slice(0, 60);
  const it = racine.getFoldersByName(nom);
  const dos = it.hasNext() ? it.next() : racine.createFolder(nom);
  files.forEach(function (f) {
    if (!f || !f.data) return;
    const bytes = Utilities.base64Decode(f.data);
    if (bytes.length > MAX_FICHIER) throw new Error(f.name + ' dépasse 15 Mo');
    const blob = Utilities.newBlob(bytes, f.type || 'application/octet-stream', clean_(f.name, 150) || 'fichier');
    const file = dos.createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* partage bloqué par le domaine */ }
    liste.push({ cat: clean_(f.cat, 30) || 'Autres', nom: file.getName(), url: file.getUrl(), id: file.getId(), par: auteur, le: now_(), taille: bytes.length });
  });
  return liste;
}

/* ---------- E-mails ---------- */

let APP_URL_FB = ''; // adresse de la version Firebase qui a appelé le script (liens des e-mails)
function appUrl_() { return APP_URL_FB || prop_('APP_URL') || APP_URL_DEFAUT; }
function lienSuivi_(d) { return appUrl_() + '#/suivi/' + d.id + '/' + d.cle; }
function lienBat_(d) { return appUrl_() + '#/bat/' + d.id; }

function mail_(to, sujet, html) {
  to = String(to || '').trim();
  if (!to || !/@/.test(to)) return;
  try {
    MailApp.sendEmail({ to: to, subject: sujet, name: 'Bâtiment Eurexpo', htmlBody:
      '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;max-width:600px">' + html +
      '<p style="color:#6b7280;font-size:12px;margin-top:24px">Message automatique – Demandes de travaux Eurexpo</p></div>' });
  } catch (e) { journal_('système', 'e-mail non envoyé', '', String(e).slice(0, 150)); }
}

function bouton_(url, txt) {
  return '<p><a href="' + url + '" style="display:inline-block;background:#14213d;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">' + txt + '</a></p>';
}

function mailNouvelle_(d) {
  const resume = '<table style="border-collapse:collapse;font-size:14px">' +
    [['Demandeur', d.demandeur + (d.service ? ' (' + d.service + ')' : '')], ['Lieu', d.lieu], ['Projet', d.intitule],
     ['Début souhaité', frD_(d.dateDebut)], ['Date impérative', frD_(d.dateImperative)], ['Impact activité', d.impact]]
      .filter(function (r) { return r[1]; })
      .map(function (r) { return '<tr><td style="padding:3px 12px 3px 0;color:#6b7280">' + r[0] + '</td><td>' + esc_(r[1]) + '</td></tr>'; }).join('') + '</table>';
  mail_(prop_('EMAILS_NOTIF'), 'Nouvelle demande de travaux ' + d.numero + ' – ' + d.intitule,
    '<p>Une nouvelle demande de travaux vient d\'être déposée.</p>' + resume + bouton_(lienBat_(d), 'Ouvrir la demande'));
  mail_(d.email, 'Demande de travaux ' + d.numero + ' bien reçue',
    '<p>Bonjour ' + esc_(d.demandeur) + ',</p><p>Votre demande « ' + esc_(d.intitule) + ' » a bien été transmise au service Bâtiment sous le numéro <b>' + d.numero + '</b>.</p>' +
    '<p>Vous pouvez suivre son avancement, ajouter des pièces jointes ou échanger avec le service Bâtiment ici :</p>' + bouton_(lienSuivi_(d), 'Suivre ma demande'));
}

function mailStatut_(d, msg) {
  mail_(d.email, 'Demande ' + d.numero + ' : ' + d.statut,
    '<p>Bonjour ' + esc_(d.demandeur) + ',</p><p>Votre demande « ' + esc_(d.intitule) + ' » est passée au statut <b>' + esc_(d.statut) + '</b>.</p>' +
    (msg ? '<p style="background:#f3f4f7;padding:10px;border-radius:6px">' + esc_(msg).replace(/\n/g, '<br>') + '</p>' : '') + bouton_(lienSuivi_(d), 'Voir ma demande'));
}

function mailMessage_(d, texte) {
  mail_(d.email, 'Demande ' + d.numero + ' : nouveau message du service Bâtiment',
    '<p>Bonjour ' + esc_(d.demandeur) + ',</p><p style="background:#f3f4f7;padding:10px;border-radius:6px">' + esc_(texte).replace(/\n/g, '<br>') + '</p>' + bouton_(lienSuivi_(d), 'Répondre'));
}

function mailMessageBat_(d, texte) {
  mail_(prop_('EMAILS_NOTIF'), 'Demande ' + d.numero + ' : message de ' + d.demandeur,
    '<p style="background:#f3f4f7;padding:10px;border-radius:6px">' + esc_(texte).replace(/\n/g, '<br>') + '</p>' + bouton_(lienBat_(d), 'Ouvrir la demande'));
}

/* ---------- Outils ---------- */

function numero_(rows) {
  const an = now_().slice(0, 4);
  let max = 0;
  rows.forEach(function (r) {
    const m = String(r.numero || '').match(/^DT-(\d{4})-(\d+)$/);
    if (m && m[1] === an) max = Math.max(max, +m[2]);
  });
  return 'DT-' + an + '-' + ('00' + (max + 1)).slice(-3);
}

function pub_(d, bat) {
  const o = Object.assign({}, d);
  delete o._row;
  o.fichiers = parse_(d.fichiers);
  if (!bat) { delete o.noteInterne; delete o.cle; }
  return o;
}

function find_(id) {
  if (!id) return null;
  return rows_(sheet_('Demandes')).filter(function (r) { return r.id === String(id); })[0] || null;
}

function write_(sh, d) {
  const head = headers_(sh);
  sh.getRange(d._row, 1, 1, head.length).setValues([head.map(function (h) { return safe_(h in d ? d[h] : ''); })]);
}

function addSuivi_(demandeId, auteur, type, texte, pub) {
  const s = { id: Utilities.getUuid().replace(/-/g, '').slice(0, 10), demandeId: demandeId, date: now_(), auteur: auteur, type: type, texte: texte, public: pub ? 'oui' : 'non' };
  append_(sheet_('Suivi'), SCHEMA.Suivi.map(function (h) { return safe_(s[h]); }));
  return s;
}

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cols = SCHEMA[name] || JOURNAL;
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, cols.length).setValues([cols])
      .setFontWeight('bold').setBackground('#14213d').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    return sh;
  }
  const head = headers_(sh);
  const miss = cols.filter(function (c) { return head.indexOf(c) < 0; });
  if (miss.length) {
    const start = head.length + 1;
    if (sh.getMaxColumns() < start + miss.length - 1) sh.insertColumnsAfter(sh.getMaxColumns(), start + miss.length - 1 - sh.getMaxColumns());
    sh.getRange(1, start, sh.getMaxRows(), miss.length).setNumberFormat('@');
    sh.getRange(1, start, 1, miss.length).setValues([miss]).setFontWeight('bold');
  }
  return sh;
}

function headers_(sh) {
  const lc = sh.getLastColumn();
  if (!lc) return [];
  return sh.getRange(1, 1, 1, lc).getValues()[0].map(String);
}

function rows_(sh) {
  const v = sh.getDataRange().getValues();
  if (v.length < 2) return [];
  const head = v[0].map(String);
  const out = [];
  for (let i = 1; i < v.length; i++) {
    const o = { _row: i + 1 };
    head.forEach(function (h, j) { if (h) o[h] = str_(v[i][j]); });
    if (o.id) out.push(o);
  }
  return out;
}

function append_(sh, line) {
  if (sh.getLastRow() >= sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 500);
  sh.getRange(sh.getLastRow() + 1, 1, 1, line.length).setNumberFormat('@').setValues([line]);
}

function journal_(user, action, numero, detail) {
  append_(sheet_('Journal'), [now_(), user || '?', action, numero || '', String(detail || '').slice(0, 200)].map(safe_));
}

function parse_(s) { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }

function str_(v) {
  if (v instanceof Date) {
    const hasTime = v.getHours() || v.getMinutes();
    return Utilities.formatDate(v, TZ, hasTime ? "yyyy-MM-dd'T'HH:mm" : 'yyyy-MM-dd');
  }
  return v === null || v === undefined ? '' : String(v);
}

function clean_(v, max) {
  return String(v === null || v === undefined ? '' : v).trim().slice(0, max || 300);
}

// Empêche qu'un texte commençant par « = » soit pris pour une formule
function safe_(v) {
  v = String(v === null || v === undefined ? '' : v);
  return /^[=+@-]/.test(v) && !/^-?\d/.test(v) ? "'" + v : v;
}

function esc_(s) {
  return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}

function now_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm"); }

function frD_(s) { s = String(s || ''); return s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : ''; }


/* ======================= Version Firebase =======================
 * Les demandes sont dans Firestore (projet partagé avec l'appli Équipe). L'appli appelle le script
 * seulement pour les e-mails et pour ranger les pièces jointes dans Drive.
 * Le script relit chaque fois la demande dans Firestore : il n'envoie que ce qui y est réellement enregistré.
 * Première fois : exécuter « autoriserFirebase » dans l'éditeur, puis Déployer › Gérer les déploiements › Nouvelle version.
 */
const FIREBASE_PROJECT = 'equipe-batiment';
const FIREBASE_KEY = 'AIzaSyARtP0RMkulG6c53-bnazwpGTspl0LgAhk'; // clé publique de l'appli web

function autoriserFirebase() {
  const r = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT + '/databases/(default)/documents/Compteurs/dt-test', { muteHttpExceptions: true });
  Logger.log('Firestore répond : ' + r.getResponseCode() + ' (404 = normal, l\'accès fonctionne)');
  Logger.log('E-mails restants aujourd\'hui : ' + MailApp.getRemainingDailyQuota());
  dossier_();
}

function fbUrl_(p) {
  const u = String(p.appUrl || '');
  if (/^https:\/\/eurexpobatiment\.github\.io\/travaux\//.test(u)) APP_URL_FB = u.split('#')[0];
}

// Lecture d'un document Firestore (avec le jeton de la personne connectée, ou sans connexion pour une demande publique)
function fsGet_(path, tok) {
  const base = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT + '/databases/(default)/documents/';
  const url = base + path.split('/').map(encodeURIComponent).join('/');
  let r = UrlFetchApp.fetch(url, { headers: tok ? { Authorization: 'Bearer ' + tok } : {}, muteHttpExceptions: true });
  if (!tok && (r.getResponseCode() === 401 || r.getResponseCode() === 403)) r = UrlFetchApp.fetch(url + '?key=' + FIREBASE_KEY, { muteHttpExceptions: true });
  if (r.getResponseCode() === 404) throw new Error('Demande introuvable');
  if (r.getResponseCode() !== 200) throw new Error('Accès refusé');
  return fsObj_(JSON.parse(r.getContentText()));
}

function fsObj_(d) {
  const o = {};
  const f = (d && d.fields) || {};
  Object.keys(f).forEach(function (k) {
    const v = f[k];
    o[k] = 'stringValue' in v ? v.stringValue : 'integerValue' in v ? String(v.integerValue) : 'doubleValue' in v ? String(v.doubleValue)
      : 'booleanValue' in v ? String(v.booleanValue) : '';
  });
  return o;
}

function cleOk_(cle) {
  cle = String(cle || '');
  if (!/^[0-9a-f]{32}$/.test(cle)) throw new Error('Lien de suivi invalide');
  return cle;
}

// Évite les envois en double et les envois tardifs (le message doit être récent)
function uneFois_(cle, quand) {
  const c = CacheService.getScriptCache();
  if (c.get(cle)) return false;
  if (quand) {
    const t = Utilities.parseDate(String(quand).slice(0, 16), TZ, "yyyy-MM-dd'T'HH:mm");
    if (Math.abs(Date.now() - t.getTime()) > 2 * 3600 * 1000) return false;
  }
  c.put(cle, '1', 21600);
  return true;
}

// Membre du service Bâtiment connecté : vérifié en relisant ses droits dans Firestore avec son propre jeton
function fbMembre_(tok) {
  tok = String(tok || '');
  if (!tok) throw new Error('Connexion nécessaire');
  const part = tok.split('.')[1] || '';
  const payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(part + '==='.slice((part.length + 3) % 4))).getDataAsString());
  const acc = fsGet_('Acces/' + String(payload.email || '').toLowerCase(), tok);
  if (!acc.nom || acc.actif === 'non') throw new Error('Accès refusé');
  return acc.nom;
}

// Nouvelle demande : accusé de réception au demandeur + alerte au Bâtiment
function fbNouvelle_(p) {
  const cle = cleOk_(p.cle);
  const d = fsGet_('Demandes/' + cle);
  d.cle = cle;
  if (!uneFois_('fbnew_' + cle, d.creeLe)) return { envoye: false };
  mailNouvelle_(d);
  return { envoye: true };
}

// Message du demandeur → service Bâtiment
function fbMsgDem_(p) {
  const cle = cleOk_(p.cle);
  const sid = String(p.sid || '');
  const d = fsGet_('Demandes/' + cle);
  const s = fsGet_('Demandes/' + cle + '/Suivi/' + sid);
  d.cle = cle;
  if (s.type !== 'demandeur' || !uneFois_('fbmsg_' + sid, s.date)) return { envoye: false };
  mailMessageBat_(d, s.texte);
  return { envoye: true };
}

// Changement de statut ou message du Bâtiment → demandeur
function fbMail_(p) {
  const tok = String(p.idToken || '');
  fbMembre_(tok);
  const cle = cleOk_(p.cle);
  const sid = String(p.sid || '');
  const d = fsGet_('Demandes/' + cle, tok);
  const s = fsGet_('Demandes/' + cle + '/Suivi/' + sid, tok);
  d.cle = cle;
  if (s.public !== 'oui' || !d.email || !uneFois_('fbmail_' + sid, s.date)) return { envoye: false };
  if (s.type === 'statut') {
    const i = s.texte.indexOf(' — ');
    mailStatut_(d, i >= 0 ? s.texte.slice(i + 3) : '');
  } else if (s.type === 'batiment') mailMessage_(d, s.texte);
  else return { envoye: false };
  return { envoye: true };
}

// Pièces jointes : rangées dans Drive, l'appli enregistre ensuite la liste dans Firestore
function fbUpload_(p) {
  const cle = cleOk_(p.cle);
  const d = fsGet_('Demandes/' + cle);
  if (!p.files || !p.files.length) return [];
  const auteur = clean_(p.auteur, 80) || d.demandeur || 'Demandeur';
  return withLock_(function () { return saveFiles_(d, p.files, auteur, []); });
}

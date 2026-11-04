# Demandes de travaux – Eurexpo

Version en ligne du « Formulaire de demande travaux V2 ». Le demandeur remplit la fiche sur son téléphone ou son PC. Le service Bâtiment la reçoit, complète la colonne « A remplir par le Bâtiment » et fait avancer le statut.
Les données sont dans un Google Sheet et la page est hébergée sur GitHub Pages, comme tes autres applis.

## 1. Le Google Sheet + Apps Script
1. Crée un Google Sheet vide, par exemple « Demandes de travaux – Eurexpo ».
2. Va dans **Extensions › Apps Script**, efface le contenu et colle **Code.gs**. Enregistre.
3. Choisis la fonction **installer** puis clique sur **Exécuter**, et accepte les autorisations (Sheets, Drive pour les pièces jointes, Gmail pour les e-mails).
   Les onglets Demandes, Suivi et Journal sont créés, ainsi que le dossier Drive « Demandes de travaux – pièces jointes ».
4. Va dans **⚙️ Paramètres du projet › Propriétés du script** et renseigne :
   - `CODE_BATIMENT` : le code d'accès de l'espace Bâtiment (l'installation en met un provisoire, à remplacer)
   - `EMAILS_NOTIF` : la ou les adresses à prévenir à chaque nouvelle demande, séparées par des virgules
   - `APP_URL` (facultatif) : seulement si l'adresse de l'appli n'est pas https://eurexpobatiment.github.io/travaux/
5. Va dans **Déployer › Nouveau déploiement › Application Web** :
   - Exécuter en tant que : **moi**
   - Qui a accès : **Tout le monde**
6. Copie l'URL qui se termine par **/exec**.

> Si tu modifies Code.gs plus tard, va dans **Déployer › Gérer les déploiements › ✏️ › Version : Nouvelle version**. Sinon, l'URL continue d'utiliser l'ancien code.

Le code d'accès et les adresses e-mail restent dans les Propriétés du script. Ils n'apparaissent pas dans Code.gs, qui peut donc rester dans le dépôt public.

## 2. La page
1. Dans **index.html**, tout en haut du script, colle l'URL dans `CONFIG.apiUrl: '...'`.
   Tant que l'URL n'est pas renseignée, l'appli tourne en **mode démo** : rien n'est envoyé et le code Bâtiment est `demo`.
2. Adapte si besoin `CONFIG.services` et `CONFIG.lieux`. Ce sont les suggestions proposées dans les champs Service et Lieu, mais on peut toujours taper autre chose.

## 3. GitHub Pages
1. Crée le dépôt **travaux** sur le compte **Eurexpobatiment** et dépose-y `index.html`, `logo.png`, `manifest.webmanifest` et le dossier `icons/` (`Code.gs` et ce fichier pour référence).
2. Va dans **Settings › Pages › Branch : main / (root)** et clique sur Save.
3. L'appli sera à l'adresse **https://eurexpobatiment.github.io/travaux/**.

## Fonctionnement
- **Demandeur** : bouton « Nouvelle demande ». La fiche reprend les mêmes rubriques que le fichier Excel (cases à cocher, listes Impact et Budget, exemples en grisé). Les photos, plans, croquis et devis peuvent être joints, et les photos sont réduites automatiquement. La saisie est gardée en brouillon sur l'appareil jusqu'à l'envoi.
- À l'envoi, la demande reçoit un numéro **DT-2026-001**. Le demandeur reçoit par e-mail un **lien de suivi** personnel où il voit le statut et les réponses du Bâtiment, et où il peut écrire ou ajouter des pièces. Ses demandes sont aussi listées sur l'accueil de son appareil.
- **Espace Bâtiment** (code d'accès) :
  - La liste des demandes est filtrable par statut et triée avec les nouvelles en premier, puis par priorité. Les dates impératives à moins de 14 jours sont signalées en rouge.
  - Sur une fiche, tu remplis la colonne « Réponse Bâtiment » ligne par ligne, ainsi que le statut, la priorité, la personne qui prend en charge, la date d'intervention et une note interne que le demandeur ne voit jamais.
  - Statuts : Nouvelle → À l'étude → Chiffrage → Validée → Planifiée → En cours → Terminée (ou Refusée). Quand le statut change, tu peux ajouter un message et prévenir le demandeur par e-mail.
  - Les échanges peuvent être des messages au demandeur ou des notes internes 🔒.
- **🖨️ Imprimer / PDF** : sort la fiche au format du formulaire d'origine, avec les colonnes Demandeur et Bâtiment.
- L'onglet **Journal** du Sheet garde la trace de qui a fait quoi.

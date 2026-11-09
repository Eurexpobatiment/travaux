# Demandes de travaux – version Firebase

Même appli, avec les demandes dans **Firebase** (le projet `equipe-batiment` de l'appli Équipe) au lieu du Google Sheet.

Adresse : https://eurexpobatiment.github.io/travaux/ (en service depuis le 7 nov. 2026 ; /v2/ redirige ici)
L'ancienne version (Google Sheet) n'est plus utilisée : le Sheet reste comme archive.

## Ce qui change
- **Espace Bâtiment** : plus de code partagé. On se connecte avec l'adresse e-mail et le mot de passe de l'appli Équipe. Si tu es déjà connecté à l'appli Équipe sur l'appareil, tu es connecté directement. Les personnes sans accès à l'appli Équipe (adresse non saisie dans 👥 Équipe) n'entrent pas.
- **Demandeur** : connexion obligatoire avec une adresse **@gl-events.com** (liste `CONFIG.domaines` dans index.html et fonction `dtDomaine` des règles Firebase, à modifier ensemble). Première fois : « Créer mon compte », puis lien de vérification reçu par mail. Le demandeur ne voit que ses propres demandes (« Mes demandes » sur l'accueil, sur tous ses appareils). Les liens de suivi demandent une connexion avec l'adresse du compte qui a déposé la demande ; pour les demandes reprises du Sheet, c'est l'adresse e-mail saisie dans la fiche (si elle est @gl-events.com).
- **Note interne et notes 🔒** : Firebase ne les envoie jamais au demandeur.
- **Pièces jointes** : plus rien n'est rangé automatiquement dans Drive. Depuis le 10 nov. 2026, les fichiers envoyés par le demandeur (ou ajoutés par le Bâtiment) sont gardés dans **Firebase Storage** (bucket `equipe-batiment.firebasestorage.app`, à Paris, chemin `demandes/{clé}/{fichier}`, règles dans `storage.rules` : Bâtiment + demandeur de la fiche, 25 Mo par fichier). Les pièces jointes plus anciennes restent lisibles en morceaux dans Firestore. Sur la fiche, le bouton **📁 Enregistrer dans un dossier…** permet de choisir pour chaque demande le dossier de destination sur le PC (dossier Drive ou Teams synchronisé, dossier réseau…), avec un sous-dossier « DT-AAAA-NNN – intitulé » si on le souhaite. La fiche indique ensuite où les fichiers ont été rangés. Avec la case « retirer ensuite de l'appli », la copie gardée dans Firebase est effacée. Il faut Chrome ou Edge sur PC ; ailleurs, on peut télécharger les fichiers un par un. Le bucket autorise les téléchargements depuis eurexpobatiment.github.io (réglage CORS).
- Les pièces jointes des anciennes demandes restent dans leur dossier Drive actuel (liens conservés).
- **Le script Google** ne sert plus qu'à envoyer les e-mails. Avant chaque envoi, il relit la demande dans Firebase.

## Mise en route
1. **Règles Firebase** : console Firebase › projet *equipe-batiment* › Firestore Database › Règles. Remplacer tout le texte par `firestore.rules`, puis remplacer `VOTRE_EMAIL` par l'adresse du propriétaire (la même qu'aujourd'hui) et cliquer sur **Publier**. Ce fichier contient aussi les règles de l'appli Équipe, qui ne changent pas.
2. **Script Google** (Google Sheet « Demandes de travaux – Eurexpo » › Extensions › Apps Script) : remplacer le contenu par le nouveau `Code.gs`. Choisir la fonction **autoriserFirebase**, cliquer sur **Exécuter** et accepter l'accès aux « services externes ». Ensuite : **Déployer › Gérer les déploiements › ✏️ › Version : Nouvelle version › Déployer**. L'adresse /exec ne change pas.
3. Ouvrir https://eurexpobatiment.github.io/travaux/#/bat, se connecter, puis cliquer sur **⇪ Reprendre le Google Sheet** (bouton visible pour les responsables ; le script vérifie la connexion, plus besoin de l'ancien code). Toutes les demandes, les échanges et les notes internes sont copiés, avec les liens vers les pièces jointes déjà dans Drive. Le Sheet n'est pas modifié.

## Bascule
Au moment de la bascule : relancer **⇪ Reprendre le Google Sheet** (les demandes arrivées entre-temps dans le Sheet sont ajoutées, les autres sont mises à jour), supprimer les demandes faites pour tester la v2, puis mettre la v2 à l'adresse principale. L'onglet Demandes de l'appli Équipe passe alors lui aussi sur Firebase.

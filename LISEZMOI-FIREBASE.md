# Demandes de travaux – version Firebase

Même appli, avec les demandes dans **Firebase** (le projet `equipe-batiment` de l'appli Équipe) au lieu du Google Sheet.

Adresse pendant la transition : https://eurexpobatiment.github.io/travaux/v2/
L'ancienne version (https://eurexpobatiment.github.io/travaux/) continue de tourner sur le Google Sheet jusqu'à la bascule.

## Ce qui change
- **Espace Bâtiment** : plus de code partagé. On se connecte avec l'adresse e-mail et le mot de passe de l'appli Équipe. Si tu es déjà connecté à l'appli Équipe sur l'appareil, tu es connecté directement. Les personnes sans accès à l'appli Équipe (adresse non saisie dans 👥 Équipe) n'entrent pas.
- **Demandeur** : rien ne change. Pas de compte, une fiche, un numéro DT-AAAA-NNN et un lien de suivi personnel. Les anciens liens de suivi restent valables après la reprise.
- **Note interne et notes 🔒** : Firebase ne les envoie jamais au demandeur.
- **Pièces jointes** : plus rien n'est rangé automatiquement dans Drive. Les fichiers envoyés par le demandeur (ou ajoutés par le Bâtiment) sont gardés dans Firebase avec la demande. Sur la fiche, le bouton **📁 Enregistrer dans un dossier…** permet de choisir pour chaque demande le dossier de destination sur le PC (dossier Drive ou Teams synchronisé, dossier réseau…), avec un sous-dossier « DT-AAAA-NNN – intitulé » si on le souhaite. La fiche indique ensuite où les fichiers ont été rangés. Avec la case « retirer ensuite de l'appli », la copie gardée dans Firebase est effacée pour libérer de la place (offre gratuite : 1 Go). Il faut Chrome ou Edge sur PC ; ailleurs, on peut télécharger les fichiers un par un.
- Les pièces jointes des anciennes demandes restent dans leur dossier Drive actuel (liens conservés).
- **Le script Google** ne sert plus qu'à envoyer les e-mails. Avant chaque envoi, il relit la demande dans Firebase.

## Mise en route
1. **Règles Firebase** : console Firebase › projet *equipe-batiment* › Firestore Database › Règles. Remplacer tout le texte par `firestore.rules`, puis remplacer `VOTRE_EMAIL` par l'adresse du propriétaire (la même qu'aujourd'hui) et cliquer sur **Publier**. Ce fichier contient aussi les règles de l'appli Équipe, qui ne changent pas.
2. **Script Google** (Google Sheet « Demandes de travaux – Eurexpo » › Extensions › Apps Script) : remplacer le contenu par le nouveau `Code.gs`. Choisir la fonction **autoriserFirebase**, cliquer sur **Exécuter** et accepter l'accès aux « services externes ». Ensuite : **Déployer › Gérer les déploiements › ✏️ › Version : Nouvelle version › Déployer**. L'adresse /exec ne change pas.
3. Ouvrir https://eurexpobatiment.github.io/travaux/v2/#/bat, se connecter, puis cliquer sur **⇪ Reprendre le Google Sheet** (bouton visible pour les responsables) et saisir le code Bâtiment de l'ancienne version. Toutes les demandes, les échanges et les notes internes sont copiés, avec les liens vers les pièces jointes déjà dans Drive. Le Sheet n'est pas modifié.

## Bascule
Au moment de la bascule : relancer **⇪ Reprendre le Google Sheet** (les demandes arrivées entre-temps dans le Sheet sont ajoutées, les autres sont mises à jour), supprimer les demandes faites pour tester la v2, puis mettre la v2 à l'adresse principale. L'onglet Demandes de l'appli Équipe passe alors lui aussi sur Firebase.

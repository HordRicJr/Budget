# Écrans MVP — Budget

## Principes UX

- **Mobile d’abord :** actions principales accessibles au pouce, formulaires courts et adaptés au clavier numérique.
- **Compréhension avant automatisation :** toute recommandation indique son motif et l’impact chiffré.
- **Pas de modification cachée :** l’utilisateur simule, compare et confirme.
- **Progressive disclosure :** les champs courants sont visibles en premier; les détails facultatifs sont repliés.
- **Accessible :** libellés explicites, navigation clavier sur desktop, contrastes et états qui ne reposent pas uniquement sur la couleur.

## Navigation

Sur téléphone, barre inférieure à quatre entrées : **Accueil**, **Mouvements**, **Priorités**, **Plus**. Un bouton d’action « + » reste accessible pour enregistrer un mouvement. Sur ordinateur, les mêmes destinations sont présentées dans une navigation latérale.

## Écrans

### 1. Accueil — budget du mois

**But :** répondre immédiatement « combien me reste-t-il et quelles échéances approchent ? »

- Sélecteur de mois.
- Solde disponible, revenus, dépenses payées et engagements planifiés.
- Barre de budget restant et réserve pour imprévus, si l’utilisateur en définit une.
- Liste courte des prochaines échéances.
- Carte de priorité/recommandation avec lien vers son explication.
- Action principale pour ajouter un mouvement.

**États :** premier démarrage sans données, mois sans mouvement, dépassement du budget, chargement, erreur réseau.

### 2. Ajouter un revenu ou une dépense

- Choix du type : revenu ou dépense.
- Montant avec devise affichée et clavier numérique.
- Catégorie.
- Date du mouvement.
- Note et bénéficiaire/source.
- Échéance facultative et statut (payé/prévu/reporté).
- Pour une dépense liée à une dette, un abonnement ou un projet, association facultative à cet engagement.
- Validation serveur; confirmation visible avec le nouveau solde calculé.

Les champs requis confirmés par le brainstorming : montant, catégorie, note, date, bénéficiaire et échéance. Dans l’interface, note, bénéficiaire et échéance peuvent rester facultatifs afin de permettre une saisie rapide.

### 3. Mouvements — historique

- Liste chronologique filtrable par mois, type et catégorie.
- Totaux calculés côté serveur.
- Détail/modification/suppression avec confirmation avant suppression.
- Indication visuelle et textuelle du statut prévu, payé ou reporté.

### 4. Priorités — engagements

- Sections dettes, abonnements, projets et postes personnalisés.
- Coût prévu, solde restant si applicable, prochaine échéance, priorité choisie et statut.
- Détail d’un engagement : paiements liés, conséquences connues en cas de report et historique.
- Création rapide d’un engagement.

### 5. Imprévu et simulation

- Saisie de l’événement, montant, date, échéance et urgence.
- Proposition d’actions : réduire, reporter ou mettre en pause des postes éligibles.
- Comparaison « situation actuelle » / « scénario proposé » :
  - argent disponible avant/après;
  - postes modifiés et montant de chaque ajustement;
  - conséquence déclarée pour chaque réduction ou report;
  - risques/éléments inconnus explicitement signalés.
- Actions : modifier le scénario, enregistrer comme brouillon, confirmer l’application.

### 6. Recommandations

- Recommandation principale et alternatives ordonnées.
- Pour chaque option : pourquoi, montant restant, urgence, coût total connu, coût ou risque du report.
- Origine indiquée : règles budgétaires, aide de Groq, ou combinaison.
- Incertitude visible; possibilité de rejeter et de fournir une correction.
- L’IA ne réalise jamais elle-même un paiement ni une mutation financière.

### 7. Plus — réglages et vie privée

- Afficher la devise XOF et le fuseau de référence GMT+0; ces valeurs sont préconfigurées pour le MVP.
- Paramètres et accès au compte.
- Export et suppression des données (à spécifier avant lancement).
- Explication des informations envoyées à Groq et contrôle de l’activation IA.

## Parcours principaux

### Enregistrer une dépense

Accueil → « + » → montant/type/catégorie → détails facultatifs → enregistrer → solde recalculé et confirmation.

### Décider entre plusieurs besoins

Accueil → Priorités → sélectionner ou créer les engagements → comparer les conséquences → ajuster le scénario → confirmer.

### Réagir à un imprévu

Accueil → « Imprévu » → saisir coût et urgence → examiner les réductions/report proposés → comparer → confirmer ou modifier.

## Hors MVP

Import bancaire automatique, comptes partagés, notifications push avancées, application native, mode hors ligne avec synchronisation conflictuelle, comptabilité réglementaire.

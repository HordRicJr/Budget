# Plan de développement — Budget

## Approche

Livrer des tranches verticales vérifiables. Chaque tranche comprend interface, API, validation, persistance et tests ciblés. Ne pas commencer par l’intégration Groq : les règles financières doivent d’abord être fiables et testées sans IA.

## Phase 0 — Scaffold et décisions de production

1. Créer le projet React + TypeScript + Vite avec les versions exactes vérifiées et un lockfile.
2. Configurer le build Vercel : assets statiques et fonctions serveur Node sous `/api`.
3. Créer les environnements Preview et Production; brancher une base Neon distincte ou isolée pour Preview.
4. Choisir et intégrer l’authentification; centraliser la résolution du propriétaire et protéger toute route financière avant exposition publique.
5. Créer le premier compte propriétaire par un flux privé avec l'adresse courriel fournie par l'utilisateur; le mot de passe est saisi dans l'interface sécurisée et n'est jamais codé en dur ni ajouté au dépôt.
6. Configurer `GROQ_API_KEY` comme unique secret propre à Groq; conserver l'URL de base dans l'adaptateur serveur et le choix du modèle dans sa configuration.
7. Configurer XOF comme devise initiale et `Africa/Abidjan` (GMT/UTC+0) comme fuseau.
8. Vérifier HTTPS, cookies de session `HttpOnly`, `Secure`, `SameSite`, et limites de tentatives de connexion.

**Sortie attendue :** URL de Preview privée, authentification active, connexion PostgreSQL, déploiement répétable.

## Phase 1 — Fondations de données et mouvements

1. Ajouter les migrations pour `app_user`, `category` et `transaction`.
2. Implémenter les dépôts PostgreSQL avec requêtes paramétrées et filtrage obligatoire par propriétaire.
3. Créer les contrats request/response versionnés et le catalogue d'erreurs partagé consommés par l'API et le client.
4. Créer les endpoints catégories et mouvements (liste, création, modification, suppression).
5. Créer les écrans Accueil initial, Ajouter un mouvement et Historique.
6. Calculer côté serveur revenus, dépenses payées, prévu et solde disponible.
7. Écrire tests unitaires des calculs et tests API d’accès, validation et isolation du propriétaire.

**Critère de sortie :** un mouvement saisi sur un appareil est immédiatement visible après reconnexion depuis un autre.

## Phase 2 — Engagements et priorités

1. Ajouter `financial_item` et les relations transaction-engagement.
2. Ajouter gestion des dettes, abonnements, projets et postes personnalisés.
3. Rendre modifiables priorité, échéance, statut et conséquence déclarée du report.
4. Afficher échéances et engagements dans l’accueil et la vue Priorités.
5. Tester limites (montants invalides, dette soldée, échéance absente, report).

**Critère de sortie :** les engagements planifiés sont distingués des mouvements réellement payés et le solde ne double-compte pas un paiement.

## Phase 3 — Imprévus et scénarios déterministes

1. Ajouter `unexpected_event`, `scenario` et `scenario_action`.
2. Implémenter le moteur de simulation pur : état de départ + actions proposées → résultat chiffré.
3. Générer d’abord des alternatives déterministes explicables (réduire, reporter, mettre en pause).
4. Créer le parcours de simulation mobile avec comparaison avant/après.
5. Appliquer un scénario dans une transaction SQL uniquement après confirmation explicite.
6. Exiger une clé idempotente et une vérification de version pour que les retries ne doublent pas les mutations et que les écrasements concurrents soient détectés.
7. Tester invariants financiers, arrondis, échéances et atomicité de l’application.

**Critère de sortie :** aucun scénario brouillon ne modifie les données réelles; les ajustements confirmés sont traçables.

## Phase 4 — Recommandation Groq contrôlée

1. Définir un schéma versionné entrée/sortie pour recommandations.
2. Construire côté serveur un snapshot minimal : montants nécessaires, échéances, priorités et conséquences déjà fournies par l’utilisateur.
3. Envoyer au modèle uniquement les options admissibles calculées par le moteur déterministe.
4. Valider strictement la réponse; sur timeout ou réponse invalide, afficher les recommandations déterministes sans simuler un succès IA.
5. Enregistrer fournisseur/modèle, snapshot minimisé et résultat; réduire/expurger les données sensibles selon une politique choisie.
6. Ajouter limites de débit, budget d’usage et contrôle de désactivation de l’IA.

**Critère de sortie :** l’IA ne peut ni inventer un solde, ni créer une action financière hors des options admissibles, ni muter des données.

## Phase 5 — PWA, durcissement et mise en production

1. Ajouter manifeste et installation PWA mobile; cache statique uniquement dans un premier temps.
2. Ajouter gestion claire des erreurs réseau et reprise sans double soumission.
3. Définir export, suppression de compte/données et procédure de sauvegarde/restauration.
4. Vérifier accessibilité, tailles mobiles, navigation desktop et performances.
5. Tester Preview avec données synthétiques, restaurer une sauvegarde de test et vérifier les migrations.
6. Promouvoir vers Production après contrôle de sécurité, tests et revue des variables secrètes.

**Critère de sortie :** parcours complet depuis l’inscription/connexion jusqu’à l’enregistrement, la simulation et la suppression/export des données est vérifié.

## Ordre de priorité

1. Accès privé, persistance et exactitude des calculs.
2. Saisie et tableau de bord.
3. Engagements et échéances.
4. Simulation des imprévus.
5. Aide Groq.
6. Confort PWA et fonctions secondaires.

## Garde-fous de réalisation

- Chaque migration doit avoir un test de montée sur base vide et, si nécessaire, de compatibilité avec données existantes.
- Tests de domaine sans base ni appel réseau pour tous les calculs.
- Tests d’intégration en Preview sans données financières réelles.
- Les montants ne passent jamais par une représentation flottante dans les calculs métier.
- Aucun secret, snapshot financier complet ou contenu sensible ne doit apparaître dans les logs clients/serveur.
- Toute erreur de base ou de Groq est exposée clairement; l’absence d’IA ne bloque pas la consultation ou les calculs budgétaires.

## Hypothèses et points à confirmer

- Authentification d’un seul propriétaire; le fournisseur/mécanisme reste à choisir avant une URL publique.
- Une seule devise XOF et le fuseau `Africa/Abidjan` (GMT/UTC+0) au MVP.
- Pas de synchronisation hors ligne ni d’application native dans la première livraison.
- Le choix définitif des plans/prix Vercel et Neon dépend du budget et de la région souhaitée.

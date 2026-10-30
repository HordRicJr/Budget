---
title: 'Initialiser la fondation MVP Budget (React + API + PostgreSQL)'
type: 'feature'
created: '2026-10-30'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'NO_VCS'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Le projet n’a encore aucun code applicatif, alors que les décisions d’architecture et de produit sont déjà validées. Sans socle exécutable, on ne peut ni enregistrer des dépenses ni valider les règles métier de base.

**Approach:** Construire une première tranche verticale fonctionnelle: scaffold React/Vite + TypeScript, API serveur, persistance PostgreSQL, authentification propriétaire simple, et flux minimum pour créer/lister des transactions XOF. Cette tranche servira de base stable pour les phases suivantes (priorités, scénarios, recommandations).

## Boundaries & Constraints

**Always:** Respecter le spine d’architecture validé; stocker les montants en `amount_xof` entiers; utiliser `Africa/Abidjan` (GMT+0); filtrer toutes les données par propriétaire côté serveur; garder `GROQ_API_KEY` côté serveur uniquement; retourner des erreurs API cohérentes.

**Never:** Pas de SQLite en production, pas de secrets côté client, pas de multi-utilisateur dans ce lot, pas de recommandation Groq dans ce premier lot, pas de confiance dans les totaux calculés par le navigateur.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Création transaction valide | Utilisateur authentifié, payload `kind/category/amount_xof/occurred_on` valide | Transaction créée et liée au propriétaire, `201` + DTO normalisé | N/A |
| Montant invalide | `amount_xof <= 0` | Aucune écriture BD | `400` avec code d’erreur métier |
| Accès non authentifié | Pas de session valide | Aucune donnée exposée | `401` |
| Tentative d’accès autre propriétaire | ID étranger injecté dans requête | Ignoré/rejeté; aucune fuite | `403` ou `404` selon contrat d’erreur retenu |

</frozen-after-approval>

## Code Map

- `_bmad-output/planning-artifacts/architecture/architecture-Budget-2026-10-29/ARCHITECTURE-SPINE.md` -- invariants techniques obligatoires (AD-1 à AD-10).
- `_bmad-output/planning-artifacts/architecture/architecture-Budget-2026-10-29/PROJECT-STRUCTURE.md` -- structure cible des dossiers pour le scaffold.
- `_bmad-output/planning-artifacts/architecture/architecture-Budget-2026-10-29/DATABASE-SCHEMA.md` -- base du schéma SQL MVP (XOF, owner isolation, idempotence).
- `_bmad-output/planning-artifacts/architecture/architecture-Budget-2026-10-29/DEVELOPMENT-PLAN.md` -- ordonnancement des phases; ce lot couvre Phase 0 + début Phase 1.
- `package.json` -- à créer; scripts build/test/lint et dépendances.
- `src/` -- à créer; application React mobile-first.
- `api/` -- à créer; endpoints serveur pour auth minimale, catégories, transactions.
- `server/domain/` -- à créer; règles de validation/calcul indépendantes du framework.
- `server/repositories/` -- à créer; seul point SQL PostgreSQL.
- `db/migrations/` -- à créer; migration initiale (`app_user`, `category`, `transaction`).
- `tests/` -- à créer; tests domaine + API ciblés sur les règles critiques.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `tsconfig*.json`, `vite.config.ts` -- initialiser le projet React/Vite TypeScript + scripts standard de développement/build/test -- fournir une base exécutable.
- [x] `src/ui/*`, `src/lib/api-client.ts`, `src/contracts/*` -- créer le tableau de bord mobile-first, la connexion, la saisie et la liste des mouvements avec contrats DTO -- aligner client et API.
- [x] `api/*` -- créer endpoints de connexion/session propriétaire, catégories et liste/création des transactions -- activer le premier flux fonctionnel.
- [x] `api/_lib/auth.js`, `api/auth/*`, `scripts/create-owner.js` -- implémenter sessions serveur et initialisation privée d'un propriétaire; aucune inscription publique ni secret codé en dur.
- [x] `server/domain/*` -- implémenter validation métier XOF/date et bornes mensuelles déterministes.
- [x] `api/_lib/db.js`, `api/*` -- implémenter accès PostgreSQL paramétré et filtrage des transactions par propriétaire; le branchement avec une base hébergée reste à effectuer au déploiement.
- [x] `db/migrations/001_initial.sql` -- créer le schéma initial du propriétaire, catégories, transactions et sessions.
- [x] `.env.example`, `README.md` -- documenter les noms de variables et la procédure de configuration sans enregistrer de secrets.
- [x] `tests/domain/*`, `api/transactions.test.js` -- couvrir validation de montant/date, auth obligatoire, isolation du propriétaire et création/listing.

**Acceptance Criteria:**
- Given un utilisateur propriétaire authentifié, when il crée une transaction XOF valide, then l’API persiste la ligne en base PostgreSQL et la retourne dans la liste du mois.
- Given une requête sans session valide, when elle appelle un endpoint transaction, then l’API refuse l’accès sans exposer de données.
- Given un montant nul ou négatif, when la création est appelée, then l’API rejette avec erreur métier explicite et n’écrit rien.
- Given deux sessions différentes, when chacune liste ses transactions, then chaque session ne voit que ses propres données.
- Given l’environnement de développement initialisé, when `npm run build` et les tests ciblés sont lancés, then la compilation et les vérifications de base passent.

## Implementation Notes

- Créés : shell React/Vite, API Node compatible Vercel, API locale de développement, schéma PostgreSQL, connexion propriétaire et commande d’initialisation interactive qui n’expose pas le mot de passe.
- Le tableau de bord est mobile-first, garde la déconnexion accessible sur téléphone, distingue les revenus prévus et charge l’historique par pages de 100 mouvements.
- Les contrôles renforcés comprennent l’association catégorie/propriétaire au niveau SQL, la limitation des tentatives par compte, le nettoyage des sessions expirées, l’ordre des mouvements selon leur date effective et le rejet des agrégats hors précision entière sûre.
- Tests couvrent la connexion réussie, l’accès non authentifié (401), le montant invalide sans écriture, l’isolation catégorie/propriétaire, les bornes mensuelles dans les deux requêtes, les buckets d’agrégats, la pagination, les cookies malformés et la limite de requête en octets UTF-8.
- Vérification de la base réelle non exécutée : aucune `DATABASE_URL` n’est configurée; appliquer la migration dans Neon/Vercel avant le premier login.

## Spec Change Log

## Review Triage Log

Chaque constat des trois couches est conservé ci-dessous. Les doublons sont triés séparément; les faux positifs indiquent le garde-fou précis qui invalide le scénario.

| ID | Verdict | Route | Vérification et décision |
|---|---|---|---|
| BH-1 | medium | patch | La FK initiale ne liait que `category_id`; une écriture SQL hors API pouvait associer un propriétaire à la catégorie d’un autre. La migration lie maintenant `(category_id, owner_id)` à la clé composite de catégorie. |
| BH-2 | false | rejeté | `X-Forwarded-Host` ne peut pas remplacer l’hôte dans la comparaison corrigée; un test vérifie qu’un en-tête transféré falsifié ne valide pas une origine externe. |
| BH-3 | medium | patch | `X-Forwarded-For` était intégré à la clé de limitation et pouvait être varié par un client direct. La clé est désormais fondée sur le compte, indépendamment de cet en-tête. |
| BH-4 | false | rejeté | Les lignes de limitation de plus de 30 jours sont supprimées à chaque tentative de connexion; elles ne s’accumulent donc pas indéfiniment quand le service est sollicité. |
| BH-5 | low | patch | Les sessions expirées n’étaient nettoyées par aucune requête. Leur suppression est maintenant faite lors de la création d’une session, en s’appuyant sur l’index d’expiration. |
| BH-6 | medium | patch | Les éléments non payés étaient filtrés selon leur échéance mais ordonnés selon leur date d’origine. Le tri utilise maintenant la même date effective que le filtre mensuel. |
| BH-7 | false | rejeté | Les totaux bigint convertis au-delà de la plage sûre deviennent des nombres non sûrs; `Number.isSafeInteger` les détecte et l’API les refuse déjà. |
| BH-8 | low | patch | Le libellé du solde pouvait laisser croire que les revenus attendus augmentaient l’argent disponible. Il précise désormais que les revenus non encaissés sont exclus; ils restent affichés séparément. |
| BH-9 | false | rejeté | Les liens `#overview` et `#movements` pointent vers des sections existantes et la navigation native du navigateur les fait défiler; Priorités est explicitement désactivé et hors de cette tranche. |
| BH-10 | low | patch | Une réponse HTTP non JSON faisait remonter uniquement l’erreur de parsing. Le client signale désormais explicitement une réponse invalide avec son statut HTTP. |
| BH-11 | false | rejeté | `GET /api/auth/me` ne modifie aucun état; la politique SameSite et l’absence de CORS empêchent un site tiers de lire son corps. L’absence de vérification d’origine ne permet pas de mutation CSRF. |
| ECH-1 | false | rejeté | `readJson` mesure les octets et vérifie le plafond avant d’ajouter chaque chunk à la chaîne accumulée; la taille de chaîne reste donc bornée par le plafond et le chunk courant. |
| ECH-2 | false | rejeté | `auth_session.owner_id` est `NOT NULL` et référence `app_user`; une session persistée avec un propriétaire nul est refusée par PostgreSQL. |
| ECH-3 | medium | patch | Même scénario de rotation de `X-Forwarded-For` que BH-3; la limitation par compte couvre maintenant ce contournement. |
| ECH-4 | false | rejeté | Le code supprime l’entrée de throttle avant de créer la session; il n’appelle pas `deleteSession` et ne peut pas suspendre une réponse après l’avoir créée. Une erreur de base est propagée comme erreur serveur. |
| ECH-5 | false | rejeté | Le hash enregistré n’est comparé que si son sel et son contenu correspondent exactement à 32 et 128 caractères hexadécimaux; la longueur transmise à `timingSafeEqual` est donc fixe. |
| ECH-6 | medium | patch | Chaque agrégat peut être sûr isolément alors que leur soustraction cumulée ne l’est pas. L’API vérifie aussi le solde calculé et renvoie `422` si celui-ci sort de la plage sûre. |
| ECH-7 | false | rejeté | L’offset est borné à 1 000 000 et la page à 100 éléments; `nextOffset` ne peut pas approcher la limite des entiers sûrs. |
| ECH-8 | false | rejeté | L’échéance est facultative dans les écrans validés; une transaction sans échéance est rattachée à sa date de mouvement pour le filtre mensuel. |
| ECH-9 | false | rejeté | Le champ échéance vide est volontairement accepté comme absence d’échéance par la validation, puis normalisé en `NULL` avant l’insertion. |
| ECH-10 | false | rejeté | La colonne nullable `due_on` correspond au caractère facultatif de l’échéance; elle ne contredit aucune règle retenue. |
| ECH-11 | false | rejeté | La FK catégorie utilise `ON DELETE RESTRICT`; une catégorie liée ne peut pas être supprimée et la jointure ne fait pas disparaître un mouvement valide. |
| ECH-12 | false | rejeté | Le scénario avec `owner_id` nul est exclu par les contraintes SQL `NOT NULL` et la FK de session; l’API utilise le propriétaire retourné par cette session. |
| ECH-13 | false | rejeté | La date d’échéance n’est pas obligatoire selon les écrans MVP; le fallback vers `occurred_on` est la règle déjà utilisée pour les transactions sans échéance. |
| VG-1 | medium | patch | Les totaux de test étaient fournis en dur par le mock sans contrôler la logique SQL. Le test vérifie maintenant les quatre filtres `kind/status`, la sélection mensuelle, le fallback d’échéance et le tri de date effective; une validation sur PostgreSQL réel reste bloquée par l’absence de `DATABASE_URL`. |

## Verification

**Commands:**
- `npm run build` -- attendu : build frontend + vérification TypeScript sans erreur
- `npm test` -- attendu : tests domaine/API critiques passent
- `npm audit --omit=dev --audit-level=high` -- attendu : aucune vulnérabilité haute ou critique dans les dépendances de production

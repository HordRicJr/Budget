---
title: 'Compléter Budget avec engagements, arbitrages et recommandations'
type: 'feature'
created: '2026-10-30'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'NO_VCS'
context:
  - D:/Budget/_bmad-output/planning-artifacts/architecture/architecture-Budget-2026-10-29/ARCHITECTURE-SPINE.md
  - D:/Budget/_bmad-output/planning-artifacts/architecture/architecture-Budget-2026-10-29/DATABASE-SCHEMA.md
  - D:/Budget/_bmad-output/planning-artifacts/architecture/architecture-Budget-2026-10-29/MVP-SCREENS.md
  - D:/Budget/_bmad-output/planning-artifacts/architecture/architecture-Budget-2026-10-29/DEVELOPMENT-PLAN.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Le socle suit les mouvements, mais ne permet pas de gérer les engagements ni d’arbitrer face aux imprévus. Le parcours de décision demandé est incomplet.

**Approach:** Ajouter engagements, priorités, imprévus, simulations explicables et recommandations Groq facultatives, ainsi que PWA en ligne et export, en conservant l’authentification et PostgreSQL.

## Boundaries & Constraints

**Always:** Mobile-first, privé, mono-propriétaire; XOF entiers, fuseau `Africa/Abidjan`; calculs côté serveur; migration additive; contrôler propriétaire, version et montants; actions déterministes explicables; confirmation explicite avant mutation; à Groq, transmettre seulement le contexte agrégé autorisé, jamais notes, bénéficiaires ou historique brut; clé Groq côté serveur.

**Never:** Pas de multi-utilisateur, conversion, import bancaire, écriture hors ligne, déploiement automatique, réécriture de migration appliquée ou mot de passe dans le dépôt.

**Décision sur la suppression :** ne pas offrir de suppression automatique du compte; traiter les demandes manuellement avant la mise en production.

## I/O & Edge-Case Matrix

| Scénario | Entrée / état | Résultat attendu | Erreur |
|---|---|---|---|
| Créer un engagement | Données valides | Engagement créé; échéance et priorité visibles | Rejeter date, type ou montant invalide |
| Simuler un imprévu | Événement et engagements actifs | Options comparées avec solde avant/après et conséquences | Aucune mutation |
| Confirmer un scénario | Brouillon, version actuelle, clé idempotente | Application atomique; un retry retourne le même résultat | `409` si données périmées; aucun effet partiel |
| Groq indisponible | Clé absente, timeout ou réponse invalide | Options déterministes maintenues, source indiquée | Pas de faux succès ni mutation |
| Exporter | Propriétaire connecté | Export privé de ses seules données | Refus explicite en cas d’erreur |

</frozen-after-approval>

## Code Map

- `api/transactions.js`, `api/categories.js`, `api/_lib/auth.js` -- réutiliser handlers, sessions et filtrage propriétaire.
- `db/migrations/001_initial.sql` -- ne pas réécrire; ajouter tables et contraintes dans une nouvelle migration.
- `server/domain/transactions.js` -- réutiliser validation date/montant; ajouter domaines purs.
- `server/dev.js`, `src/lib/api-client.ts`, `src/contracts/api.ts` -- étendre routage et contrats communs.
- `src/ui/App.tsx`, `src/ui/styles.css`, `src/main.tsx`, `index.html` -- intégrer vues et PWA sans casser les mouvements.
- `api/*test.js`, `server/domain/*test.js` -- tests `node:test`, mocks SQL et règles pures.
- `scripts/create-owner.js`, `README.md`, `.env.example` -- conserver l’initialisation privée et documenter sans secret.

## Tasks & Acceptance

**Execution:**
 - [x] `db/migrations/002_financial_planning.sql` -- ajouter tables, relations propriétaires, index et idempotence sans toucher à `001`.
 - [x] `server/domain/obligations.js`, `scenarios.js`, `recommendations.js` -- implémenter validations, simulations et classement déterministes testables.
 - [x] `api/financial-items.js`, `unexpected-events.js`, `scenarios.js`, `recommendations.js`, `export.js` -- exposer CRUD privé, simulation et export.
 - [x] `server/providers/groq.js`, `api/_lib/*` -- intégrer timeout, limitation, contexte minimisé et réponse stricte; fallback déterministe.
 - [x] `src/contracts/api.ts`, `src/lib/api-client.ts`, `server/dev.js` -- aligner contrats, client et routage local/Vercel.
 - [x] `src/ui/*`, `public/manifest.webmanifest`, `public/sw.js`, `index.html` -- créer vues, contrôle IA et PWA; ne jamais mettre en cache de données financières.
 - [x] `api/**/*.test.js`, `server/domain/**/*.test.js`, `README.md`, `.env.example` -- tester sécurité/invariants/retries/Groq et documenter migrations/configuration.

**Acceptance Criteria:**
- Given un propriétaire connecté, when il crée ou modifie un engagement, then priorité, conséquences et échéance sont persistées sous son propriétaire.
- Given des mouvements et engagements enregistrés, when un imprévu est simulé, then plusieurs choix admissibles affichent leurs impacts exacts en XOF et aucun ne modifie les données réelles avant confirmation.
- Given un scénario confirmé, when le même appel est rejoué ou si une version concurrente a changé, then l’effet est appliqué au plus une fois ou rejeté sans écriture partielle.
- Given Groq désactivé ou en échec, when l’utilisateur demande une aide, then les choix déterministes restent disponibles et aucun secret ni détail personnel non autorisé ne quitte le serveur.
- Given l’application est installée sur téléphone, when le réseau est indisponible, then aucune écriture financière n’est mise en cache ou présentée comme sauvegardée.
- Given une demande d’export autorisée, when elle est confirmée, then seules les données du propriétaire sont exportées; la suppression de compte reste manuelle avant production.
- Given une `DATABASE_URL` et, facultativement, une `GROQ_API_KEY` valides, when les migrations, tests et build sont exécutés, then les parcours sans IA comme avec IA configurée passent; sans ces secrets, la validation locale reste possible et le blocage de service est explicite.

## Implementation Notes

La migration additive `002_financial_planning.sql` ajoute engagements, imprévus, scénarios, actions, recommandations, limitation Groq et idempotence; `001_initial.sql` est inchangée. Les routes financières résolvent le propriétaire depuis la session. Les simulations sont pures; la confirmation verrouille et revalide les versions dans une instruction PostgreSQL atomique, puis conserve la réponse idempotente. Les paiements liés sont déduits du montant planifié afin d’éviter le double comptage. Le classement Groq est facultatif, borné et validé; les recommandations déterministes restent disponibles. La PWA ne met en cache que le shell et les ressources statiques. L’export exige une confirmation et ne comprend que les données du propriétaire.

Le compte, la base PostgreSQL, les secrets Groq et la publication ne sont pas provisionnés par le code. L’absence de `DATABASE_URL` et de `GROQ_API_KEY` dans cet environnement permet de tester les parcours hors intégration, mais bloque les vérifications réelles de migration, de connexion Groq et de persistance.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Preuve et décision |
|---|---|---|
| La liste de colonnes de `ON DELETE SET NULL (scenario_id)` rendrait la migration invalide. | false | PostgreSQL 15+ prend en charge les listes de colonnes pour les actions `SET NULL`; la contrainte composite conserve donc `owner_id`. Référence : documentation PostgreSQL 15, `CREATE TABLE`. |
| Le fournisseur Groq contient une erreur de syntaxe JavaScript. | false | `node --check server/providers/groq.js` et l’import du module réussissent; l’affichage antérieur de l’en-tête était masqué, pas le contenu du fichier. |
| Les additions de montants de simulation peuvent perdre de la précision entière. | medium — patch | Le calcul intermédiaire est fait en `BigInt` et une régression teste le cas dépassant temporairement la précision sûre; tests de domaine réussis. |
| Des options déficitaires pourraient être envoyées à Groq et présentées comme finançables. | medium — patch | L’appel ne transmet que `admissibleCandidates`; le test vérifie l’exclusion du candidat déficitaire. |
| Les mises à jour d’engagements pourraient accepter silencieusement des champs inconnus. | medium — patch | La validation rejette les clés inconnues dans l’API et le domaine; le test confirme le rejet avant lecture ou écriture. |
| Le classement des engagements ne serait pas stable. | false | Le tri applique des critères déterministes de priorité, échéance et libellé; le test du classement passe et le tri JavaScript est stable pour les égalités restantes. |
| Les candidats ou leurs métadonnées seraient insuffisamment validés. | false | L’API valide l’identifiant d’événement et le mois; les montants, statuts, priorités et périodicités chargés depuis PostgreSQL sont aussi bornés par les contraintes de schéma, et le domaine vérifie les montants avant calcul. |
| La fenêtre temporelle du budget inclurait des échéances futures hors du mois choisi. | false | Les requêtes excluent les échéances à partir du premier jour du mois suivant. Les échéances antérieures non soldées restent incluses comme obligations en retard; elles ne deviennent pas des dépenses payées. |
| Une réponse Groq volumineuse serait entièrement lue et analysée avant contrôle de taille. | medium — patch | Le fournisseur lit maintenant le flux avec une limite de 32 Kio (et contrôle `Content-Length`); le test confirme le repli déterministe avant parsing d’une réponse trop grande. |
| La normalisation des notes d’imprévu serait incohérente entre création et mise à jour. | false | Les deux chemins valident la longueur et enregistrent `note.trim()`; aucune divergence de nettoyage n’est présente. |
| La migration et la persistance n’ont pas été exercées sur PostgreSQL réel. | maybe-false — medium non vérifié, defer | Le code ne dispose pas d’une `DATABASE_URL`; le moteur Docker local est indisponible. Une base PostgreSQL Preview et l’exécution des migrations sont nécessaires pour conclure sur l’intégration réelle. |

## Design Notes

- Un engagement porte les montants planifiés; une transaction reste la source de vérité d’un mouvement réellement effectué. Lier une transaction à un engagement ne doit jamais compter le paiement deux fois.
- Le moteur serveur crée une liste fermée d’actions admissibles (réduire, reporter, mettre en pause, affecter); l’IA peut seulement ordonner ou expliquer ces options.
- Le service worker peut mettre en cache le shell statique, jamais les réponses API, sessions, exports ou données budgétaires.

## Verification

**Commands:**
- `npm test` -- attendu : tests de domaine, API et sécurité passent
- `npm run build` -- attendu : vérification TypeScript et build de production réussis
- `npm audit --omit=dev --audit-level=high` -- attendu : aucune vulnérabilité haute/critique
- Validation PostgreSQL de migrations et intégration -- attendue uniquement avec base Preview fournie; documenter l’absence de secret plutôt que simuler ce contrôle.

**Résultats :**
- `npm test` : réussi, 50 tests, aucun échec.
- `npm run build` : réussi.
- `npm audit --omit=dev --audit-level=high` : réussi, 0 vulnérabilité.
- `node --check server/providers/groq.js` et import du module Groq : réussis.
- Smoke test de prévisualisation : `/`, manifeste, icône SVG et service worker répondent HTTP 200; la route API est explicitement network-only dans le service worker.
- PostgreSQL/Neon et appel Groq réel : non testés, car `DATABASE_URL` et `GROQ_API_KEY` sont absents. Le démon Docker est indisponible et aucune migration n’a été appliquée sur une base.

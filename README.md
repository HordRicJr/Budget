# Budget

Application personnelle de suivi mensuel des revenus et dépenses en XOF, conçue pour le téléphone et l’ordinateur.

## Développement local

Prérequis : Node.js 24 LTS et npm.

1. Copier `.env.example` vers `.env`, puis renseigner `DATABASE_URL` avec l’URL PostgreSQL et, facultativement, `GROQ_API_KEY` avec la clé API Groq.
2. Garder `.env` sur cette machine : il est ignoré par Git. Ne jamais coller ces valeurs dans le code ou les partager dans le chat.
3. Créer/configurer la base et exécuter les migrations listées ci-dessous avant le premier démarrage authentifié.

```powershell
npm install
npm run dev:all
```

Ouvrir l’URL Vite affichée dans le terminal. L’API locale écoute sur `http://127.0.0.1:3000` et le frontend relaie `/api` vers cette API.
Le serveur API local et `npm run owner:create` chargent automatiquement les variables du fichier `.env`. Les tests et le build ne nécessitent pas ces secrets; les tests simulés ne valident pas la connexion réelle à Groq ou PostgreSQL.

## PostgreSQL et premier compte

1. Créer une base PostgreSQL managée (Neon via Vercel Marketplace est prévu).
2. Appliquer les migrations dans l’ordre : `db/migrations/001_initial.sql`, puis `db/migrations/002_financial_planning.sql`. Ne pas réexécuter une migration déjà appliquée.
3. Vérifier que `DATABASE_URL` est renseignée dans `.env`, puis lancer dans PowerShell :

   ```powershell
   npm run owner:create
   ```

4. Saisir l’adresse courriel et un nouveau mot de passe lorsqu’ils sont demandés. La commande refuse de créer un second compte et n’affiche ni n’écrit le mot de passe.

Le compte propriétaire est créé uniquement par cette commande d’administration. La page de connexion ne permet pas une inscription publique. Sans `DATABASE_URL`, les tests et le build restent exécutables, mais les parcours authentifiés nécessitent une base configurée.

## Engagements et arbitrages

- Les dettes, abonnements, projets et postes personnalisés sont des engagements planifiés distincts des mouvements réellement payés. Une dépense peut être liée à un engagement; les paiements liés sont déduits des montants planifiés pour éviter un double comptage.
- Les imprévus se simulent sans modifier les données financières. Les options non couvrables affichent le déficit et ne peuvent pas être confirmées. La confirmation verrouille et vérifie les versions, enregistre le scénario et ses actions dans une seule instruction atomique et exige une clé idempotente.
- Groq est facultatif. Définir `GROQ_API_KEY` uniquement dans l’environnement serveur. La demande n’envoie ni note, ni bénéficiaire, ni historique brut, ni identifiant d’engagement; les règles déterministes restent disponibles si Groq est désactivé, limité, indisponible ou renvoie une réponse invalide.
- L’export JSON est privé et exige une confirmation dans l’interface. Aucun endpoint de suppression automatique du compte n’est proposé; une demande est traitée manuellement avant la mise en production.
- La PWA ne met en cache que le shell et les ressources statiques. Les routes `/api`, sessions, exports et données financières ne sont jamais mises en cache. Les mutations sont désactivées hors connexion.

## Vérifications

```powershell
npm run build
npm test
npm audit --omit=dev --audit-level=high
```

## Déploiement Vercel

- Connecter le dépôt à Vercel et provisionner PostgreSQL via Marketplace.
- Configurer les valeurs de connexion fournies par le fournisseur uniquement dans les variables serveur Vercel.
- Appliquer les migrations avant d’exposer l’application et lancer `npm run owner:create` une seule fois depuis un terminal privé connecté à la base de production choisie.
- Déployer une Preview privée avant Production et utiliser une base distincte pour Preview.
- La seule variable propre à Groq est `GROQ_API_KEY`; elle ne sera nécessaire qu’à l’intégration des recommandations, pas pour le suivi des transactions.

Ne jamais placer de mot de passe, d’URL de base réelle ou de clé Groq dans Git, les fichiers de migration ou le bundle navigateur. Les montants sont des francs CFA XOF entiers et les mois sont interprétés selon `Africa/Abidjan` (GMT+0).

# Structure du projet — Budget

## Décision de déploiement

**Proposition retenue :** Vercel héberge l’application React/Vite et les fonctions Node côté serveur. Une base PostgreSQL persistante, provisionnée via le Vercel Marketplace (Neon recommandé), conserve les données partagées entre le téléphone et l’ordinateur. Groq est appelé uniquement depuis le serveur.

Vercel sait servir des fonctions Node.js et des applications Vite. En revanche, le système de fichiers d’une fonction n’est pas une base persistante : SQLite dans les fichiers de déploiement n’est donc pas le stockage de production retenu.

## Arborescence proposée

```text
budget/
├── api/                         # Fonctions serveur Vercel, adaptateurs HTTP minces
│   ├── dashboard.ts
│   ├── transactions/
│   │   ├── index.ts             # GET liste / POST création
│   │   └── [id].ts              # GET / PATCH / DELETE
│   ├── obligations/
│   │   └── [id].ts
│   ├── unexpected-events.ts
│   ├── scenarios.ts
│   └── recommendations.ts
├── src/
│   ├── app/                     # Entrée React, routage, layouts
│   ├── features/
│   │   ├── dashboard/
│   │   ├── transactions/
│   │   ├── obligations/
│   │   ├── scenarios/
│   │   └── recommendations/
│   ├── components/              # Composants UI réutilisables
│   ├── lib/
│   │   ├── api-client.ts
│   │   └── formatters.ts
│   ├── contracts/               # Schémas versionnés des DTO et erreurs API
│   └── styles/
├── server/
│   ├── auth/                     # Session et résolution de l’utilisateur
│   ├── domain/
│   │   ├── budget.ts
│   │   ├── priorities.ts
│   │   ├── scenarios.ts
│   │   └── recommendations.ts
│   ├── repositories/             # Accès PostgreSQL et transactions DB
│   ├── providers/
│   │   └── groq.ts
│   └── validation/               # Schémas d’entrée et de sortie
├── db/
│   ├── migrations/
│   └── seed/
├── tests/
│   ├── domain/
│   ├── api/
│   └── database/
├── public/                       # Icônes, manifeste PWA
├── .env.example                  # Noms de variables seulement, jamais de valeurs secrètes
├── package.json
├── vite.config.ts
└── vercel.json                   # Uniquement si le routage SPA l’exige
```

### Règles de structure

- `api/` traduit HTTP vers les services; aucune règle financière importante ne vit dans les handlers.
- `server/domain/` contient les calculs déterministes et ne dépend ni de React, ni de Vercel, ni de Groq.
- `server/repositories/` est le seul emplacement qui exécute des requêtes SQL.
- `server/providers/groq.ts` isole l’API externe et valide ses réponses avant usage.
- `src/contracts/` détient les schémas canoniques request/response consommés par le client et les handlers serveur; le catalogue d’erreurs API y est commun.
- `src/` appelle l’API par `api-client.ts`; il ne contient ni clé Groq ni accès direct à PostgreSQL.
- Les fichiers déployés sont sans état durable. PostgreSQL est la source de vérité.

## Configuration et déploiement

Secret Groq requis côté serveur :

```text
GROQ_API_KEY=
```

L'URL Groq est fixe dans l'adaptateur serveur (`https://api.groq.com/openai/v1`) et le modèle est choisi dans la configuration serveur, pas dans une variable secrète Groq. L'intégration PostgreSQL Vercel Marketplace fournit les variables de connexion de base de données : elles ne sont pas des variables Groq. Le fournisseur d'authentification retenu apportera sa propre configuration si nécessaire.

Le projet Vercel a au minimum deux environnements séparés : Preview et Production. Chaque environnement possède sa propre clé Groq et sa propre base (ou branche isolée). Les migrations sont appliquées de façon contrôlée avant le déploiement qui dépend d’elles. `.env.example` documente uniquement les noms de variables nécessaires, jamais leurs valeurs.

Le premier compte propriétaire sera créé via un flux d'inscription/invitation privé après l'implémentation de l'authentification. Le mot de passe sera saisi directement dans ce flux et géré par le fournisseur d'authentification; aucun mot de passe par défaut ne sera stocké dans le dépôt, les migrations ou les documents.

## Références techniques consultées

- [Vite sur Vercel](https://vercel.com/docs/frameworks/frontend/vite)
- [Fonctions Node.js sur Vercel](https://vercel.com/docs/functions/runtimes/node-js)
- [Stockage Vercel et bases Marketplace](https://vercel.com/docs/storage)
- [Neon sur Vercel Marketplace](https://vercel.com/marketplace/neon)
- [Pilote serverless Neon](https://neon.com/docs/serverless/serverless-driver)
- [API Groq — overview](https://console.groq.com/docs/overview)

La documentation officielle Groq présente une API compatible OpenAI, l'endpoint de base `https://api.groq.com/openai/v1`, la variable serveur `GROQ_API_KEY` et l'API Responses. Les versions exactes des dépendances seront verrouillées dans le lockfile au moment du scaffold; la connectivité au registre npm était intermittente pendant la vérification.

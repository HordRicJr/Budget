---
title: 'Configurer les secrets locaux pour tester Budget'
type: 'chore'
created: '2026-10-30'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context:
  - D:/Budget/.env.example
  - D:/Budget/.gitignore
  - D:/Budget/package.json
  - D:/Budget/README.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** L’utilisateur a besoin d’un fichier local non versionné pour ajouter sa clé Groq et la connexion PostgreSQL afin de tester l’application.

**Approach:** Créer `.env` avec les variables documentées, charger ce fichier au démarrage de l’API locale, et expliquer la configuration et les limites des tests dans le README.

</frozen-after-approval>

## Implementation Notes

`GROQ_API_KEY` est facultative et sert uniquement aux recommandations IA. `DATABASE_URL` est nécessaire aux parcours authentifiés et à l’application des migrations. Ne jamais afficher ni inclure ces valeurs dans le dépôt. Utiliser l’option Node `--env-file-if-exists` afin que le serveur fonctionne aussi lorsque `.env` est absent.

Le fichier `.env` local a été créé avec les deux variables vides; `.gitignore` exclut déjà `.env`. Les scripts `dev:api` et `owner:create` chargent maintenant le fichier avec Node 24. Le README indique comment le remplir et précise que tests/build seuls ne valident pas les intégrations réelles. Vérifications : 50 tests réussis, build réussi, lecture du fichier .env validée sans exposer de valeur; revue ciblée sans constat.

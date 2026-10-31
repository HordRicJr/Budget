---
title: 'Exclure les tests des fonctions Vercel'
type: 'bugfix'
created: '2026-10-31'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problème :** les fichiers de tests présents dans `api/` peuvent être interprétés par Vercel comme des fonctions serverless lors du déploiement.

**Approche :** exclure les fichiers `*.test.js` du contexte envoyé à Vercel, sans déplacer les tests ni modifier leur exécution locale.

</frozen-after-approval>

## Implementation Notes

Ajout de `.vercelignore` à la racine pour exclure les tests sous `api/` du déploiement uniquement. Les tests restent suivis par Git et exécutés localement. Vérifications : `npm test` (50 réussis) et `npm run build` (réussi). Le déploiement Vercel distant reste à relancer pour confirmer le comportement sur la plateforme.

## Review Triage Log

- false — Les tests `*.test.js` existants sont tous couverts; aucune extension de test différente n’existe sous `api/`.
- false — Les autres tests sont sous `server/domain/`, en dehors du dossier de fonctions `api/`; ils ne sont pas publiés comme des fonctions API.
- false — Les tests et le build ont été exécutés avec succès. Une validation du déploiement distant reste nécessaire après publication du correctif.
- false — Les handlers Vercel existants sont sous `api/`; étendre l’exclusion à d’autres dossiers risquerait de masquer une portée non requise.
- false — L’exclusion de fichiers de test du déploiement ne change ni le build local ni le lancement des tests, vérifiés tous les deux.

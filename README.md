# Explorateur de séismes (Athena AI + MCP)

Un agent **Athena AI** qui affiche les **séismes récents dans le monde** à partir des
**données en direct de l'USGS**, à travers un **serveur MCP**, dans un **widget interactif**
intégré à la conversation.

## Source de données

- **API :** USGS Earthquake Hazards Program (publique, sans clé)
- **Point d'accès :** `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_{periode}.geojson`

## Fonctionnement

1. L'utilisateur demande par exemple « Montre-moi les séismes de la semaine au Japon ».
2. Athena appelle l'outil MCP `chercher_seismes` (`periode`, `magnitudeMin`, `lieu`).
3. Le serveur interroge l'USGS (avec un cache de 60 s et un nouvel essai en cas d'erreur),
   filtre, trie et renvoie les données (`structuredContent`).
4. Athena affiche le widget `ui://widget/donnees.html` avec ces données.

## Interactions du widget

- **Lieu** (champ texte), **Période** et **Magnitude min.** (menus) : relancent la recherche
  sur l'USGS via `window.openai.callTool`.
- **Pastilles de magnitude** cliquables (Majeur, Fort, Modéré, Léger) avec compteurs : filtrent la liste.
- **Mini-carte** cliquable, **recherche** texte, **tri** (magnitude, date, nom).
- **Clic** sur un séisme : détails (profondeur, ressenti, alerte tsunami) et lien vers la fiche USGS.

## Lancer en local

```bash
npm install
npm run dev               # http://localhost:8787/mcp
npm run inspector         # tester l'outil avec MCP Inspector
ngrok http 8787 --url https://VOTRE-DOMAINE.ngrok-free.dev
```

## Structure

| Fichier | Rôle |
| --- | --- |
| `server.js` | Serveur MCP : déclare le widget (ressource `text/html+skybridge`) et l'outil, appelle l'USGS |
| `public/widget.html` | Widget HTML/CSS/JS affiché dans Athena (`window.openai`) |
| `package.json` | Dépendances (`@modelcontextprotocol/sdk`, `zod`) et scripts |

## Projet lié

Même architecture appliquée à la cybersécurité : <https://github.com/Dhiya-Lamamra/athena-defi>

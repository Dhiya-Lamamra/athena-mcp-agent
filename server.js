// =====================================================================
//  Agent Athena AI : Explorateur de séismes récents
//  - serveur MCP qui expose l'outil chercher_seismes (données USGS)
//  - renvoie les données avec un widget interactif (public/widget.html)
//
//  Pour changer de sujet, modifie surtout la section « SUJET ».
// =====================================================================

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT ?? 8787);
const MCP_PATH = "/mcp";

// Adresse interne du widget. Change le nom du fichier .html si tu veux,
// mais garde le préfixe ui://
const WIDGET_URI = "ui://widget/donnees.html";

// On lit le widget au démarrage. Redémarre le serveur après l'avoir modifié
// (ou lance `npm run dev`, qui redémarre tout seul).
const widgetHtml = readFileSync(new URL("./public/widget.html", import.meta.url), "utf8");

// =====================================================================
//  SUJET : Explorateur de séismes récents
//  Source : USGS Earthquake Hazards Program (API publique, sans clé)
//  Doc : https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
// =====================================================================

const TOOL_NAME = "chercher_seismes";

const TOOL_CONFIG = {
  title: "Chercher les séismes récents",
  // La description est lue par l'IA pour décider QUAND appeler l'outil.
  description:
    "Récupère les séismes récents dans le monde (données réelles de l'USGS), filtrés par période, " +
    "magnitude minimale et lieu, et les affiche dans un widget interactif (carte, liste, filtres). " +
    "À utiliser quand l'utilisateur parle de séismes, tremblements de terre ou activité sismique.",
  inputSchema: {
    periode: z
      .enum(["hour", "day", "week", "month"])
      .default("week")
      .describe("Période couverte : hour, day, week ou month"),
    magnitudeMin: z
      .number()
      .min(0)
      .max(10)
      .default(2.5)
      .describe("Magnitude minimale des séismes à garder"),
    lieu: z
      .string()
      .max(60)
      .default("")
      .describe("Mot à chercher dans le lieu, en anglais (ex. Japan, Alaska, Chile). Vide = monde entier"),
  },
};

// Les contrôles du widget. Changer l'un d'eux rappelle l'outil (nouvelles données).
const CONTROLES = [
  { name: "lieu", label: "Lieu", type: "text", placeholder: "ex. Japan" },
  {
    name: "periode",
    label: "Période",
    options: [
      { value: "hour", label: "Dernière heure" },
      { value: "day", label: "Dernier jour" },
      { value: "week", label: "7 derniers jours" },
      { value: "month", label: "30 derniers jours" },
    ],
  },
  {
    name: "magnitudeMin",
    label: "Magnitude min.",
    type: "number",
    options: [
      { value: 0, label: "Toutes" },
      { value: 2.5, label: "2,5 et plus" },
      { value: 4.5, label: "4,5 et plus" },
      { value: 6, label: "6 et plus" },
    ],
  },
];

// Catégories de magnitude : pastilles de couleur cliquables dans le widget
const CATEGORIES = [
  { nom: "MAJEUR", label: "Majeur (6+)", couleur: "#991b1b" },
  { nom: "FORT", label: "Fort (5 à 6)", couleur: "#dc2626" },
  { nom: "MODERE", label: "Modéré (4 à 5)", couleur: "#d97706" },
  { nom: "LEGER", label: "Léger (moins de 4)", couleur: "#16a34a" },
];
function categorieDe(mag) {
  if (mag == null) return "LEGER";
  if (mag >= 6) return "MAJEUR";
  if (mag >= 5) return "FORT";
  if (mag >= 4) return "MODERE";
  return "LEGER";
}

// Petite mémoire (cache) : le flux USGS est mis à jour chaque minute,
// on le garde 60 s pour que les interactions du widget soient instantanées.
const cache = new Map();

async function fluxUsgs(periode) {
  const url = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_${periode}.geojson`;
  const enCache = cache.get(url);
  if (enCache && Date.now() - enCache.quand < 60 * 1000) return { url, json: enCache.json };
  let derniere;
  for (let essai = 1; essai <= 2; essai++) {
    try {
      const reponse = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!reponse.ok) throw new Error(`L'API USGS a répondu ${reponse.status}`);
      const json = await reponse.json();
      cache.set(url, { quand: Date.now(), json });
      return { url, json };
    } catch (e) {
      derniere = e;
      console.log(`[USGS] essai ${essai} échoué (${e.message})`);
    }
  }
  throw derniere;
}

// Va chercher les vraies données et les met dans le format GÉNÉRIQUE du widget :
//   { id, nom, valeur, categorie, date, lien, lat, lon, details }
async function recupererDonnees({ periode = "week", magnitudeMin = 2.5, lieu = "" }) {
  const { url: sourceUrl, json } = await fluxUsgs(periode);
  const filtreLieu = lieu.trim().toLowerCase();

  const tous = json.features
    .filter((f) => (f.properties.mag ?? 0) >= magnitudeMin)
    .filter((f) => !filtreLieu || (f.properties.place ?? "").toLowerCase().includes(filtreLieu));

  const items = tous
    .sort((a, b) => (b.properties.mag ?? 0) - (a.properties.mag ?? 0))
    .slice(0, 150) // on limite pour garder un widget rapide
    .map((f) => ({
      id: f.id,
      nom: f.properties.place ?? "Lieu inconnu",
      valeur: f.properties.mag,
      categorie: categorieDe(f.properties.mag),
      date: new Date(f.properties.time).toISOString(),
      lien: f.properties.url,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      details: {
        "Magnitude": `${f.properties.mag ?? "—"} (${f.properties.magType ?? "?"})`,
        "Profondeur (km)": f.geometry.coordinates[2],
        "Ressenti signalé": f.properties.felt ? `${f.properties.felt} personnes` : "—",
        "Alerte tsunami": f.properties.tsunami ? "Oui" : "Non",
        "Niveau d'alerte PAGER": f.properties.alert ?? "—",
      },
    }));

  return {
    titre: "Séismes récents",
    valeurLabel: "Magnitude",
    source: "USGS Earthquake Hazards Program",
    sourceUrl,
    recupereLe: new Date().toISOString(),
    outil: TOOL_NAME,
    arguments: { periode, magnitudeMin, lieu },
    controles: CONTROLES,
    categories: CATEGORIES,
    total: tous.length,
    items,
  };
}

// Petit résumé en texte, lu par l'IA (pas affiché dans le widget).
function resumePourIA(data) {
  const compte = {};
  for (const i of data.items) compte[i.categorie] = (compte[i.categorie] ?? 0) + 1;
  const repartition = CATEGORIES.filter((c) => compte[c.nom])
    .map((c) => `${c.label} : ${compte[c.nom]}`)
    .join(", ");
  const top = data.items.slice(0, 3).map((i) => `${i.nom} (${i.valeur})`).join(" ; ");
  return (
    `${data.total} séismes trouvés (source : ${data.source}). ` +
    `Répartition : ${repartition || "aucune"}. Les plus forts : ${top || "aucun"}.`
  );
}

// =====================================================================
//  FIN DE LA PARTIE À CHANGER — le reste fonctionne pour tous les sujets
// =====================================================================

function creerServeurMcp() {
  const server = new McpServer({ name: "athena-starter", version: "0.1.0" });

  // 1) Le widget, déclaré comme « ressource ». Le type text/html+skybridge
  //    indique à Athena que c'est un widget à afficher dans un iframe.
  server.registerResource(
    "widget",
    WIDGET_URI,
    {
      title: "Widget de données",
      description: "Widget interactif qui affiche les résultats de l'outil",
      mimeType: "text/html+skybridge",
      _meta: { "openai/widgetPrefersBorder": true },
    },
    async () => {
    console.log("[MCP] Athena lit le widget (resources/read)");
    return {
    contents: [
      {
        uri: WIDGET_URI,
        mimeType: "text/html+skybridge",
        text: widgetHtml,
        _meta: { "openai/widgetPrefersBorder": true },
      },
    ],
    };
    }
  );

  // 2) L'outil. _meta["openai/outputTemplate"] relie l'outil au widget :
  //    « quand cet outil répond, affiche ce widget ».
  server.registerTool(
    TOOL_NAME,
    {
      ...TOOL_CONFIG,
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: {
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "Récupération des données…",
        "openai/toolInvocation/invoked": "Données récupérées",
        // Permet au widget d'appeler cet outil lui-même (window.openai.callTool)
        "openai/widgetAccessible": true,
      },
    },
    async (args) => {
      console.log("[MCP] Athena appelle l'outil avec :", JSON.stringify(args));
      try {
        const data = await recupererDonnees(args);
        return {
          content: [{ type: "text", text: resumePourIA(data) }], // pour l'IA
          structuredContent: data, // pour le widget (et l'IA)
          _meta: { "openai/outputTemplate": WIDGET_URI },
        };
      } catch (err) {
        console.error(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Erreur pendant la récupération : ${err.message}` }],
        };
      }
    }
  );

  return server;
}

// =====================================================================
//  Serveur HTTP : reçoit les requêtes d'Athena sur /mcp
// =====================================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, mcp-session-id, mcp-protocol-version, authorization",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  // Pré-vérification CORS des navigateurs
  if (req.method === "OPTIONS" && url.pathname === MCP_PATH) {
    res.writeHead(204, CORS).end();
    return;
  }

  // Page de santé : ouvre http://localhost:8787/ pour vérifier que ça tourne
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(`Serveur MCP en marche. Point d'accès : ${MCP_PATH}`);
    return;
  }

  if (url.pathname === MCP_PATH && ["POST", "GET", "DELETE"].includes(req.method ?? "")) {
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);

    // Mode « sans état » : un nouveau serveur MCP par requête. Simple et fiable.
    const server = creerServeurMcp();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error("Erreur MCP :", err);
      if (!res.headersSent) res.writeHead(500).end("Erreur interne du serveur");
    }
    return;
  }

  res.writeHead(404).end("Introuvable");
});

httpServer.listen(PORT, () => {
  console.log(`Serveur MCP en écoute sur http://localhost:${PORT}${MCP_PATH}`);
});

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const GRAPH_FILE = fileURLToPath(new URL('../data/tour-graph.json', import.meta.url));

// Friendly building / faculty names for the tour's tags (first matching tag wins).
const AREA_NAMES = {
  fMecanica: 'Mechanical Engineering',
  fInginerieElectrica: 'Electrical Engineering',
  fInginerieChimica: 'Chemical Engineering',
  fArhitectura: 'Architecture & Urban Planning',
  fStiinte: 'Sciences',
  fManagementTP: 'Management in Production & Transportation',
  fConstructii: 'Civil Engineering',
  fAutomaticaCalculatoare: 'Automation & Computers',
  fElectronica: 'Electronics & Telecommunications',
  fHunedoaraInginerie: 'Engineering Hunedoara',
  BibliotecaUPT: 'Library',
  Rectorat: 'Rectorate',
  Centrudeconferinte: 'Conference Center',
  CCOC: 'Counseling & Career Center',
  BazaSportiva1: 'Sports Base 1',
  BazaSportiva2: 'Sports Base 2',
  Cantina: 'Canteen',
  Camin21C: 'Dorm 21C',
  Camin9C: 'Dorm 9C',
  METAMV: 'META MV',
  ARChA: 'ARChA',
  cOrologerie: 'Clock Tower',
  Exterioare: 'Outdoors',
};

export function areaOf(node) {
  for (const t of node.tags) if (AREA_NAMES[t]) return AREA_NAMES[t];
  return null;
}

let cache;
export async function loadGraph(file = GRAPH_FILE) {
  if (cache && file === GRAPH_FILE) return cache;
  const g = JSON.parse(await readFile(file, 'utf8'));
  g.byIndex = g.nodes; // nodes are stored in playlist order: nodes[i].index === i
  if (file === GRAPH_FILE) cache = g;
  return g;
}

const isCameraId = (l) => /^R\d{7}/.test(l ?? '');
const isAerial = (n) => n.tags.includes('drone');

/** Places a user can pick: panoramas that have a real, human-readable name. */
export function listPlaces(graph) {
  return graph.nodes
    .filter((n) => n.label && !isCameraId(n.label) && !isAerial(n) && n.index !== 0)
    .map((n) => ({
      index: n.index,
      name: n.label,
      nameRo: n.labelRo,
      area: areaOf(n),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || (a.area ?? '').localeCompare(b.area ?? ''));
}

const AERIAL_COST = 1000;
const isAerialIdx = (nodes, i) => i === 0 || isAerial(nodes[i]);

/**
 * Best route from one panorama index to another.
 * Walking hotspots cost 1 each. Aerial/drone views and the 360° map hub (index 0)
 * link across the whole campus, so any hop touching one costs 1000: routes stay on
 * foot whenever the tour allows it and only "fly" (jump) when it does not (the tour
 * itself connects e.g. the Rectorate to the rest of the campus only via drone views).
 * Returns { steps, jumps } or null if unreachable. steps[i].jump marks a hop that
 * touches an aerial view.
 */
export function findRoute(graph, from, to) {
  const { nodes } = graph;
  if (!nodes[from] || !nodes[to]) throw new Error(`Unknown panorama index (${from} -> ${to})`);

  const dist = new Array(nodes.length).fill(Infinity);
  const prev = new Array(nodes.length).fill(null);
  const done = new Array(nodes.length).fill(false);
  dist[from] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || u === to) break;
    done[u] = true;
    for (const e of nodes[u].edges) {
      const aerial = isAerialIdx(nodes, u) || isAerialIdx(nodes, e.to);
      const nd = dist[u] + 1 + (aerial ? AERIAL_COST : 0);
      if (nd < dist[e.to]) {
        dist[e.to] = nd;
        prev[e.to] = { from: u, edge: e, jump: aerial };
      }
    }
  }
  if (dist[to] === Infinity) return null;

  const hops = [];
  for (let cur = to; cur !== from; cur = prev[cur].from) hops.push(prev[cur]);
  hops.reverse();

  // steps[i]: standing at `node`, then go through the hotspot (yaw/pitch) to `next`
  const steps = [];
  let at = from;
  for (const h of hops) {
    steps.push({ node: at, yaw: h.edge.yaw, pitch: h.edge.pitch, next: h.edge.to, jump: h.jump });
    at = h.edge.to;
  }
  steps.push({ node: at, yaw: null, pitch: null, next: null, jump: false });
  return { steps, jumps: hops.filter((h) => h.jump).length };
}

/** Resolve "Main Hall", "Main Hall|Rectorate", or a numeric index to a node index. */
export function resolvePlace(graph, query) {
  if (/^\d+$/.test(String(query))) return Number(query);
  const [name, area] = String(query).split('|').map((s) => s.trim().toLowerCase());
  const hits = listPlaces(graph).filter(
    (p) =>
      (p.name.toLowerCase() === name || p.nameRo?.toLowerCase() === name) &&
      (!area || p.area?.toLowerCase().includes(area)),
  );
  if (!hits.length) throw new Error(`No place named "${query}"`);
  if (hits.length > 1)
    throw new Error(
      `"${query}" is ambiguous; use "name|area" or an index. Candidates: ` +
        hits.map((h) => `${h.name}|${h.area} (#${h.index})`).join(', '),
    );
  return hits[0].index;
}

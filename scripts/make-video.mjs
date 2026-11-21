// Usage: npm run route -- "<from>" "<to>" [out.mp4]
//   <from>/<to>: place name ("UPT Library"), "name|area" to disambiguate, or a node index.
import path from 'node:path';
import { loadGraph, resolvePlace, findRoute } from '../src/graph.mjs';
import { renderRouteVideo } from '../src/render-video.mjs';

const [fromQ, toQ, outArg] = process.argv.slice(2);
if (!fromQ || !toQ) {
  console.error('Usage: npm run route -- "<from>" "<to>" [out.mp4]');
  process.exit(1);
}
const graph = await loadGraph();
const from = resolvePlace(graph, fromQ);
const to = resolvePlace(graph, toQ);
const route = findRoute(graph, from, to);
if (!route) {
  console.error('No route between those places in the tour.');
  process.exit(2);
}
console.log(`Route: ${route.steps.length - 1} hops, ${route.jumps} aerial jump(s)`);
const out = path.resolve(outArg ?? `output/route-${from}-${to}.mp4`);
const res = await renderRouteVideo({
  graph,
  steps: route.steps,
  outFile: out,
  onProgress: (p) => console.log(`[${p.step}/${p.total}] ${p.message}`),
});
console.log(`Wrote ${res.file} (${(res.bytes / 1e6).toFixed(1)} MB)`);

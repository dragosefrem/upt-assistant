// Scrapes the 3DVista tour at visit360.upt.ro and writes data/tour-graph.json:
//   nodes = panoramas in the main playlist, edges = navigation hotspots.
// Hotspot targets are read from the click binding string
//   "this.setPlayListSelectedIndex(this.mainPlayList, N)"
// so they are exact (no guessing from hotspot labels).
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';

export const TOUR_URL = 'https://visit360.upt.ro/';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(TOUR_URL, { waitUntil: 'networkidle', timeout: 90_000 });
// Labels are translated lazily; wait until the locale has actually been applied.
await page.waitForFunction(() => {
  const pl = window.tour?.player;
  const main = pl?.getByClassName('PlayList').find(p => p.get('id') === 'mainPlayList');
  const first = main?.get('items')?.[0]?.get('media');
  return !!first?.get('label');
}, null, { timeout: 60_000 });

const graph = await page.evaluate(() => {
  const pl = window.tour.player;
  const main = pl.getByClassName('PlayList').find(p => p.get('id') === 'mainPlayList');
  const items = main.get('items');
  const idxById = new Map();
  items.forEach((it, i) => idxById.set(it.get('media').get('id'), i));

  const nodes = items.map((it, i) => {
    const m = it.get('media');
    const d = m.get('data') || {};
    const edges = [];
    for (const ov of m.get('overlays') || []) {
      if (ov.get('class') !== 'HotspotPanoramaOverlay') continue;
      const area = (ov.get('areas') || [])[0];
      const item = (ov.get('items') || [])[0];
      if (!area || !item) continue;
      for (const b of area.getBindings('click') || []) {
        const mm = /setPlayListSelectedIndex\(this\.mainPlayList,\s*(\d+)\)/.exec(String(b));
        if (mm) edges.push({ to: +mm[1], yaw: item.get('yaw'), pitch: item.get('pitch') });
      }
    }
    return {
      index: i,
      id: m.get('id'),
      label: m.get('label') || null,  // English (current locale)
      labelRo: d.label ?? null,       // Romanian original
      tags: d.tags || [],
      edges,
    };
  });
  return { nodes, locale: window.tour.getLocale?.() };
});

graph.source = TOUR_URL;
graph.extractedAt = new Date().toISOString();
await mkdir('data', { recursive: true });
await writeFile('data/tour-graph.json', JSON.stringify(graph));
const e = graph.nodes.reduce((s, n) => s + n.edges.length, 0);
console.log(`nodes=${graph.nodes.length} edges=${e} locale=${graph.locale}`);
await browser.close();

import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat, mkdir, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGraph, listPlaces, findRoute } from './graph.mjs';
import { renderRouteVideo } from './render-video.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const VIDEO_DIR = path.join(ROOT, 'output', 'videos');
const PORT = Number(process.env.PORT ?? 3000);

const graph = await loadGraph();
const places = listPlaces(graph);
await mkdir(VIDEO_DIR, { recursive: true });

const jobs = new Map(); // id -> job
const byKey = new Map(); // "from-to" -> job id (in-flight or finished this run)
let chain = Promise.resolve(); // renders run one at a time (each launches a browser)

const exists = (f) => stat(f).then(() => true, () => false);
const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const readBody = async (req, max = 10_000) => {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > max) throw Object.assign(new Error('Body too large'), { status: 413 });
  }
  return data ? JSON.parse(data) : {};
};

function routeSummary(route) {
  const nameOf = (i) => (places.find((p) => p.index === i) ? graph.nodes[i].label : null);
  return {
    hops: route.steps.length - 1,
    aerialJumps: route.jumps,
    stops: route.steps.map((s) => nameOf(s.node)).filter(Boolean),
  };
}

function startJob(from, to, route) {
  const key = `${from}-${to}`;
  const file = path.join(VIDEO_DIR, `${key}.mp4`);
  const job = { id: randomUUID(), key, status: 'queued', step: 0, total: route.steps.length - 1, message: 'Queued', videoUrl: null, error: null };
  jobs.set(job.id, job);
  byKey.set(key, job.id);

  chain = chain.then(async () => {
    job.status = 'rendering';
    const tmp = `${file}.part.mp4`;
    try {
      await renderRouteVideo({
        graph,
        steps: route.steps,
        outFile: tmp,
        onProgress: (p) => Object.assign(job, { step: p.step, total: p.total, message: p.message }),
      });
      await rename(tmp, file); // only ever publish complete files
      Object.assign(job, { status: 'done', message: 'Ready', videoUrl: `/videos/${key}.mp4` });
    } catch (err) {
      console.error(`[job ${job.id}]`, err);
      byKey.delete(key); // allow a retry
      Object.assign(job, { status: 'error', message: 'Could not generate the video', error: err.message });
    }
  });
  return job;
}

async function handleRoute(req, res) {
  const { from, to } = await readBody(req);
  const ok = (v) => Number.isInteger(v) && places.some((p) => p.index === v);
  if (!ok(from) || !ok(to)) return json(res, 400, { error: 'from and to must be valid place indexes (see /api/places)' });
  if (from === to) return json(res, 400, { error: 'You are already there. Pick a different destination.' });

  const route = findRoute(graph, from, to);
  if (!route) return json(res, 404, { error: 'The tour has no connection between these two places.' });
  const summary = routeSummary(route);

  const key = `${from}-${to}`;
  if (await exists(path.join(VIDEO_DIR, `${key}.mp4`))) {
    return json(res, 200, { status: 'done', videoUrl: `/videos/${key}.mp4`, ...summary });
  }
  const existing = jobs.get(byKey.get(key));
  const job = existing && existing.status !== 'error' ? existing : startJob(from, to, route);
  json(res, 202, { jobId: job.id, status: job.status, ...summary });
}

async function serveFile(req, res, file, type) {
  let st;
  try {
    st = await stat(file);
    if (!st.isFile()) throw new Error('not a file');
  } catch {
    return json(res, 404, { error: 'Not found' });
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && type === 'video/mp4') {
    let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
    end = Math.min(end, st.size - 1);
    if (!(start >= 0) || start > end) {
      res.writeHead(416, { 'content-range': `bytes */${st.size}` });
      return res.end();
    }
    res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'accept-ranges': 'bytes' });
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/places') return json(res, 200, places);
    if (req.method === 'POST' && url.pathname === '/api/route') return await handleRoute(req, res);

    const jobMatch = /^\/api\/jobs\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (req.method === 'GET' && jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) return json(res, 404, { error: 'Unknown job' });
      const { id, key, ...pub } = job;
      return json(res, 200, pub);
    }

    const vid = /^\/videos\/(\d+-\d+\.mp4)$/.exec(url.pathname);
    if (req.method === 'GET' && vid) return await serveFile(req, res, path.join(VIDEO_DIR, vid[1]), 'video/mp4');

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html'))
      return await serveFile(req, res, path.join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8');

    json(res, 404, { error: 'Not found' });
  } catch (err) {
    const status = err instanceof SyntaxError ? 400 : (err.status ?? 500);
    if (status === 500) console.error(err);
    json(res, status, { error: status === 500 ? 'Internal error' : err.message });
  }
});

server.listen(PORT, () => console.log(`UPT route videos: http://localhost:${PORT}  (${places.length} places)`));

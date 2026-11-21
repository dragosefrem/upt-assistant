import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TOUR_URL = 'https://visit360.upt.ro/';
const VIEWPORT = { width: 1280, height: 720 };
const LAUNCH_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(-500)}`))));
  });
}

/** Runs inside the tour page. Installed once after load. */
function installHelpers() {
  const pl = window.tour.player;
  const main = pl.getByClassName('PlayList').find((p) => p.get('id') === 'mainPlayList');
  const pp = pl.getByClassName('PanoramaPlayer').find((p) => p.get('id') === 'MainViewerPanoramaPlayer');
  const root = pl.getByClassName('Container').find((c) => c.get('id') === 'rootPlayer');
  const norm = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

  window.__rt = {
    go: (i) => main.set('selectedIndex', i),
    current: () => main.get('selectedIndex'),
    shown: () => pp.get('panorama')?.get('id') ?? null, // id of the panorama actually on screen
    // Hide the tour's own menus/buttons/popups so only the panorama remains.
    hideSkin: () => {
      // Only root-level siblings: MainViewer's own children are the panorama display layers.
      for (const k of root.get('children') || []) if (k.get('id') !== 'MainViewer') k.set('visible', false);
    },
    view: () => ({ yaw: pp.get('yaw'), pitch: pp.get('pitch'), hfov: pp.get('hfov') }),
    setView: (yaw, pitch) => { pp.set('yaw', norm(yaw)); pp.set('pitch', pitch); },
    setFov: (f) => pp.set('hfov', f),
    delta: (yaw) => norm(yaw - pp.get('yaw')),
    // Smoothly rotate the camera (ease in-out) toward yaw/pitch by the shortest way round.
    look: (yaw, pitch, ms) =>
      new Promise((resolve) => {
        const y0 = pp.get('yaw'), p0 = pp.get('pitch');
        const dy = norm(yaw - y0), dp = pitch - p0;
        const t0 = performance.now();
        const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
        const tick = (now) => {
          const t = Math.min(1, (now - t0) / ms);
          const e = ease(t);
          pp.set('yaw', norm(y0 + dy * e));
          pp.set('pitch', p0 + dp * e);
          t < 1 ? requestAnimationFrame(tick) : resolve();
        };
        requestAnimationFrame(tick);
      }),
    // Slow full turn, used on the final panorama.
    spin: (ms) =>
      new Promise((resolve) => {
        const y0 = pp.get('yaw');
        const t0 = performance.now();
        const tick = (now) => {
          const t = Math.min(1, (now - t0) / ms);
          pp.set('yaw', norm(y0 + 360 * t));
          t < 1 ? requestAnimationFrame(tick) : resolve();
        };
        requestAnimationFrame(tick);
      }),
  };

  // The tour re-shows its menu on some panorama changes; keep it suppressed.
  setInterval(() => window.__rt.hideSkin(), 80);

  // ---- HUD (plain DOM, drawn over the full-screen viewer) ----
  const css = document.createElement('style');
  css.textContent = `
    #rt-hud{position:fixed;inset:0;z-index:99999;pointer-events:none;font-family:Inter,Arial,Helvetica,sans-serif;color:#fff}
    #rt-top{position:absolute;top:18px;left:50%;transform:translateX(-50%);display:flex;gap:10px;align-items:center;
      background:rgba(0,19,95,.88);padding:10px 20px;border-radius:999px;font-size:18px;box-shadow:0 4px 18px rgba(0,0,0,.35);white-space:nowrap}
    #rt-top b{font-weight:700}
    #rt-card{position:absolute;left:24px;bottom:44px;display:flex;gap:14px;align-items:center;max-width:70%;
      background:rgba(0,19,95,.88);padding:14px 20px;border-radius:16px;box-shadow:0 4px 18px rgba(0,0,0,.35)}
    #rt-arrow{font-size:38px;line-height:1;width:44px;text-align:center;transition:transform .3s}
    #rt-step{font-size:13px;opacity:.75;letter-spacing:.06em;text-transform:uppercase}
    #rt-text{font-size:22px;font-weight:600}
    #rt-sub{font-size:14px;opacity:.8;margin-top:2px}
    #rt-bar{position:absolute;left:0;bottom:0;height:8px;width:100%;background:rgba(255,255,255,.25)}
    #rt-bar i{display:block;height:100%;width:0;background:#ffc20e;transition:width .6s ease}
    #rt-end{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,19,95,.55)}
    #rt-end div{background:rgba(0,19,95,.95);padding:26px 44px;border-radius:20px;text-align:center}
    #rt-end h1{margin:0 0 6px;font-size:34px} #rt-end p{margin:0;font-size:20px;opacity:.9}`;
  document.head.appendChild(css);
  const hud = document.createElement('div');
  hud.id = 'rt-hud';
  hud.innerHTML = `<div id="rt-top"></div>
    <div id="rt-card"><div id="rt-arrow">▲</div><div><div id="rt-step"></div><div id="rt-text"></div><div id="rt-sub"></div></div></div>
    <div id="rt-bar"><i></i></div><div id="rt-end"><div><h1></h1><p></p></div></div>`;
  document.body.appendChild(hud);
  const $ = (s) => hud.querySelector(s);

  window.__hud = {
    header: (from, to) => ($('#rt-top').innerHTML = `<b>${from}</b> <span>➜</span> <b>${to}</b>`),
    step: ({ step, total, text, sub, arrowDeg, progress }) => {
      $('#rt-card').style.display = 'flex';
      $('#rt-step').textContent = `Step ${step} of ${total}`;
      $('#rt-text').textContent = text;
      $('#rt-sub').textContent = sub || '';
      $('#rt-sub').style.display = sub ? 'block' : 'none';
      $('#rt-arrow').style.transform = `rotate(${arrowDeg}deg)`;
      $('#rt-bar i').style.width = `${Math.round(progress * 100)}%`;
    },
    arrive: (title, sub) => {
      $('#rt-card').style.display = 'none';
      $('#rt-bar i').style.width = '100%';
      $('#rt-end h1').textContent = title;
      $('#rt-end p').textContent = sub;
      $('#rt-end').style.display = 'flex';
    },
  };
}

/** "Turn left" / "Go straight" / ... from a heading change in degrees (+ = right). */
function turnHint(delta) {
  const a = Math.abs(delta);
  if (a < 20) return { arrow: 0, text: 'Continue straight' };
  if (a > 150) return { arrow: 180, text: 'Turn around' };
  const side = delta > 0 ? 'right' : 'left';
  return { arrow: Math.max(-135, Math.min(135, delta)), text: `${a < 60 ? 'Bear' : 'Turn'} ${side}` };
}

/** Yaw (in `node`'s own frame) that looks away from the hotspot leading back to `cameFrom`. */
function forwardHeading(node, cameFrom, wasJump) {
  if (wasJump || node.tags.includes('drone')) return null; // aerial views have no walking direction
  const back = node.edges.find((e) => e.to === cameFrom);
  return back ? back.yaw + 180 : null;
}

/**
 * Render a walking-route video through the tour.
 * @param {object} opts
 * @param {object} opts.graph       graph from loadGraph()
 * @param {Array}  opts.steps       steps from findRoute().steps
 * @param {string} opts.outFile     destination .mp4
 * @param {(p:{step:number,total:number,message:string})=>void} [opts.onProgress]
 */
export async function renderRouteVideo({ graph, steps, outFile, onProgress = () => {} }) {
  const { nodes } = graph;
  const nameOf = (i) => nodes[i].label && !/^R\d{7}/.test(nodes[i].label) ? nodes[i].label : null;
  const first = nodes[steps[0].node];
  const last = nodes[steps.at(-1).node];
  const total = steps.length - 1;

  const workDir = await mkdtemp(path.join(tmpdir(), 'upt-route-'));
  await mkdir(path.dirname(outFile), { recursive: true });
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  try {
    const createdAt = Date.now();
    const context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: workDir, size: VIEWPORT } });
    const page = await context.newPage();

    // Track in-flight image/tile requests so we can wait for sharp panoramas.
    let pending = 0;
    const isTile = (r) => r.resourceType() === 'image' || /\/media\//.test(r.url());
    page.on('request', (r) => isTile(r) && pending++);
    page.on('requestfinished', (r) => isTile(r) && pending--);
    page.on('requestfailed', (r) => isTile(r) && pending--);
    const settle = async (maxMs = 6000) => {
      const t0 = Date.now();
      let quietSince = Date.now();
      while (Date.now() - t0 < maxMs) {
        if (pending > 0) quietSince = Date.now();
        else if (Date.now() - quietSince > 450) return;
        await sleep(60);
      }
    };

    // Wait until the viewer is really showing panorama `id` (selecting an index is not instant).
    const waitShown = async (id, maxMs = 10_000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < maxMs) {
        if ((await page.evaluate(() => window.__rt.shown())) === id) return true;
        await sleep(80);
      }
      return false;
    };

    // The viewer reports a panorama as "shown" before its textures are loaded, so also watch the
    // picture: wait until it differs from the pre-navigation frame and then stops changing.
    // Frames are compared as 32x18 thumbnails (mean pixel difference) because hotspot rings pulse
    // forever, so exact equality never happens.
    const helper = await browser.newPage();
    const thumb = async () => {
      const b64 = (await page.screenshot({ type: 'jpeg', quality: 50 })).toString('base64');
      return helper.evaluate(async (data) => {
        const img = new Image();
        img.src = 'data:image/jpeg;base64,' + data;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = 32; c.height = 18;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0, 32, 18);
        return Array.from(x.getImageData(0, 0, 32, 18).data);
      }, b64);
    };
    const diff = (a, b) => {
      let sum = 0, n = 0;
      for (let i = 0; i < a.length; i += 4) { sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); n += 3; }
      return sum / n;
    };
    const CHANGED = 4, STABLE = 1.5;
    const waitFreshFrame = async (before, maxMs = 15_000) => {
      const t0 = Date.now();
      let last = null, stable = 0;
      while (Date.now() - t0 < maxMs) {
        const cur = await thumb();
        const moved = last ? diff(last, cur) : Infinity;
        // Two nearby panoramas can look alike, so after a few seconds accept "stable and idle" alone.
        const isNew = diff(before, cur) > CHANGED || Date.now() - t0 > 5000;
        stable = moved < STABLE && isNew && pending === 0 ? stable + 1 : 0;
        if (stable >= 2) return true;
        last = cur;
        await sleep(150);
      }
      return false; // carry on with whatever is on screen rather than failing the whole video
    };

    onProgress({ step: 0, total, message: 'Loading the virtual tour…' });
    await page.goto(TOUR_URL, { waitUntil: 'networkidle', timeout: 90_000 });
    await page.waitForFunction(() => {
      const main = window.tour?.player?.getByClassName('PlayList').find((p) => p.get('id') === 'mainPlayList');
      return !!main?.get('items')?.[0]?.get('media')?.get('label');
    }, null, { timeout: 60_000 });
    await sleep(1500);
    // Dismiss the language chooser (English flag).
    await page.mouse.click(VIEWPORT.width * 0.5, VIEWPORT.height * 0.915);
    await sleep(1500);

    await page.evaluate(installHelpers);
    await page.evaluate(() => window.__rt.hideSkin());
    await page.evaluate(([f, t]) => window.__hud.header(f, t), [nameOf(first.index) ?? 'Start', nameOf(last.index) ?? 'Destination']);

    // Jump to the starting panorama off-screen of the final cut (trimmed below).
    const beforeStart = await thumb();
    await page.evaluate((i) => window.__rt.go(i), steps[0].node);
    if (!(await waitShown(nodes[steps[0].node].id))) throw new Error('Start panorama never appeared');
    await page.evaluate(() => { window.__rt.hideSkin(); window.__rt.setFov(100); });
    await waitFreshFrame(beforeStart);
    await sleep(200);
    const startedAt = Date.now();
    const cuts = []; // [from, to] wall-clock ms of loading waits, removed from the final video

    for (let i = 0; i < total; i++) {
      const s = steps[i];
      const nextName = nameOf(s.next);
      onProgress({ step: i + 1, total, message: `Recording step ${i + 1} of ${total}` });

      await page.evaluate(() => { window.__rt.hideSkin(); });
      // Heading change needed to face the next hotspot, measured from where the camera currently looks.
      const delta = await page.evaluate((y) => window.__rt.delta(y), s.yaw);
      const hint = s.jump
        ? { arrow: 0, text: 'Aerial view: jump ahead' }
        : turnHint(delta);
      await page.evaluate((h) => window.__hud.step(h), {
        step: i + 1,
        total,
        text: hint.text,
        sub: nextName ? `Toward ${nextName}` : null,
        arrowDeg: hint.arrow,
        progress: i / total,
      });

      await sleep(i === 0 ? 1600 : 700); // let the viewer take in the new spot
      await page.evaluate(([y, p]) => window.__rt.look(y, Math.max(-25, Math.min(25, p * 0.5)), 1100), [s.yaw, s.pitch]);
      await sleep(550);

      const before = await thumb();
      const cutFrom = Date.now();
      await page.evaluate((n) => window.__rt.go(n), s.next);
      if (!(await waitShown(nodes[s.next].id))) throw new Error(`Panorama ${s.next} never appeared`);
      // Panoramas aren't aligned to a common north, so each one opens at its own default heading.
      // Face the direction of travel instead: straight away from the hotspot that links back to
      // where we came from.
      const heading = forwardHeading(nodes[s.next], s.node, s.jump);
      const face = () => heading !== null && page.evaluate((y) => window.__rt.setView(y, 0), heading);
      await face();
      await page.evaluate(() => { window.__rt.hideSkin(); window.__rt.setFov(100); });
      await face();
      await waitFreshFrame(before);
      await face();
      cuts.push([cutFrom + 250, Date.now() - 150]); // keep a brief moment of the old view
    }

    await page.evaluate(([t, s]) => window.__hud.arrive(t, s), [
      'You have arrived',
      nameOf(last.index) ?? 'Destination',
    ]);
    await sleep(2500);

    await page.close();
    const videoPath = await page.video().path();
    await context.close();

    onProgress({ step: total, total, message: 'Encoding video…' });
    const trim = Math.max(0, (startedAt - createdAt) / 1000 - 0.3);
    const t = (ms) => ((ms - createdAt) / 1000 - trim).toFixed(2);
    const longCuts = cuts.filter(([a, b]) => b - a > 600);
    const vf = longCuts.length
      ? `select='not(${longCuts.map(([a, b]) => `between(t,${t(a)},${t(b)})`).join('+')})',setpts=N/FRAME_RATE/TB`
      : 'null';
    await run('ffmpeg', [
      '-y', '-ss', trim.toFixed(2), '-i', videoPath, '-vf', vf,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
      '-fps_mode', 'cfr', '-r', '30', '-movflags', '+faststart', '-an', outFile,
    ]);
    const { size } = await stat(outFile);
    return { file: outFile, bytes: size, steps: total };
  } finally {
    await browser.close();
    await rm(workDir, { recursive: true, force: true });
  }
}

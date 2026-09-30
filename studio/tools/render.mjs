// Render a film: headless Chrome on the GPU draws each frame (studio/engine/film.html), the PNGs are
// piped straight into ffmpeg.
//
//   node studio/tools/render.mjs <film> --video [--format h|v|s|p|k] [--workers 3] [--draft] [--scale 0.5]
//   node studio/tools/render.mjs <film> --stills 1.5,6.2          -> <film>/out/stills/<fmt>-01.50.jpg
//   node studio/tools/render.mjs <film> --sheet 0:30:0.5 [--cols 6 --tw 400]   -> <film>/out/sheet-<fmt>.jpg
//   node studio/tools/render.mjs <film> --sheet 0.4,2.1,5.3        (a list of times: one frame per shot)
//   node studio/tools/render.mjs <film> --video --draft --sound    (also writes <name>-sound.mp4 with the film's
//                                                                   song or out/audio.wav: an animatic)
//   node studio/tools/render.mjs <film> --audit 0:30:0.1           -> <film>/out/audit-<fmt>.json (for audit.mjs)
//   node studio/tools/render.mjs <film> --cues                     -> <film>/out/cues.json (for the sound)
//   node studio/tools/render.mjs <film> --bench 1.5,12             -> ms per frame
// Common: --samples N (sub-frames per frame), --from/--to (s), --name <stem>, --crf 12, --q 0.9,
// --alpha (transparent: ProRes 4444 .mov), --eval '<js>'.
// Frames come back from the page in 1 MB slices: one DevTools message carrying a whole grainy 1080p
// PNG (~5 MB of base64) can hang without an error.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './cdp.mjs';
import { startServer, filmUrlPath } from './serve.mjs';

const argv = process.argv.slice(2);
const VALUED = new Set(['format', 'workers', 'scale', 'samples', 'stills', 'sheet', 'audit', 'bench', 'from', 'to', 'name', 'crf', 'q', 'cols', 'tw', 'port', 'cdp', 'eval', 'outscale']);
const opt = (name, d) => { const i = argv.indexOf('--' + name); return i < 0 ? d : VALUED.has(name) ? argv[i + 1] : true; };
let filmArg = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { if (VALUED.has(argv[i].slice(2))) i++; continue; }
  filmArg = argv[i]; break;
}
if (!filmArg) { console.log('usage: node studio/tools/render.mjs <film folder> --video|--stills|--sheet|--audit|--cues|--bench ...'); process.exit(1); }
const { abs: filmDir, url: filmUrl } = filmUrlPath(filmArg);
const out = path.join(filmDir, 'out');
fs.mkdirSync(out, { recursive: true });
const FMT = String(opt('format', 'h'));
let PORT = +opt('port', 0);             // 0: the OS picks a free port (read back once the server listens)
const CDP0 = +opt('cdp', 0);            // 0: each Chrome picks a free debugging port (cdp.mjs)
const quality = +opt('q', 0.9);
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} took over ${ms / 1000} s`)), ms))]);

async function openPage(port, extra = {}) {
  const page = await launch({ port, width: 1280, height: 720, quiet: !!extra.quiet });
  const q = new URLSearchParams({ film: filmUrl, format: FMT });
  for (const k of ['samples', 'scale']) if (opt(k)) q.set(k, opt(k));
  if (opt('alpha')) q.set('alpha', '1');
  await page.goto(`http://127.0.0.1:${PORT}/studio/engine/film.html?${q}`);
  await page.evaluate(`new Promise((res, rej) => { const t0 = Date.now(); const f = () => window.REEL ? res(true) : window.REEL_ERROR ? rej(new Error(window.REEL_ERROR)) : Date.now() - t0 > 60000 ? rej(new Error('REEL never appeared')) : setTimeout(f, 50); f(); })`);
  page.grab = async expr => {
    const len = await page.evaluate(`(async () => { window.__grab = await (${expr}); return window.__grab.length; })()`);
    const parts = [];
    for (let o = 0; o < len; o += 1e6) parts.push(await page.evaluate(`window.__grab.slice(${o}, ${o + 1e6})`));
    await page.evaluate('window.__grab = null');
    return parts.join('');
  };
  return page;
}

function ffmpegArgs(file, info, { alpha, crf, draft }) {
  // raw RGBA frames straight from the page (readPixels rows are bottom-up, hence vflip)
  const input = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${info.outW}x${info.outH}`, '-framerate', String(info.fps), '-i', '-'];
  if (alpha) return [...input, '-vf', 'vflip', '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0', file];
  const scale = opt('outscale') ? `scale=${opt('outscale')}:flags=lanczos,` : '';
  return [...input, '-vf', `vflip,${scale}scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`, '-c:v', 'libx264', '-preset', draft ? 'medium' : 'slow', '-crf', String(crf),
    '-profile:v', 'high', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', file];
}

// frames arrive as POST /__frame/<sink id>; each sink is one ffmpeg process fed in order
const sinks = new Map();
function onPost(u, req, res) {
  const m = /^\/__frame\/(\w+)$/.exec(u);
  if (!m) return false;
  const ff = sinks.get(m[1]);
  if (!ff) { res.writeHead(404); res.end(); return true; }
  req.pipe(ff.stdin, { end: false });
  req.on('end', () => { res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); res.end('ok'); });
  return true;
}

async function renderRange(page, from, to, file, info, label = '') {
  const draft = !!opt('draft'), alpha = !!opt('alpha');
  const id = 's' + Math.random().toString(36).slice(2, 9);
  const ff = spawn('ffmpeg', ffmpegArgs(file, info, { draft, alpha, crf: opt('crf', draft ? 18 : 12) }), { stdio: ['pipe', 'inherit', 'inherit'] });
  sinks.set(id, ff);
  const done = new Promise(res => ff.on('close', res));
  const endpoint = `http://127.0.0.1:${PORT}/__frame/${id}`;
  const t0 = Date.now();
  for (let i = from; i < to; i++) {
    await withTimeout(page.evaluate(`REEL.pushFrame(${i}, '${endpoint}')`), 120000, `frame ${i}`);
    if ((i - from) % 30 === 29 || i === to - 1) {
      const per = (Date.now() - t0) / (i - from + 1);
      progress[label] = `${label}${i + 1 - from}/${to - from} ${per.toFixed(0)}ms eta ${((to - i - 1) * per / 1000).toFixed(0)}s`;
      process.stdout.write('\r' + Object.values(progress).join('  |  ') + '   ');
    }
  }
  ff.stdin.end();
  const code = await done;
  sinks.delete(id);
  return code === 0;
}
const progress = {};

const server = await startServer({ port: PORT, onPost });
PORT = server.address().port;
let page;
try {
  page = await openPage(CDP0);
  const info = await page.evaluate('({ fps: REEL.fps, frames: REEL.frames, duration: REEL.duration, gpu: REEL.gpu, W: REEL.W, H: REEL.H, outW: REEL.outW, outH: REEL.outH, format: REEL.format, title: REEL.meta.title || REEL.meta.name })');
  console.log('film', info);
  const fmtTag = FMT;
  if (opt('eval')) console.log('eval ->', JSON.stringify(await page.evaluate(String(opt('eval'))), null, 1));
  if (opt('bench')) for (const t of String(opt('bench')).split(',').map(Number)) console.log(`bench ${t}s: ${await page.evaluate(`REEL.bench(${t})`)} ms`);

  const writeCues = async () => {
    const data = { ...info, cues: await page.evaluate('REEL.cues'), edits: await page.evaluate('REEL.edits'), curves: await page.evaluate('REEL.curves()') };
    fs.writeFileSync(path.join(out, 'cues.json'), JSON.stringify(data, null, 1));
    console.log(`cues -> ${path.relative(process.cwd(), path.join(out, 'cues.json'))} (${data.cues.length} cues, ${data.edits.length} edits)`);
  };
  if (opt('cues')) await writeCues();

  if (opt('audit')) {
    const [a, b, st] = String(opt('audit')).split(':').map(Number);
    const res = [];
    for (let t = a; t <= b + 1e-6; t += st) res.push({ t: +t.toFixed(3), items: await page.evaluate(`REEL.audit(${t.toFixed(4)})`) });
    const file = path.join(out, `audit-${fmtTag}.json`);
    const F = await page.evaluate('REEL.ctx.F');
    fs.writeFileSync(file, JSON.stringify({ W: info.W, H: info.H, format: fmtTag, safe: F.safe, minText: F.minText, frames: res }));
    console.log(`audit ${res.length} times -> ${path.relative(process.cwd(), file)}`);
  }

  if (opt('stills')) {
    fs.mkdirSync(path.join(out, 'stills'), { recursive: true });
    for (const t of String(opt('stills')).split(',').map(Number)) {
      const t0 = Date.now();
      const b64 = await page.grab(`REEL.still(${t}, ${quality})`);
      const file = path.join(out, 'stills', `${opt('name', fmtTag)}-${t.toFixed(2).padStart(5, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
      console.log(`${t}s -> ${path.relative(process.cwd(), file)} (${Date.now() - t0} ms)`);
    }
  }

  if (opt('sheet')) {
    const spec = String(opt('sheet'));
    const times = [];
    if (spec.includes(':')) {
      const [a, b, s] = spec.split(':').map(Number);
      for (let t = a; t <= b + 1e-6; t += s) times.push(+t.toFixed(4));
    } else times.push(...spec.split(',').map(Number).filter(Number.isFinite));
    const t0 = Date.now();
    const b64 = await page.grab(`REEL.sheet(${JSON.stringify(times)}, ${+opt('cols', 4)}, ${+opt('tw', 480)})`);
    const file = path.join(out, `${opt('name', 'sheet-' + fmtTag)}.jpg`);
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    console.log(`${times.length} frames -> ${path.relative(process.cwd(), file)} (${Date.now() - t0} ms)`);
  }

  if (opt('video')) {
    await writeCues();
    const from = Math.round(+opt('from', 0) * info.fps), to = Math.min(info.frames, Math.round(+opt('to', info.duration) * info.fps));
    const ext = opt('alpha') ? '.mov' : '.mp4';
    const file = path.join(out, `${opt('name', 'video-' + fmtTag)}${ext}`);
    const workers = Math.max(1, Math.min(+opt('workers', 1), 8, to - from));
    const t0 = Date.now();
    let ok;
    if (workers === 1) {
      ok = await renderRange(page, from, to, file, info);
    } else {
      // contiguous chunks, one Chrome each, then a lossless concat
      const parts = [], pages = [page];
      for (let w = 1; w < workers; w++) pages.push(await openPage(CDP0 && CDP0 + w, { quiet: true }));
      const size = Math.ceil((to - from) / workers);
      const jobs = pages.map((p, w) => {
        const a = from + w * size, b = Math.min(to, a + size);
        const part = path.join(out, `.part-${fmtTag}-${w}${ext}`);
        parts.push(part);
        return a < b ? renderRange(p, a, b, part, info, `w${w} `) : Promise.resolve(true);
      });
      ok = (await Promise.all(jobs)).every(Boolean);
      for (const p of pages.slice(1)) await p.close();
      const list = path.join(out, `.parts-${fmtTag}.txt`);
      fs.writeFileSync(list, parts.filter(fs.existsSync).map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
      const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', file], { encoding: 'utf8' });
      if (r.status) { console.log(r.stderr); ok = false; }
      for (const p of [...parts, list]) try { fs.unlinkSync(p); } catch {}
    }
    console.log(`\n${ok ? 'ok' : 'FAILED'} ${path.relative(process.cwd(), file)}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    // --sound: lay the film's audio under the picture (the mixed out/audio.wav if it exists, else the song
    // from film.json at songStart), for animatics and review cuts. The picture is copied, not re-encoded.
    if (ok && opt('sound') && !opt('alpha')) {
      const meta = JSON.parse(fs.readFileSync(path.join(filmDir, 'film.json'), 'utf8'));
      const wav = path.join(out, 'audio.wav');
      const song = meta.audio?.song ? path.join(filmDir, meta.audio.song) : null;
      const src = fs.existsSync(wav) ? { file: wav, at: 0 } : song && fs.existsSync(song) ? { file: song, at: meta.audio.songStart ?? meta.songStart ?? 0 } : null;
      if (!src) console.log('--sound: no out/audio.wav and no audio.song in film.json');
      else {
        const withSound = file.replace(/\.mp4$/, '-sound.mp4');
        const fromS = +opt('from', 0);
        const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-ss', String(src.at + fromS), '-i', src.file,
          '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', withSound], { encoding: 'utf8' });
        console.log(r.status ? `--sound failed: ${r.stderr}` : `with sound -> ${path.relative(process.cwd(), withSound)}`);
      }
    }
  }
} finally {
  if (page) await page.close();
  server.close();
}

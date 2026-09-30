// Checks the text a film really draws (out/audit-<fmt>.json from `render.mjs <film> --audit 0:30:0.1`):
//   frame    readable text stays inside the format's safe area
//   size     readable text is at least the format's minimum size
//   overlap  two readable pieces of text never cover each other longer than a transition
//   hold     each line stays readable long enough to be read (default: 0.25 s per word, at least 1 s;
//            lines marked caption: true in their audit extra are exempt, since the song sets them)
// "Readable" = drawn at >= 0.6 opacity, not marked deco, not on a 3D card texture.
//
//   node studio/tools/audit.mjs <film> [--format h] [--min-hold 1]
import fs from 'node:fs';
import path from 'node:path';
import { filmUrlPath } from './serve.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const { abs: film } = filmUrlPath(argv.find(a => !a.startsWith('--') && !['h', 'v', 's', 'p'].includes(a)) || '.');
const fmt = opt('format', 'h');
const A = JSON.parse(fs.readFileSync(path.join(film, 'out', `audit-${fmt}.json`), 'utf8'));
const { W, H } = A;
const [sx0, sy0, sx1, sy1] = A.safe || [40, 30, W - 40, H - 30];
const MIN = A.minText || 20;
const minHold = +opt('min-hold', 1);
const readable = i => i.alpha >= 0.6 && !i.deco && i.layer !== 'plane';
const step = A.frames.length > 1 ? A.frames[1].t - A.frames[0].t : 0.1;

const issues = { frame: new Map(), size: new Map(), overlap: new Map() };
const note = (map, key, t, detail) => { const e = map.get(key) || { first: t, last: t, n: 0, detail }; e.last = t; e.n++; map.set(key, e); };
const seen = new Map();   // text -> list of times it is readable

for (const F of A.frames) {
  const items = F.items.filter(readable);
  for (const i of items) {
    const onScreen = i.x1 > 0 && i.x0 < W && i.y1 > 0 && i.y0 < H;
    if (!onScreen) continue;
    if (i.x0 < sx0 - 2 || i.y0 < sy0 - 2 || i.x1 > sx1 + 2 || i.y1 > sy1 + 2) note(issues.frame, `${i.id} «${i.text}»`, F.t, `[${i.x0},${i.y0}]-[${i.x1},${i.y1}]`);
    if (i.px < MIN - 0.5) note(issues.size, `${i.id} «${i.text}»`, F.t, `${i.px}px < ${MIN}`);
    const key = String(i.text).trim();
    if (!i.caption && !i.typing) { if (!seen.has(key)) seen.set(key, []); seen.get(key).push(F.t); }
  }
  for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
    const p = items[a], q = items[b];
    if (p.id === q.id && p.text === q.text) continue;
    const ix = Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0), iy = Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0);
    if (ix <= 2 || iy <= 2) continue;
    const small = Math.min((p.x1 - p.x0) * (p.y1 - p.y0), (q.x1 - q.x0) * (q.y1 - q.y0));
    if (ix * iy < 0.12 * small) continue;
    note(issues.overlap, `${p.id} «${p.text}» x ${q.id} «${q.text}»`, F.t, '');
  }
}

// hold: contiguous readable runs per text; single words inside longer lines are judged with their line
const holds = [];
for (const [txt, ts] of seen) {
  let a = ts[0], prev = ts[0];
  const runs = [];
  for (const t of ts.slice(1)) { if (t - prev > step * 1.5) { runs.push([a, prev]); a = t; } prev = t; }
  runs.push([a, prev]);
  const need = Math.max(minHold, 0.25 * txt.split(/\s+/).length);
  for (const [r0, r1] of runs) if (r1 - r0 + step < need) holds.push(`${r0.toFixed(2)}-${r1.toFixed(2)}s  «${txt}» readable ${(r1 - r0 + step).toFixed(2)} s, needs ${need.toFixed(2)} s`);
}

let bad = 0;
for (const [kind, map] of Object.entries(issues)) {
  const rows = [...map.entries()].filter(([, e]) => (kind === 'frame' ? e.n * step >= 0.2 - 1e-6 : e.n * step >= 0.35 - 1e-6));
  console.log(`\n${kind}: ${rows.length}`);
  for (const [k, e] of rows.slice(0, 40)) console.log(`  ${e.first.toFixed(2)}-${e.last.toFixed(2)}s  ${k}  ${e.detail}`);
  bad += rows.length;
}
console.log(`\nhold: ${holds.length}`);
for (const h of holds.slice(0, 40)) console.log('  ' + h);
bad += holds.length;
console.log(`\n${A.frames.length} samples at ${step.toFixed(2)} s, format ${fmt} (safe ${sx0},${sy0}-${sx1},${sy1}, min ${MIN}px): ${bad} findings`);

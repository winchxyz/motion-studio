// Save a generated asset (a Runway result URL) into a film and record it in the film's manifest, so
// every generation can be traced and regenerated.
//   node studio/tools/fetch.mjs <film> <url> <assets/gen/name.png> --model nano-banana-pro --prompt "..." \
//        [--prompt-file prompt.txt] [--task <taskId>] [--cost 8] [--refs a.png,b.png] [--ratio 16:9] [--kind image|video|audio]
// Appends to <film>/assets/gen/manifest.json and prints the running credit total for the film.
// Multi-line prompts: pass --prompt-file (read as UTF-8). On Windows an argument such as
// --prompt "$(cat prompt.txt)" is cut at its first newline on the way to node.
import fs from 'node:fs';
import path from 'node:path';
import { filmUrlPath } from './serve.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const [filmArg, url, rel] = pos;
if (!filmArg || !url || !rel) { console.log('usage: node studio/tools/fetch.mjs <film> <url> <relative/path.ext> [--model --prompt "..." | --prompt-file prompt.txt --task --cost --refs --ratio --kind]'); process.exit(1); }
const promptFile = opt('prompt-file');
const prompt = promptFile ? fs.readFileSync(promptFile, 'utf8').replace(/^﻿/, '').replace(/\s+$/, '') : opt('prompt', '');
const { abs: film } = filmUrlPath(filmArg);
const dest = path.join(film, rel);
fs.mkdirSync(path.dirname(dest), { recursive: true });
const res = await fetch(url);
if (!res.ok) { console.log(`download failed: ${res.status} ${res.statusText}`); process.exit(1); }
const buf = Buffer.from(await res.arrayBuffer());
fs.writeFileSync(dest, buf);
const manPath = path.join(film, 'assets', 'gen', 'manifest.json');
fs.mkdirSync(path.dirname(manPath), { recursive: true });
const man = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, 'utf8')) : [];
const entry = {
  file: rel.replace(/\\/g, '/'), kind: opt('kind', /\.(mp4|mov|webm)$/i.test(rel) ? 'video' : /\.(mp3|wav|m4a)$/i.test(rel) ? 'audio' : 'image'),
  model: opt('model', ''), prompt, task: opt('task', ''), ratio: opt('ratio', ''),
  refs: (opt('refs', '') || '').split(',').filter(Boolean), cost: +opt('cost', 0) || 0, bytes: buf.length, saved: new Date().toISOString(),
};
man.push(entry);
fs.writeFileSync(manPath, JSON.stringify(man, null, 1));
const total = man.reduce((s, e) => s + (e.cost || 0), 0);
console.log(`${rel}  ${(buf.length / 1048576).toFixed(2)} MB  (${man.length} assets, ${total} credits recorded for this film)`);

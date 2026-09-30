// Start a film from a template.
//   node studio/tools/new-film.mjs <folder name> [--template music-video|spot] [--title "Title"]
// Creates <motion videos>/<name>/ with film.json, film.js (and sound.py for a spot), brief.md,
// storyboard.md, assets/gen/, then prints the next steps.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './serve.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const name = argv.find(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--template' && argv[argv.indexOf(a) - 1] !== '--title');
if (!name || !/^[a-z0-9][a-z0-9_-]*$/.test(name)) { console.log('usage: node studio/tools/new-film.mjs <folder-name (a-z 0-9 - _)> [--template music-video|spot] [--title "Title"]'); process.exit(1); }
const template = opt('template', 'music-video');
const title = opt('title', name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));
const src = path.join(ROOT, 'studio', 'templates', template);
const dst = path.join(ROOT, name);
if (!fs.existsSync(src)) { console.log(`no template "${template}" (have: ${fs.readdirSync(path.join(ROOT, 'studio', 'templates')).join(', ')})`); process.exit(1); }
if (fs.existsSync(dst)) { console.log(`${dst} already exists`); process.exit(1); }

fs.cpSync(src, dst, { recursive: true });
for (const f of ['film.json', 'film.js', 'style.js', 'sound.py']) {
  const p = path.join(dst, f);
  if (fs.existsSync(p)) fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('NAME', name).replaceAll('TITLE', title));
}
fs.mkdirSync(path.join(dst, 'assets', 'gen'), { recursive: true });
fs.writeFileSync(path.join(dst, 'brief.md'), `# ${title}

Every agent reads this file: keep it under 6 KB. Research goes to research/, evidence to evidence/.

## Brief
- What it is:
- Who it is for, where it runs:
- Length and formats:
- Must show, must say:
- Feel, in three words:
- Style direction (a card from styles/ or a reference in refs/):

## Truth
Facts, names, numbers and handles that appear on screen, each with where it was checked.

## Art direction
- Palette:
- Type pairing:
- Look (post chain):
- Texture and light:
- Camera and transitions:

## Sound
- ${template === 'music-video' ? 'Song: generated (Runway Lyria) from the lyrics below, or supplied' : 'Score: synthesized in sound.py'}
- Tempo, key, the moments the sound must hit:
${template === 'music-video' ? '\n## Lyrics\n' : ''}`);
fs.writeFileSync(path.join(dst, 'storyboard.md'), `# ${title}: storyboard

One row per shot, 12 KB at most. Times come from the timing file film.json points at${template === 'music-video' ? ' (the timed lyrics, assets/song.json)' : ''}.
Each shot's detail (composition per format, motion, assets) goes in shots/<id>.md, 1.5 KB at most.

| id | time | length | ${template === 'music-video' ? 'lyric' : 'line / VO'} on screen | picture | in |
| --- | --- | --- | --- | --- | --- |
| hook | 0.00 | | | | cut |
`);
console.log(`created ${path.relative(process.cwd(), dst) || dst} from ${template}
next:
  1. fill brief.md, then storyboard.md
  2. preview: http://127.0.0.1:8960/studio/engine/preview.html?film=/${name}   (node studio/tools/serve.mjs)
  3. node studio/tools/render.mjs ${name} --sheet 0:${template === 'spot' ? 30 : 45}:1 --cols 8 --tw 320
  4. node studio/tools/render.mjs ${name} --video --format h ; node studio/tools/deliver.mjs ${name}`);

// Copy the open-source part of the studio into a separate repository folder: the engine, tools,
// audio, templates, fonts (with their licences), the engine tests, the Claude Code workflow, skills,
// agent and hook. Then overlay oss/ (the public README, CLAUDE.md, style cards, licence, docs).
// Films, references, research and anything client-owned never leave this repo.
//   node studio/tools/export-oss.mjs ../motion-studio
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './serve.mjs';

const dest = path.resolve(process.argv[2] || path.join(ROOT, '..', 'motion-studio'));
const INCLUDE = [
  'studio/engine', 'studio/tools', 'studio/audio', 'studio/templates', 'studio/fonts',
  '_lab/engine-test', '_lab/three-test', '_lab/looks',
  '.claude/workflows', '.claude/skills', '.claude/agents', '.claude/settings.json', '.claude/launch.json',
  'WORKFLOW.md', 'package.json', 'package-lock.json',
];
const SKIP = /(^|[\\/])(out|__pycache__|node_modules|notes\.md)([\\/]|$)/;

let n = 0;
function copy(src, dst) {
  const st = fs.statSync(src);
  if (SKIP.test(path.relative(ROOT, src))) return;
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) copy(path.join(src, f), path.join(dst, f));
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    n++;
  }
}
for (const rel of INCLUDE) {
  const src = path.join(ROOT, rel);
  if (fs.existsSync(src)) copy(src, path.join(dest, rel));
  else console.log('missing', rel);
}
const overlay = path.join(ROOT, 'oss');
if (fs.existsSync(overlay)) copy(overlay, dest);
console.log(`${n} files -> ${dest}`);

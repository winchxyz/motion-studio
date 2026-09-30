// PostToolUse hook: after Claude edits or writes a .js/.mjs file in the studio, run node --check on
// it and hand any syntax error straight back (exit 2), so a broken film never reaches a render.
// Workflow scripts (.claude/workflows/*.js) run inside an async function (top-level return and await
// are legal there), so they are checked wrapped the same way.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let raw = '';
process.stdin.on('data', d => { raw += d; });
process.stdin.on('end', () => {
  let file = '';
  try { file = JSON.parse(raw)?.tool_input?.file_path || ''; } catch { process.exit(0); }
  if (!/\.(m?js)$/i.test(file) || /node_modules/.test(file) || !fs.existsSync(file)) process.exit(0);
  let target = file, tmp = null;
  if (/[\\/]\.claude[\\/]workflows[\\/]/.test(file)) {
    const src = fs.readFileSync(file, 'utf8').replace(/^export const meta/m, 'const meta');
    tmp = path.join(os.tmpdir(), `wf-check-${process.pid}.mjs`);
    fs.writeFileSync(tmp, `const agent = async () => null, parallel = async () => [], pipeline = async () => [], phase = () => {}, log = () => {}, workflow = async () => null, args = {}, budget = {};\nexport default async function __wf() {\n${src}\n}\n`);
    target = tmp;
  }
  const r = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
  if (tmp) try { fs.unlinkSync(tmp); } catch {}
  if (r.status) {
    process.stderr.write(`node --check failed for ${file}:\n${(r.stderr || '').split('\n').slice(0, 12).join('\n')}\n`);
    process.exit(2);
  }
  process.exit(0);
});

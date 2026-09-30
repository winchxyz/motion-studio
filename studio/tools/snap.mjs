// Screenshot a studio page (the preview player with a film, a film frame) in headless Chrome.
//   node studio/tools/snap.mjs "/studio/engine/preview.html?film=/my-film#t=12.5" docs/media/player.png [--w 1600 --h 1000 --wait 4000]
//   (a path is served from the studio root; a full http URL is opened as is)
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './cdp.mjs';
import { startServer } from './serve.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const [target, out] = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
if (!target || !out) { console.log('usage: node studio/tools/snap.mjs <path-or-url> <out.png> [--w 1600 --h 1000 --wait 4000]'); process.exit(1); }
const W = +opt('w', 1600), H = +opt('h', 1000);
const server = /^https?:/.test(target) ? null : await startServer({ port: 0 });   // 0: a free port
const url = /^https?:/.test(target) ? target : `http://127.0.0.1:${server.address().port}${target.startsWith('/') ? '' : '/'}${target}`;
const page = await launch({ width: W, height: H, quiet: true });
try {
  await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await page.goto(url);
  await new Promise(r => setTimeout(r, +opt('wait', 4000)));
  const shot = await page.send('Page.captureScreenshot', { format: out.endsWith('.jpg') ? 'jpeg' : 'png', quality: 90 });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`${url} -> ${out}`);
} finally {
  await page.close();
  server?.close();
}

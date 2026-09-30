// Static server for the studio root (the "motion videos" folder), used by render.mjs and the preview.
//   node studio/tools/serve.mjs [--port 8960]
//   then open http://127.0.0.1:8960/studio/engine/preview.html?film=/<film folder>
// POST /__note { film, t, format, text } appends a timestamped note to <film>/notes.md, so notes taken
// while watching the preview land where Claude reads them.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.hdr': 'application/octet-stream', '.md': 'text/markdown; charset=utf-8',
};

function sendFile(req, res, file) {
  const stat = fs.statSync(file);
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) {                                   // audio/video seeking in the preview needs ranges
    const start = range[1] ? +range[1] : 0;
    const end = range[2] ? Math.min(+range[2], stat.size - 1) : stat.size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'no-store' });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

export function startServer({ root = ROOT, port = 8960, quiet = true, onPost = null } = {}) {
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (req.method === 'POST' && onPost && onPost(u, req, res)) return;
    if (req.method === 'POST' && u === '/__note') {
      let body = '';
      req.on('data', d => { body += d; if (body.length > 20000) req.destroy(); });
      req.on('end', () => {
        try {
          const n = JSON.parse(body);
          const dir = path.join(root, String(n.film || '').replace(/^\/+/, ''));
          if (!dir.startsWith(root) || !fs.existsSync(path.join(dir, 'film.json'))) throw new Error('unknown film');
          const line = `- ${(+n.t).toFixed(2)} s${n.format ? ` [${n.format}]` : ''}: ${String(n.text).replace(/\s+/g, ' ').trim()}\n`;
          const file = path.join(dir, 'notes.md');
          if (!fs.existsSync(file)) fs.writeFileSync(file, '# Notes from the preview\n\n');
          fs.appendFileSync(file, line);
          res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
        } catch (e) { res.writeHead(400); res.end(String(e.message)); }
      });
      return;
    }
    const file = path.join(root, u === '/' ? 'studio/engine/index.html' : u);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (!quiet) console.log('404', u);
      res.writeHead(404); res.end(); return;
    }
    sendFile(req, res, file);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

// the URL path of a film folder given on the command line (absolute, or relative to cwd or the root)
export function filmUrlPath(dir) {
  const cands = [path.resolve(dir), path.resolve(ROOT, dir)];
  const abs = cands.find(p => fs.existsSync(path.join(p, 'film.json')));
  if (!abs) throw new Error(`no film.json in ${dir}`);
  const rel = path.relative(ROOT, abs);
  if (rel.startsWith('..')) throw new Error(`${dir} is outside ${ROOT}`);
  return { abs, url: '/' + rel.split(path.sep).map(encodeURIComponent).join('/') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--port');
  const port = i > 0 ? +process.argv[i + 1] : 8960;
  await startServer({ port, quiet: false });
  console.log(`studio at http://127.0.0.1:${port}/  (preview: /studio/engine/preview.html?film=/<film folder>)`);
}

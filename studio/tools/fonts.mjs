// Fetch an open-licence family from Google Fonts' own repository (github.com/google/fonts) into a
// film's fonts/ folder (or studio/fonts), static instances first, variable files otherwise.
//   node studio/tools/fonts.mjs "Space Grotesk" <film>        -> <film>/fonts/SpaceGrotesk-*.ttf
//   node studio/tools/fonts.mjs "Instrument Serif" studio     -> studio/fonts/
// Prints the files and the FONTS entries to paste into style.js.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, filmUrlPath } from './serve.mjs';

const [family, target = 'studio'] = process.argv.slice(2);
if (!family) { console.log('usage: node studio/tools/fonts.mjs "<Family Name>" <film|studio>'); process.exit(1); }
const slug = family.toLowerCase().replace(/[^a-z0-9]/g, '');
const destDir = target === 'studio' ? path.join(ROOT, 'studio', 'fonts') : path.join(filmUrlPath(target).abs, 'fonts');
const urlBase = target === 'studio' ? '/studio/fonts' : 'fonts';
fs.mkdirSync(destDir, { recursive: true });

const api = async p => {
  const r = await fetch(`https://api.github.com/repos/google/fonts/contents/${p}`, { headers: { 'User-Agent': 'motion-studio' } });
  return r.ok ? r.json() : null;
};
let listing = null, where = null;
for (const lic of ['ofl', 'apache', 'ufl']) {
  listing = await api(`${lic}/${slug}`);
  if (Array.isArray(listing)) { where = `${lic}/${slug}`; break; }
}
if (!where) { console.log(`"${family}" not found in google/fonts (tried ofl, apache, ufl as ${slug})`); process.exit(1); }
const statics = await api(`${where}/static`);
const files = (Array.isArray(statics) && statics.length ? statics : listing).filter(f => /\.(ttf|otf)$/i.test(f.name));
const entries = [];
for (const f of files) {
  const buf = Buffer.from(await (await fetch(f.download_url)).arrayBuffer());
  fs.writeFileSync(path.join(destDir, f.name), buf);
  const w = /Thin/.test(f.name) ? 100 : /ExtraLight/.test(f.name) ? 200 : /Light/.test(f.name) ? 300 : /Medium/.test(f.name) ? 500 : /SemiBold/.test(f.name) ? 600 : /ExtraBold/.test(f.name) ? 800 : /Black/.test(f.name) ? 900 : /Bold/.test(f.name) ? 700 : /\[.*wght.*\]/.test(f.name) ? '100 900' : 400;
  entries.push(`{ family: '${family}', src: '${urlBase}/${f.name}', weight: ${typeof w === 'string' ? `'${w}'` : w}${/Italic/.test(f.name) ? ", style: 'italic'" : ''} },`);
  console.log(`${f.name}  ${(buf.length / 1024).toFixed(0)} KB`);
}
const lic = listing.find(f => /^(OFL|LICENSE)/i.test(f.name));
if (lic) fs.writeFileSync(path.join(destDir, `${slug}-${lic.name}`), Buffer.from(await (await fetch(lic.download_url)).arrayBuffer()));
console.log(`\n${files.length} files -> ${path.relative(process.cwd(), destDir) || destDir}\nFONTS entries:\n  ${entries.join('\n  ')}`);

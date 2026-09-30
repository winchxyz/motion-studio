// Finish a film after its video renders (out/video-<fmt>.mp4 from render.mjs --video):
//   1. the soundtrack: <film>/sound.py if the film has one (a synthesized score), else the song plus
//      effects on the cues (studio/audio/mixdown.py); a spectrogram check picture
//   2. per format: master (audio at -14 LUFS / -1 dBTP, picture copied), share file (CRF 16),
//      phone preview under --preview-mb (two-pass), poster, styleframes sheet
//
//   node studio/tools/deliver.mjs <film> [--formats h,v] [--skip-sound] [--preview-mb 28]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { filmUrlPath, ROOT } from './serve.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const filmArg = argv.find(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--formats' && argv[argv.indexOf(a) - 1] !== '--preview-mb');
const { abs: film } = filmUrlPath(filmArg || '.');
const meta = JSON.parse(fs.readFileSync(path.join(film, 'film.json'), 'utf8'));
const out = path.join(film, 'out');
const name = meta.name || path.basename(film);
const TAG = { h: '16x9', v: '9x16', s: '1x1', p: '4x5', k: '4k' };
const formats = String(opt('formats', (meta.formats || ['h']).join(','))).split(',').filter(f => fs.existsSync(path.join(out, `video-${f}.mp4`)));
const run = (cmd, args, o = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26, ...o });
  if (r.status) { console.log(r.stdout || '', r.stderr || ''); throw new Error(`${cmd} failed`); }
  return r;
};
const probeDur = f => +run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).stdout.trim();
const mb = f => (fs.statSync(f).size / 1048576).toFixed(1) + ' MB';

if (!formats.length) { console.log(`no out/video-<fmt>.mp4 in ${film}; render first: node studio/tools/render.mjs <film> --video --format h`); process.exit(1); }

// ------------------------------------------------------------------ 1. sound
const wav = path.join(out, 'audio.wav');
if (!opt('skip-sound')) {
  const own = path.join(film, 'sound.py');
  if (fs.existsSync(own)) { console.log('score: sound.py'); run('python', [own], { cwd: film, stdio: 'inherit' }); }
  else { console.log('sound: mixdown'); run('python', [path.join(ROOT, 'studio/audio/mixdown.py'), film], { stdio: 'inherit' }); }
  run('python', [path.join(ROOT, 'studio/tools/audio_check.py'), wav, path.join(out, 'audio_check.png')], { stdio: 'inherit' });
}
const hasAudio = fs.existsSync(wav);

// ------------------------------------------------------------------ 2. per format
const pre = 'acompressor=threshold=-18dB:ratio=2:attack=6:release=120:makeup=1.5dB';
const target = 'I=-14:TP=-1.0:LRA=9';
let loud = null;
if (hasAudio) {
  const p1 = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', wav, '-af', `${pre},loudnorm=${target}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
  loud = JSON.parse(p1.stderr.slice(p1.stderr.lastIndexOf('{'), p1.stderr.lastIndexOf('}') + 1));
  console.log(`audio measured ${loud.input_i} LUFS, ${loud.input_tp} dBTP -> -14 LUFS`);
}
const rows = [];
for (const f of formats) {
  const video = path.join(out, `video-${f}.mp4`);
  const stem = `${name}-${TAG[f] || f}`;
  const master = path.join(out, `${stem}-master.mp4`);
  if (hasAudio) {
    const ln = `loudnorm=${target}:measured_I=${loud.input_i}:measured_TP=${loud.input_tp}:measured_LRA=${loud.input_lra}:measured_thresh=${loud.input_thresh}:offset=${loud.target_offset}:linear=true`;
    run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', video, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
      '-af', `${pre},${ln},aresample=192000,alimiter=limit=0.84:attack=0.5:release=60:level=false,aresample=48000`, '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', master]);
  } else fs.copyFileSync(video, master);
  const share = path.join(out, `${stem}.mp4`);
  run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', master, '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-tune', 'film', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-c:a', 'copy', '-movflags', '+faststart', share]);
  const dur = probeDur(master);
  const kbps = Math.min(12000, Math.floor((+opt('preview-mb', 28) * 8 * 1024 * 1024 / dur - 256000) / 1000));
  const preview = path.join(out, `${stem}-preview.mp4`);
  const passlog = path.join(out, `x264pass-${f}`);
  run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', master, '-c:v', 'libx264', '-preset', 'slow', '-b:v', `${kbps}k`, '-pass', '1', '-passlogfile', passlog, '-an', '-f', 'null', 'NUL']);
  run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', master, '-c:v', 'libx264', '-preset', 'slow', '-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.5)}k`, '-bufsize', `${kbps * 2}k`,
    '-pass', '2', '-passlogfile', passlog, '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-c:a', 'copy', '-movflags', '+faststart', preview]);
  for (const p of fs.readdirSync(out)) if (p.startsWith(`x264pass-${f}`)) fs.unlinkSync(path.join(out, p));
  const posterT = meta.deliver?.poster ?? Math.max(0, dur - 0.5);
  const poster = path.join(out, `${stem}-poster.png`);
  run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(posterT), '-i', master, '-frames:v', '1', poster]);
  const times = meta.deliver?.styleframes || Array.from({ length: 12 }, (_, i) => +((i + 0.5) * dur / 12).toFixed(2));
  const sheet = path.join(out, `${stem}-styleframes.jpg`);
  const cols = f === 'v' ? 6 : 3;
  run('python', [path.join(ROOT, 'studio/tools/frames.py'), master, times.join(','), sheet, String(cols), String(f === 'v' ? 320 : 640), 'clean']);
  rows.push([f, master, share, preview, poster, sheet]);
}
console.log('\ndelivered:');
for (const [f, ...files] of rows) {
  console.log(`  ${TAG[f] || f}`);
  for (const p of files) console.log(`    ${path.relative(film, p)}  ${mb(p)}`);
}

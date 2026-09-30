// The preview player: plays a film in real time (1 sub-frame, reduced resolution), scrubs with beat,
// edit and cue marks, switches formats, shows the safe area, plays the soundtrack in sync, and posts
// timestamped notes into the film's notes.md.
//   /studio/engine/preview.html?film=/<film folder>&format=h#t=12.5
import { boot } from './harness.js';
import { FORMATS } from './formats.js';

const P = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem('studio.' + k); localStorage.setItem('studio.' + k, v); } catch { return null; } };
const hashT = () => { const m = /t=([\d.]+)/.exec(location.hash); return m ? +m[1] : 0; };

const res = P.get('scale') || store('res') || '0.5';
$('res').value = res;
$('q').value = store('q') || '4';

let REEL;
try {
  REEL = await boot({ canvas: $('gl'), params: P, overrides: { scale: res, samples: 1 } });
  window.REEL = REEL;
} catch (e) {
  $('err').style.display = 'block';
  $('err').textContent = String(e && e.stack || e);
  throw e;
}

const { fps, duration: dur, ctx } = REEL;
const F = ctx.F;
document.title = `${REEL.meta.title || REEL.meta.name} · ${F.name} · preview`;
let t = Math.min(hashT(), dur), playing = false, busy = false, dirty = true, showSafe = store('safe') === '1', muted = store('mute') === '1';
let last = performance.now(), frames = 0, fpsT = performance.now();

// ------------------------------------------------------------------ layout
function fitStage() {
  const st = $('stage').getBoundingClientRect();
  const k = Math.min(st.width / F.W, st.height / F.H);
  const w = Math.floor(F.W * k), h = Math.floor(F.H * k);
  Object.assign($('wrap').style, { width: w + 'px', height: h + 'px' });
  const ov = $('ov');
  ov.width = Math.round(w * devicePixelRatio); ov.height = Math.round(h * devicePixelRatio);
  const sc = $('sc');
  const r = $('scrub').getBoundingClientRect();
  sc.width = Math.round(r.width * devicePixelRatio); sc.height = Math.round(r.height * devicePixelRatio);
  dirty = true;
}
addEventListener('resize', fitStage);

// ------------------------------------------------------------------ formats
for (const k of Object.keys(FORMATS)) {
  const b = document.createElement('button');
  b.textContent = FORMATS[k].name;
  b.title = `format ${k}`;
  if (k === REEL.format) b.className = 'on';
  b.onclick = () => { const q = new URLSearchParams(location.search); q.set('format', k); location.href = `${location.pathname}?${q}#t=${t.toFixed(3)}`; };
  $('fmts').appendChild(b);
}

// ------------------------------------------------------------------ sound
const audioSrc = REEL.film.audio || REEL.meta.audio;
let audio = null;
if (audioSrc) {
  audio = new Audio(/^(\/|https?:)/.test(audioSrc) ? audioSrc : `${ctx.film}/${audioSrc}`);
  audio.preload = 'auto';
  audio.muted = muted;
}
const songStart = REEL.meta.songStart || 0;       // the film's t = 0 sits this far into the audio file
$('mute').textContent = muted ? 'Sound off' : 'Sound on';
$('mute').style.display = audio ? '' : 'none';

function play() {
  if (t >= dur - 1e-3) t = 0;
  playing = true;
  $('play').textContent = 'Pause';
  last = performance.now();
  if (audio) { audio.currentTime = t + songStart; audio.play().catch(() => {}); }
}
function pause() {
  playing = false;
  $('play').textContent = 'Play';
  if (audio) audio.pause();
  dirty = true;
}
function seek(v) {
  t = Math.max(0, Math.min(dur, v));
  if (audio && playing) audio.currentTime = t + songStart;
  history.replaceState(null, '', `#t=${t.toFixed(3)}`);
  dirty = true;
}

// ------------------------------------------------------------------ drawing
function drawOverlay() {
  const ov = $('ov'), c = ov.getContext('2d');
  c.clearRect(0, 0, ov.width, ov.height);
  if (!showSafe) return;
  const k = ov.width / F.W;
  const [x0, y0, x1, y1] = F.safe;
  c.strokeStyle = 'rgba(255,154,77,0.9)';
  c.lineWidth = Math.max(1, devicePixelRatio);
  c.setLineDash([6 * devicePixelRatio, 5 * devicePixelRatio]);
  c.strokeRect(x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k);
  c.setLineDash([]);
  c.strokeStyle = 'rgba(255,255,255,0.25)';
  c.beginPath();
  c.moveTo(ov.width / 2, 0); c.lineTo(ov.width / 2, ov.height);
  c.moveTo(0, ov.height / 2); c.lineTo(ov.width, ov.height / 2);
  for (const f of [1 / 3, 2 / 3]) { c.moveTo(ov.width * f, 0); c.lineTo(ov.width * f, ov.height); c.moveTo(0, ov.height * f); c.lineTo(ov.width, ov.height * f); }
  c.stroke();
}

const edits = REEL.edits, cues = REEL.cues;
function drawScrub() {
  const sc = $('sc'), c = sc.getContext('2d');
  const W = sc.width, H = sc.height, d = devicePixelRatio;
  const X = v => (v / dur) * W;
  c.clearRect(0, 0, W, H);
  const G = ctx.grid;
  if (G) {
    const b0 = Math.ceil(G.beat(0)), b1 = Math.floor(G.beat(dur));
    for (let b = b0; b <= b1; b++) {
      const bar = b % (G.meter || 4) === 0;
      c.fillStyle = bar ? '#4a505c' : '#2c3038';
      c.fillRect(Math.round(X(G.t(b))), bar ? 0 : H * 0.55, d, bar ? H : H * 0.45);
    }
  }
  c.fillStyle = '#ff5c7a';
  for (const e of edits) c.fillRect(Math.round(X(e.t)) - d, 0, 2 * d, H * 0.4);
  c.fillStyle = 'rgba(151,252,228,0.8)';
  for (const q of cues) c.fillRect(Math.round(X(q.t)), H * 0.42, d, H * 0.12);
  c.fillStyle = 'rgba(255,154,77,0.25)';
  c.fillRect(0, 0, X(t), H);
  c.fillStyle = '#ff9a4d';
  c.fillRect(Math.round(X(t)) - d, 0, 2 * d, H);
}

function updateTime() {
  const G = ctx.grid;
  const f = Math.round(t * fps);
  const bb = G ? `  bar ${Math.floor(G.beat(t) / (G.meter || 4)) + 1}.${Math.floor(((G.beat(t) % (G.meter || 4)) + (G.meter || 4)) % (G.meter || 4)) + 1}` : '';
  const shot = REEL.film.shotAt ? `  ${REEL.film.shotAt(t, ctx) || ''}` : '';
  $('time').textContent = `${t.toFixed(2)} / ${dur.toFixed(2)} s  f${f}${bb}${shot}`;
}

async function loop(now) {
  if (playing) {
    if (audio && !audio.paused && !audio.muted) t = audio.currentTime - songStart;
    else t += (now - last) / 1000;
    if (t >= dur) { t = dur; pause(); }
  }
  last = now;
  if ((dirty || playing) && !busy) {
    busy = true;
    try { await REEL.render(t, playing ? 1 : +$('q').value); } catch (e) { $('err').style.display = 'block'; $('err').textContent = String(e.stack || e); pause(); }
    busy = false;
    dirty = false;
    frames++;
    drawOverlay(); drawScrub(); updateTime();
  }
  if (now - fpsT > 1000) { $('fps').textContent = playing ? `${Math.round(frames * 1000 / (now - fpsT))} fps` : ''; frames = 0; fpsT = now; }
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ input
$('play').onclick = () => (playing ? pause() : play());
$('safe').onclick = () => { showSafe = !showSafe; store('safe', showSafe ? '1' : '0'); $('safe').classList.toggle('on', showSafe); dirty = true; };
$('safe').classList.toggle('on', showSafe);
$('mute').onclick = () => { muted = !muted; store('mute', muted ? '1' : '0'); if (audio) audio.muted = muted; $('mute').textContent = muted ? 'Sound off' : 'Sound on'; };
$('q').onchange = () => { store('q', $('q').value); dirty = true; };
$('res').onchange = () => { store('res', $('res').value); const q = new URLSearchParams(location.search); q.delete('scale'); location.href = `${location.pathname}?${q}#t=${t.toFixed(3)}`; };
let dragging = false;
const scrubTo = e => { const r = $('scrub').getBoundingClientRect(); seek((e.clientX - r.left) / r.width * dur); };
$('scrub').addEventListener('pointerdown', e => { dragging = true; $('scrub').setPointerCapture(e.pointerId); scrubTo(e); });
$('scrub').addEventListener('pointermove', e => { if (dragging) scrubTo(e); });
$('scrub').addEventListener('pointerup', () => { dragging = false; });
addEventListener('keydown', e => {
  if (e.target === $('note')) {
    if (e.key === 'Escape') $('note').blur();
    return;
  }
  const G = ctx.grid;
  if (e.key === ' ') { e.preventDefault(); playing ? pause() : play(); }
  else if (e.key === 'ArrowRight') seek(e.altKey && G ? G.t(Math.floor(G.beat(t) + 1e-6) + 1) : t + (e.shiftKey ? 1 : 1 / fps));
  else if (e.key === 'ArrowLeft') seek(e.altKey && G ? G.t(Math.ceil(G.beat(t) - 1e-6) - 1) : t - (e.shiftKey ? 1 : 1 / fps));
  else if (e.key === 'Home') seek(0);
  else if (e.key === 'End') seek(dur);
  else if (e.key === 's' || e.key === 'S') $('safe').click();
  else if (e.key === 'm' || e.key === 'M') $('mute').click();
  else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); $('note').focus(); }
});
$('note').addEventListener('keydown', async e => {
  if (e.key !== 'Enter' || !$('note').value.trim()) return;
  const text = $('note').value.trim();
  const at = t;
  const r = await fetch('/__note', { method: 'POST', body: JSON.stringify({ film: ctx.film, t: at, format: REEL.format, text }) });
  const line = document.createElement('div');
  line.textContent = `${at.toFixed(2)} s: ${text}${r.ok ? '  (saved to notes.md)' : '  (not saved: ' + r.status + ')'}`;
  $('notes').prepend(line);
  $('note').value = '';
});

fitStage();
requestAnimationFrame(loop);

// Boots a film in the page and exposes the REEL interface the tools drive (render, stills, sheets,
// audit, cues). URL: /studio/engine/film.html?film=/<film folder>&format=h|v|s|p|k&samples=16&scale=1&alpha=0
//
// A film folder holds film.json (meta) and film.js, whose default export is:
//   { fonts: [{ family, src, weight, style }], images: { key: 'assets/x.png' }, audio: 'assets/song.mp3',
//     async init(ctx), build(t, ctx) -> { layers, post }, cues(ctx) -> [{ t, type, ... }],
//     automation(t, ctx) -> { name: value }, edits(ctx) -> [{ t, type }], async prepare(t, ctx) }
// ctx = { F (layout), W, H, fps, meta, images, format, engine, loadImage(src), song, film }
import { Engine } from './engine.js';
import { layout, resolveFormat } from './formats.js';
import { AUDIT } from './text.js';

const url = (filmPath, src) => (/^(\/|https?:)/.test(src) ? src : `${filmPath}/${src}`);

export async function loadFonts(list = [], filmPath = '') {
  await Promise.all(list.map(async f => {
    const face = new FontFace(f.family, `url("${encodeURI(url(filmPath, f.src))}")`, { weight: String(f.weight ?? 'normal'), style: f.style || 'normal', featureSettings: f.features || 'normal' });
    await face.load();
    document.fonts.add(face);
  }));
}

const imageCache = new Map();
export function loadImage(src) {
  let p = imageCache.get(src);
  if (!p) {
    p = new Promise((res, rej) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => img.decode().then(() => res(img), () => res(img));
      img.onerror = () => rej(new Error('image failed to load: ' + src));
      img.src = encodeURI(src);
    });
    imageCache.set(src, p);
  }
  return p;
}

export async function boot({ canvas, params = new URLSearchParams(location.search), overrides = {} } = {}) {
  const filmPath = (params.get('film') || '').replace(/\/$/, '');
  if (!filmPath) throw new Error('no ?film= given');
  const fmt = resolveFormat(overrides.format || params.get('format') || 'h');
  const scale = +(overrides.scale ?? params.get('scale') ?? 1) * fmt.scale;
  const alpha = (overrides.alpha ?? params.get('alpha')) === '1';
  const F = layout(fmt.key);
  const meta = await (await fetch(`${filmPath}/film.json`, { cache: 'no-store' })).json();
  const film = (await import(`${filmPath}/film.js?v=${Date.now()}`)).default;
  const fps = meta.fps || 60;
  const samples0 = +(overrides.samples ?? params.get('samples') ?? meta.samples ?? 16);
  await loadFonts(film.fonts || [], filmPath);
  const images = {};
  await Promise.all(Object.entries(film.images || {}).map(async ([k, src]) => { images[k] = await loadImage(url(filmPath, src)); }));
  const eng = new Engine(canvas, F.W, F.H, { scale, alpha });
  let song = null;
  if (meta.song) {
    const r = await fetch(url(filmPath, meta.song), { cache: 'no-store' });
    if (r.ok) song = await r.json();
    else console.warn(`${meta.song} not found yet: running on a steady grid`);
  }
  const ctx = { F, W: F.W, H: F.H, fps, meta, images, format: fmt.key, engine: eng, film: filmPath, song, loadImage: src => loadImage(url(filmPath, src)), params };
  await film.init?.(ctx);
  const duration = meta.duration ?? ctx.duration;
  // sub-frame time tk, frame time t: hard cuts are decided by the frame, so no frame blends two shots
  const build = (tk, t) => { ctx.frameT = t ?? tk; return film.build(tk, ctx); };
  const dbg = eng.gl.getExtension('WEBGL_debug_renderer_info');

  const REEL = {
    fps, W: F.W, H: F.H, outW: eng.iw, outH: eng.ih, scale, format: fmt.key, alpha, duration,
    frames: Math.round(duration * fps),
    meta, film, ctx, engine: eng,
    gpu: dbg ? eng.gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
    ready: Promise.resolve(true),
    get cues() { return (film.cues?.(ctx) || []).slice().sort((a, b) => a.t - b.t); },
    get edits() { return film.edits?.(ctx) || []; },
    curves(rate = 100) {
      const out = {};
      if (!film.automation) return { rate };
      for (let i = 0; i <= Math.round(duration * rate); i++) {
        const v = film.automation(i / rate, ctx);
        for (const k in v) (out[k] ||= []).push(+(+v[k]).toFixed(4));
      }
      return { rate, ...out };
    },
    async render(t, samples = samples0) {
      if (film.prepare) await film.prepare(t, ctx);
      return eng.render(t, build, { samples, fps, shutter: meta.shutter ?? 0.5 });
    },
    async frame(i, samples = samples0) {
      await this.render(i / fps, samples);
      return canvas.toDataURL('image/png').split(',')[1];
    },
    // render frame i and POST its raw RGBA pixels (rows bottom-up) to the renderer: no PNG encode,
    // no base64, no DevTools payload. Returns the byte count.
    async pushFrame(i, endpoint, samples = samples0) {
      await this.render(i / fps, samples);
      const gl = eng.gl;
      const buf = this.__px || (this.__px = new Uint8Array(eng.iw * eng.ih * 4));
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, eng.iw, eng.ih, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const r = await fetch(endpoint, { method: 'POST', body: buf });
      if (!r.ok) throw new Error(`frame ${i}: renderer answered ${r.status}`);
      return buf.length;
    },
    async frameJpeg(i, q = 0.9, samples = samples0) {
      await this.render(i / fps, samples);
      return canvas.toDataURL('image/jpeg', q).split(',')[1];
    },
    async still(t, q = 0.92, samples = samples0) {
      await this.render(t, samples);
      return canvas.toDataURL('image/jpeg', q).split(',')[1];
    },
    async sheet(times, cols = 4, tw = 480, samples = samples0) {
      const th = Math.round(tw * F.H / F.W);
      const rows = Math.ceil(times.length / cols);
      const sc = document.createElement('canvas');
      sc.width = cols * tw + (cols + 1) * 6;
      sc.height = rows * (th + 26) + 6;
      const c = sc.getContext('2d');
      c.fillStyle = '#1b1d21';
      c.fillRect(0, 0, sc.width, sc.height);
      for (let i = 0; i < times.length; i++) {
        const t = times[i];
        await this.render(t, samples);
        const x = 6 + (i % cols) * (tw + 6), y = 6 + Math.floor(i / cols) * (th + 26);
        c.drawImage(canvas, x, y, tw, th);
        c.fillStyle = '#dcdcdc';
        c.font = '500 15px ui-monospace, Consolas, monospace';
        const b = ctx.grid ? `  b${ctx.grid.beat(t).toFixed(2)}` : '';
        c.fillText(`${t.toFixed(3)}s  f${Math.round(t * fps)}${b}`, x + 4, y + th + 18);
      }
      return sc.toDataURL('image/jpeg', 0.88).split(',')[1];
    },
    // text boxes drawn at time t (one sample, no jitter), for tools/audit.mjs
    async audit(t) {
      AUDIT.on = true;
      AUDIT.items = [];
      await this.render(t, 1);
      AUDIT.on = false;
      return AUDIT.items.map(i => ({ ...i, x0: Math.round(i.x0), y0: Math.round(i.y0), x1: Math.round(i.x1), y1: Math.round(i.y1), px: +i.px.toFixed(1), alpha: +i.alpha.toFixed(3) }));
    },
    async bench(t, samples = samples0) {
      const a = performance.now();
      await this.render(t, samples);
      eng.gl.finish();
      return Math.round(performance.now() - a);
    },
  };
  return REEL;
}

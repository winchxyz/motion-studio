// Image sequences: generated video clips (Runway, Blender, any mp4) as frames the engine can draw.
// Extract with `python studio/tools/seq.py <clip.mp4> <film>/assets/seq/<name> --fps 30`, which writes
// frames (webp) and index.json. In the film:
//   const clip = await loadSequence(ctx, 'assets/seq/dance');            // in init
//   prepare: async (t, ctx) => clip.prepare(t - shotStart)                // before each frame
//   build:  { type: 'image', img: clip.frame(t - shotStart), x, y, h }    // or inside a group with fx
// Frames load lazily around the requested time and older ones are released (GPU textures too), so
// long clips cost little memory. frame(t) holds the last available frame if one is still loading.
export async function loadSequence(ctx, dir, { keep = 36, ahead = 12 } = {}) {
  const base = dir.startsWith('/') ? dir : `${ctx.film}/${dir}`;
  const index = await (await fetch(`${encodeURI(base)}/index.json`, { cache: 'no-store' })).json();
  return new Sequence(ctx, base, index, { keep, ahead });
}

class Sequence {
  constructor(ctx, base, index, { keep, ahead }) {
    this.ctx = ctx;
    this.base = base;
    this.fps = index.fps;
    this.count = index.count;
    this.w = index.w; this.h = index.h;
    this.ext = index.ext || 'webp';
    this.duration = this.count / this.fps;
    this.keep = keep;
    this.ahead = ahead;
    this.cache = new Map();        // frame index -> ImageBitmap
    this.loading = new Map();
    this.last = null;
    this.loop = !!index.loop;
  }
  index(t) {
    let i = Math.floor(t * this.fps + 1e-6);
    if (this.loop) i = ((i % this.count) + this.count) % this.count;
    return Math.max(0, Math.min(this.count - 1, i));
  }
  url(i) { return `${this.base}/${String(i + 1).padStart(5, '0')}.${this.ext}`; }
  async load(i) {
    if (this.cache.has(i)) return this.cache.get(i);
    if (!this.loading.has(i)) {
      this.loading.set(i, fetch(encodeURI(this.url(i))).then(r => r.blob()).then(b => createImageBitmap(b, { premultiplyAlpha: 'premultiply' })).then(bmp => {
        this.cache.set(i, bmp);
        this.loading.delete(i);
        return bmp;
      }));
    }
    return this.loading.get(i);
  }
  // load the frames around local time t (the shutter needs the neighbours), release far ones
  async prepare(t) {
    if (t < -1 || t > this.duration + 1 && !this.loop) return;
    const i = this.index(t);
    const need = [i - 1, i, i + 1].map(k => this.loop ? ((k % this.count) + this.count) % this.count : Math.max(0, Math.min(this.count - 1, k)));
    await Promise.all(need.map(k => this.load(k)));
    for (let k = 2; k < this.ahead; k++) if (i + k < this.count) this.load(i + k);   // read ahead, not awaited
    if (this.cache.size > this.keep) {
      const far = [...this.cache.keys()].sort((a, b) => Math.abs(b - i) - Math.abs(a - i));
      for (const k of far.slice(0, this.cache.size - this.keep)) {
        const bmp = this.cache.get(k);
        this.cache.delete(k);
        this.ctx.engine?.releaseImage(bmp);
        bmp.close?.();
      }
    }
  }
  frame(t) {
    const bmp = this.cache.get(this.index(t));
    if (bmp) this.last = bmp;
    return bmp || this.last;
  }
}

// Bringing still art to life, for generated characters and painted scenes:
//   puppet()   a cutout on a bendable mesh: breathing, sway, beat bounce, blinks, a mouth that opens
//              on sung words, expression swaps (all by swapping or deforming images, no skeleton)
//   parallax() depth layers of a scene under a camera (pan, zoom, drift): 2.5D from flat plates
//   shake()    seeded camera shake;  singing() mouth openness from timed lyric words
// Variant images (eyes closed, mouth open, a smile) must share the base image's framing: make them
// by editing the base image, never by generating anew.
import { clamp, hash, noise1, E, TAU } from './util.js';

// deterministic blink times: every ~`every` s with jitter, each `dur` long
export function blinking(t, { every = 3.4, dur = 0.13, seed = 1, double = 0.2 } = {}) {
  let tk = hash(seed * 7.13) * every;
  for (let k = 0; k < 400 && tk <= t + dur; k++) {
    if (t >= tk && t < tk + dur) return true;
    const dbl = hash(seed * 31 + k) < double;               // sometimes a quick double blink
    if (dbl && t >= tk + dur * 1.8 && t < tk + dur * 2.8) return true;
    tk += every * (0.55 + 0.9 * hash(seed * 13.7 + k * 1.91));
  }
  return false;
}

// how open the mouth is (0..1) at time t from timed words [{ start, end }], with a syllable flutter
export function singing(t, words, { attack = 0.04, release = 0.08, rate = 7, seed = 3 } = {}) {
  let v = 0;
  for (const w of words || []) {
    if (t < w.start - attack || t > w.end + release) continue;
    const a = clamp((t - (w.start - attack)) / attack), r = clamp(((w.end + release) - t) / release);
    const len = w.end - w.start;
    const flutter = len > 0.25 ? 0.65 + 0.35 * Math.abs(Math.sin((t - w.start) * rate * Math.PI + hash(seed + w.start) * 3)) : 1;
    v = Math.max(v, Math.min(a, r) * flutter);
  }
  return v;
}

// a character from one cutout image plus optional variants: { base, blink, mouth, ...expressions }
export function puppet(imgs, t, {
  x, y, h, anchor = [0.5, 1], rot = 0, flipX = false, alpha = 1, tint = null,
  breathe = 0.012, breatheRate = 0.28, sway = 5, swayRate = 0.23, seed = 1,
  bounce = 0, grid = null, blink = true, blinkOpts = {}, mouth = 0, expression = null,
} = {}) {
  const base = imgs.base || imgs;
  let img = base;
  if (expression && imgs[expression]) img = imgs[expression];
  else if (mouth > 0.45 && imgs.mouth) img = imgs.mouth;
  else if (blink && imgs.blink && blinking(t, { seed, ...blinkOpts })) img = imgs.blink;
  const br = Math.sin(TAU * breatheRate * t + seed);
  const hit = grid && bounce ? grid.pulse(t, { decay: 0.14 }) : 0;
  return {
    type: 'image', img, x, y: y - hit * bounce * 0.4, h, anchor, rot, flipX, alpha, tint,
    squash: 1 + breathe * br - hit * 0.04 * (bounce ? 1 : 0),
    bend: sway * noise1(t * swayRate * 2 + seed * 10) + hit * bounce * 0.15,
  };
}

// depth layers of a painted scene. layers: [{ img, depth, x, y, h, anchor }] in format px as framed at
// rest; depth 0 = at infinity (moves least), 1 = the subject plane, > 1 = foreground.
// cam: { x, y, zoom } offsets in format px at the subject plane.
export function parallax(F, layers, cam = {}) {
  const zx = cam.zoom ?? 1, cx = cam.x || 0, cy = cam.y || 0;
  return layers.map(L => {
    const d = L.depth ?? 1;
    const k = 1 + (zx - 1) * d;
    return {
      type: 'image', img: L.img, anchor: L.anchor || [0.5, 0.5], alpha: L.alpha ?? 1, tint: L.tint, blend: L.blend,
      x: F.cx + ((L.x ?? F.cx) - F.cx) * k - cx * d * zx,
      y: F.cy + ((L.y ?? F.cy) - F.cy) * k - cy * d * zx,
      h: (L.h ?? F.H) * k, w: L.w != null ? L.w * k : undefined,
      bend: L.bend, wave: L.wave, squash: L.squash, rot: L.rot,
    };
  });
}

// cover the frame with an image (the painted plate behind everything), with a slow push
export function plate(F, img, t, { push = 0.04, dur = 4, drift = [0, 0], anchor = [0.5, 0.5] } = {}) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const k = Math.max(F.W / iw, F.H / ih) * (1 + push * clamp(t / dur));
  return { type: 'image', img, x: F.cx + drift[0] * clamp(t / dur), y: F.cy + drift[1] * clamp(t / dur), w: iw * k, h: ih * k, anchor };
}

// seeded shake: returns { x, y, rot } for a group transform; amp in px, fades with `decay` after t0
export function shake(t, { amp = 12, freq = 14, seed = 1, t0 = -Infinity, decay = 0 } = {}) {
  const k = decay > 0 ? Math.exp(-Math.max(0, t - t0) / decay) * (t >= t0 ? 1 : 0) : 1;
  return {
    x: amp * k * noise1(t * freq + seed * 17.3),
    y: amp * k * noise1(t * freq + seed * 41.9 + 100),
    rot: amp * k * 0.0009 * noise1(t * freq * 0.7 + seed * 5.1 + 200),
  };
}

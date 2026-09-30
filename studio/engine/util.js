// Math, easing and springs. Every function here is pure, so any frame of the film can be
// rendered on its own from nothing but its time.

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => (b === a ? (x >= b ? 1 : 0) : clamp((x - a) / (b - a)));
export const smooth = t => t * t * (3 - 2 * t);
export const smoother = t => t * t * t * (t * (t * 6 - 15) + 10);
export const TAU = Math.PI * 2;

// CSS-style cubic-bezier easing.
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = t => ((ax * t + bx) * t + cx) * t;
  const Y = t => ((ay * t + by) * t + cy) * t;
  const dX = t => (3 * ax * t + 2 * bx) * t + cx;
  return x => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = X(t) - x;
      if (Math.abs(e) < 1e-7) return Y(t);
      const d = dX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const v = X(t);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return Y(t);
  };
}

export const E = {
  linear: t => t,
  inQuad: t => t * t,
  outQuad: t => 1 - (1 - t) * (1 - t),
  inOutQuad: t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
  inCubic: t => t * t * t,
  outCubic: t => 1 - (1 - t) ** 3,
  inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  inQuart: t => t * t * t * t,
  outQuart: t => 1 - (1 - t) ** 4,
  outQuint: t => 1 - (1 - t) ** 5,
  inExpo: t => (t <= 0 ? 0 : 2 ** (10 * t - 10)),
  outExpo: t => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  inOutExpo: t => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2),
  outBack: t => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
  outBackSoft: t => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2,
  inBack: t => 2.70158 * t * t * t - 1.70158 * t * t,
  snap: bezier(0.16, 1, 0.3, 1),       // fast out, long settle: the house ease
  swift: bezier(0.65, 0, 0.35, 1),     // symmetric in-out
  whip: bezier(0.83, 0, 0.17, 1),      // aggressive in-out for camera whips
  accel: bezier(0.55, 0, 0.9, 0.35),   // leave the ground
  soft: bezier(0.33, 0, 0.2, 1),
  glide: bezier(0.4, 0, 0.1, 1),
};

// Step response of a damped spring from 0 to 1, t in seconds.
export function spring(t, freq = 3, zeta = 0.45) {
  if (t <= 0) return 0;
  const w = TAU * freq;
  if (zeta < 1) {
    const wd = w * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + (zeta * w / wd) * Math.sin(wd * t));
  }
  return 1 - Math.exp(-w * t) * (1 + w * t);
}

// Decaying oscillation that starts at 0 (an impulse), peak close to 1.
export function wobble(t, freq = 4, zeta = 0.3) {
  if (t <= 0) return 0;
  const w = TAU * freq, wd = w * Math.sqrt(1 - zeta * zeta);
  return Math.exp(-zeta * w * t) * Math.sin(wd * t);
}

// Keyframe track: keys = [[t, value, ease?], ...]; the ease on a key shapes the segment that ends on it.
// Values may be numbers or arrays of numbers.
export function track(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e = E.swift] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const k = e(invLerp(t0, t1, t));
      return Array.isArray(v0) ? v0.map((a, j) => lerp(a, v1[j], k)) : lerp(v0, v1, k);
    }
  }
  return keys[keys.length - 1][1];
}

// Deterministic hashing and value noise.
export function hash(n) {
  let x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}
export function noise1(x) {
  const i = Math.floor(x), f = x - i;
  return lerp(hash(i), hash(i + 1), smooth(f)) * 2 - 1;
}

// A parabolic hop from a to b that bulges h above the straight line at its middle.
// Returns [x, y, vx, vy] (y down; velocities per unit k).
export function hop(a, b, h, k) {
  const x = lerp(a[0], b[0], k);
  const y = lerp(a[1], b[1], k) - 4 * h * k * (1 - k);
  return [x, y, b[0] - a[0], (b[1] - a[1]) - 4 * h * (1 - 2 * k)];
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
}
export const toLin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const hexToLin = hex => hexToRgb(hex).map(toLin);
export const mixHex = (a, b, t) => {
  const A = hexToRgb(a), B = hexToRgb(b);
  const c = A.map((v, i) => Math.round(lerp(v, B[i], t) * 255));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
};
export const rgba = (hex, a) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
};

// Halton sequence for sub-pixel jitter.
export function halton(i, b) {
  let f = 1, r = 0;
  i += 1;
  while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); }
  return r;
}

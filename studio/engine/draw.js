// Canvas 2D drawing kit: colour helpers, rounded shapes, shadows, SVG paths (fill, stroke, draw-on),
// simple marks (arrows, stars, polygons, cursors). Everything takes format pixels.
import { clamp, lerp, hexToRgb } from './util.js';

// ---------------------------------------------------------------- colour
export const rgba = (hex, a = 1) => {
  if (hex.startsWith('rgb')) return hex;
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
};
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const c = A.map((v, i) => Math.round(lerp(v, B[i], clamp(t)) * 255));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- shapes
export function rr(ctx, x, y, w, h, r) {
  const rad = Array.isArray(r) ? r : [r, r, r, r];
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, rad.map(v => Math.max(0, Math.min(v, Math.abs(w) / 2, Math.abs(h) / 2))));
}
export function fillRR(ctx, x, y, w, h, r, color) {
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = color;
  ctx.fill();
}
export function strokeRR(ctx, x, y, w, h, r, color, lw = 1) {
  rr(ctx, x + lw / 2, y + lw / 2, w - lw, h - lw, r);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.stroke();
}
// a soft drop shadow under a rounded box (draw it before the box). Layers make it read as real light:
// a tight contact shadow plus a wide ambient one.
export function shadowRR(ctx, x, y, w, h, r, { color = 'rgba(0,0,0,0.35)', blur = 40, dy = 16, contact = true } = {}) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = dy;
  fillRR(ctx, x, y, w, h, r, '#000');
  if (contact) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur * 0.2;
    ctx.shadowOffsetY = dy * 0.15;
    fillRR(ctx, x, y, w, h, r, '#000');
  }
  ctx.restore();
}
export function circle(ctx, x, y, r, fill = null, stroke = null, lw = 1) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
export function polygon(ctx, x, y, r, n, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + i * Math.PI * 2 / n;
    i ? ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)) : ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a));
  }
  ctx.closePath();
}
export function star(ctx, x, y, r, n = 5, inner = 0.45, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + i * Math.PI / n, rr_ = i % 2 ? r * inner : r;
    i ? ctx.lineTo(x + rr_ * Math.cos(a), y + rr_ * Math.sin(a)) : ctx.moveTo(x + rr_ * Math.cos(a), y + rr_ * Math.sin(a));
  }
  ctx.closePath();
}
// a line drawn on from a to b (progress 0..1), with round caps
export function line(ctx, ax, ay, bx, by, color, lw = 2, progress = 1) {
  if (progress <= 0) return;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(lerp(ax, bx, progress), lerp(ay, by, progress));
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.stroke();
}
export function arrow(ctx, ax, ay, bx, by, color, lw = 3, head = 14, progress = 1) {
  const x = lerp(ax, bx, progress), y = lerp(ay, by, progress);
  line(ctx, ax, ay, bx, by, color, lw, progress);
  const a = Math.atan2(by - ay, bx - ax);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - head * Math.cos(a - 0.45), y - head * Math.sin(a - 0.45));
  ctx.moveTo(x, y);
  ctx.lineTo(x - head * Math.cos(a + 0.45), y - head * Math.sin(a + 0.45));
  ctx.stroke();
}

// ---------------------------------------------------------------- SVG paths
const P2D = new Map();
export const path2d = d => { let p = P2D.get(d); if (!p) { p = new Path2D(d); P2D.set(d, p); } return p; };
// fill SVG path data drawn on a (vw x vh) grid into a box of size s centred at (cx, cy)
export function svgFill(ctx, d, cx, cy, s, color, { vw = 24, vh = null, evenodd = false, alpha = 1 } = {}) {
  vh = vh ?? vw;
  const k = s / Math.max(vw, vh);
  ctx.save();
  ctx.translate(cx - vw * k / 2, cy - vh * k / 2);
  ctx.scale(k, k);
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  for (const dd of Array.isArray(d) ? d : [d]) ctx.fill(path2d(dd), evenodd ? 'evenodd' : 'nonzero');
  ctx.restore();
}
// stroke SVG path data; progress < 1 draws it on (needs `length`, the path length in path units,
// or a generous default)
export function svgStroke(ctx, d, cx, cy, s, color, lw = 1.5, { vw = 24, vh = null, alpha = 1, progress = 1, length = 200 } = {}) {
  vh = vh ?? vw;
  const k = s / Math.max(vw, vh);
  ctx.save();
  ctx.translate(cx - vw * k / 2, cy - vh * k / 2);
  ctx.scale(k, k);
  ctx.globalAlpha *= alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = lw / k;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (progress < 1) { ctx.setLineDash([length, length]); ctx.lineDashOffset = length * (1 - progress); }
  for (const dd of Array.isArray(d) ? d : [d]) ctx.stroke(path2d(dd));
  ctx.restore();
}

// the macOS-style pointer and a click ripple, for UI walkthroughs
export function cursor(ctx, x, y, s = 1, { fill = '#111', stroke = '#fff', click = 0 } = {}) {
  if (click > 0 && click < 1) circle(ctx, x, y, 8 + 34 * click, null, rgba(fill, 0.35 * (1 - click)), 3);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s * (1 - 0.12 * Math.sin(Math.PI * clamp(click * 3))), s * (1 - 0.12 * Math.sin(Math.PI * clamp(click * 3))));
  const p = path2d('M0 0 L0 24 L6.5 18.2 L10.6 27.4 L14.4 25.7 L10.4 16.8 L18.8 16.2 Z');
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke; ctx.lineWidth = 2.4; ctx.stroke(p);
  ctx.fillStyle = fill; ctx.fill(p);
  ctx.restore();
}

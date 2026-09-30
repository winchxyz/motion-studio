// Typography: text with tracking and an audit trail, wrapping and fitting, and the kinetic moves
// (word and letter reveals, typewriter, odometer, slot-machine roller, text on a path, marker
// highlights, stamps). Sizes and positions are format pixels.
import { clamp, lerp, invLerp, E } from './util.js';
import { rgba } from './draw.js';

// ---------------------------------------------------------------- audit
// While AUDIT.on, every piece of text records its on-screen box (format px) so tools/audit.mjs can
// check the safe area, the minimum size, overlaps and how long each line stays readable.
export const AUDIT = { on: false, items: [], layer: 'screen' };
export function auditMark(ctx, id, x, y, w, h, size, extra = {}) {
  if (!AUDIT.on) return;
  const m = ctx.getTransform();
  const k = ctx.canvas.__scale || 1;
  const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([px, py]) => [(m.a * px + m.c * py + m.e) / k, (m.b * px + m.d * py + m.f) / k]);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  AUDIT.items.push({ id, layer: ctx.canvas.__plane ? 'plane' : AUDIT.layer, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), px: size * Math.hypot(m.a, m.b) / k, alpha: ctx.globalAlpha, ...extra });
}

// ---------------------------------------------------------------- basics
export function font(ctx, weight, size, family = 'sans-serif', style = '') {
  const fam = /^["']/.test(family) || family.includes(',') || !family.includes(' ') ? family : `"${family}"`;
  ctx.font = `${style ? style + ' ' : ''}${weight} ${size}px ${fam}`;
}
export function measure(ctx, str, track = 0) {
  ctx.letterSpacing = `${track}px`;
  const w = ctx.measureText(str).width;
  ctx.letterSpacing = '0px';
  return w - (track && str.length ? track : 0);
}
const sizeOf = ctx => parseFloat(ctx.font.match(/(\d+(\.\d+)?)px/)[1]);

// draw text; align 'left' | 'center' | 'right'; baseline alphabetic at y. Returns the width.
// deco: true marks decorative text the audit ignores (background patterns, HUD micro-labels)
export function text(ctx, str, x, y, { color = '#fff', align = 'left', track = 0, id = null, alpha = 1, deco = false, stroke = null, strokeW = 0, audit = null } = {}) {
  str = String(str);
  ctx.letterSpacing = `${track}px`;
  const w = ctx.measureText(str).width - (track && str.length ? track : 0);
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  const a0 = ctx.globalAlpha;
  ctx.globalAlpha = a0 * alpha;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (stroke && strokeW) { ctx.strokeStyle = stroke; ctx.lineWidth = strokeW; ctx.lineJoin = 'round'; ctx.strokeText(str, x0, y); }
  ctx.fillStyle = color;
  ctx.fillText(str, x0, y);
  if (AUDIT.on && str.trim()) {
    const px = sizeOf(ctx);
    auditMark(ctx, id || 'text', x0, y - px * 0.74, w, px * 0.98, px, { text: str, deco, alpha: ctx.globalAlpha, ...(audit || {}) });
  }
  ctx.globalAlpha = a0;
  ctx.letterSpacing = '0px';
  return w;
}
// several styled runs on one line: parts = [[str, color, weight?, family?, style?]]
export function runs(ctx, parts, x, y, { size, family = 'sans-serif', align = 'left', track = 0, id = null, alpha = 1 } = {}) {
  const ws = parts.map(([s, , wgt, fam, st]) => { font(ctx, wgt || 400, size, fam || family, st); return measure(ctx, s, track); });
  const total = ws.reduce((a, b) => a + b, 0);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  parts.forEach(([s, col, wgt, fam, st], i) => {
    font(ctx, wgt || 400, size, fam || family, st);
    text(ctx, s, cx, y, { color: col, track, id: id ? `${id}.${i}` : null, alpha });
    cx += ws[i];
  });
  return total;
}
export function fit(ctx, str, maxW, track = 0) {
  if (measure(ctx, str, track) <= maxW) return str;
  let s = str;
  while (s.length > 1 && measure(ctx, s.trimEnd() + '…', track) > maxW) s = s.slice(0, -1);
  return s.trimEnd() + '…';
}
export function wrap(ctx, str, maxW, track = 0) {
  const lines = [];
  for (const para of String(str).split('\n')) {
    let cur = '';
    for (const w of para.split(' ')) {
      const t = cur ? cur + ' ' + w : w;
      if (measure(ctx, t, track) <= maxW || !cur) cur = t;
      else { lines.push(cur); cur = w; }
    }
    lines.push(cur);
  }
  return lines;
}
// the largest size (<= max) at which str fits maxW in this weight and family
export function fitSize(ctx, str, maxW, { weight = 700, family = 'sans-serif', max = 200, min = 10, track = 0 } = {}) {
  font(ctx, weight, 100, family);
  const w100 = measure(ctx, str, track * 100 / max);
  return clamp(Math.floor(100 * maxW / Math.max(w100, 1)), min, max);
}

// ---------------------------------------------------------------- kinetic type
// Words appear one after another (rise + fade, optional blur and scale), then optionally leave.
// Returns the line's width. t is the film/shot time; t0 when the first word starts.
export function words(ctx, str, x, y, t, t0, {
  size = 64, weight = 700, family = 'sans-serif', style = '', color = '#fff', track = 0, align = 'left',
  stagger = 0.06, dur = 0.45, rise = 0.35, blur = 0, scale = 0, ease = E.snap, id = 'words',
  out = null, outDur = 0.3, outStagger = 0.03, outRise = -0.2, colors = null, alpha = 1,
} = {}) {
  font(ctx, weight, size, family, style);
  const parts = String(str).split(' ');
  const space = measure(ctx, ' ', track);
  const ws = parts.map(p => measure(ctx, p, track));
  const total = ws.reduce((a, b) => a + b, 0) + space * (parts.length - 1);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const k0 = ctx.getTransform();
  const kk = Math.hypot(k0.a, k0.b);
  parts.forEach((p, i) => {
    const kin = ease(clamp(invLerp(t0 + i * stagger, t0 + i * stagger + dur, t)));
    const kout = out != null ? E.inCubic(clamp(invLerp(out + i * outStagger, out + i * outStagger + outDur, t))) : 0;
    const a = kin * (1 - kout) * alpha;
    if (a > 0.002) {
      ctx.save();
      const dy = (1 - kin) * rise * size + kout * outRise * size;
      const sc = 1 + (1 - kin) * scale;
      ctx.translate(cx + ws[i] / 2, y + dy);
      ctx.scale(sc, sc);
      const b = blur * (1 - kin) + blur * kout;
      if (b > 0.3) ctx.filter = `blur(${(b * kk).toFixed(2)}px)`;
      text(ctx, p, -ws[i] / 2, 0, { color: colors ? colors[i] ?? color : color, track, id: `${id}.${i}`, alpha: a });
      ctx.restore();
    }
    cx += ws[i] + space;
  });
  return total;
}

// Letters appear one after another (drop, fade, optional random order by seed)
export function letters(ctx, str, x, y, t, t0, { size = 64, weight = 700, family = 'sans-serif', color = '#fff', track = 0, align = 'left', stagger = 0.025, dur = 0.35, rise = 0.5, ease = E.outBack, order = null, id = 'letters', alpha = 1 } = {}) {
  font(ctx, weight, size, family);
  const chars = [...String(str)];
  const ws = chars.map(c => measure(ctx, c, 0) + track);
  const total = ws.reduce((a, b) => a + b, 0) - track;
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  chars.forEach((c, i) => {
    const j = order ? order[i] : i;
    const k = clamp(invLerp(t0 + j * stagger, t0 + j * stagger + dur, t));
    const e = ease(k);
    if (k > 0 && c !== ' ') text(ctx, c, cx, y + (1 - e) * rise * size, { color, id: `${id}.${i}`, alpha: clamp(k * 3) * alpha, deco: true });
    cx += ws[i];
  });
  if (AUDIT.on && t > t0 + chars.length * stagger) auditMark(ctx, id, x - (align === 'center' ? total / 2 : align === 'right' ? total : 0), y - size * 0.74, total, size * 0.98, size, { text: str, alpha: ctx.globalAlpha * alpha });
  return total;
}

// Typewriter: the first round(progress * length) characters, with a blinking caret
export function typeOn(ctx, str, x, y, progress, { color = '#fff', caret = true, caretColor = null, t = 0, track = 0, id = 'type', align = 'left', alpha = 1 } = {}) {
  const n = Math.round(clamp(progress) * str.length);
  const shown = str.slice(0, n);
  const w = text(ctx, shown, x, y, { color, track, id, align, alpha, audit: progress < 1 ? { typing: true } : null });
  if (caret) {
    const size = sizeOf(ctx);
    const on = progress < 1 || Math.floor(t * 2.2) % 2 === 0;
    if (on) {
      ctx.fillStyle = rgba(caretColor || color, alpha);
      const cx = align === 'center' ? x + w / 2 : align === 'right' ? x : x + w;
      ctx.fillRect(cx + size * 0.06, y - size * 0.78, Math.max(2, size * 0.07), size * 0.95);
    }
  }
  return w;
}

export function formatNumber(v, { decimals = 0, sep = ',', dot = '.', prefix = '', suffix = '' } = {}) {
  const neg = v < 0;
  const s = Math.abs(v).toFixed(decimals);
  const [i, f] = s.split('.');
  const body = i.replace(/\B(?=(\d{3})+(?!\d))/g, sep) + (f ? dot + f : '');
  return (neg ? '−' : '') + prefix + body + suffix;
}

// Odometer: digits roll between integers; value may be fractional mid-roll. Tabular figures assumed.
export function odometer(ctx, value, x, y, { digits = null, size = 80, weight = 700, family = 'sans-serif', color = '#fff', align = 'left', sep = '', id = 'odo', alpha = 1 } = {}) {
  font(ctx, weight, size, family);
  const whole = Math.floor(value), frac = value - whole;
  const str = String(whole).padStart(digits || 1, '0');
  const next = String(whole + 1).padStart(str.length, '0');
  const cw = measure(ctx, '0');
  const sw = sep ? measure(ctx, sep) : 0;
  const groups = str.length;
  const seps = sep ? Math.floor((groups - 1) / 3) : 0;
  const total = cw * groups + sw * seps;
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const lh = size * 1.05;
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - 4, y - size * 0.9, total + 8, size * 1.15);
  ctx.clip();
  for (let i = 0; i < groups; i++) {
    // a digit rolls when every digit to its right is rolling over from 9
    const rolls = str.slice(i + 1).split('').every(c => c === '9') || i === groups - 1;
    const f = rolls && str[i] !== next[i] ? E.inOutCubic(frac) : 0;
    text(ctx, str[i], cx, y - f * lh, { color, id: `${id}.${i}`, alpha, deco: true });
    if (f > 0) text(ctx, next[i], cx, y + (1 - f) * lh, { color, alpha, deco: true });
    cx += cw;
    if (sep && (groups - 1 - i) % 3 === 0 && i < groups - 1) { text(ctx, sep, cx, y, { color, alpha, deco: true }); cx += sw; }
  }
  ctx.restore();
  auditMark(ctx, id, align === 'center' ? x - total / 2 : align === 'right' ? x - total : x, y - size * 0.74, total, size * 0.98, size, { text: str, alpha: ctx.globalAlpha * alpha });
  return total;
}

// Slot-machine roller: items stacked vertically, pos = fractional index shown; clipped to one line
export function roller(ctx, items, pos, x, y, { size = 80, weight = 700, family = 'sans-serif', style = '', color = '#fff', align = 'left', track = 0, id = 'roller', alpha = 1, blur = 0 } = {}) {
  font(ctx, weight, size, family, style);
  const lh = size * 1.1;
  ctx.save();
  ctx.beginPath();
  const wmax = Math.max(...items.map(s => measure(ctx, s, track)));
  const x0 = align === 'center' ? x - wmax / 2 - 20 : align === 'right' ? x - wmax - 20 : x - 20;
  ctx.rect(x0, y - size * 0.95, wmax + 40, size * 1.25);
  ctx.clip();
  const i0 = Math.floor(pos);
  for (const i of [i0 - 1, i0, i0 + 1]) {
    if (i < 0 || i >= items.length) continue;
    const d = i - pos;
    if (Math.abs(d) > 1.2) continue;
    ctx.save();
    if (blur) { const m = ctx.getTransform(); ctx.filter = `blur(${(blur * Math.abs(d) * Math.hypot(m.a, m.b)).toFixed(2)}px)`; }
    text(ctx, items[i], x, y + d * lh, { color, align, track, id: `${id}.${i}`, alpha: alpha * (1 - clamp(Math.abs(d) * 0.7)), deco: Math.abs(d) > 0.5 });
    ctx.restore();
  }
  ctx.restore();
}

// Text along a path: at(s) -> { x, y, a } for arc length s (px). Letters are placed by width.
export function onPath(ctx, str, at, { start = 0, color = '#fff', track = 0, id = 'path', alpha = 1 } = {}) {
  let s = start;
  for (const c of String(str)) {
    const w = measure(ctx, c, 0);
    const p = at(s + w / 2);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a);
    text(ctx, c, -w / 2, 0, { color, alpha, deco: true });
    ctx.restore();
    s += w + track;
  }
  return s - start;
}
export const circlePath = (cx, cy, r, a0 = -Math.PI / 2) => s => { const a = a0 + s / r; return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), a: a + Math.PI / 2 }; };

// a marker highlight behind a word, drawn on from the left
export function highlight(ctx, x, y, w, h, progress, color, { skew = 0.08, alpha = 0.9 } = {}) {
  const p = clamp(progress);
  if (p <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + h * skew);
  ctx.lineTo(x + w * p, y);
  ctx.lineTo(x + w * p, y + h * (1 - skew));
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
export function underline(ctx, x, y, w, progress, color, lw = 4) {
  const p = clamp(progress);
  if (p <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * p, lw);
}
// a rubber stamp that lands with an overshoot: impact 0..1 over the first ~0.25 s
export function stamp(ctx, str, x, y, t, t0, { size = 56, weight = 800, family = 'sans-serif', color = '#d33', rot = -0.12, border = 5, pad = 18, id = 'stamp' } = {}) {
  const k = clamp((t - t0) / 0.22);
  if (k <= 0) return;
  const sc = lerp(2.2, 1, E.outCubic(k)) + (k >= 1 ? 0 : 0);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(sc, sc);
  ctx.globalAlpha *= clamp(k * 2.5) * 0.92;
  font(ctx, weight, size, family);
  const w = measure(ctx, str, size * 0.04);
  ctx.strokeStyle = color;
  ctx.lineWidth = border;
  ctx.strokeRect(-w / 2 - pad, -size * 0.78 - pad * 0.7, w + pad * 2, size + pad * 1.4);
  text(ctx, str, 0, size * 0.1, { color, align: 'center', track: size * 0.04, id });
  ctx.restore();
}

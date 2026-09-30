// Lyric and subtitle captions from timed lines (song.json lines: { text, start, end, words }).
//   const line = lineAt(song.lines, t);
//   drawCaption(ctx, line, t, F, { style: 'pop', family: '"Inter Display"', color: '#fff' });
// Styles:
//   'box'      the line in a box at the bottom (subtitle look), words brighten as they are sung
//   'karaoke'  the line in place, a sweep colours the sung part
//   'pop'      each word pops in when it is sung and the line leaves together
//   'kinetic'  one big word at a time in the centre (keywords in the accent colour)
import { clamp, E, invLerp } from './util.js';
import { font, measure, text, AUDIT } from './text.js';
import { fillRR, rgba } from './draw.js';

export function lineAt(lines, t, { lead = 0.12, hold = 0.35 } = {}) {
  let best = null;
  for (const l of lines || []) if (t >= l.start - lead && t <= l.end + hold) best = l;
  return best;
}

export function drawCaption(ctx, line, t, F, {
  style = 'box', family = 'sans-serif', weight = 700, size = null, color = '#ffffff', dim = 'rgba(255,255,255,0.45)',
  accent = '#ffd23f', box = 'rgba(10,10,14,0.72)', y = null, maxW = null, keywords = [], upper = false, id = 'caption',
} = {}) {
  if (!line) return;
  const words = line.words?.length ? line.words : [{ w: line.text, start: line.start, end: line.end }];
  const S = size ?? F.pick({ h: 46, v: 54, s: 50, p: 52 });
  const W = maxW ?? (F.safeBox.w - 40);
  const Y = y ?? (F.portrait ? F.safe[3] - S * 1.2 : F.safe[3] - S * 0.9);
  const inA = clamp((t - (line.start - 0.12)) / 0.18), outA = 1 - clamp((t - (line.end + 0.2)) / 0.18);
  const a = Math.min(inA, outA);
  if (a <= 0) return;
  const txt = w => (upper ? w.toUpperCase() : w);
  font(ctx, weight, S, family);
  const space = measure(ctx, ' ');
  const widths = words.map(w => measure(ctx, txt(w.w)));
  // wrap into rows that fit W
  const rows = [[]];
  let rw = 0;
  words.forEach((w, i) => {
    const add = widths[i] + (rows[rows.length - 1].length ? space : 0);
    if (rw + add > W && rows[rows.length - 1].length) { rows.push([]); rw = 0; }
    rows[rows.length - 1].push(i);
    rw += widths[i] + (rows[rows.length - 1].length > 1 ? space : 0);
  });
  const lh = S * 1.22;
  const y0 = Y - (rows.length - 1) * lh;
  ctx.save();
  ctx.globalAlpha *= a;
  if (style === 'kinetic') {
    const cur = words.find(w => t >= w.start - 0.05 && t <= w.end + 0.12) || words.filter(w => w.start <= t).pop();
    if (cur) {
      const k = E.outBack(clamp((t - (cur.start - 0.05)) / 0.16));
      const big = S * 2.6;
      font(ctx, 800, big, family);
      const hot = keywords.some(kw => cur.w.toLowerCase().includes(kw.toLowerCase()));
      ctx.save();
      ctx.translate(F.cx, F.cy);
      ctx.scale(0.6 + 0.4 * k, 0.6 + 0.4 * k);
      text(ctx, txt(cur.w), 0, big * 0.35, { color: hot ? accent : color, align: 'center', id, audit: { caption: true } });
      ctx.restore();
    }
    ctx.restore();
    return;
  }
  rows.forEach((row, r) => {
    const tw = row.reduce((s, i) => s + widths[i], 0) + space * (row.length - 1);
    let x = F.cx - tw / 2;
    const yy = y0 + r * lh;
    if (style === 'box') fillRR(ctx, x - S * 0.45, yy - S * 0.92, tw + S * 0.9, S * 1.28, S * 0.22, box);
    row.forEach(i => {
      const w = words[i];
      const sung = clamp(invLerp(w.start, Math.max(w.end, w.start + 0.05), t));
      const on = t >= w.start - 0.03;
      const hot = keywords.some(kw => w.w.toLowerCase().includes(kw.toLowerCase()));
      if (style === 'pop') {
        const k = E.outBack(clamp((t - (w.start - 0.04)) / 0.2));
        if (k > 0) {
          ctx.save();
          ctx.translate(x + widths[i] / 2, yy);
          ctx.scale(0.7 + 0.3 * k, 0.7 + 0.3 * k);
          text(ctx, txt(w.w), -widths[i] / 2, (1 - k) * S * 0.3, { color: hot ? accent : color, alpha: clamp(k * 1.5), id: `${id}.${i}`, audit: { caption: true } });
          ctx.restore();
        }
      } else if (style === 'karaoke') {
        text(ctx, txt(w.w), x, yy, { color: dim, id: `${id}.${i}`, audit: { caption: true } });
        if (sung > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, yy - S, widths[i] * sung, S * 1.4);
          ctx.clip();
          text(ctx, txt(w.w), x, yy, { color: hot ? accent : color, deco: true });
          ctx.restore();
        }
      } else {
        text(ctx, txt(w.w), x, yy, { color: on ? (hot ? accent : color) : dim, id: `${id}.${i}`, audit: { caption: true } });
      }
      x += widths[i] + space;
    });
  });
  ctx.restore();
}

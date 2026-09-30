// Engine test: every layer type, a group with a look, per-shot looks, five transitions, all formats.
import { E, clamp, track, spring, wobble } from '/studio/engine/util.js';
import { Grid, Edit, Cues } from '/studio/engine/timeline.js';
import { font, text, words, odometer, roller, typeOn, highlight } from '/studio/engine/text.js';
import { fillRR, shadowRR, rgba, circle } from '/studio/engine/draw.js';

const D = '"Inter Display"', T = '"Inter Text"', S = '"Newsreader Display"', M = '"Geist Mono"';
let G, EDIT, CUES;

export default {
  fonts: [
    { family: 'Inter Display', src: '/studio/fonts/InterDisplay-SemiBold.ttf', weight: 600 },
    { family: 'Inter Display', src: '/studio/fonts/InterDisplay-Bold.ttf', weight: 700 },
    { family: 'Inter Text', src: '/studio/fonts/InterText-Medium.ttf', weight: 500 },
    { family: 'Newsreader Display', src: '/studio/fonts/NewsreaderDisplay-Italic.ttf', weight: 400, style: 'italic' },
    { family: 'Geist Mono', src: '/studio/fonts/GeistMono-VariableFont_wght.ttf', weight: '100 900' },
  ],
  images: { blob: 'assets/blob.png' },

  init(ctx) {
    const { F, images } = ctx;
    G = new Grid({ bpm: ctx.meta.bpm });
    ctx.grid = G;
    const hero = (t, x, y, h) => ({
      type: 'image', img: images.blob, x, y, h, anchor: [0.5, 1],
      squash: 1 - 0.08 * G.pulse(t, { decay: 0.12 }) + 0.05 * wobble(G.phase(t) * G.spb, 3, 0.35),
      bend: 40 * Math.sin(t * 2.2), wave: [0, 1, 0],
    });
    const shots = [
      { id: 'type', at: 0, build: t => [
        { type: 'shader', preset: 'mesh', uniforms: { c0: '#10131c', c1: '#28324f', c2: '#6b3aa8', c3: '#0b0d12', speed: 0.12 } },
        { type: 'shader', preset: 'grid', uniforms: { spacing: 80 * F.u, opacity: 0.07, fade: 1.4 } },
        hero(t, F.pick({ h: F.W * 0.72, v: F.cx, s: F.W * 0.7 }), F.pick({ h: F.H * 0.92, v: F.H * 0.86, s: F.H * 0.95 }), F.pick({ h: 560, v: 620, s: 480 })),
        { type: 'canvas', draw: c => {
          const x = F.pick({ h: 140, v: 100, s: 90 }), y = F.pick({ h: 420, v: 520, s: 330 });
          const size = F.pick({ h: 132, v: 118, s: 104 });
          words(c, 'Every frame', x, y, t, 0.15, { size, weight: 700, family: D, blur: 12, stagger: 0.09 });
          words(c, 'on purpose.', x, y + size * 1.05, t, 0.55, { size: size * 1.05, weight: 400, family: S, style: 'italic', color: '#ffb36b', blur: 10 });
        } },
      ] },
      { id: 'halftone', at: 2, in: { type: 'flash', dur: 0.25 }, build: t => [
        { type: 'shader', preset: 'sunburst', uniforms: { center: [F.cx, F.cy], c0: '#f4ecdf', c1: '#ee7ab0', count: 16, turn: t * 0.05 } },
        { type: 'group', fx: [['halftone', { cell: 9 * F.u, ink: '#1d1e3c', paper: '#f4ecdf', angle: 0.5, amount: 1 }]], layers: [
          hero(t + 1, F.cx, F.H * 0.98, F.pick({ h: 900, v: 1250, s: 900 })),
        ] },
        { type: 'canvas', draw: c => {
          const size = F.pick({ h: 190, v: 150, s: 150 });
          font(c, 700, size, D);
          const k = E.outBack(clamp((t - 0.05) / 0.4));
          c.save(); c.translate(F.cx, F.pick({ h: 250, v: 420, s: 230 })); c.scale(k, k); c.rotate(-0.06);
          text(c, 'HALFTONE', 0, size * 0.35, { color: '#1d1e3c', align: 'center', stroke: '#f4ecdf', strokeW: 14 });
          c.restore();
        } },
      ] },
      { id: 'card', at: 4, in: { type: 'wipe', dur: 0.5, angle: -0.35 }, post: { looks: [['riso', { inkA: '#2c3e8f', inkB: '#ef5a8c', texture: 0.06 }], ['grain', { amount: 0.02 }]] }, build: t => {
        const roll = E.snap(clamp(t / 0.9));
        const cw = F.pick({ h: 760, v: 860, s: 760 }), ch = cw * 0.62;
        return [
          { type: 'shader', preset: 'paper', uniforms: { color: '#f2ede3' } },
          { type: 'plane', name: 'card', tw: 1200, th: Math.round(1200 * 0.62), stamp: 'card', x: F.cx, y: F.cy, w: cw, h: ch, rx: (1 - roll) * 1.2, ry: -0.18 * (1 - roll) + 0.08 * Math.sin(t * 1.3), pivotY: 0.5, sheen: [0.25 * (1 - roll), -1 + 3 * roll, 0.25], draw: c => {
            shadowRR(c, 30, 30, 1140, 684, 48, { color: 'rgba(0,0,0,0.25)', blur: 30, dy: 8 });
            fillRR(c, 30, 30, 1140, 684, 48, '#ffffff');
            font(c, 500, 44, M); text(c, 'RENDERED FRAMES', 100, 150, { color: '#6d6f78', track: 4 });
            font(c, 700, 90, D); text(c, 'Per second, on one laptop', 100, 280, { color: '#15161b' });
          } },
          { type: 'canvas', draw: c => {
            const v = track(t, [[0.4, 0], [1.6, 3.4, E.outCubic]]);
            odometer(c, v * 100, F.cx, F.cy + ch * 0.32, { size: F.pick({ h: 150, v: 170, s: 150 }), family: D, color: '#15161b', align: 'center', digits: 3 });
          } },
        ];
      } },
      { id: 'roller', at: 6, in: { type: 'whip', dur: 0.32, dir: [-1, 0] }, post: { looks: [['crt', { curve: 0.05, scan: 0.25 }], ['vignette', { amount: 0.35 }]] }, build: t => [
        { type: 'fill', color: '#0c0d11' },
        { type: 'shader', preset: 'dots', uniforms: { spacing: 28 * F.u, opacity: 0.16 } },
        { type: 'canvas', draw: c => {
          const size = F.pick({ h: 120, v: 100, s: 96 });
          const items = ['brand reels.', 'music videos.', 'product demos.', 'anything.'];
          const pos = track(t, [[0.2, 0], [0.55, 1, E.snap], [0.9, 1], [1.25, 2, E.snap], [1.5, 2], [1.8, 3, E.snap]]);
          const x = F.pick({ h: 180, v: 110, s: 100 }), y = F.pick({ h: 470, v: 820, s: 470 });
          font(c, 600, size, D);
          text(c, 'We make', x, y, { color: '#ffffff' });
          roller(c, items, pos, x, y + size * 1.15, { size, weight: 400, family: S, style: 'italic', color: '#ffb36b', blur: 8 });
          font(c, 500, F.pick({ h: 34, v: 32, s: 30 }), M);
          typeOn(c, '> render --workers 3 --format v', x, y + size * 2.6, clamp((t - 0.3) / 1.2), { color: '#9aa3b5', t });
          highlight(c, x - 8, y + size * 1.25 - size * 0.9, 20, size, 0, '#fff');
        } },
      ] },
    ];
    EDIT = new Edit(shots, { W: F.W, H: F.H, duration: ctx.meta.duration });
    CUES = new Cues().fromEdit(EDIT);
    for (let b = 0; b < 16; b++) CUES.add(G.t(b), 'kick');
  },

  build(t, ctx) {
    const shot = EDIT.shotAt(t, ctx);
    const looks = [...(shot.post?.looks || []), ['grain', { amount: 0.025 }], ['vignette', { amount: 0.18 }]];
    const dark = shot.id === 'type' || shot.id === 'roller';
    return { layers: EDIT.layers(t, ctx), post: { looks, bloom: dark ? { amount: 0.2, threshold: 0.8 } : null } };
  },
  cues: () => CUES.sorted(),
  edits: () => EDIT.edits,
  automation: t => ({ energy: 0.5 + 0.5 * G.pulse(t) }),
};

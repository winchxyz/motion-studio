// One frame through each look: second n shows LOOKS[n]. Render a sheet at 0.5, 1.5, ... 7.5.
import { font, text } from '/studio/engine/text.js';

const PC98 = ['#000000', '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179', '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86'];
const LOOKS = [
  ['clean', []],
  ['riso', [['riso', { inkA: '#2c3e8f', inkB: '#ef5a8c' }]]],
  ['halftone', [['halftone', { cell: 7, ink: '#1d1e3c', paper: '#f4ecdf', angle: 0.4 }]]],
  ['dither (PC-98)', [['dither', { pixel: 3, palette: PC98, spread: 0.22 }], ['crt', { curve: 0.03, scan: 0.22, mask: 0.08 }]]],
  ['tritone + paper', [['tritone', { shadow: '#1b1a2e', mid: '#d0542f', highlight: '#f4ecdf' }], ['paper', { texture: 0.12, edge: 0.5 }]]],
  ['crt + chroma', [['crt', { curve: 0.08, scan: 0.35, chroma: 2 }]]],
  ['grade + grain', [['grade', { contrast: 1.25, saturation: 0.7, lift: [0.04, 0.02, 0.06], gain: [1.05, 1, 0.92] }], ['grain', { amount: 0.06, size: 1.5 }]]],
  ['glitch slices', [['slices', { amount: 60, height: 24, density: 0.35, seed: 3 }], ['chroma', { amount: 3 }]]],
];

export default {
  fonts: [
    { family: 'Inter Display', src: '/studio/fonts/InterDisplay-Bold.ttf', weight: 700 },
    { family: 'Newsreader Display', src: '/studio/fonts/NewsreaderDisplay-Italic.ttf', weight: 400, style: 'italic' },
    { family: 'Geist Mono', src: '/studio/fonts/GeistMono-VariableFont_wght.ttf', weight: '100 900' },
  ],
  images: { blob: 'blob.png' },
  build(t, ctx) {
    const { F, images } = ctx;
    const i = Math.min(LOOKS.length - 1, Math.floor(t));
    return {
      layers: [
        { type: 'shader', preset: 'sunburst', uniforms: { center: [F.W * 0.68, F.H * 0.55], c0: '#f4ecdf', c1: '#ee7ab0', count: 14 } },
        { type: 'shader', preset: 'radial', uniforms: { center: [F.W * 0.2, F.H * 0.2], radius: 900, c0: '#2b3a8f', c1: '#2b3a8f', power: 1 }, alpha: 0.0 },
        { type: 'image', img: images.blob, x: F.W * 0.68, y: F.H * 0.98, h: 820, anchor: [0.5, 1] },
        { type: 'canvas', draw: c => {
          c.fillStyle = '#1f2a6b';
          c.fillRect(0, 0, F.W * 0.42, F.H);
          font(c, 700, 150, '"Inter Display"');
          text(c, 'Every', 110, 430, { color: '#f4ecdf' });
          text(c, 'frame', 110, 580, { color: '#ffb36b' });
          font(c, 400, 110, '"Newsreader Display"', 'italic');
          text(c, 'on purpose.', 110, 720, { color: '#f4ecdf' });
          font(c, 500, 30, '"Geist Mono"');
          text(c, LOOKS[i][0].toUpperCase(), 110, 960, { color: '#f4ecdf', track: 4 });
        } },
      ],
      post: { looks: LOOKS[i][1] },
    };
  },
};

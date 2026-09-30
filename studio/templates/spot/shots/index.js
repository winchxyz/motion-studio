// The storyboard as code: one entry per shot, in order. Written by the planner from storyboard.md;
// builders only write their own shots/<id>.js. Scene changes sit on bar lines: G.bt(bar).
//   { id, at (film s), in: transition, build, prepare?, captions?: false, look?: [...], cues?: [{ t, type }] }
import stub from './_stub.js';

export async function shotList(G, S, ctx) {
  const shot = (id, at, extra = {}) => ({ id, at, build: extra.build || stub(id, extra.note), ...extra });
  return [
    shot('hook', 0, { note: 'the first idea, readable in under 2 s' }),
    shot('product', G.bt(2), { in: { type: 'push', dur: 0.5, dir: [0, 1] }, note: 'the product moment' }),
    shot('lockup', G.bt(12), { in: { type: 'dip', dur: 0.6, color: '#000000' }, note: 'logo, line, handle' }),
  ];
}

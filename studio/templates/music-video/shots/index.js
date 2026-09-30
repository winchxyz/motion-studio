// The storyboard as code: one entry per shot, in order. Written by the planner from storyboard.md;
// builders only write their own shots/<id>.js. Times come from the grid (G.t(beat)) or the lyrics
// (S.lines[i].start), so the edit follows the song.
//   { id, at (film s), in: transition, build, prepare?, captions?: false, look?: [...], cues?: [{ t, type }] }
import stub from './_stub.js';

export async function shotList(G, S, ctx) {
  const shot = (id, at, extra = {}) => ({ id, at, build: extra.build || stub(id, extra.note), ...extra });
  return [
    shot('hook', 0, { note: 'the visual hook: the first 2 s decide if people stay' }),
    shot('verse', G.t(8), { in: { type: 'fade', dur: 0.4 }, note: 'first verse' }),
    shot('chorus', G.t(16), { in: { type: 'flash', dur: 0.25 }, note: 'the chorus: the biggest idea' }),
  ];
}

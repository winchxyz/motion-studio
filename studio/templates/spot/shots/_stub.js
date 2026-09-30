// A stand-in for a shot that is not built yet: its id and intent on the film's ground colour, so the
// whole film runs from the first minute. Never ship a stub; qa and the critic flag them.
import { font, text } from '/studio/engine/text.js';
import { PALETTE, TYPE } from '../style.js';

export default (id, note = '') => (t, ctx) => {
  const { F } = ctx;
  return [
    { type: 'fill', color: PALETTE.ground },
    { type: 'canvas', draw: c => {
      font(c, 500, 26 * F.u, TYPE.mono);
      text(c, `STUB  ${id}`, F.safe[0], F.safe[1] + 30 * F.u, { color: PALETTE.accent, track: 4, deco: true, audit: { stub: true } });
      if (note) text(c, note, F.safe[0], F.safe[1] + 70 * F.u, { color: PALETTE.ink, alpha: 0.6, deco: true });
    } },
  ];
};

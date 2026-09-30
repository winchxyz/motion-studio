// TITLE: assembly. The bar grid (film.json bpm) sets time, shots/index.js lists the shots (the
// storyboard as code), each shot lives in its own file, style.js holds the art direction. This file
// only wires them together with the captions and the running devices; shots are built elsewhere.
import { Grid, Edit, Cues, songFor } from '/studio/engine/timeline.js';
import { lineAt, drawCaption } from '/studio/engine/captions.js';
import { FONTS, LOOK, CAPTION } from './style.js';
import { shotList } from './shots/index.js';

let G, SONG, EDIT, CUES;

export default {
  fonts: FONTS,
  images: {},                         // generated art: { key: 'assets/gen/x.png' }, see brief.md
  audio: 'out/audio.wav',            // the score from sound.py, once rendered

  async init(ctx) {
    const { F, meta } = ctx;
    SONG = songFor(ctx.song, meta.songStart || 0, meta.duration, meta.bpm || 120);
    G = Grid.fromSong(SONG);
    ctx.grid = G;
    ctx.S = SONG;
    const shots = await shotList(G, SONG, ctx);
    EDIT = new Edit(shots, { W: F.W, H: F.H, duration: meta.duration });
    CUES = new Cues().fromEdit(EDIT);
    for (const s of shots) for (const c of s.cues || []) CUES.add(s.at + c.t, c.type, c);
  },

  // shots with image sequences load their frames here (both shots during a transition)
  async prepare(t, ctx) {
    await Promise.all(EDIT.shots.filter(s => s.prepare && t >= s.at - 1 && t <= s.end + 1).map(s => s.prepare(t - s.at, ctx)));
  },

  build(t, ctx) {
    const { F } = ctx;
    const shot = EDIT.shotAt(t, ctx);
    const layers = EDIT.layers(t, ctx);
    const line = shot.captions === false ? null : lineAt(SONG.lines, t);
    if (line) layers.push({ type: 'canvas', draw: c => drawCaption(c, line, t, F, CAPTION) });
    return { layers, post: { looks: shot.look || LOOK, bloom: shot.bloom || null } };
  },
  cues: () => CUES.sorted(),
  edits: () => EDIT.edits,
  shotAt: t => EDIT?.shotAt(t)?.id,
};

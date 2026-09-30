// Time structure: the beat grid, the edit (shots and the transitions between them) and the cue list
// the sound is built from. Everything is a pure function of t.
import { clamp, invLerp, lerp, E } from './util.js';

// ------------------------------------------------------------------ beat grid
// A steady grid (bpm + offset of beat 0), or a detected beat list from a song (song.json beats), in
// which case positions between beats are interpolated so a live band's drift is followed.
export class Grid {
  constructor({ bpm = 120, offset = 0, meter = 4, beats = null } = {}) {
    this.meter = meter;
    this.beats = beats && beats.length > 2 ? beats : null;
    if (this.beats) {
      const n = this.beats.length;
      this.spb = (this.beats[n - 1] - this.beats[0]) / (n - 1);
      this.bpm = 60 / this.spb;
      this.offset = this.beats[0];
    } else {
      this.bpm = bpm; this.spb = 60 / bpm; this.offset = offset;
    }
  }
  static fromSong(song) {
    return new Grid({ bpm: song.bpm, offset: song.beats?.[0] ?? song.offset ?? 0, meter: song.meter || 4, beats: song.beats });
  }
  // beat index (fractional) -> seconds
  t(beat) {
    const B = this.beats;
    if (!B) return this.offset + beat * this.spb;
    if (beat <= 0) return B[0] + beat * this.spb;
    if (beat >= B.length - 1) return B[B.length - 1] + (beat - B.length + 1) * this.spb;
    const i = Math.floor(beat);
    return lerp(B[i], B[i + 1], beat - i);
  }
  bt(bar, beat = 0) { return this.t(bar * this.meter + beat); }
  // seconds -> beat index (fractional)
  beat(t) {
    const B = this.beats;
    if (!B) return (t - this.offset) / this.spb;
    if (t <= B[0]) return (t - B[0]) / this.spb;
    if (t >= B[B.length - 1]) return B.length - 1 + (t - B[B.length - 1]) / this.spb;
    let lo = 0, hi = B.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (B[m] <= t) lo = m; else hi = m; }
    return lo + (t - B[lo]) / (B[hi] - B[lo]);
  }
  bar(t) { return this.beat(t) / this.meter; }
  // 0..1 through the current beat (div 2 = eighth notes, 0.25 = bars of four)
  phase(t, div = 1) { const b = this.beat(t) * div; return b - Math.floor(b); }
  // 1 just after each beat, decaying exponentially (seconds) until the next: drive kicks, pulses,
  // flashes. The short attack keeps it continuous, so motion blur shows a hit rather than a double
  // exposure of the frame before and after the beat.
  pulse(t, { decay = 0.15, div = 1, attack = 0.035, from = -Infinity, to = Infinity } = {}) {
    if (t < from || t > to) return 0;
    const since = this.phase(t, div) * this.spb / div;
    const rise = attack > 0 ? Math.min(1, since / attack) : 1;
    return rise * rise * (3 - 2 * rise) * Math.exp(-Math.max(0, since - attack) / decay);
  }
  snap(t, div = 1) { return this.t(Math.round(this.beat(t) * div) / div); }
}

// The song in film time: a film that starts `start` seconds into the song file sees beats, lines and
// sections shifted so film t = 0 is that point, and only what falls inside [0, duration] (+ margin).
// Without a song.json yet, a steady grid at `bpm` stands in so the film still runs.
export function songFor(song, start = 0, duration = 60, bpm = 120) {
  if (!song) {
    const spb = 60 / bpm, beats = [];
    for (let t = 0; t <= duration + 2; t += spb) beats.push(+t.toFixed(4));
    return { bpm, meter: 4, beats, downbeats: beats.filter((_, i) => i % 4 === 0), lines: [], sections: [], hits: [], placeholder: true };
  }
  const sh = t => +(t - start).toFixed(4);
  const inside = t => t >= -2 && t <= duration + 2;
  return {
    ...song,
    beats: song.beats.map(sh).filter(inside),
    downbeats: (song.downbeats || []).map(sh).filter(inside),
    hits: (song.hits || []).map(sh).filter(inside),
    sections: (song.sections || []).map(s => ({ ...s, start: sh(s.start), end: sh(s.end) })).filter(s => s.end >= 0 && s.start <= duration),
    lines: (song.lines || []).map(l => ({ ...l, start: sh(l.start), end: sh(l.end), words: (l.words || []).map(w => ({ ...w, start: sh(w.start), end: sh(w.end) })) }))
      .filter(l => l.end >= 0 && l.start <= duration),
  };
}

// ------------------------------------------------------------------ edit
// shots: [{ id, at (s), build(local, ctx) -> layers, in: transition }]; a shot runs until the next
// one starts (or at + dur for the last). local = t - at, so a shot's own animation keys off the edit
// point; during a transition it can be negative (pre-roll) or run past its end (tail).
//
// transitions (the incoming shot's `in`):
//   'cut' | { type: 'cut' }
//   { type: 'flash', dur: 0.2, color: '#fff' }           cut on the edit, a flash that decays over dur
//   { type: 'fade', dur }  { type: 'dip', dur, color }   crossfade / through a colour
//   { type: 'wipe', dur, angle, feather }  { type: 'iris', dur, x, y }  { type: 'clock', dur }
//   { type: 'push' | 'whip' | 'slide', dur, dir: [1, 0] } the frames travel (whip = fast, eased hard)
//   { type: 'zoom', dur }                                 the old shot rushes past the camera, the new one settles
// dur is centred on the edit point unless `align` says otherwise (0 = starts on it, 1 = ends on it).
const DEF = {
  cut: { dur: 0 }, flash: { dur: 0.22, align: 0, color: '#ffffff' }, fade: { dur: 0.5 }, dip: { dur: 0.6, color: '#000000' },
  wipe: { dur: 0.45, angle: 0, feather: 60, ease: E.inOutCubic }, iris: { dur: 0.5, feather: 3, ease: E.inOutCubic },
  clock: { dur: 0.5, feather: 0.01, ease: E.inOutCubic }, push: { dur: 0.5, dir: [1, 0], ease: E.inOutCubic },
  whip: { dur: 0.3, dir: [1, 0], ease: E.inOutExpo }, slide: { dur: 0.45, dir: [1, 0], ease: E.outCubic }, zoom: { dur: 0.45, ease: E.inOutCubic },
};

export class Edit {
  constructor(shots, { W = 1920, H = 1080, duration = null } = {}) {
    this.W = W; this.H = H;
    this.shots = shots.slice().sort((a, b) => a.at - b.at).map((s, i, arr) => {
      const tr = typeof s.in === 'string' ? { type: s.in } : (s.in || { type: 'cut' });
      const T = { ...DEF[tr.type] || DEF.cut, ...tr, type: tr.type || 'cut' };
      const align = T.align ?? 0.5;
      const end = i + 1 < arr.length ? arr[i + 1].at : s.dur != null ? s.at + s.dur : duration ?? s.at + 4;
      return { ...s, index: i, tr: T, end, tIn0: s.at - T.dur * align, tIn1: s.at + T.dur * (1 - align) };
    });
  }
  get edits() {
    return this.shots.slice(1).map(s => ({ t: s.at, id: s.id, type: s.tr.type, dur: s.tr.dur }));
  }
  index(t) {
    const S = this.shots;
    let lo = 0, hi = S.length - 1;
    if (t < S[0].at) return 0;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S[m].at <= t) lo = m; else hi = m - 1; }
    return lo;
  }
  // pass ctx so a frame's sub-samples agree on the shot (ctx.frameT is the frame's own time)
  shotAt(t, ctx = null) { return this.shots[this.index(ctx?.frameT ?? t)]; }
  // progress 0..1 through the current shot
  progress(t) { const s = this.shotAt(t); return clamp(invLerp(s.at, s.end, t)); }

  build(shot, t, ctx) {
    const r = shot.build(t - shot.at, ctx, shot);
    return Array.isArray(r) ? r : (r?.layers || []);
  }

  // the layers of time t, with any transition in progress composed
  layers(t, ctx) {
    const S = this.shots;
    // the frame's own time (not the sub-sample's) picks the side of a hard cut
    const ts = ctx?.frameT ?? t;
    let i = this.index(ts);
    // a centred transition into the next shot may already have begun
    if (i + 1 < S.length && ts >= S[i + 1].tIn0) i = i + 1;
    const cur = S[i], prev = S[i - 1];
    const T = cur.tr;
    const hard = T.type === 'cut' || T.type === 'flash';
    const inTr = prev && T.type !== 'cut' && (hard ? ts : t) < cur.tIn1 && (hard ? ts : t) >= cur.tIn0;
    if (!inTr) return this.build(ts >= cur.at || !prev ? cur : prev, t, ctx);
    const k = clamp(invLerp(cur.tIn0, cur.tIn1, t));
    const ke = (T.ease || E.inOutCubic)(k);
    const { W, H } = this;
    const out = () => this.build(prev, t, ctx), inn = () => this.build(cur, t, ctx);
    const group = (layers, o = {}) => ({ type: 'group', layers, ...o });
    const dir = T.dir || [1, 0];
    switch (T.type) {
      case 'flash': {
        const L = ts >= cur.at ? inn() : out();
        const a = ts >= cur.at ? (1 - k) ** 2 : 0;
        return [...L, { type: 'fill', color: T.color, alpha: a, blend: T.blend || 'normal' }];
      }
      case 'fade':
        return [...out(), group(inn(), { alpha: ke })];
      case 'dip':
        return k < 0.5
          ? [...out(), { type: 'fill', color: T.color, alpha: E.inOutSine(k * 2) }]
          : [...inn(), { type: 'fill', color: T.color, alpha: E.inOutSine(2 - k * 2) }];
      case 'wipe':
        return [...out(), group(inn(), { mask: { type: 'wipe', angle: T.angle, p: ke, feather: T.feather } })];
      case 'iris':
        return [...out(), group(inn(), { mask: { type: 'iris', x: T.x ?? W / 2, y: T.y ?? H / 2, r: ke * Math.hypot(W, H), feather: T.feather } })];
      case 'clock':
        return [...out(), group(inn(), { mask: { type: 'clock', x: T.x ?? W / 2, y: T.y ?? H / 2, p: ke, start: T.start || 0, feather: T.feather } })];
      case 'push':
      case 'whip': {
        const dx = dir[0] * W, dy = dir[1] * H;
        const sc = T.type === 'whip' ? 1 - 0.06 * Math.sin(Math.PI * k) : 1;
        return [
          group(out(), { transform: { x: -dx * ke, y: -dy * ke, scale: sc } }),
          group(inn(), { transform: { x: dx * (1 - ke), y: dy * (1 - ke), scale: sc } }),
        ];
      }
      case 'slide':
        return [...out(), group(inn(), { transform: { x: dir[0] * W * (1 - ke), y: dir[1] * H * (1 - ke) } })];
      case 'zoom': {
        const ko = clamp(k / 0.6), ki = clamp((k - 0.35) / 0.65);
        return [
          group(out(), { transform: { scale: lerp(1, 2.6, E.inCubic(ko)) }, alpha: 1 - E.inQuad(ko) }),
          group(inn(), { transform: { scale: lerp(0.72, 1, E.outCubic(ki)) }, alpha: E.outQuad(ki) }),
        ];
      }
      default:
        return this.build(t >= cur.at ? cur : prev, t, ctx);
    }
  }
}

// ------------------------------------------------------------------ cues
// The film's cue list: every landing, hit, whoosh or click, with the time the sound must land on.
export class Cues {
  constructor() { this.list = []; }
  // t and type go last: params may carry their own (a shot cue's relative t) and must never move the cue
  add(t, type, params = {}) { this.list.push({ ...params, t: +t.toFixed(4), type }); return this; }
  // one cue per edit point, typed by transition (whoosh for travels, hit for flashes)
  fromEdit(edit, map = { flash: 'hit', whip: 'whoosh', push: 'whoosh', slide: 'swish', zoom: 'whoosh', wipe: 'swish', iris: 'swish', clock: 'swish', fade: null, dip: null, cut: 'cut' }) {
    for (const e of edit.edits) {
      const type = map[e.type];
      if (type) this.add(e.type === 'flash' || e.type === 'cut' ? e.t : e.t - e.dur / 2, type, { dur: e.dur, shot: e.id });
    }
    return this;
  }
  sorted() { return this.list.slice().sort((a, b) => a.t - b.t); }
}

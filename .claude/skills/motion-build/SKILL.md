---
name: motion-build
description: Reference for building a film on this studio's engine - the film module contract, layer types, looks, shader presets, type kit, beat grid and edit, rig for generated art, 3D layer, formats, and the render and check commands. Use whenever writing or changing a film's film.js or shots.
---

# Building on the engine

A film folder (from `new-film.mjs`): `film.json` (meta), `style.js` (the art direction as code:
PALETTE, FONTS, TYPE scale, LOOK, CAPTION, MOTION), `shots/index.js` (the storyboard as code: the shot
list with times and transitions), `shots/<id>.js` (one file per shot: `export default (t, ctx, shot)
=> layers`), `film.js` (wires them with captions and running devices), `assets/`, `out/`. A shot
imports style.js and the engine, nothing from other shots, so builders can work on shots in
parallel. Stubs (`shots/_stub.js`) keep the film running until every shot exists; never ship one.
Imports use absolute paths: `import { Edit } from '/studio/engine/timeline.js'`. Everything is a pure
function of t; precompute in init, never accumulate state across frames. Read `motion-craft` first.

## film.js contract

```js
export default {
  fonts: [{ family: 'Inter Display', src: '/studio/fonts/InterDisplay-Bold.ttf', weight: 700 }],
  images: { hero: 'assets/gen/hero.png' },          // loaded before init, ctx.images.hero
  audio: 'assets/song.mp3',                          // preview playback (meta.songStart offsets it)
  async init(ctx) {},                                // ctx: F (layout), W, H, fps, meta, images, song, engine, loadImage(src), grid
  build(t, ctx) { return { layers: [...], post: { looks: [...], bloom, exposure, fade } }; },
  cues: ctx => [...], edits: ctx => [...],           // for sound and QA (use Cues / Edit)
  automation: (t, ctx) => ({ energy: 0.5 }),         // curves for sound.py
  shotAt: t => 'shot-id',                            // shown in the preview
  async prepare(t, ctx) {},                          // optional: lazy-load assets for frame t
};
```
Set `ctx.grid = G` in init so sheets and the preview show beats.

## Layers (engine.js; format px, y down)

- `fill` { color, alpha }
- `shader` { preset | code, uniforms, blend }: presets linear, radial, mesh, grid, dots, noise,
  sunburst, rays, stripes, paper (shaders.js). Custom code defines `vec4 shade(vec2 px)` returning
  premultiplied sRGB; LIB gives snoise, fbm, vnoise, hash, sdBox/sdRoundBox/sdCircle, smin, rot, cover.
- `canvas` { draw(ctx), blur, blend, stamp }: Canvas 2D in format px. stamp = redraw only when it changes.
- `image` { img, x, y, w|h, anchor, rot, bend, squash, wave: [amp, cycles, phase], skew, crop, flipX, tint, bright }
- `plane` { name, tw, th, draw, x, y, z, w, h, rx, ry, rz, focal, pivotY, sheen, stamp }: a 3D card.
- `three` { layer: ThreeLayer }: see below.
- `group` { layers, fx: lookChain, mask: { type: wipe|iris|rect|clock, ... }, transform: { x, y, scale, rot, anchor }, blur, alpha, blend }
blend: normal | add | screen | multiply.

## Looks (looks.js), as `post.looks` (whole frame) or a group's `fx`

grade, tritone, halftone, riso (two inks on paper, misregistered), dither (palette up to 16,
pixel size: PC-98 / GameBoy), crt, paper, ink (XDoG line art over flat colour or paper: redraws
footage), kuwahara (painterly), chroma, slices (glitch), pixelate, posterize, lens, grain, vignette.
`[['riso', { inkA: '#2c3e8f', inkB: '#ef5a8c' }], ['grain', { amount: 0.03 }]]`. Sampling-heavy looks
(ink, kuwahara) go first in a chain. `post.bloom = { amount, threshold, radius }` on dark shots only.

## Clips (sequence.js)

`const clip = await loadSequence(ctx, 'assets/seq/name')` (from `seq.py`), in the shot's `prepare`
`await clip.prepare(local)`, in build `{ type: 'image', img: clip.frame(local), x, y, w, h }`, usually
inside `{ type: 'group', fx: [['ink', {...}], ['paper', {...}]] }` with JS drawing on top.

## Type (text.js) and drawing (draw.js)

`font(ctx, weight, size, family, style)`, `text(ctx, str, x, y, { color, align, track, id, deco, stroke, strokeW })`,
`runs`, `wrap`, `fit`, `fitSize`; kinetic: `words(ctx, str, x, y, t, t0, { stagger, dur, rise, blur, scale, out })`,
`letters`, `typeOn(ctx, str, x, y, progress, { caret, t })`, `odometer(ctx, value, x, y, { digits, sep })`,
`roller(ctx, items, pos, x, y)`, `onPath(ctx, str, circlePath(cx, cy, r))`, `highlight`, `underline`,
`stamp(ctx, str, x, y, t, t0)`, `formatNumber`. Mark decorative text `deco: true` so the audit skips it.
draw.js: `rgba`, `mix`, `rr`/`fillRR`/`strokeRR`/`shadowRR`, `circle`, `polygon`, `star`, `line`,
`arrow`, `svgFill`, `svgStroke` (draw-on with progress), `cursor` (with click ripple).
util.js: `E` easings (snap, swift, whip, glide, outBack...), `bezier`, `track(t, [[t, v, ease]])`,
`spring`, `wobble`, `hop`, `noise1`, `hash`, `clamp`, `lerp`, `invLerp`.

## Time (timeline.js)

- `new Grid({ bpm, offset })` or `Grid.fromSong(song)`: `t(beat)`, `bt(bar, beat)`, `beat(t)`,
  `phase(t, div)`, `pulse(t, { decay, div })` (1 just after each beat), `snap(t)`.
- `songFor(ctx.song, meta.songStart, meta.duration)`: the song in film time (steady grid if missing).
- `new Edit(shots, { W, H, duration })`, shots `{ id, at, build(local, ctx), in: { type, dur, ... } }`;
  `edit.layers(t, ctx)`, `edit.shotAt(t, ctx)`, `edit.edits`. Types: cut flash fade dip wipe iris clock push whip slide zoom.
- `new Cues().fromEdit(edit).add(t, 'hit')`: types in studio/audio/sfx.py.

## Generated art (rig.js), captions (captions.js)

`puppet({ base, blink, mouth }, t, { x, y, h, anchor, grid, bounce, mouth, breathe, sway })`,
`singing(t, words)`, `blinking(t)`, `plate(F, img, t, { push })`, `parallax(F, layers, cam)`,
`shake(t, { amp, t0, decay })` (use as a group transform). `lineAt(lines, t)` +
`drawCaption(ctx, line, t, F, { style: 'box' | 'karaoke' | 'pop' | 'kinetic', family, accent, keywords })`.

## 3D (three-layer.js)

```js
import { ThreeLayer, THREE, textMesh, svgMesh, loadGLTF, chrome, glass, clay, plastic, toon, studioLights } from '/studio/engine/three-layer.js';
L3 = new ThreeLayer(ctx.engine, { fov: 30, async setup(L, T) { ... L.scene.add(...) }, update(t, L, T) { ... } });
await L3.ready;  // then { type: 'three', layer: L3 } in build
```
`textMesh(fontUrl, str, { size, depth, bevel, material })` extrudes any TTF; `svgMesh(pathData, { height, depth })`
extrudes a logo; glTF animations: `mixer.setTime(t)` in update. ~0.3 s/frame at 12 samples.

## Formats (formats.js)

`ctx.F`: W, H, cx, cy, u (scale for 1080 on the short side), safe [x0, y0, x1, y1], safeBox, minText,
portrait, `F.pick({ h: 120, v: 90 })`. Keys h 16:9, v 9:16, s 1:1, p 4:5; k = 16:9 at 2x (4K).
Lay out per format with F.pick; check each format's sheet.

## Loop

Preview: `http://127.0.0.1:8960/studio/engine/preview.html?film=/<name>` (serve.mjs). After each shot:
`node studio/tools/render.mjs <film> --sheet a:b:0.25 --cols 8 --tw 300 --samples 4`, look at it,
fix, repeat. `--bench t` when a shot gets slow. Edit JS with Edit/Write only (hook checks syntax).

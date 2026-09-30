# Motion studio

Code-rendered motion films: brand and product spots, music videos, showreels. Every frame is a pure
function of time, drawn on the GPU in headless Chrome and encoded with ffmpeg; the sound is
synthesized in Python or built on a song. One shared engine and toolset (`studio/`), one folder per
film. The workflow `.claude/workflows/motion-video.js` runs a whole film from one brief (see WORKFLOW.md);
the skills in `.claude/skills/` hold each stage's method and `motion-craft` holds the quality bar.

## Layout

- `studio/engine/`: the engine (browser ES modules). `engine.js` compositor (layers, groups, masks,
  motion blur, bloom, looks), `looks.js` post styles, `shaders.js` backgrounds, `text.js` type,
  `draw.js` shapes, `timeline.js` beat grid, edit and cues, `formats.js`, `rig.js` for generated art,
  `captions.js` lyrics, `three-layer.js` 3D, `harness.js` + `film.html` (render page),
  `preview.html` (player).
- `studio/tools/`: `render.mjs`, `deliver.mjs`, `serve.mjs`, `new-film.mjs`, `song.py`,
  `breakdown.py`, `qa.py`, `audit.mjs`, `frames.py`, `audio_check.py`.
- `studio/audio/`: `synth.py` instruments, `mix.py` mixer, `sfx.py` cue effects, `mixdown.py`.
- `studio/templates/`: `music-video`, `spot`. `studio/fonts/`: shared OFL fonts.
- `refs/`: reference videos (media not in git) and their breakdowns. `styles/README.md`: style cards.
- `_lab/`: engine tests (`engine-test`, `three-test`). Keep them rendering; they are the regression check.

## Commands

```bash
node studio/tools/new-film.mjs <name> --template music-video|spot
node studio/tools/serve.mjs            # preview: http://127.0.0.1:8960/studio/engine/preview.html?film=/<name>
node studio/tools/render.mjs <film> --sheet 0:30:0.5 --cols 8 --tw 320    # contact sheet, the main way to look
node studio/tools/render.mjs <film> --stills 1.5,7.2                      # full-size frames
node studio/tools/render.mjs <film> --video --format h|v|s|p|k            # silent video + cues.json
node studio/tools/deliver.mjs <film>   # sound, -14 LUFS masters, share, <28 MB previews, posters, styleframes
python studio/tools/qa.py <film> --format h          # undeclared cuts, too-fast stretches, light, colours
node studio/tools/render.mjs <film> --audit 0:30:0.1 && node studio/tools/audit.mjs <film>   # text checks
python studio/tools/song.py <film>/assets/song.mp3 --lyrics <film>/lyrics.txt            # beats + timed lyrics
python studio/tools/breakdown.py refs/<clip>.mp4     # study a reference (sheets, cuts, pace, palette, tempo)
python studio/tools/seq.py <clip.mp4> <film>/assets/seq/<name> --sheet   # a generated clip as frames for the engine
node studio/tools/fetch.mjs <film> <url> assets/gen/<name>.png --model <m> --prompt "..." --cost <n>   # save + log a generation
                                                       # multi-line prompt: --prompt-file prompt.txt (UTF-8) instead of --prompt
node studio/tools/fonts.mjs "<Family>" <film>          # an OFL family from Google Fonts into <film>/fonts
```

The `studio` launch config serves the root on port 8960 for the browser pane.

## Rules

- Files, code and chat in English. On-screen language is whatever the film's brief says.
- Every brand asset is official (the brand's own SVG, kit, site code) and every fact, name, number and
  handle on screen is checked at its source and written in the film's brief.md under Truth. Never draw
  your own version of a logo or mascot when the real one exists.
- One idea at a time. Every line of text stays readable for at least 1 s (0.25 s per word). Minimum
  text size and the safe area come from the format (`formats.js`); `audit.mjs` checks both.
- Motion snaps then holds: moves of 0.2-0.5 s, then a readable rest. Nothing faster than a whip
  outside a transition (`qa.py` flags it). "Too fast, I can't understand what's going on" is the
  most common note on a first cut; clarity beats density.
- Look at the work through contact sheets and stills, and at the real encode with `frames.py`;
  run `qa.py` and `audit.mjs` before calling anything done. A preview player note lands in
  `<film>/notes.md`: read it at the start of every session on that film.
- Offer options as a lettered line-up that differs in subject, view and rendering, not recolours.
- Deliverables: master, share file, a preview under 30 MB (what messaging apps accept), poster,
  styleframes. Send the preview to the user (SendUserFile in the Claude desktop app).
- Runway credits cost money: say what a batch of generations will cost before running it, and log
  every generation with fetch.mjs (--cost).
- The user hears the song, voice-over and music and says yes before anything is built or rendered on
  them (the workflow stops after Sound with the takes in `out/listen-*.mp3`). A film about a brand or
  project carries its real information (what it is, how to join, where) on screen, not only its in-jokes.
- Never show the user a test, a stub or placeholder art: only work that meets motion-craft.

## Engine gotchas

- Edit JS with Edit/Write, not shell heredocs: some Windows shells strip backslashes from them. A
  hook runs `node --check` on every edited .js/.mjs file (and on workflow scripts).
- Paths may contain spaces: use fileURLToPath in node tools, quote in shells.
- Hard cuts are decided by the frame's own time (`ctx.frameT`); pass ctx to `edit.shotAt(t, ctx)`.
- Beat pulses have an attack (`grid.pulse`), so motion blur shows a hit, not a double exposure.
- Bloom on light backgrounds turns into haze; use it on dark shots only.
- Renders pull raw pixels (readPixels, POSTed to the renderer). On one GPU a single worker is usually
  fastest; `--workers` helps Canvas-heavy films.
- Text from opentype.js for 3D is laid out glyph by glyph (no shaping): fine for display type.

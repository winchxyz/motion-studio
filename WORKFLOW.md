# The motion workflow

One brief in, a finished video out. The workflow is `.claude/workflows/motion-video.js`: a Claude
Code workflow that runs the production as eight stages, with a team of agents where independent
eyes or parallel hands help, and the studio's tools and skills underneath.

## Starting it

In Claude Code, in this folder, describe the video and ask for the workflow, e.g.

> Run the motion-video workflow: a 45-second music video about ..., riso anime, 16:9 and 9:16.

Claude calls it with `{ brief: "<your words>" }`. Options: `refs` (links or files to learn from),
`formats` (["h", "v", "s", "p"]), `credits` (Runway credits it may spend, default 150),
`gate: "look"` (stop after the styleframes for your yes), `until` / `from` (run part of it, or
resume at a stage with `film`; the stage continues the work already in the folder), `rounds` (review
loops, default 3), `models` (`{ worker, judge }`: the makers run on Sonnet and the judges and critics on
Opus by default). Watch it live with /workflows.

## The stages

| Stage | Who | What happens | Leaves behind |
| --- | --- | --- | --- |
| 1 Brief | setup agent, then a references agent and a truth agent in parallel | The folder is made from a template; your words become brief.md; references are downloaded and broken down, or found on the web; the subject is researched: official assets and facts for a brand, the events and memes the audience knows for a culture piece | `brief.md`, `research/references.md`, `research/truth.md` |
| 2 Concept | three concept agents, three judges, a synthesiser | Three concepts from different angles (typography-led, a character and world, a rendering technique), each pitched with rendered key frames in 16:9 and 9:16. Judges look at the frames and score attention, craft and feasibility; the winner is merged with the best of the others | `concepts/` (pitches + frames), `concept.md` |
| 3 Sound | sound agent, then you | A music video gets lyrics and two takes of a Runway Lyria song (or your track), timed word by word with song.py; a spot gets its tempo, music bed and voice-over (two voices to choose from). The run then stops: you listen to the takes, pick or ask for others, and run again with `from: "plan"`. Nothing is built on audio you have not heard | `assets/song.mp3`, `song.json`, `lyrics.txt`, `out/listen-*.mp3` |
| 4 Plan | storyboard agent, a critic, a revision | Every shot on the beat grid: picture, composition, where the text goes and how big, transition, technique, assets. The first 2 s are designed as the hook. Every shot starts as a board frame drawn from the brand's real art, so the plan is a storyboard sheet and an animatic timed to the song | `storyboard.md`, `shots/`, `out/storyboard-*.jpg`, `out/animatic-sound.mp4` |
| 5 Look | style agent, asset agents in parallel, a styleframe builder, two critics | The style sheet, characters, sets, stills and video bases from Runway (within the credit budget), fonts, `style.js`; then 4-6 shots built to final quality as styleframes and critiqued in every format | `style.js`, `assets/gen/`, `out/stills/` |
| 6 Build | one builder per shot, each followed by its reviewer and a fixer | Every remaining shot is built in its own file to the styleframes' standard, checked on a sheet in 16:9 and 9:16, reviewed and fixed; then the film is assembled and its transitions checked | `shots/*.js` |
| 7 Review | a tools pass and three critics per round, fixers per shot | A review cut is rendered; qa.py, the text audit and frames from the real encode run; critics judge the hook and pacing, the type and composition, the art direction against the references. Major notes are fixed, and the loop repeats (up to 3 rounds) until none remain | review renders, notes |
| 8 Deliver | delivery agent | Every format at full quality, the soundtrack mixed and mastered to -14 LUFS, share files, phone previews under 30 MB, posters, styleframes, post copy for X | `out/*`, `post.md` |

## What makes it good, not just finished

- **The bar is written down** (`motion-craft`): type scale, motion timing, composition, the hook,
  and what never ships (placeholder art, default type, PowerPoint motion).
- **Independent eyes at every step**: judges pick the concept, critics review the storyboard,
  the styleframes, every shot, and the whole film each round. They have not seen the code; they see
  frames.
- **Real checks, not opinions only**: undeclared cuts, stretches too fast to follow, text outside the
  safe area, too small, or not up long enough to read, loudness and true peak.
- **Generated media is a base, not the result**: Runway stills and clips are redrawn and animated in
  code (ink, painterly, riso, halftone, dither; rigs; JS overlays), so it looks made, not generated.

## Formats, 3D, sound, credits

- Formats: 16:9, 9:16, 1:1, 4:5, 4K from one timeline, each laid out on its own, checked on its own.
- 3D: a Three.js layer inside the same frames (extruded type and logos, models, chrome, glass).
- Sound: Runway Lyria songs, a score synthesized in Python, Eleven v3 voice-over through Runway,
  designed effects on every cut and hit.
- Credits: capped per run (`credits`); every generation is logged with its cost in
  `assets/gen/manifest.json`.

## Where you can step in

One stop is built in: after the song, the run waits for you to listen and pick (`listen: false` skips it).
If you want more say: `gate: "look"` stops after the styleframes;
the preview player (`node studio/tools/serve.mjs`, then /studio/engine/preview.html?film=/<name>)
plays any stage's current state, and notes typed there (N) land in the film's notes.md, which the
next run reads.

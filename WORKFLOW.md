# The motion workflow

One brief in, a finished video out. The workflow is `.claude/workflows/motion-video.js`: a Claude
Code workflow with the studio's tools and skills underneath. It is **direct** by default: after one
stop for your approval, a single agent makes the whole film the way one motion designer would, a critic
looks, and one pass fixes and delivers. For a short film that is the fastest and cheapest way; splitting
the making across many agents only pays off on long films with many shots. `preset: "lean"` does that
split (a planner, a look stage, parallel builders); `preset: "full"` adds a judge panel, a drawn
storyboard and a builder, reviewer and fixer per shot.

## Direct (default)

| Step | Who | What happens | About |
| --- | --- | --- | --- |
| Setup | one agent, low effort | the folder, the kind, the length, the formats, a 3 KB brief | 5 min |
| Pitch and sound | two agents at the same time | research and the concept with key frames in each format; the audio takes (a song, a music bed, or narrator voices) and the timing file | 25-30 min |
| **Your pick** | you | the key frames and the takes; resume with `from: "plan"` | |
| Make | one agent | the shot list, style, every shot, checked with sheets, qa.py and the text audit | 45-75 min |
| Check | one Opus critic | the whole film from its sheets | 5-10 min |
| Finish | one agent | fixes the critic's major notes, renders every format at 8 samples, masters, previews, post copy | 15-30 min |

Six agents, about 1.5-2.5 hours of machine time for a film up to 30 s.

## Starting it

In Claude Code, in this folder, describe the video and ask for the workflow, e.g.

> Run the motion-video workflow: a 30-second launch film for ..., their brand, 16:9 and 9:16.

Claude calls it with `{ brief: "<your words>" }`. Options: `preset` (`"direct"`, the default, `"lean"` or `"full"`),
`refs` (links or files to learn from), `formats` (["h", "v", "s", "p"]), `credits` (Runway credits it may
spend, default 150), `gate: "look"` (also stop after the hero shots for your yes), `until` / `from` (run
part of it, or resume at a stage with `film`; the stage continues the work already in the folder),
`rounds` (review rounds: lean 1, full 3), `samples` (motion-blur samples for the masters: lean 8),
`models` (`{ worker, judge, builderEffort }`: makers on Sonnet, judges and critics on Opus), `listen: false`
(skip the stop after the sound). Watch it live with /workflows.

## Lean (`preset: "lean"`, for long films with many shots)

| Stage | Who | What happens | Leaves behind |
| --- | --- | --- | --- |
| 1 Brief | one agent | The folder from a template; the subject researched in one pass (official assets, facts with sources); a brief of 6 KB at most with the facts that go on screen | `brief.md`, `research/truth.md` |
| 2 Concept | one agent | The strongest concept for the brief, in 5 KB, and a small film drawing its hook and one key moment, rendered in 16:9 and 9:16 | `concept.md`, `concept/` (key frames) |
| 3 Sound | one agent, then **you** | A song (two Lyria takes), or a narrator (two voices) over a music bed, or a synthesized score; the timing in one file every later stage reads. The run stops: you see the key frames, hear the takes, pick, and it continues with `from: "plan"` | `out/listen-*.mp3`, the timing file |
| 4 Plan | one agent | A shot table of 12 KB at most (times read from the timing file), a note of 1.5 KB per shot, every shot file stubbed and wired, two hero shots, the rest in groups of 3-5 | `storyboard.md`, `shots/<id>.md`, `shots/index.js` |
| 5 Look | a style agent, art agents if needed, a hero builder, one critic | Fonts, `style.js` and `kit.js` (what every shot shares); prepared or generated art; the two hero shots at final quality; one critic on their stills and one fix pass | `style.js`, `kit.js`, `assets/`, `out/stills/` |
| 6 Build | one builder per group, all at once | Each builder owns a run of consecutive shots and builds them to the heroes' standard, reading only its shots' notes, writing only its shots' files, checking one sheet per pass | `shots/*.js` |
| 7 Review | a tools pass and one critic, fixers per group | A draft cut (half size, two samples) through qa.py, the text audit and frames from the encode; a critic on the whole film; major notes fixed by one fixer per group, cross-shot notes by one film-wide fixer after them | review sheets, notes |
| 8 Deliver | one agent | Every format at 8 samples, the soundtrack mastered to -14 LUFS, share files, phone previews under 30 MB, posters, post copy. It renders and packages; it does not redesign | `out/*`, `post.md` |

`preset: "full"` swaps in: three concept agents with prototypes, three judges and a synthesiser; a
storyboard drawn as board frames with a sheet and an animatic, then a critic and a revision; 4-6
styleframes and two critics; a builder, reviewer and fixer for every shot and an assembler; three
critics per review round and up to three rounds; masters at the film's own sample count.

## What it costs, and how it stays small

Measure any run with `python studio/tools/runcost.py <run id>` (agents, tokens, dollars at API prices,
hours per stage). Nearly all of the cost is agents re-reading their context on every step, so:

- **Few agents.** Every agent starts by loading the studio's instructions and the film's documents; the
  lean path uses about 12-16 per film instead of 45-60.
- **Short documents.** brief.md 6 KB, concept.md 5 KB, storyboard.md 12 KB, shots/<id>.md 1.5 KB; research
  and evidence live in `research/` and `evidence/`, which builders do not read.
- **Budgets.** About three render-and-look passes and about 15 images per agent, test renders at two
  samples; what is still off goes in the report as open instead of into more passes.
- **The right model.** Makers on Sonnet at medium effort for builders and fixers, judges and critics on Opus.
- **No re-runs.** Stages run in a fixed order, so a resume after a dropped connection or a usage limit
  replays what finished instead of running it again.

## What makes it good, not just finished

- **The bar is written down** (`motion-craft`): type scale, motion timing, composition, the hook,
  and what never ships (placeholder art, default type, PowerPoint motion).
- **You approve the idea and the sound before anything is built**, from frames you can see and takes you
  can hear.
- **Independent eyes**: a critic that has not seen the code judges the hero shots and the whole film from
  frames.
- **Real checks, not opinions only**: undeclared cuts, stretches too fast to follow, text outside the
  safe area, too small, or not up long enough to read, loudness and true peak.
- **Generated media is a base, not the result**: Runway stills and clips are redrawn and animated in
  code (ink, painterly, riso, halftone, dither; rigs; JS overlays), so it looks made, not generated.

## Formats, 3D, sound, credits

- Formats: 16:9, 9:16, 1:1, 4:5, 4K from one timeline, each laid out on its own, checked on its own.
- 3D: a Three.js layer inside the same frames (extruded type and logos, models, chrome, glass).
- Sound: Runway Lyria songs, a score synthesized in Python, voice-over through Runway,
  designed effects on every cut and hit.
- Credits: capped per run (`credits`); every generation is logged with its cost in
  `assets/gen/manifest.json`.

## Where you can step in

One stop is built in: after the sound, the run waits for you to see the key frames and hear the takes
(`listen: false` skips it). `gate: "look"` also stops after the hero shots. The preview player
(`node studio/tools/serve.mjs`, then /studio/engine/preview.html?film=/<name>) plays any stage's current
state, and notes typed there (N) land in the film's notes.md, which the next run reads.

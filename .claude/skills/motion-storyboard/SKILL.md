---
name: motion-storyboard
description: Plan a motion video's shots on the beat grid in this studio - pacing rules, transition vocabulary, music-video structure, the storyboard table and its code form. Use after the brief (and the song, for music videos) and before building shots.
---

# Storyboard

Write `<film>/storyboard.md` (one row per shot: beat, time, lyric or line, picture, transition in,
notes), then mirror it as the SHOTS array in film.js.

## Time

- Spots: pick a tempo so the film is whole bars (120 BPM: bar = 2 s, 15 bars = 30 s; 128 BPM: 64 beats
  = 30 s). Scene changes on bar lines, accents on beats.
- Music videos: time comes from `assets/song.json` (`song.py`). Shots start on beats; lyric lines
  set the story beats; the chorus gets the biggest ideas. `songFor()` shifts the song to film time.
- Measured in the references: spots cut every 1.7-3.7 s with ~30 % of the time nearly still (snap
  0.2-0.4 s, then hold). Music videos cut on the music: most shots half a beat or one beat, mixed
  with 2-8 beat holds; 70-190 shots in 2.5 min. The user's own reels were one continuous take.
  Pick one grammar per film and keep it.

## Readability

- One idea per shot. A line of text stays readable at least 1 s (0.25 s per word). A lyric caption
  follows the song. Big type for hooks; small type is decoration, marked deco.
- The eye needs a place to land: one subject per frame, strongest contrast on it.
- 9:16 keeps text inside y 220-1560 and x 80-940 (platform UI).

## Transition vocabulary (timeline.js `in:`)

cut (on the beat), flash (hit on a downbeat), fade, dip (through a colour), wipe (angled edge),
iris / clock (reveal from a point), push / whip (the frames travel; whip = fast, eased hard),
slide, zoom (rush through). Match cuts (same shape or position across two shots) and object
hand-offs (a thing becomes the next thing) read best; use them for the key moments.

## Music-video structure that worked

A recurring device across the whole song (a meter that climbs, a date stamp that advances, a
caption style) ties 100+ shots together. Each lyric line gets its own picture, literal or witty.
One art direction for every shot (palette, texture, type). Energy follows the song's sections:
calmer verses, dense chorus, a breakdown, a final hit.

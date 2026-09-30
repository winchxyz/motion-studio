---
name: motion-art
description: Generate art for a film with the Runway MCP - the style sheet, consistent characters, sets and plates, video bases (seedance, kling, veo) - and turn it into drawn animation in code (image layers, the rig, image sequences redrawn with the ink, kuwahara and riso looks, JS overlays). Use when a film needs illustrated or photographic art, characters, or physical motion that code should not animate by hand.
---

# Generated art

Runway supplies pictures and base motion; the film is drawn in code. Stills go through `rig.js`;
clips go through `seq.py` into the image-sequence layer and are redrawn by looks and JS overlays, so
the raw generation never has to show.

## Before any generation

- `whoami` (models), `show_plans_and_credits` (balance). Say what the batch costs before running it;
  record each call's cost with `fetch.mjs --cost`.
- The style line lives in brief.md (medium, palette, line quality, light, texture, "no text in the
  image") and is appended to every prompt so everything belongs together. Describe qualities, never
  an artist's name.

## Order of work

1. **Style sheet**: one image that sets the world (character, palette, a set, the texture). Iterate
   until it passes the poster test (`motion-craft`). It is the reference for everything after.
2. **Characters**: a sheet per character, front-on, full body, flat plain background, from the style
   sheet as `referenceImages`. Backup and supporting characters the same way.
3. **Sets and plates**: backgrounds with the subject area kept clear, at each format's ratio, with
   the space for type planned in the storyboard left empty.
4. **Shot images**: the character in the set (`@hero in @set, pose, framing`). Variants for the rig
   are edits of that exact image ("same image, eyes closed" / "mouth open") so swaps do not jump.
5. **Video bases** where the film needs real motion (dance, physics, camera through a space):
   `generate_video` image-to-video from a shot image (`startFrame`, optional `endFrame`), 5-10 s,
   prompt the motion and camera only. seedance-2.5 or kling-o3 for characters, veo-3.1 for
   camera and physics. Budget them: video costs far more than images.

## Into the film

- Stills: `fetch.mjs <film> <url> assets/gen/<name>.png --model --prompt --cost`; then image layers,
  `puppet()`, `plate()`, `parallax()`.
- Clips: `fetch.mjs ... assets/gen/<name>.mp4`, then
  `python studio/tools/seq.py <film>/assets/gen/<name>.mp4 <film>/assets/seq/<name> --fps 30 --sheet`
  and look at the sheet. In the shot: `loadSequence(ctx, 'assets/seq/<name>')`, `prepare` calls
  `clip.prepare(local)`, draw `{ type: 'image', img: clip.frame(local) }` inside a group whose `fx`
  redraws it: `ink` (line art over flat colour or paper), `kuwahara` (painterly), `riso`, `halftone`,
  `dither`. JS overlays on top (type, graphic marks, traced strokes, particles) finish it.
- Lip sync to our own song is not available through these models; show singing briefly, cut away,
  use the rig's mouth on stills (`singing(t, words)`), or keep faces out of close-up while singing.

## Files

`<film>/assets/gen/manifest.json` (written by fetch.mjs) records file, model, prompt, refs, ratio,
task id and cost for every generation. Regenerate from it, never from memory.

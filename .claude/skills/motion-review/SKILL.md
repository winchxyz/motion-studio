---
name: motion-review
description: Review a film in this studio before showing it - contact sheets and stills, frames from the real encode, qa.py (undeclared cuts, too-fast stretches, light, brand colours), audit.mjs (safe area, text size, overlaps, reading time), the motion-critic agent, and the user's preview notes. Use after building shots, before delivering, and whenever the user gives feedback.
---

# Review

Claude cannot watch video or hear audio. It looks at frames and reads measurements; this skill is
how that becomes a reliable eye.

## Every pass

1. Notes first: read `<film>/notes.md` (timestamped notes the user typed in the preview player) and
   the latest chat feedback. Each note becomes a fix with its time.
2. Contact sheet of the whole film at 0.25-0.5 s (`render.mjs --sheet`), then zoom sheets of busy
   moments at 0.05-0.1 s. Look for: one subject per frame, hierarchy, readable type, clean edges,
   overlaps, empty frames, flicker between neighbours, anything off-brand.
3. After a video render: `python studio/tools/frames.py <master.mp4> a:b:step out/check.jpg` looks at
   the real encode (banding, compression, the cut frames).
4. `python studio/tools/qa.py <film> --format h`: no undeclared one-frame changes, no whip-speed
   stretches outside transitions, no black or blown frames, brand colours within 3/255.
5. `render.mjs --audit 0:<dur>:0.1` + `audit.mjs`: text inside the safe area, above the minimum size,
   not overlapping, readable long enough. Do both formats.
6. Sound: `out/audio_check.png` (spectrogram, loudness, cue marks) and the master's -14 LUFS / -1 dBTP.
7. Fresh eyes: spawn the `motion-critic` agent with the sheet paths, brief.md and storyboard.md.
   It has not seen the code, so it judges only the picture. Fix what it finds that you agree with.

## Pace numbers (breakdown.py / qa.py, fastest tenth of the picture, % of frame width per second)

The user's approved reels: median 0.2-3.7, 36-75 % nearly still. Spots in the references: median
4-9, ~30 % still. Music videos: median 11-21. Above ~150 for longer than 0.35 s outside a transition
is too fast to follow.

## Done means

Sheets looked at in every format, qa.py and audit.mjs clean (or each remaining finding explained),
critic findings addressed, the encode checked with frames.py. Then deliver.

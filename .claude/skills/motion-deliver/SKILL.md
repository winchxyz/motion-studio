---
name: motion-deliver
description: Render and deliver a finished film from this studio - every format, the soundtrack, -14 LUFS masters, share files, phone previews under 30 MB, posters, styleframes, alpha overlays, cutdowns, and post copy. Use when a film is approved for final render, or the user asks for files, formats or a post.
---

# Deliver

```bash
node studio/tools/render.mjs <film> --video --format h        # repeat per format in film.json (v, s, p; k = 4K)
node studio/tools/deliver.mjs <film>                          # sound + per-format master, share, preview, poster, styleframes
python studio/tools/qa.py <film> --format h                   # on the master
```

- Render time: ~80 ms/frame for 2D at 12 samples, ~300 ms with 3D (1080p60). A 60 s film is
  5-20 min per format. `--draft --samples 4 --scale 0.5` for quick checks.
- Outputs in `<film>/out/`: `<name>-16x9-master.mp4` (CRF 12 picture, AAC 256k), `<name>-16x9.mp4`
  (CRF 16 share file), `<name>-16x9-preview.mp4` (under 28 MB, reaches the user's phone),
  `-poster.png`, `-styleframes.jpg`. Set `deliver.poster` and `deliver.styleframes` times in film.json.
- Send the preview (and the styleframes sheet) with SendUserFile; say where the masters are.
- Transparent overlays (lower thirds, logo stings for editors): `render.mjs --video --alpha` gives
  ProRes 4444 .mov; the film must leave the background unfilled.
- Cutdowns (6 s, 15 s): a second film.json `duration` with `songStart`/shots chosen for the hook, or
  `--from/--to` renders of the master's best stretch.
- Captions for platforms: write an .srt from the film's lines or script (times from song.json or cues).

## Post copy (the user posts on X, Reddit, Threads)

Lead with what it is and that it was made with Claude Code, in plain words; say how (code-rendered,
no video model unless one was used, what was generated), the time it took and the notes given.
Keep a "not affiliated with <brand>" line for fan-made brand pieces. Offer a title per platform.

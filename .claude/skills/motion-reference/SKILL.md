---
name: motion-reference
description: Study reference videos for this studio - download (yt-dlp), break down with breakdown.py (contact sheets, shot list and cut rhythm, pace, palette, loudness, tempo), describe the style, and add a style card to styles/README.md. Use when the user shares video links or files as references, or asks what makes a video work.
---

# References

1. Download into `refs/` (the user's links are the permission): `python -m yt_dlp --write-info-json
   --restrict-filenames -f "bv*+ba/b" --merge-output-format mp4 -o "refs/%(uploader_id)s-%(id)s.%(ext)s" <url>`.
   A post with a quote downloads both videos; drop duplicates by media id. Replies on X need a login:
   ask the user for any prompt they want studied.
2. `python studio/tools/breakdown.py refs/<clip>.mp4` writes `refs/<clip>/`: breakdown.md (format,
   shots, cut rhythm, pace bands, light, palette, loudness, tempo, edits on the beat), sheet-NN.jpg,
   shots-NN.jpg, curves.png, palette.png. Run several at once in the background; long clips take
   minutes. Zoom: `--from 12 --to 18 --every 0.1 --tag hook --sheets-only`.
3. Look at the sheets and the curves. Describe: what it is, the one idea per section, art
   direction (palette, type, texture, rendering), motion vocabulary (how things enter, move, leave),
   transitions, pacing numbers, sound, and what it would take here (engine features, generated art,
   3D, a song).
4. Add or update a card in `styles/README.md`: name, source clips, look recipe (palette hexes, type
   pairing, look chain, textures), motion and pacing, sound, what to borrow, what to avoid, what the
   engine needs. Cards are what the brief offers as style directions.

Compare against your own finished films with `--out refs/_own/<name>`: their approved pace is the
calibration for "too fast".

---
name: motion-song
description: Make and time the song for a music video in this studio - write lyrics, generate the track with Runway Lyria, analyse it with song.py (beats, bars, sections, word-timed lyrics), choose the stretch the film uses. Also covers voice-over. Use for music videos, lyric videos, or any film cut to a song.
---

# The song

## Lyrics (with the user)

- Short lines of 4-8 words, each one a picture: the video gets one idea per line.
- A hook that repeats; for a 30-60 s film one chorus (plus a pre-chorus) is enough.
- Mark sections in square brackets: [Verse], [Chorus]. Save as `<film>/lyrics.txt` (one sung line per
  line; bracket lines are ignored by the aligner).

## Generate (Runway `generate_music`)

- `lyria-3-pro` (8 credits, a full song) or `lyria-3-clip` (4 credits, short beds and stings).
- promptText: genre and mood first, then tempo in BPM, instrumentation, vocal style, structure, then
  the full lyrics. Ask for a clear lead vocal (the aligner needs to hear the words).
- Download to `<film>/assets/song.mp3`. Generation is not repeatable: keep every take
  (`song-take2.mp3`) and note prompts in brief.md.

## Analyse

```bash
python studio/tools/song.py <film>/assets/song.mp3 --lyrics <film>/lyrics.txt
```
Prints tempo, sections and every line with its time; writes `assets/song.json`. Check the matched
percentage (below ~70 %, listen-check is impossible, so compare the transcript lines it prints with
the lyrics and fix times by hand in song.json). Whisper runs on the CPU here (small model: about a
minute per minute of song; `--model medium` is slower and better).

## Choose the stretch

Set `songStart` (film.json top level and `audio.songStart`) to the downbeat where the film begins
(usually the bar before the chorus) and `duration` to whole bars. `songFor()` in the film shifts
beats, lines and sections to film time. Leave half a bar of tail for the fade.

## Voice-over instead of a song

`generate_speech` (1 credit per 50 characters; `eleven_v3` for character, `eleven_multilingual_v2`
for neutral narration). One call per line, placed by the film's cues in sound.py with `Mixer.place`;
duck the music under it. Captions come from the script (times from the cues), not from recognition.

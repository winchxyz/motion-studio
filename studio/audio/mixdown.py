"""Soundtrack for a film that has no score script of its own: the song (or none), plus designed
effects on the film's cues, into <film>/out/audio.wav.

    python studio/audio/mixdown.py <film folder>

Reads <film>/film.json:
  "audio": { "song": "assets/song.mp3", "songStart": 45.0, "gain": 1.0,
             "sfx": true, "sfxGain": 0.8, "duck": 0.25, "tail": 0.6 }
and <film>/out/cues.json (written by render.mjs --cues or --video). A film with its own sound.py
(a synthesized score) runs that instead; deliver.mjs picks whichever exists.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mix import Mixer, load_audio  # noqa: E402
from sfx import for_cue  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8')


def main(film):
    meta = json.load(open(os.path.join(film, 'film.json'), encoding='utf-8'))
    cues_path = os.path.join(film, 'out', 'cues.json')
    info = json.load(open(cues_path, encoding='utf-8')) if os.path.exists(cues_path) else {'cues': []}
    dur = meta.get('duration') or info.get('duration')
    A = meta.get('audio', {})
    song_file = A.get('song') or meta.get('audioFile')
    start = A.get('songStart', meta.get('songStart', 0.0))
    m = Mixer(dur)
    if song_file:
        path = os.path.join(film, song_file)
        track = load_audio(path, start=start, dur=dur + 0.05)
        m.put('music', track, 0.0, gain=A.get('gain', 1.0), fade_in=A.get('fadeIn', 0.01), fade_out=A.get('tail', 0.6))
        print(f'song {song_file} from {start:.2f} s, {track.shape[1] / 48000:.2f} s')
    n = 0
    if A.get('sfx', True):
        for c in info.get('cues', []):
            r = for_cue(c)
            if not r:
                continue
            sig, gain, pan, verb, lead = r
            m.place('sfx', sig, c['t'] - lead, gain * A.get('sfxGain', 0.8), pan, verb)
            if A.get('duck') and c['type'] in ('hit', 'impact', 'stamp'):
                m.duck('music', c['t'], depth=A['duck'])
            n += 1
    out = os.path.join(film, 'out', 'audio.wav')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    # a song arrives mastered: keep its tone, only a light safety chain
    m.write(out, tone=not song_file, drive=1.05 if song_file else 1.25, fade_out=0.0 if song_file else 0.6)
    print(f'{n} effects on cues -> {out}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '.')

"""TITLE: score and sound design, synthesized from the film's cue list.

    python sound.py      (run by deliver.mjs; reads out/cues.json, writes out/audio.wav)

A starting point: a pad on a four-chord loop, kick and hats once the hook lands, the film's cues as
designed effects, the energy curve (automation) opening the filter. Rewrite it per film: key,
instruments and a signature sound that belongs to the brand.
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
STUDIO = os.path.join(HERE, '..', 'studio', 'audio')
sys.path.insert(0, os.path.normpath(STUDIO))
from synth import SR, midi, pad_note, pluck, kick, hat, bass, lp_gain, stft_filter  # noqa: E402
from mix import Mixer  # noqa: E402
from sfx import for_cue  # noqa: E402

info = json.load(open(os.path.join(HERE, 'out', 'cues.json'), encoding='utf-8'))
meta = json.load(open(os.path.join(HERE, 'film.json'), encoding='utf-8'))
DUR = info['duration']
BPM = meta.get('bpm', 120)
BEAT = 60 / BPM
m = Mixer(DUR)

PROG = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 55, 60, 64], [55, 59, 62, 67]]   # Am7 Fmaj7 C G
bar = 4 * BEAT
for i in range(int(DUR / bar) + 1):
    ch = PROG[i % 4]
    for n in ch:
        m.place('music', pad_note(midi(n), bar, 2500, attack=0.3, release=1.0), i * bar, gain=0.16)
    m.place('music', bass(midi(ch[0] - 24), bar * 0.9), i * bar, gain=0.35)
hook_end = 2 * bar
for k in range(int(DUR / BEAT)):
    t = k * BEAT
    if t >= hook_end and t < DUR - bar:
        m.place('drums', kick(0.9), t, gain=0.7)
        m.place('drums', hat(0.5), t + BEAT / 2, gain=0.25, pan=0.3)
for c in info['cues']:
    r = for_cue(c)
    if r:
        sig, gain, pan, verb, lead = r
        m.place('sfx', sig, c['t'] - lead, gain, pan, verb)
curve = np.array(info.get('curves', {}).get('energy', [1.0]))
rate = info.get('curves', {}).get('rate', 100)
tm = np.arange(m.N) / SR
energy = np.interp(tm, np.arange(len(curve)) / rate, curve) if len(curve) > 1 else np.ones(m.N)
for ch in range(2):
    m.bus['music'][ch] = stft_filter(m.bus['music'][ch], lambda a, f: lp_gain(f, 600 + 9000 * np.interp(a, tm, energy) ** 2, 2))
m.write(os.path.join(HERE, 'out', 'audio.wav'))
print('wrote out/audio.wav', f'{DUR:.2f} s', len(info['cues']), 'cues')

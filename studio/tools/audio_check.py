"""Picture of the soundtrack for checking by eye: log-frequency spectrogram, loudness envelope
(short-term RMS in dBFS) and the film's cue times.

    python tools/audio_check.py [out/audio.wav] [out/audio_check.png]
"""
import json
import os
import sys
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'out', 'audio.wav')
dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'out', 'audio_check.png')
with wave.open(src) as w:
    sr = w.getframerate()
    x = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').reshape(-1, w.getnchannels()).astype(np.float64) / 32768
mono = x.mean(axis=1)
dur = len(mono) / sr
Wd, Hs, He = 2400, 520, 200
F, hop = 4096, int(sr * dur / Wd)
win = np.hanning(F)
cols = []
for i in range(Wd):
    a = i * hop
    seg = mono[a:a + F]
    if len(seg) < F:
        seg = np.pad(seg, (0, F - len(seg)))
    cols.append(np.abs(np.fft.rfft(seg * win)))
S = np.array(cols).T
freqs = np.fft.rfftfreq(F, 1 / sr)
ys = np.geomspace(30, 18000, Hs)
img = np.zeros((Hs, Wd))
for j, f in enumerate(ys):
    k = np.searchsorted(freqs, f)
    img[Hs - 1 - j] = S[min(k, len(freqs) - 1)]
db = 20 * np.log10(img + 1e-9)
db = np.clip((db - db.max() + 80) / 80, 0, 1)
rgb = np.stack([db ** 1.5 * 255, db ** 0.9 * 255, db ** 0.6 * 200], axis=-1).astype(np.uint8)
canvas = Image.new('RGB', (Wd, Hs + He + 40), (12, 14, 16))
canvas.paste(Image.fromarray(rgb), (0, 0))
d = ImageDraw.Draw(canvas)
# envelope
rms = []
n = int(0.05 * sr)
for i in range(Wd):
    a = int(i / Wd * len(mono))
    seg = x[a:a + n]
    rms.append(20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9))
rms = np.array(rms)
y0 = Hs + 20
for db_line in (-6, -12, -18, -24, -36):
    yy = y0 + int((-db_line) / 48 * He)
    d.line([(0, yy), (Wd, yy)], fill=(40, 44, 48))
    d.text((4, yy - 12), f'{db_line} dB', fill=(110, 110, 110))
pts = [(i, y0 + int(min(48, -v) / 48 * He)) for i, v in enumerate(rms)]
d.line(pts, fill=(151, 252, 228), width=2)
peak = np.max(np.abs(x))
# cues
try:
    cues = json.load(open(os.path.join(ROOT, 'out', 'cues.json'), encoding='utf-8'))['cues']
except Exception:
    cues = []
for c in cues:
    if c['type'] in ('tick',):
        continue
    xx = int(c['t'] / dur * Wd)
    d.line([(xx, 0), (xx, Hs)], fill=(255, 90, 120), width=1)
    d.text((xx + 2, 2 + (hash(c['type']) % 6) * 12), c['type'], fill=(255, 150, 170))
for s in range(0, int(dur) + 1):
    xx = int(s / dur * Wd)
    d.line([(xx, Hs), (xx, Hs + 10)], fill=(200, 200, 200))
    d.text((xx + 2, Hs + 2), f'{s}s', fill=(200, 200, 200))
d.text((Wd - 380, Hs + He + 20), f'peak {20 * np.log10(peak):.2f} dBFS  dur {dur:.3f}s', fill=(220, 220, 220))
canvas.save(dst)
print(dst, f'peak {20 * np.log10(peak):.2f} dBFS', f'rms range {rms.min():.1f}..{rms.max():.1f} dB')

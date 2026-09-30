"""Automated checks on a film's real encode.

    python studio/tools/qa.py <film> [--format h] [--video path.mp4]

1. Edit points: every one-frame change in the picture is compared with the edits the film declares
   (out/cues.json "edits"). A change nobody declared is flagged: a glitch, a pop, a layer that
   blinks in or out.
2. Pace: stretches where the fastest-moving tenth of the picture travels faster than a whip
   (150 % of the frame width per second) for longer than 0.35 s outside a declared transition.
   Viewers lose track there ("too fast, I can't follow").
3. Black or blown frames, an empty first or last frame.
4. Brand colours: flat patches that must come out exact, from <film>/qa_colors-<fmt>.json:
   [{ "name": "logo orange", "t": 12.0, "box": [x0, y0, x1, y1], "hex": "#ff6700", "tol": 3 }]
Writes out/qa-<fmt>.png (motion, change, light, loudness and colour over time).
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from breakdown import probe, analyse, edit_points, draw_curves, audio_track, rms_db, loudness  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8')
TAG = {'h': '16x9', 'v': '9x16', 's': '1x1', 'p': '4x5'}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('film')
    ap.add_argument('--format', default='h')
    ap.add_argument('--video')
    a = ap.parse_args()
    film = os.path.abspath(a.film)
    meta = json.load(open(os.path.join(film, 'film.json'), encoding='utf-8'))
    name = meta.get('name') or os.path.basename(film)
    out = os.path.join(film, 'out')
    video = a.video or next((p for p in (os.path.join(out, f'{name}-{TAG.get(a.format, a.format)}-master.mp4'), os.path.join(out, f'video-{a.format}.mp4')) if os.path.exists(p)), None)
    if not video:
        sys.exit('no rendered video for format ' + a.format)
    info = probe(video)
    afps = min(info['fps'], 30)
    print(f"{os.path.relpath(video, film)}: {info['w']}x{info['h']} {info['fps']:g} fps {info['duration']} s")
    tiles, rows, _ = analyse(video, info, 256, afps, 0.0, info['duration'])
    edits = edit_points(rows)
    times = np.array([r['t'] for r in rows])
    cues = json.load(open(os.path.join(out, 'cues.json'), encoding='utf-8')) if os.path.exists(os.path.join(out, 'cues.json')) else {}
    declared = cues.get('edits', [])
    tol = 2.5 / afps
    # 1. edit points
    unexpected = []
    for i, kind in edits:
        t = times[i]
        ok = any(abs(t - e['t']) <= tol + (e.get('dur') or 0) / 2 + 0.02 for e in declared)
        if not ok:
            unexpected.append((t, kind))
    print(f'\nedit points: {len(edits)} found, {len(declared)} declared, {len(unexpected)} not declared')
    for t, kind in unexpected[:20]:
        print(f'  ? {t:7.3f} s  one-frame {kind}  (declare it as an edit, or find the pop)')
    # 2. pace
    win = [(e['t'] - (e.get('dur') or 0) / 2 - 0.1, e['t'] + (e.get('dur') or 0) / 2 + 0.1) for e in declared]
    fast, run = [], None
    for r in rows:
        in_tr = any(a0 <= r['t'] <= a1 for a0, a1 in win)
        if r['flow90'] > 150 and not in_tr:
            run = run or [r['t'], r['t']]
            run[1] = r['t']
        else:
            if run and run[1] - run[0] >= 0.35:
                fast.append(tuple(run))
            run = None
    if run and run[1] - run[0] >= 0.35:
        fast.append(tuple(run))
    f90 = np.array([r['flow90'] for r in rows[1:]]) if len(rows) > 1 else np.zeros(1)
    print(f'\npace: fastest tenth median {np.median(f90):.1f} %W/s, 90th pct {np.percentile(f90, 90):.1f}; still {np.mean(f90 < 2) * 100:.0f} % of the time')
    print(f'  stretches faster than a whip outside transitions: {len(fast)}')
    for a0, a1 in fast[:12]:
        print(f'  ! {a0:7.2f}-{a1:.2f} s')
    # 3. light
    lum = np.array([r['luma'] for r in rows])
    black = np.where(lum < 2)[0]
    blown = np.where(lum > 250)[0]
    print(f'\nlight: luma {lum.min():.1f}..{lum.max():.1f}; first {lum[0]:.1f}, last {lum[-1]:.1f}; black frames {len(black)}, blown frames {len(blown)}')
    # 4. brand colours
    cpath = os.path.join(film, f'qa_colors-{a.format}.json')
    if os.path.exists(cpath):
        print('\nbrand colours (flat patch mean vs token, 8-bit):')
        for c in json.load(open(cpath, encoding='utf-8')):
            raw = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-ss', f"{c['t']:.4f}", '-i', video, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
            fr = np.frombuffer(raw, np.uint8).reshape(info['h'], info['w'], 3).astype(np.float32)
            x0, y0, x1, y1 = c['box']
            got = fr[y0:y1, x0:x1].reshape(-1, 3).mean(0)
            v = int(c['hex'][1:], 16)
            want = np.array([(v >> 16) & 255, (v >> 8) & 255, v & 255], np.float32)
            err = float(np.abs(got - want).max())
            print(f"  {'ok ' if err <= c.get('tol', 3) else 'BAD'} {c['name']:<34} t={c['t']:<6} want {c['hex']} got #{int(got[0]):02x}{int(got[1]):02x}{int(got[2]):02x} err {err:.1f}")
    snd = None
    if info['acodec']:
        x = audio_track(video)
        snd = {**loudness(video), 'rms_db': rms_db(x, 22050)}
        print(f"\nsound: {snd['lufs']} LUFS, true peak {snd['true_peak']} dBTP")
    png = os.path.join(out, f'qa-{a.format}.png')
    draw_curves(png, info, rows, edits, snd, 0.0, info['duration'])
    print('->', os.path.relpath(png, film))


if __name__ == '__main__':
    main()

"""Break a video down into things that can be read without watching it: contact sheets, a shot
list with the cut rhythm, motion speed, light and colour, loudness and tempo.

    python studio/tools/breakdown.py refs/clip.mp4                       full breakdown
    python studio/tools/breakdown.py refs/clip.mp4 --from 12 --to 18 --every 0.1 --tag hook --sheets-only
                                                                          zoomed sheet of one moment

Output folder: --out, default <video folder>/<video name>/
  breakdown.md   the numbers in words: format, shots and cut rhythm, motion, light, colour, sound
  sheet-NN.jpg   contact sheets, one frame every --every seconds, time-stamped
  shots-NN.jpg   the middle frame of every shot between edit points, with its start and length
  curves.png     motion speed, frame change with the cuts, brightness, saturation, loudness and the
                 beat grid on one time axis, over a colour barcode of the whole video
  palette.png    dominant colours with their share of the picture
  data.json      all of it as numbers

Motion speed is dense optical flow in % of the frame width per second, so clips of any size
compare. "p90" is the speed of the fastest-moving tenth of the picture, which is what the eye
tracks; it is the number to watch for "too fast to follow".
Edit points: "cut" = the look of the picture changes in one frame (colour histogram jumps);
"swap" = same look, new content in one frame (a word or a card replaced on the same background).
"""
import argparse
import io
import json
import math
import os
import re
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.stdout.reconfigure(encoding='utf-8')

AW = 256                                   # analysis width (px)
BANDS = [('still', 0, 2), ('slow', 2, 15), ('moderate', 15, 50), ('fast', 50, 150), ('whip', 150, 1e9)]
BG, INK, DIM, GRID = (14, 16, 19), (225, 228, 232), (120, 126, 134), (38, 42, 48)
ACCENT, CUT, SWAP, BEAT = (120, 220, 200), (255, 92, 120), (255, 190, 90), (70, 76, 86)


def font(size):
    for f in ('C:/Windows/Fonts/consola.ttf', 'C:/Windows/Fonts/arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def even(x):
    return max(2, int(round(x / 2)) * 2)


def probe(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path],
                       capture_output=True, text=True, encoding='utf-8')
    d = json.loads(r.stdout)
    v = next(s for s in d['streams'] if s['codec_type'] == 'video')
    a = next((s for s in d['streams'] if s['codec_type'] == 'audio'), None)

    def rate(s):
        n, m = s.split('/')
        return float(n) / float(m) if float(m) else 0.0
    return {
        'file': os.path.basename(path),
        'w': int(v['width']), 'h': int(v['height']),
        'fps': round(rate(v.get('avg_frame_rate', '0/1')) or rate(v.get('r_frame_rate', '0/1')), 3),
        'duration': round(float(d['format'].get('duration') or v.get('duration') or 0), 3),
        'vcodec': v['codec_name'], 'bitrate_kbps': int(int(d['format'].get('bit_rate') or 0) / 1000),
        'acodec': a['codec_name'] if a else None,
        'sample_rate': int(a['sample_rate']) if a else None,
        'channels': int(a['channels']) if a else None,
    }


def decode(path, w, h, fps, t0=0.0, t1=None):
    """Yield RGB frames resampled to fps, starting at t0."""
    cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error']
    if t0:
        cmd += ['-ss', f'{t0:.3f}']
    cmd += ['-i', path]
    if t1 is not None:
        cmd += ['-t', f'{t1 - t0:.3f}']
    cmd += ['-vf', f'fps={fps:.6f},scale={w}:{h}:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    n = w * h * 3
    try:
        while True:
            b = p.stdout.read(n)
            if len(b) < n:
                break
            yield np.frombuffer(b, np.uint8).reshape(h, w, 3)
    finally:
        p.stdout.close()
        p.wait()


def jpeg(fr, q=88):
    return cv2.imencode('.jpg', np.ascontiguousarray(fr[:, :, ::-1]), [cv2.IMWRITE_JPEG_QUALITY, q])[1].tobytes()


def analyse(path, info, tw, afps, t0, t1):
    th = even(tw * info['h'] / info['w'])
    aw = min(AW, tw)
    ah = even(aw * info['h'] / info['w'])
    rng = np.random.default_rng(7)
    k = 100.0 * afps / aw                  # px per frame at aw -> % of width per second
    tiles, rows, samples = [], [], []
    prev = None
    every_px = max(1, int(round(afps / 2)))
    for i, fr in enumerate(decode(path, tw, th, afps, t0, t1)):
        tiles.append(jpeg(fr))
        small = cv2.resize(fr, (aw, ah), interpolation=cv2.INTER_AREA) if tw != aw else fr
        hsv = cv2.cvtColor(small, cv2.COLOR_RGB2HSV)
        hist = cv2.calcHist([hsv], [0, 1, 2], None, [18, 4, 4], [0, 180, 0, 256, 0, 256])
        cv2.normalize(hist, hist)
        g = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
        f32 = small.astype(np.float32)
        m = {
            't': round(t0 + i / afps, 4),
            'luma': float((f32 @ np.array([0.2126, 0.7152, 0.0722], np.float32)).mean()),
            'sat': float(hsv[..., 1].mean() / 255),
            'rgb': [float(c) for c in f32.reshape(-1, 3).mean(0)],
            'diff': 0.0, 'hist': 0.0, 'flow': 0.0, 'flow90': 0.0, 'moving': 0.0,
        }
        if prev is not None:
            pf32, ph, pg = prev
            m['diff'] = float(np.abs(f32 - pf32).mean())
            m['hist'] = float(cv2.compareHist(ph, hist, cv2.HISTCMP_BHATTACHARYYA))
            flow = cv2.calcOpticalFlowFarneback(pg, g, None, 0.5, 3, 15, 3, 5, 1.2, 0)
            mag = np.sqrt((flow ** 2).sum(-1)) * k
            m['flow'] = float(mag.mean())
            m['flow90'] = float(np.percentile(mag, 90))
            m['moving'] = float((mag > 5).mean())
        if i % every_px == 0:
            px = small.reshape(-1, 3)
            samples.append(px[rng.integers(0, len(px), 256)])
        rows.append(m)
        prev = (f32, hist, g)
        if i % 300 == 0:
            print(f'\r  frames {i}', end='', flush=True)
    print(f'\r  frames {len(rows)}')
    return tiles, rows, (np.concatenate(samples) if samples else np.zeros((0, 3), np.uint8))


def edit_points(rows):
    """Frames where the picture changes in one step: hard cuts and content swaps."""
    d = np.array([r['diff'] for r in rows])
    h = np.array([r['hist'] for r in rows])
    n = len(d)
    out = []
    for i in range(1, n):
        nb = max(d[i - 1] if i >= 2 else 0.0, d[i + 1] if i + 1 < n else 0.0)
        excess = d[i] - nb
        local = np.median(d[max(1, i - 15):min(n, i + 16)])
        if (h[i] >= 0.30 and excess >= 5) or (d[i] >= 35 and excess >= 18):
            kind = 'cut'
        elif d[i] >= 6 and excess >= max(6.0, 5 * local):
            kind = 'swap'
        else:
            continue
        if out and i - out[-1][0] <= 3:        # a flash or a two-frame transition: one edit point
            if kind == 'cut':
                out[-1] = (out[-1][0], 'cut')
            continue
        out.append((i, kind))
    return out


def audio_track(path, sr=22050):
    raw = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', path, '-vn', '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-'],
                         capture_output=True).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64)


def loudness(path):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    s = r.stderr[r.stderr.rfind('Summary:'):]

    def num(pat):
        m = re.search(pat, s)
        return float(m.group(1)) if m and m.group(1) not in ('-inf', 'inf') else None
    return {'lufs': num(r'I:\s+(-?[\d.]+|-inf) LUFS'), 'lra': num(r'LRA:\s+(-?[\d.]+) LU'), 'true_peak': num(r'Peak:\s+(-?[\d.]+|-inf) dBFS')}


def tempo(x, sr, dur):
    """Onset envelope (spectral flux), tempo by autocorrelation with a mild 120 BPM prior, beat phase."""
    n_fft, hop = 1024, 256
    if len(x) < n_fft * 8:
        return None
    win = np.hanning(n_fft)
    nfr = 1 + (len(x) - n_fft) // hop
    env = np.zeros(nfr)
    prev = None
    for a in range(0, nfr, 2048):                          # chunks keep memory small
        idx = np.arange(n_fft)[None, :] + hop * np.arange(a, min(nfr, a + 2048))[:, None]
        L = np.log1p(1000 * np.abs(np.fft.rfft(x[idx] * win, axis=1)))
        if prev is not None:
            L = np.vstack([prev, L])
        flux = np.maximum(0, np.diff(L, axis=0)).sum(1)
        env[a + (0 if prev is not None else 1):a + (0 if prev is not None else 1) + len(flux)] = flux
        prev = L[-1:]
    fr = sr / hop
    kk = max(1, int(0.5 * fr))
    env = np.maximum(0, env - np.convolve(env, np.ones(kk) / kk, mode='same'))
    env /= env.std() + 1e-9
    n = len(env)
    f = np.fft.rfft(env, 2 * n)
    ac = np.fft.irfft(f * np.conj(f))[:n]
    ac /= ac[0] + 1e-9
    lags = np.arange(n, dtype=float)
    lags[0] = 1
    bpm = 60 * fr / lags
    valid = (bpm >= 60) & (bpm <= 200)
    prior = np.exp(-0.5 * (np.log2(np.maximum(bpm, 1) / 120) / 1.0) ** 2)
    score = np.where(valid, ac * prior, -1)
    lag = int(np.argmax(score))
    if 1 <= lag < n - 1:                                    # parabolic refinement
        y0, y1, y2 = ac[lag - 1], ac[lag], ac[lag + 1]
        den = y0 - 2 * y1 + y2
        P = lag + (0.5 * (y0 - y2) / den if abs(den) > 1e-12 else 0)
    else:
        P = float(lag)
    phases = np.arange(0, P, 0.5)
    best = max(phases, key=lambda ph: env[np.clip(np.round(ph + P * np.arange(int((n - ph) / P))).astype(int), 0, n - 1)].mean())
    beats = [(best + P * j) / fr for j in range(int((n - best) / P) + 1) if (best + P * j) / fr <= dur]
    return {'bpm': round(60 * fr / P, 2), 'confidence': round(float(ac[lag]), 3), 'beats': [round(b, 4) for b in beats]}


def rms_db(x, sr, step=0.05):
    n = int(step * sr)
    m = len(x) // n
    if not m:
        return []
    seg = x[:m * n].reshape(m, n)
    return [round(float(v), 2) for v in 20 * np.log10(np.sqrt((seg ** 2).mean(1)) + 1e-9)]


def kmeans(px, k=8, iters=30, seed=3):
    if len(px) < k:
        return np.zeros((0, 3)), np.zeros(0)
    lab = cv2.cvtColor(px.reshape(-1, 1, 3).astype(np.uint8), cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float64)
    rng = np.random.default_rng(seed)
    c = [lab[rng.integers(len(lab))]]
    for _ in range(1, k):
        d = np.min(((lab[:, None, :] - np.array(c)[None]) ** 2).sum(-1), axis=1)
        c.append(lab[rng.choice(len(lab), p=d / d.sum())] if d.sum() > 0 else lab[rng.integers(len(lab))])
    c = np.array(c)
    for _ in range(iters):
        lbl = np.argmin(((lab[:, None, :] - c[None]) ** 2).sum(-1), axis=1)
        for j in range(k):
            if (lbl == j).any():
                c[j] = lab[lbl == j].mean(0)
    share = np.bincount(lbl, minlength=k) / len(lab)
    rgb = cv2.cvtColor(np.clip(np.round(c), 0, 255).astype(np.uint8).reshape(-1, 1, 3), cv2.COLOR_LAB2RGB).reshape(-1, 3)
    order = np.argsort(-share)
    return rgb[order], share[order]


def hexc(c):
    return '#' + ''.join(f'{int(v):02x}' for v in c)


def draw_sheet(tiles, labels, cols, path, title):
    imgs = [Image.open(io.BytesIO(b)).convert('RGB') for b in tiles]
    tw, th = imgs[0].size
    pad, lh, top = 6, 22, 36
    rows = math.ceil(len(imgs) / cols)
    W = cols * tw + (cols + 1) * pad
    H = top + rows * (th + lh + pad) + pad
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((pad + 2, 8), title, fill=INK, font=font(18))
    f = font(15)
    for i, (img, lab) in enumerate(zip(imgs, labels)):
        x = pad + (i % cols) * (tw + pad)
        y = top + (i // cols) * (th + lh + pad)
        im.paste(img, (x, y))
        d.text((x + 2, y + th + 3), lab, fill=INK, font=f)
    im.save(path, quality=90)


def fmt_t(t):
    return f'{int(t // 60)}:{t % 60:05.2f}' if t >= 60 else f'{t:.2f}s'


def draw_curves(path, info, rows, edits, snd, t0, t1):
    t = np.array([r['t'] for r in rows])
    Wd, L, R = 2200, 86, 20
    PW = Wd - L - R
    panels = [('motion %W/s', 150), ('change', 110), ('light', 90), ('sound dB', 110), ('colour', 60)]
    top = 40
    H = top + sum(h + 26 for _, h in panels) + 30
    im = Image.new('RGB', (Wd, H), BG)
    d = ImageDraw.Draw(im)
    f, fs = font(16), font(13)
    d.text((L, 10), f"{info['file']}  {info['w']}x{info['h']}  {info['fps']:g} fps  {fmt_t(t1 - t0)}", fill=INK, font=f)
    X = lambda tt: L + (tt - t0) / max(t1 - t0, 1e-6) * PW
    span = t1 - t0
    step = next(s for s in (0.5, 1, 2, 5, 10, 15, 30, 60) if span / s <= 30)
    y = top
    beats = (snd or {}).get('tempo', {}) or {}
    for name, ph in panels:
        d.rectangle([L, y, L + PW, y + ph], outline=GRID)
        d.text((6, y + 2), name, fill=DIM, font=fs)
        tt = math.ceil(t0 / step) * step
        while tt <= t1 + 1e-6:
            d.line([(X(tt), y), (X(tt), y + ph)], fill=GRID)
            tt += step
        if name.startswith('motion'):
            top_v = max(100.0, float(np.percentile([r['flow90'] for r in rows], 99)) * 1.05)
            for ref in (15, 50, 150):
                if ref < top_v:
                    yy = y + ph - ref / top_v * ph
                    d.line([(L, yy), (L + PW, yy)], fill=(50, 56, 64))
                    d.text((L - 40, yy - 7), f'{ref}', fill=DIM, font=fs)
            for key, col in (('flow90', (70, 140, 130)), ('flow', ACCENT)):
                pts = [(X(r['t']), y + ph - min(r[key], top_v) / top_v * ph) for r in rows]
                d.line(pts, fill=col, width=1)
        elif name == 'change':
            mx = max(40.0, max(r['diff'] for r in rows))
            pts = [(X(r['t']), y + ph - r['diff'] / mx * ph) for r in rows]
            d.line(pts, fill=(170, 176, 186), width=1)
            for i, kind in edits:
                d.line([(X(rows[i]['t']), y), (X(rows[i]['t']), y + 10)], fill=CUT if kind == 'cut' else SWAP, width=2)
        elif name == 'light':
            d.line([(X(r['t']), y + ph - r['luma'] / 255 * ph) for r in rows], fill=(230, 230, 230), width=1)
            d.line([(X(r['t']), y + ph - r['sat'] * ph) for r in rows], fill=(230, 140, 200), width=1)
            d.text((L + PW - 150, y + 2), 'luma  saturation', fill=DIM, font=fs)
        elif name.startswith('sound'):
            for b in beats.get('beats', []):
                if t0 <= b <= t1:
                    d.line([(X(b), y), (X(b), y + ph)], fill=BEAT)
            env = (snd or {}).get('rms_db') or []
            if env:
                pts = [(X(t0 + j * 0.05), y + ph - (max(-60.0, v) + 60) / 60 * ph) for j, v in enumerate(env) if t0 + j * 0.05 <= t1]
                if len(pts) > 1:
                    d.line(pts, fill=(151, 252, 228), width=1)
            for i, kind in edits:
                d.line([(X(rows[i]['t']), y + ph - 10), (X(rows[i]['t']), y + ph)], fill=CUT if kind == 'cut' else SWAP, width=2)
        elif name == 'colour':
            for j, r in enumerate(rows):
                xa = X(r['t'])
                xb = X(rows[j + 1]['t']) if j + 1 < len(rows) else L + PW
                d.rectangle([xa, y + 1, max(xa, xb), y + ph - 1], fill=tuple(int(c) for c in r['rgb']))
        y += ph + 26
    tt = math.ceil(t0 / step) * step
    while tt <= t1 + 1e-6:
        d.text((X(tt) - 12, y - 22), f'{tt:g}s', fill=DIM, font=fs)
        tt += step
    im.save(path)


def draw_palette(path, cols, share):
    W, H = 1200, 170
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    f = font(15)
    ws = [max(70.0, (W - 20) * s) for s in share]        # small colours still get a readable swatch
    k = (W - 20) / max(sum(ws), 1)
    x = 10
    for c, s, w in zip(cols, share, ws):
        w = int(w * k)
        d.rectangle([x, 10, x + max(w - 4, 1), 110], fill=tuple(int(v) for v in c))
        d.text((x, 118), hexc(c), fill=INK, font=f)
        d.text((x, 140), f'{s * 100:.0f}%', fill=DIM, font=f)
        x += w
    im.save(path)


def pct(a, q):
    return float(np.percentile(a, q)) if len(a) else 0.0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('video')
    ap.add_argument('--out')
    ap.add_argument('--from', dest='t0', type=float, default=0.0)
    ap.add_argument('--to', dest='t1', type=float)
    ap.add_argument('--every', type=float, help='seconds between contact-sheet frames (default: about 60 frames)')
    ap.add_argument('--fps', type=float, help='analysis rate (default: the video rate, at most 30)')
    ap.add_argument('--cols', type=int, default=6)
    ap.add_argument('--tw', type=int, default=384, help='tile width (px)')
    ap.add_argument('--per-page', type=int, default=36)
    ap.add_argument('--tag', default='', help='name prefix for the sheets, so a zoom keeps the overview')
    ap.add_argument('--sheets-only', action='store_true', help='contact sheets only, no analysis')
    a = ap.parse_args()

    info = probe(a.video)
    t0 = max(0.0, a.t0)
    t1 = min(info['duration'], a.t1) if a.t1 is not None else info['duration']
    span = t1 - t0
    out = a.out or os.path.join(os.path.dirname(os.path.abspath(a.video)), os.path.splitext(os.path.basename(a.video))[0])
    os.makedirs(out, exist_ok=True)
    every = a.every or next(s for s in (0.1, 0.2, 0.25, 0.5, 1, 2, 3, 4, 5, 10, 15, 30) if span / s <= 60)
    tag = (a.tag + '-') if a.tag else ''
    print(f"{info['file']}: {info['w']}x{info['h']} {info['fps']:g} fps {info['duration']} s  ->  {out}")

    if a.sheets_only:
        th = even(a.tw * info['h'] / info['w'])
        tiles = [jpeg(fr) for fr in decode(a.video, a.tw, th, 1 / every, t0, t1)]
        times = [t0 + i * every for i in range(len(tiles))]
        write_sheets(out, tag, tiles, times, a, info, every)
        return

    afps = a.fps or min(info['fps'] or 30, 30)
    tiles, rows, px = analyse(a.video, info, a.tw, afps, t0, t1)
    edits = edit_points(rows)
    times = [r['t'] for r in rows]

    # sheets: one tile every `every` seconds, picked from the analysis stream
    idx = sorted({min(len(rows) - 1, int(round((t - t0) * afps))) for t in np.arange(t0, t1, every)})
    write_sheets(out, tag, [tiles[i] for i in idx], [times[i] for i in idx], a, info, every)

    # shots between edit points
    bounds = [0] + [i for i, _ in edits] + [len(rows)]
    kinds = ['start'] + [k for _, k in edits]
    shots = []
    for j in range(len(bounds) - 1):
        s, e = bounds[j], bounds[j + 1]
        if e <= s:
            continue
        shots.append({'n': len(shots) + 1, 'start': round(times[s], 3), 'end': round(times[e - 1] + 1 / afps, 3),
                      'length': round((e - s) / afps, 3), 'by': kinds[j], 'mid': (s + e - 1) // 2})
    per = a.per_page
    for p in range(0, len(shots), per):
        chunk = shots[p:p + per]
        draw_sheet([tiles[s['mid']] for s in chunk],
                   [f"#{s['n']} {fmt_t(s['start'])} {s['length']:.2f}s{'' if s['by'] != 'swap' else ' swap'}" for s in chunk],
                   a.cols, os.path.join(out, f'{tag}shots-{p // per + 1:02d}.jpg'),
                   f"{info['file']}  shots {chunk[0]['n']}-{chunk[-1]['n']} of {len(shots)} (middle frame, start, length)")

    # sound
    snd = None
    if info['acodec']:
        x = audio_track(a.video)
        sr = 22050
        x = x[int(t0 * sr):int(t1 * sr)]
        snd = {**loudness(a.video), 'rms_db': rms_db(x, sr)}
        tp = tempo(x, sr, span)
        if tp:
            tp['beats'] = [round(b + t0, 4) for b in tp['beats']]
            snd['tempo'] = tp

    draw_curves(os.path.join(out, f'{tag}curves.png'), info, rows, edits, snd, t0, t1)
    cols, share = kmeans(px)
    draw_palette(os.path.join(out, f'{tag}palette.png'), cols, share)

    # numbers
    moving = [r for j, r in enumerate(rows) if j and j not in {i for i, _ in edits}]
    f90 = np.array([r['flow90'] for r in moving]) if moving else np.zeros(1)
    fm = np.array([r['flow'] for r in moving]) if moving else np.zeros(1)
    bands = {name: round(float(((f90 >= lo) & (f90 < hi)).mean()), 3) for name, lo, hi in BANDS}
    lengths = np.array([s['length'] for s in shots])
    data = {
        'info': info, 'range': [t0, t1], 'analysis_fps': afps,
        'edits': [{'t': times[i], 'kind': k} for i, k in edits],
        'shots': [{k: v for k, v in s.items() if k != 'mid'} for s in shots],
        'motion': {'median': round(pct(fm, 50), 1), 'p90_median': round(pct(f90, 50), 1), 'p90_p90': round(pct(f90, 90), 1), 'bands_by_p90': bands},
        'light': {'luma_mean': round(float(np.mean([r['luma'] for r in rows])), 1), 'luma_p10': round(pct([r['luma'] for r in rows], 10), 1),
                  'luma_p90': round(pct([r['luma'] for r in rows], 90), 1), 'sat_mean': round(float(np.mean([r['sat'] for r in rows])), 3)},
        'palette': [{'hex': hexc(c), 'share': round(float(s), 3)} for c, s in zip(cols, share)],
        'sound': {k: v for k, v in (snd or {}).items() if k != 'rms_db'} if snd else None,
        'per_frame': [{k: (round(v, 3) if isinstance(v, float) else [round(c, 1) for c in v] if isinstance(v, list) else v) for k, v in r.items()} for r in rows],
    }
    beat_note = ''
    tp = (snd or {}).get('tempo')
    if tp and edits:
        per_beat = 60 / tp['bpm']
        tol = max(0.05, 1 / afps + 0.02)
        bt = np.array(tp['beats'])
        offs = [min(abs(times[i] - bt)) for i, _ in edits] if len(bt) else []
        hit = float(np.mean([o <= tol for o in offs])) if offs else 0.0
        data['sound']['edits_on_beat'] = {'share': round(hit, 3), 'tolerance_s': round(tol, 3), 'chance': round(min(1.0, 2 * tol / per_beat), 3)}
        shot_beats = [round(s['length'] / per_beat * 2) / 2 for s in shots]
        common = sorted({b: shot_beats.count(b) for b in shot_beats}.items(), key=lambda kv: -kv[1])[:6]
        beat_note = (f"- Edits on the beat: {hit * 100:.0f} % within {tol * 1000:.0f} ms of a beat (chance {min(1, 2 * tol / per_beat) * 100:.0f} %).\n"
                     f"- Shot lengths in beats (most common): " + ', '.join(f'{b:g} beats x{c}' for b, c in common) + '\n')
    with open(os.path.join(out, 'data.json'), 'w', encoding='utf-8') as fh:
        json.dump(data, fh)

    n_cut = sum(1 for _, k in edits if k == 'cut')
    n_swap = len(edits) - n_cut
    md = [f"# {info['file']}", '',
          f"- Format: {info['w']}x{info['h']}, {info['fps']:g} fps, {info['duration']} s, {info['vcodec']} {info['bitrate_kbps']} kb/s"
          + (f", audio {info['acodec']} {info['sample_rate']} Hz x{info['channels']}" if info['acodec'] else ', no audio'),
          f"- Range analysed: {t0:g}-{t1:g} s at {afps:g} fps",
          f"- Edit points: {len(edits)} ({n_cut} cuts, {n_swap} swaps) -> {len(shots)} shots; "
          f"average {lengths.mean():.2f} s, median {np.median(lengths):.2f} s, shortest {lengths.min():.2f} s, longest {lengths.max():.2f} s",
          f"- Motion (optical flow, % of frame width per second): whole-frame median {data['motion']['median']}; "
          f"fastest tenth median {data['motion']['p90_median']}, 90th pct {data['motion']['p90_p90']}",
          '- Time by pace of the fastest tenth: ' + ', '.join(f'{k} {v * 100:.0f} %' for k, v in bands.items()),
          f"- Light: mean luma {data['light']['luma_mean']}/255 (10-90 %: {data['light']['luma_p10']}-{data['light']['luma_p90']}), "
          f"mean saturation {data['light']['sat_mean']}",
          '- Palette: ' + ', '.join(f"{p['hex']} {p['share'] * 100:.0f} %" for p in data['palette'])]
    if snd:
        md.append(f"- Sound: {snd.get('lufs')} LUFS integrated, LRA {snd.get('lra')} LU, true peak {snd.get('true_peak')} dBTP")
        if tp:
            md.append(f"- Tempo: about {tp['bpm']} BPM (autocorrelation {tp['confidence']}; below ~0.2 treat as a guess)")
    md.append(beat_note.rstrip('\n'))
    md += ['', '## Shots', '', '| # | start | length | by |', '| --- | --- | --- | --- |']
    md += [f"| {s['n']} | {fmt_t(s['start'])} | {s['length']:.2f} s | {s['by']} |" for s in shots[:200]]
    md += ['', 'Files: sheet-NN.jpg (every %g s), shots-NN.jpg, curves.png, palette.png, data.json' % every, '']
    with open(os.path.join(out, f'{tag}breakdown.md'), 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(l for l in md if l is not None))
    print('\n'.join(md[:12]))


def write_sheets(out, tag, tiles, times, a, info, every):
    per = a.per_page
    pages = math.ceil(len(tiles) / per)
    for p in range(pages):
        chunk = slice(p * per, (p + 1) * per)
        tt = times[chunk]
        draw_sheet(tiles[chunk], [fmt_t(t) for t in tt], a.cols, os.path.join(out, f'{tag}sheet-{p + 1:02d}.jpg'),
                   f"{info['file']}  {fmt_t(tt[0])}-{fmt_t(tt[-1])}  every {every:g} s  (page {p + 1}/{pages})")
    print(f'  {len(tiles)} frames on {pages} sheet(s)')


if __name__ == '__main__':
    main()

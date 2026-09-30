"""Analyse a song for a music video: tempo, beats and bars, energy and sections, strong hits, and the
lyrics timed word by word. The film builds its edit on this (shots on beats and lines, captions).

    python studio/tools/song.py <film>/assets/song.mp3 [--lyrics lyrics.txt] [--out song.json]
                                [--model medium] [--no-lyrics] [--from 45 --to 90]

Writes song.json (default: next to the audio file):
  duration, bpm, beats [s], downbeats [s], meter, energy {rate, values 0..1}, sections [{start, end,
  label, energy}], hits [s] (strongest onsets), lines [{text, start, end, words [{w, start, end}]}]
--from/--to analyse only that stretch of the file; times stay in file time, so the film sets
meta.songStart to where its t = 0 sits in the file.

Lyrics: faster-whisper transcribes with word timestamps (GPU if CUDA works, else CPU), biased by the
known lyrics; the known lyric words are then aligned to the transcript so every written word gets a
time, and each line of the lyrics file becomes one line. Without --lyrics the transcript's own
segments become the lines.
"""
import argparse
import difflib
import json
import os
import re
import subprocess
import sys

import numpy as np

sys.stdout.reconfigure(encoding='utf-8')
SR = 22050
HOP = 256


def load(path, sr=SR):
    raw = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', path, '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-'], capture_output=True).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64)


def spectra(x):
    n_fft = 2048
    win = np.hanning(n_fft)
    nfr = 1 + (len(x) - n_fft) // HOP
    freqs = np.fft.rfftfreq(n_fft, 1 / SR)
    # 24 log-spaced bands from 40 Hz to 11 kHz
    edges = np.geomspace(40, 11000, 25)
    band = np.digitize(freqs, edges) - 1
    B = np.zeros((nfr, 24))
    for a in range(0, nfr, 1024):
        idx = np.arange(n_fft)[None, :] + HOP * np.arange(a, min(nfr, a + 1024))[:, None]
        S = np.abs(np.fft.rfft(x[idx] * win, axis=1)) ** 2
        for b in range(24):
            m = band == b
            if m.any():
                B[a:a + len(S), b] = S[:, m].sum(1)
    return np.log1p(B * 1e3)


def onset_env(L):
    flux = np.maximum(0, np.diff(L, axis=0)).sum(1)
    flux = np.concatenate([[0], flux])
    fr = SR / HOP
    k = max(1, int(0.4 * fr))
    env = np.maximum(0, flux - np.convolve(flux, np.ones(k) / k, mode='same'))
    return env / (env.std() + 1e-9)


def tempo(env):
    fr = SR / HOP
    n = len(env)
    f = np.fft.rfft(env, 2 * n)
    ac = np.fft.irfft(f * np.conj(f))[:n]
    ac /= ac[0] + 1e-9
    lags = np.arange(n, dtype=float)
    lags[0] = 1
    bpm = 60 * fr / lags
    prior = np.exp(-0.5 * (np.log2(np.maximum(bpm, 1) / 120) / 0.9) ** 2)
    score = np.where((bpm >= 60) & (bpm <= 200), ac * prior, -1)
    lag = int(np.argmax(score))
    y0, y1, y2 = ac[lag - 1], ac[lag], ac[lag + 1]
    den = y0 - 2 * y1 + y2
    P = lag + (0.5 * (y0 - y2) / den if abs(den) > 1e-12 else 0)
    return 60 * fr / P, float(ac[lag])


def track_beats(env, bpm, tightness=120):
    """Dynamic-programming beat tracker (Ellis 2007): the beat sequence that best balances onset strength
    against a steady period."""
    fr = SR / HOP
    P = 60 * fr / bpm
    n = len(env)
    score = env.copy()
    back = -np.ones(n, dtype=int)
    lo, hi = int(round(P / 2)), int(round(2 * P))
    offs = np.arange(lo, hi + 1)
    pen = -tightness * np.log(offs / P) ** 2
    for t in range(hi, n):
        cand = score[t - offs] + pen
        j = int(np.argmax(cand))
        score[t] = env[t] + cand[j]
        back[t] = t - offs[j]
    # end on the best-scoring frame in the last period
    t = int(np.argmax(score[n - hi:]) + n - hi) if n > hi else int(np.argmax(score))
    beats = []
    while t >= 0:
        beats.append(t)
        t = back[t]
    beats = np.array(beats[::-1], dtype=float)
    # extend back to the start at the found period if the tracker began late. Frames before 2P never get
    # a back pointer, so a song that starts on a beat at t = 0 would lose that beat: the last step may land
    # up to 60 ms before the start, and is clamped to 0.
    while beats[0] - P > -0.06 * fr:
        beats = np.concatenate([[max(beats[0] - P, 0.0)], beats])
    return beats / fr


def downbeat_phase(L, beats, meter=4):
    """Which beat of each bar is the one: the phase whose beats carry the most low-end attack."""
    fr = SR / HOP
    low = np.maximum(0, np.diff(L[:, :6], axis=0)).sum(1)
    low = np.concatenate([[0], low])
    idx = np.clip(np.round(np.array(beats) * fr).astype(int), 0, len(low) - 1)
    s = [low[idx[p::meter]].mean() if len(idx[p::meter]) else 0 for p in range(meter)]
    return int(np.argmax(s))


def sections(L, beats, meter=4, bars_per_block=4):
    """Split on novelty between blocks of bars (timbre + loudness), label by similarity."""
    fr = SR / HOP
    bar_t = beats[::meter]
    blocks = [(bar_t[i], bar_t[min(i + bars_per_block, len(bar_t) - 1)]) for i in range(0, len(bar_t) - 1, bars_per_block)]
    feats = []
    for a, b in blocks:
        seg = L[int(a * fr):max(int(a * fr) + 1, int(b * fr))]
        feats.append(np.concatenate([seg.mean(0), [seg.sum(1).mean()]]))
    if not feats:
        return []
    F = np.array(feats)
    F = (F - F.mean(0)) / (F.std(0) + 1e-9)
    nov = np.r_[0, np.linalg.norm(np.diff(F, axis=0), axis=1)]
    cut = nov > max(np.median(nov) * 1.5, np.percentile(nov, 70))
    out, start, labels, protos = [], 0, [], []
    for i in range(1, len(blocks) + 1):
        if i == len(blocks) or cut[i]:
            f = F[start:i].mean(0)
            lab = None
            for li, p in enumerate(protos):
                if np.linalg.norm(f - p) < 2.2:
                    lab = chr(65 + li)
                    break
            if lab is None:
                protos.append(f)
                lab = chr(64 + len(protos))
            out.append({'start': round(blocks[start][0], 3), 'end': round(blocks[i - 1][1], 3), 'label': lab})
            start = i
    en = L.sum(1)
    for s in out:
        seg = en[int(s['start'] * fr):int(s['end'] * fr)]
        s['energy'] = round(float(seg.mean()) if len(seg) else 0.0, 2)
    top = max(s['energy'] for s in out) or 1
    for s in out:
        s['energy'] = round(s['energy'] / top, 2)
    return out


def norm_word(w):
    return re.sub(r"[^a-z0-9а-яё']", '', w.lower())


def transcribe(path, model_name, lyrics_text, t0, t1):
    from faster_whisper import WhisperModel
    model = None
    for dev, ct in (('cuda', 'float16'), ('cpu', 'int8')):
        try:
            model = WhisperModel(model_name, device=dev, compute_type=ct)
            segs, info = model.transcribe(path, word_timestamps=True, vad_filter=False, beam_size=5,
                                          initial_prompt=(lyrics_text or '')[:800] or None, condition_on_previous_text=False,
                                          clip_timestamps=[t0, t1] if t1 else '0')
            segs = list(segs)
            print(f'  whisper {model_name} on {dev}: {len(segs)} segments, language {info.language}')
            return segs
        except Exception as e:
            print(f'  whisper on {dev} failed: {str(e)[:160]}')
            model = None
    return []


def align(lyrics_lines, segs):
    """Give every written lyric word the time of the transcript word it matches; interpolate the rest."""
    heard = [(norm_word(w.word), w.start, w.end) for s in segs for w in (s.words or []) if norm_word(w.word)]
    written = [(li, w) for li, line in enumerate(lyrics_lines) for w in line.split()]
    a = [norm_word(w) for _, w in written]
    b = [h[0] for h in heard]
    times = [None] * len(written)
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            times[blk.a + k] = (heard[blk.b + k][1], heard[blk.b + k][2])
    # fuzzy pass for near-misses (misheard words) between matched neighbours
    for i, tm in enumerate(times):
        if tm is not None:
            continue
        best, bj = 0.0, None
        for j, (hw, hs, he) in enumerate(heard):
            r = difflib.SequenceMatcher(a=a[i], b=hw).ratio()
            if r > best:
                best, bj = r, j
        prev_t = next((times[k][1] for k in range(i - 1, -1, -1) if times[k]), -1)
        if bj is not None and best >= 0.75 and heard[bj][1] >= prev_t:
            times[i] = (heard[bj][1], heard[bj][2])
    # interpolate the remaining gaps between known neighbours
    known = [i for i, tm in enumerate(times) if tm]
    for i in range(len(times)):
        if times[i]:
            continue
        lo = max([k for k in known if k < i], default=None)
        hi = min([k for k in known if k > i], default=None)
        if lo is not None and hi is not None:
            s0, s1 = times[lo][1], times[hi][0]
            f0, f1 = (i - lo) / (hi - lo), (i - lo + 1) / (hi - lo)
            times[i] = (s0 + (s1 - s0) * f0, s0 + (s1 - s0) * f1)
        elif lo is not None:
            times[i] = (times[lo][1], times[lo][1] + 0.3)
        elif hi is not None:
            times[i] = (max(0, times[hi][0] - 0.3), times[hi][0])
    lines = []
    for li, text in enumerate(lyrics_lines):
        ws = [(w, times[k]) for k, (l2, w) in enumerate(written) if l2 == li and times[k]]
        if not ws:
            continue
        lines.append({'text': text, 'start': round(ws[0][1][0], 3), 'end': round(ws[-1][1][1], 3),
                      'words': [{'w': w, 'start': round(t[0], 3), 'end': round(t[1], 3)} for w, t in ws]})
    matched = sum(1 for blk in sm.get_matching_blocks() for _ in range(blk.size))
    return lines, matched / max(1, len(written))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('audio')
    ap.add_argument('--lyrics')
    ap.add_argument('--out')
    ap.add_argument('--model', default='medium')
    ap.add_argument('--no-lyrics', action='store_true')
    ap.add_argument('--meter', type=int, default=4)
    ap.add_argument('--bpm', type=float, help='override the tempo estimate')
    ap.add_argument('--from', dest='t0', type=float, default=0.0)
    ap.add_argument('--to', dest='t1', type=float)
    a = ap.parse_args()

    x = load(a.audio)
    dur = len(x) / SR
    t0, t1 = a.t0, a.t1 or dur
    xs = x[int(t0 * SR):int(t1 * SR)]
    L = spectra(xs)
    env = onset_env(L)
    bpm, conf = tempo(env)
    if a.bpm:
        bpm = a.bpm
    beats = track_beats(env, bpm) + t0
    beats = beats[(beats >= t0) & (beats <= t1)]
    if len(beats) > 8:
        # the beat period is the least-squares slope of beat time against beat number; single gaps are
        # quantised to the 11.6 ms hop, so their median snaps to one side of the true tempo
        bpm = 60 / np.polyfit(np.arange(len(beats)), beats, 1)[0]
    ph = downbeat_phase(L, beats - t0, a.meter)
    downbeats = beats[ph::a.meter]
    secs = sections(L, beats[ph:] - t0, a.meter)
    for s in secs:
        s['start'] = round(s['start'] + t0, 3)
        s['end'] = round(s['end'] + t0, 3)
    fr = SR / HOP
    # the loudness envelope at exactly 20 values a second (averaging whole 11.6 ms frames in fours would
    # give 21.5 a second): smooth over 50 ms, then sample each 50 ms bin at its centre
    en = L.sum(1)
    kk = max(1, int(round(0.05 * fr)))
    smooth = np.convolve(en, np.ones(kk) / kk, mode='same')
    centres = (np.arange(len(en)) * HOP + 1024) / SR          # frame centres (n_fft / 2 = 1024 samples)
    energy = np.interp((np.arange(int(round(len(xs) / SR * 20))) + 0.5) / 20, centres, smooth)
    energy = (energy - energy.min()) / (np.ptp(energy) + 1e-9)
    peaks = [i for i in range(1, len(env) - 1) if env[i] > env[i - 1] and env[i] >= env[i + 1] and env[i] > np.percentile(env, 99)]
    hits = sorted(round(i / fr + t0, 3) for i in peaks)

    song = {
        'file': os.path.basename(a.audio), 'duration': round(dur, 3), 'range': [t0, round(t1, 3)],
        'bpm': round(float(bpm), 3), 'tempo_confidence': round(conf, 3), 'meter': a.meter,
        'beats': [round(float(b), 4) for b in beats], 'downbeats': [round(float(b), 4) for b in downbeats],
        'sections': secs, 'hits': hits, 'energy': {'rate': 20, 'from': t0, 'values': [round(float(v), 3) for v in energy]},
        'lines': [],
    }
    print(f"{song['file']}: {dur:.1f} s, {song['bpm']} BPM (conf {conf:.2f}), {len(beats)} beats, downbeat phase {ph}, {len(secs)} sections, {len(hits)} hits")
    if not a.no_lyrics:
        text = open(a.lyrics, encoding='utf-8').read() if a.lyrics else ''
        lyric_lines = [l.strip() for l in text.splitlines() if l.strip() and not l.strip().startswith('[')]
        segs = transcribe(a.audio, a.model, ' '.join(lyric_lines), t0, a.t1)
        if lyric_lines and segs:
            song['lines'], cover = align(lyric_lines, segs)
            song['lyrics_matched'] = round(cover, 3)
            print(f'  lyrics: {len(song["lines"])} lines timed, {cover * 100:.0f} % of written words heard')
        elif segs:
            song['lines'] = [{'text': s.text.strip(), 'start': round(s.start, 3), 'end': round(s.end, 3),
                              'words': [{'w': w.word.strip(), 'start': round(w.start, 3), 'end': round(w.end, 3)} for w in (s.words or [])]} for s in segs]
            print(f'  transcript: {len(song["lines"])} lines')
    out = a.out or os.path.join(os.path.dirname(os.path.abspath(a.audio)), 'song.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(song, f, ensure_ascii=False, indent=1)
    for s in secs:
        print(f"  section {s['label']}  {s['start']:7.2f}-{s['end']:7.2f}  energy {s['energy']}")
    for l in song['lines'][:40]:
        print(f"  {l['start']:7.2f}-{l['end']:7.2f}  {l['text']}")
    print('->', out)


if __name__ == '__main__':
    main()

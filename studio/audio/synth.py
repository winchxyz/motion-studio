"""Synth instruments shared by tools/sound.py (numpy only). Adapted from earlier films'
scores: additive pads, plucks, FM bells, drums, whooshes and risers, STFT filters."""
import numpy as np

SR = 48000
TAU = 2 * np.pi
rng = np.random.default_rng(11)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def tt(dur):
    return np.arange(int(dur * SR)) / SR


def env(n, a=0.005, d=0.1, s=0.7, r=0.2, hold=None):
    A, Dd, R = int(a * SR), int(d * SR), int(r * SR)
    H = max(0, n - A - Dd - R) if hold is None else int(hold * SR)
    e = np.concatenate([np.linspace(0, 1, max(A, 1)), np.linspace(1, s, max(Dd, 1)), np.full(H, s), np.linspace(s, 0, max(R, 1))])
    return np.pad(e, (0, max(0, n - len(e))))[:n]


def lp_gain(f, fc, order=2):
    return 1.0 / np.sqrt(1.0 + (f / np.maximum(fc, 1.0)) ** (2 * order))


def noise(n):
    return rng.standard_normal(n)


def stft_filter(x, mask):
    """mask(times (frames,1), freqs (1,bins)) -> gains. Hann, hop 512."""
    F, Hh = 2048, 512
    w = np.hanning(F)
    pad = np.concatenate([np.zeros(F), x, np.zeros(F)])
    frames = 1 + (len(pad) - F) // Hh
    idx = np.arange(F)[None, :] + Hh * np.arange(frames)[:, None]
    spec = np.fft.rfft(pad[idx] * w, axis=1)
    times = (np.arange(frames) * Hh - F + F / 2) / SR
    freqs = np.fft.rfftfreq(F, 1 / SR)
    spec *= mask(times[:, None], freqs[None, :])
    y = np.fft.irfft(spec, n=F, axis=1) * w
    out = np.zeros(len(pad))
    norm = np.zeros(len(pad))
    ww = w * w
    for i in range(frames):
        out[i * Hh:i * Hh + F] += y[i]
        norm[i * Hh:i * Hh + F] += ww
    out /= np.maximum(norm, 1e-6)
    return out[F:F + len(x)]


def bandpass(x, fc, width=1.0):
    return stft_filter(x, lambda a, f: np.exp(-0.5 * (np.log2(np.maximum(f, 20) / fc) / width) ** 2))


def highpass(x, fc, order=2):
    return stft_filter(x, lambda a, f: 1 - lp_gain(f, fc, order))


def lowpass(x, fc, order=2):
    return stft_filter(x, lambda a, f: lp_gain(f, fc, order))


def glide(f_of_t):
    return TAU * np.cumsum(f_of_t) / SR


def pad_note(f0, dur, cutoff, attack=0.4, release=1.2, voices=3, detune=0.12, partials=14):
    n = int((dur + release) * SR)
    t = np.arange(n) / SR
    fc = cutoff(t) if callable(cutoff) else np.full(n, cutoff)
    out = np.zeros((2, n))
    for v in range(voices):
        det = 2 ** (((v - (voices - 1) / 2) * detune) / 12)
        f = f0 * det
        ph = rng.random(partials + 1) * TAU
        pan = (v - (voices - 1) / 2) / max(1, (voices - 1) / 2) * 0.75
        sig = np.zeros(n)
        for k in range(1, partials + 1):
            fk = f * k
            if fk > 16000:
                break
            sig += (1 / k) * lp_gain(fk, fc, 3) * np.sin(TAU * fk * t + ph[k])
        a = (pan + 1) * np.pi / 4
        out[0] += sig * np.cos(a)
        out[1] += sig * np.sin(a)
    e = env(n, a=attack, d=0.3, s=0.85, r=release, hold=max(0.0, dur - attack - 0.3))
    return out * e / voices


def pluck(f0, dur=0.5, bright=0.6, partials=8, decay=3.0):
    t = tt(dur)
    sig = np.zeros(len(t))
    for k in range(1, partials + 1):
        fk = f0 * k * (1 + 0.0007 * k * k)
        if fk > 16000:
            break
        sig += (bright ** (k - 1)) / k ** 1.1 * np.exp(-t * (decay + 2.8 * k)) * np.sin(TAU * fk * t)
    return sig * np.minimum(1, t / 0.0015)


def droplet(f0, dur=0.22):
    """The signature 'liquid' note: a sine that bends up fast, like a drop into water, tuned."""
    t = tt(dur)
    f = f0 * (0.62 + 0.38 * (1 - np.exp(-t / 0.018)))
    s = np.sin(glide(f)) * np.exp(-t / 0.07)
    s += 0.25 * np.sin(glide(2 * f)) * np.exp(-t / 0.03)
    return s * np.minimum(1, t / 0.0012)


def bell(f0, dur=1.6, index=2.0, ratio=3.5, decay=0.8):
    t = tt(dur)
    mod = index * np.exp(-t / 0.3) * np.sin(TAU * f0 * ratio * t)
    s = np.sin(TAU * f0 * t + mod) * np.exp(-t / decay)
    s += 0.3 * np.sin(TAU * f0 * 2.01 * t) * np.exp(-t / (decay * 0.4))
    return s * np.minimum(1, t / 0.0012)


def bass(f0, dur=0.3, drive=1.8, bright=0.35):
    t = tt(dur + 0.06)
    s = np.sin(TAU * f0 * t) + bright * np.sin(TAU * 2 * f0 * t) + 0.5 * bright * np.sin(TAU * 3 * f0 * t)
    s = np.tanh(s * drive) / np.tanh(drive)
    return s * env(len(t), a=0.004, d=0.08, s=0.8, r=0.05)


def stab(notes, dur=0.35, bright=1.0):
    out = np.zeros(int((dur + 0.5) * SR))
    for n_ in notes:
        p = pad_note(midi(n_), dur, lambda x: 1500 + 7000 * bright * np.exp(-x / 0.12), attack=0.004, release=0.4, voices=2, detune=0.15, partials=16)
        m = p.mean(axis=0)
        out[:len(m)] += m[:len(out)]
    return out / max(1, len(notes)) * 2.2


# ------------------------------------------------------------------ drums
def kick(level=1.0, dur=0.32):
    t = tt(dur)
    f = 55 + 115 * np.exp(-t / 0.03)
    s = np.sin(glide(f)) * np.exp(-t / 0.16)
    s = np.tanh(s * 2.0) / np.tanh(2.0)
    knock = np.sin(TAU * 160 * t) * np.exp(-t / 0.016) * 0.4
    click = highpass(noise(len(t)) * np.exp(-t / 0.0025), 2500) * 0.4
    return (s + knock + click) * level


def clap(level=1.0):
    t = tt(0.35)
    n = noise(len(t))
    e = np.zeros(len(t))
    for d in (0.0, 0.009, 0.019, 0.028):
        e += np.where(t >= d, np.exp(-(t - d) / 0.006), 0)
    e += np.where(t >= 0.028, np.exp(-(t - 0.028) / 0.09) * 0.55, 0)
    return bandpass(n * e, 1300, 0.9) * level * 1.6


def hat(level=1.0, open_=False):
    t = tt(0.4 if open_ else 0.08)
    s = highpass(noise(len(t)), 7500, 3) * np.exp(-t / (0.12 if open_ else 0.016))
    return s * level


def shaker(level=1.0):
    t = tt(0.07)
    s = bandpass(noise(len(t)), 6500, 0.6) * np.exp(-t / 0.02) * np.minimum(1, t / 0.006)
    return s * level


def crash(level=1.0, dur=2.2):
    t = tt(dur)
    s = highpass(noise(len(t)), 4200, 2) * np.exp(-t / 0.9) * np.minimum(1, t / 0.002)
    return s * level


def snare(level=1.0):
    t = tt(0.25)
    body = np.sin(TAU * 190 * t) * np.exp(-t / 0.05)
    s = bandpass(noise(len(t)), 3500, 1.3) * np.exp(-t / 0.08)
    return (0.6 * body + s) * level


# ------------------------------------------------------------------ effects
def blip(f0, f1, dur=0.08, tone=0.0):
    t = tt(dur)
    f = f0 * (f1 / f0) ** np.minimum(1, t / (dur * 0.6))
    ph = glide(f)
    s = np.sin(ph) + tone * np.sin(2 * ph) * 0.3
    return s * np.exp(-t / (dur * 0.45)) * np.minimum(1, t / 0.002)


def boing(f0, dur=0.32, depth=0.35):
    t = tt(dur)
    f = f0 * (1 + depth * np.exp(-t / 0.05) * np.cos(TAU * 16 * t)) * (1 + 0.25 * (1 - np.exp(-t / 0.03)))
    ph = glide(f)
    s = np.sin(ph) + 0.25 * np.sin(2 * ph)
    return s * np.exp(-t / (dur * 0.4)) * np.minimum(1, t / 0.002)


def bloop(f0, dur=0.14):
    t = tt(dur)
    f = f0 * np.minimum(3.2, np.exp(t / 0.045))
    s = np.sin(glide(f)) * np.exp(-t / 0.05)
    pop = bandpass(noise(len(t)) * np.exp(-t / 0.003), 2500, 0.8) * 0.4
    return (s + pop) * np.minimum(1, t / 0.001)


def thump(f0=95, f1=48, dur=0.25, level=1.0):
    t = tt(dur)
    f = f1 + (f0 - f1) * np.exp(-t / 0.03)
    return np.sin(glide(f)) * np.exp(-t / 0.08) * level


def tick(freq=3200, dur=0.03, level=1.0):
    t = tt(dur)
    s = np.diff(np.concatenate([[0], noise(len(t))])) * np.exp(-t / 0.0022) * 0.45 + 0.6 * np.sin(TAU * freq * t) * np.exp(-t / 0.005)
    return s * level


def whoosh(dur, f_from, f_to, width=0.9, shape=0.4):
    n = int(dur * SR)
    x = noise(n)

    def mask(a, ff):
        k = np.clip(a / dur, 0, 1)
        fc = f_from * (f_to / f_from) ** k
        return np.exp(-0.5 * (np.log2(np.maximum(ff, 20) / fc) / width) ** 2)
    y = stft_filter(x, mask)
    k = np.arange(n) / SR / dur
    e = np.where(k < shape, (k / shape) ** 2, ((1 - k) / (1 - shape)) ** 1.6)
    return y * e


def riser(dur, f_from=250, f_to=7000):
    y = whoosh(dur, f_from, f_to, width=0.8, shape=0.97)
    t = np.arange(len(y)) / SR
    tone = np.sin(glide(220 * 2 ** (2.2 * (t / dur) ** 1.6))) * (t / dur) ** 2 * 0.35
    return y + tone


def reverse_crash(dur):
    t = tt(dur)
    return highpass(noise(len(t)), 3500, 2) * np.exp((t - dur) / (dur * 0.28))


def boom(dur=1.6, f0=70, f1=34, level=1.0):
    t = tt(dur)
    f = f1 + (f0 - f1) * np.exp(-t / 0.16)
    ph = glide(f)
    s = np.sin(ph) * np.exp(-t / 0.38) + 0.35 * np.tanh(3 * np.sin(2 * ph)) * np.exp(-t / 0.12)
    return s * np.minimum(1, t / 0.003) * level


def splash(dur=0.9, size=1.0):
    """Water: a burst of filtered noise plus a swarm of tiny bubble blips."""
    t = tt(dur)
    body = bandpass(noise(len(t)), 1400 / size, 1.4) * np.exp(-t / (0.12 * size)) * np.minimum(1, t / 0.004)
    hiss = highpass(noise(len(t)), 3000) * np.exp(-t / (0.25 * size)) * 0.5
    s = body + hiss
    for _ in range(int(14 * size)):
        d = rng.uniform(0.02, dur * 0.7)
        b = droplet(rng.uniform(700, 2400) / size ** 0.3, 0.09)
        i = int(d * SR)
        s[i:i + len(b)] += b[:len(s) - i] * rng.uniform(0.1, 0.35) * np.exp(-d / (0.3 * size))
    return s


def bubbles(dur, rate=18, lo=500, hi=1600):
    s = np.zeros(int(dur * SR))
    tk = 0.0
    while tk < dur:
        b = droplet(rng.uniform(lo, hi), 0.08)
        i = int(tk * SR)
        s[i:i + len(b)] += b[:len(s) - i] * rng.uniform(0.2, 0.6)
        tk += rng.exponential(1 / rate)
    return s



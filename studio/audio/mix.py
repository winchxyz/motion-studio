"""Mixing shared by every film's sound: stereo buses at 48 kHz, placing sounds on the timeline with
pan and a reverb send, ducking, loading a song, a gentle master chain, and writing the WAV.

    import sys; sys.path.insert(0, 'studio/audio')
    from mix import Mixer, load_audio
    m = Mixer(duration)
    m.put('music', load_audio('assets/song.mp3', start=45.0, dur=duration))
    m.place('sfx', sig, t=3.2, gain=0.7, pan=-0.3, verb=0.2)
    m.duck('music', t=3.2, depth=0.35)
    m.write('out/audio.wav')
Loudness is finished later (-14 LUFS, -1 dBTP) by studio/tools/deliver.mjs.
"""
import subprocess
import wave

import numpy as np

from synth import SR, noise, stft_filter, lp_gain


def load_audio(path, start=0.0, dur=None, sr=SR):
    """Decode any audio file to float stereo (2, N) at sr, from `start` seconds for `dur` seconds."""
    cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error']
    if start:
        cmd += ['-ss', f'{start:.4f}']
    cmd += ['-i', path]
    if dur:
        cmd += ['-t', f'{dur:.4f}']
    cmd += ['-ac', '2', '-ar', str(sr), '-f', 'f32le', '-']
    raw = subprocess.run(cmd, capture_output=True).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64).reshape(-1, 2).T.copy()


def reverb_ir(seconds=2.2, rng_seed=5):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(rng_seed)
    ir = np.zeros((2, n))
    for ch in range(2):
        X = np.fft.rfft(rng.standard_normal(n))
        f = np.fft.rfftfreq(n, 1 / SR)
        y = np.zeros(n)
        for lo, hi, rt in [(0, 600, 1.8), (600, 4000, 1.4), (4000, 24000, 0.7)]:
            y += np.fft.irfft(X * ((f >= lo) & (f < hi)), n=n) * np.exp(-6.9 * t / (rt * seconds / 2.2))
        pre = int(0.02 * SR)
        ir[ch, pre:] = y[:n - pre]
    ir /= np.sqrt(np.sum(ir ** 2) / 2)
    return ir


def convolve(x, h):
    m = len(x) + len(h) - 1
    size = 1 << (m - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(h, size), size)[:len(x)]


def stereo(sig, pan=0.0):
    if sig.ndim == 2:
        return sig
    a = (np.clip(pan, -1, 1) + 1) * np.pi / 4
    return np.vstack([sig * np.cos(a), sig * np.sin(a)]) * np.sqrt(2)


class Mixer:
    def __init__(self, duration, buses=('music', 'drums', 'sfx', 'vox')):
        self.dur = duration
        self.N = int(round(duration * SR))
        self.bus = {b: np.zeros((2, self.N)) for b in buses}
        self.gain = {b: 1.0 for b in buses}
        self.env = {b: np.ones(self.N) for b in buses}
        self.send = np.zeros((2, self.N))

    def add_bus(self, name, gain=1.0):
        self.bus.setdefault(name, np.zeros((2, self.N)))
        self.gain[name] = gain
        self.env.setdefault(name, np.ones(self.N))

    def place(self, bus, sig, t, gain=1.0, pan=0.0, verb=0.0):
        """Add a mono or stereo signal so that its first sample lands at time t (s)."""
        sig = stereo(sig, pan)
        i = int(round(t * SR))
        if i >= self.N:
            return
        j0 = max(0, -i)
        n = min(sig.shape[1] - j0, self.N - max(i, 0))
        if n <= 0:
            return
        seg = sig[:, j0:j0 + n] * gain
        self.bus[bus][:, max(i, 0):max(i, 0) + n] += seg
        if verb:
            self.send[:, max(i, 0):max(i, 0) + n] += seg * verb

    def put(self, bus, track, t=0.0, gain=1.0, fade_in=0.01, fade_out=0.3):
        """Lay a whole stereo track (e.g. the song) on a bus with short edge fades."""
        tr = track.copy()
        a, b = int(fade_in * SR), int(fade_out * SR)
        if a:
            tr[:, :a] *= np.linspace(0, 1, a)
        if b and tr.shape[1] > b:
            tr[:, -b:] *= np.linspace(1, 0, b) ** 1.5
        self.place(bus, tr, t, gain)

    def duck(self, bus, t, depth=0.4, attack=0.01, hold=0.06, release=0.35):
        """Dip a bus under a hit: gain falls by `depth` (0..1) and recovers."""
        n = int((attack + hold + release) * SR)
        e = np.concatenate([np.linspace(1, 1 - depth, max(1, int(attack * SR))),
                            np.full(int(hold * SR), 1 - depth),
                            1 - depth * np.exp(-np.linspace(0, 5, max(1, int(release * SR))))])[:n]
        i = int(t * SR)
        j = min(self.N, i + len(e))
        if i < self.N and j > max(i, 0):
            self.env[bus][max(i, 0):j] = np.minimum(self.env[bus][max(i, 0):j], e[max(0, -i):j - i])

    def render(self, verb=0.25, verb_seconds=2.2, tone=True, drive=1.25, fade_out=0.6):
        mix = np.zeros((2, self.N))
        for b, x in self.bus.items():
            mix += x * self.gain[b] * self.env[b]
        if np.any(self.send):
            ir = reverb_ir(verb_seconds)
            mix += np.vstack([convolve(self.send[0], ir[0]), convolve(self.send[1], ir[1])]) * verb
        if tone:
            # clean the sub rumble, keep presence: high-pass 30 Hz, a little air
            for ch in range(2):
                mix[ch] = stft_filter(mix[ch], lambda a, f: (1 - lp_gain(f, 30, 3)) * (1 + 0.25 * (1 - lp_gain(f, 9000, 2))))
        mix = np.tanh(mix * drive) / drive
        if fade_out:
            k = int(fade_out * SR)
            mix[:, -k:] *= np.linspace(1, 0, k) ** 1.5
        mix[:, :int(0.003 * SR)] *= np.linspace(0, 1, int(0.003 * SR))
        peak = np.max(np.abs(mix))
        if peak > 0:
            mix *= 0.89 / peak
        return mix

    def write(self, path, **kw):
        mix = self.render(**kw)
        pcm = (np.clip(mix, -1, 1) * 32767).astype('<i2').T.copy()
        with wave.open(path, 'wb') as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(pcm.tobytes())
        return path

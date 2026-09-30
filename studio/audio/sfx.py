"""Standard sound effects for the film's cue types, synthesized (no sample files).

    from sfx import for_cue
    sig, gain, pan, verb, lead = for_cue({'t': 3.2, 'type': 'whoosh', 'dur': 0.3})
    mixer.place('sfx', sig, cue_t - lead, gain, pan, verb)     # lead: whooshes peak on the cue

Cue types: whoosh (travels, whips), swish (wipes, slides), hit (flash cuts, drops), cut (plain cuts),
riser (dur = length), impact (heavy landing), pop, click, type (keystrokes, n), stamp, glitch,
sparkle, thump, bell (f = Hz). Unknown types are silent. A cue may carry gain and pan.
"""
import numpy as np

from synth import SR, tt, noise, bandpass, highpass, lowpass, whoosh, riser, boom, thump, tick, bloop, blip, bell, clap, crash, glide

rng = np.random.default_rng(23)


def s_whoosh(dur=0.35):
    d = max(0.18, dur * 1.3)
    return whoosh(d, 180, 5200, width=0.8, shape=0.55) * 0.9


def s_swish(dur=0.3):
    d = max(0.14, dur)
    return whoosh(d, 900, 9000, width=0.6, shape=0.5) * 0.6


def s_hit():
    b = boom(0.9, 90, 38, 0.9)
    n = len(b)
    burst = highpass(noise(n), 2500) * np.exp(-np.arange(n) / SR / 0.05) * 0.5
    c = np.zeros(n)
    cl = clap(0.6)
    c[:len(cl)] = cl[:n]
    return b + burst + c * 0.5


def s_cut():
    return tick(2600, 0.03, 0.5)


def s_impact():
    b = boom(1.4, 70, 30, 1.0)
    cr = crash(0.35, 1.4)
    out = np.zeros(max(len(b), len(cr)))
    out[:len(b)] += b
    out[:len(cr)] += cr
    return out


def s_pop(f=900):
    return bloop(f, 0.12) * 0.7


def s_click():
    return tick(3400, 0.025, 0.7)


def s_type(n=6, rate=14):
    out = np.zeros(int((n / rate + 0.1) * SR))
    for k in range(n):
        i = int((k / rate + rng.uniform(-0.01, 0.01)) * SR)
        c = tick(rng.uniform(2200, 3600), 0.03, rng.uniform(0.35, 0.6))
        out[max(0, i):max(0, i) + len(c)] += c[:len(out) - max(0, i)]
    return out


def s_stamp():
    t = thump(120, 50, 0.3, 1.0)
    n = len(t)
    body = bandpass(noise(n), 700, 1.2) * np.exp(-np.arange(n) / SR / 0.04) * 0.6
    return t + body


def s_glitch(dur=0.25):
    n = int(dur * SR)
    x = noise(n)
    hold = np.repeat(x[::60], 60)[:n]
    crush = np.round(hold * 3) / 3
    gate = (np.sin(np.arange(n) / SR * 2 * np.pi * 34) > 0).astype(float)
    return bandpass(crush * gate, 2500, 1.4) * 0.5


def s_sparkle(dur=0.6):
    out = np.zeros(int(dur * SR))
    for k in range(9):
        f = rng.uniform(2400, 6000)
        b = bell(f, 0.4, index=1.2, ratio=2.7, decay=0.12) * rng.uniform(0.1, 0.25)
        i = int(k * dur / 11 * SR)
        out[i:i + len(b)] += b[:len(out) - i]
    return out


def for_cue(c):
    """(signal, gain, pan, reverb send) for a cue dict, or None."""
    typ = c.get('type')
    dur = c.get('dur') or 0.3
    table = {
        'whoosh': lambda: (s_whoosh(dur), 0.55, 0.0, 0.15),
        'swish': lambda: (s_swish(dur), 0.45, 0.0, 0.1),
        'hit': lambda: (s_hit(), 0.7, 0.0, 0.25),
        'cut': lambda: (s_cut(), 0.25, 0.0, 0.0),
        'riser': lambda: (riser(max(0.5, c.get('dur', 2.0))), 0.4, 0.0, 0.2),
        'impact': lambda: (s_impact(), 0.8, 0.0, 0.3),
        'pop': lambda: (s_pop(c.get('f', 900)), 0.5, c.get('pan', 0.0), 0.1),
        'click': lambda: (s_click(), 0.45, c.get('pan', 0.0), 0.0),
        'type': lambda: (s_type(c.get('n', 6)), 0.35, c.get('pan', 0.0), 0.0),
        'stamp': lambda: (s_stamp(), 0.7, 0.0, 0.15),
        'glitch': lambda: (s_glitch(dur), 0.4, 0.0, 0.0),
        'sparkle': lambda: (s_sparkle(dur), 0.4, 0.2, 0.3),
        'thump': lambda: (thump(95, 45, 0.3, 1.0), 0.6, 0.0, 0.05),
        'bell': lambda: (bell(c.get('f', 880), 1.4), 0.4, 0.0, 0.3),
    }
    fn = table.get(typ)
    if not fn:
        return None
    sig, gain, pan, verb = fn()
    # a whoosh is centred on its cue; everything else starts on it
    lead = len(sig) / SR * 0.55 if typ in ('whoosh', 'swish') else 0.0
    return sig, gain * c.get('gain', 1.0), c.get('pan', pan), verb, lead

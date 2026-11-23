"""Original music bed + SFX (all synthesised here, no third-party audio) and the final mix -> audio/mix.wav.

Bed: tanpura-style drone (D/A), Karplus-Strong plucks on a D major pentatonic pattern, soft low "dha" and shaker.
Music ducks under the voiceover. Final loudness: -14 LUFS integrated, -1 dBTP (social platforms).
"""
import json
import wave

import numpy as np

from common import AUDIO, BUILD, load_config, run

SR = 48000
rng = np.random.default_rng(7)   # fixed seed: same output every build


def env_ad(n, a, d):
    t = np.arange(n) / SR
    return np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / d)


def pluck(freq, dur, bright=0.5):
    n = int(dur * SR)
    p = max(2, int(SR / freq))
    buf = rng.uniform(-1, 1, p)
    out = np.empty(n)
    for i in range(n):
        out[i] = buf[i % p]
        buf[i % p] = 0.5 * (buf[i % p] + buf[(i + 1) % p]) * (0.993 + 0.006 * bright)
    return out * np.minimum(1, np.arange(n) / (0.004 * SR))


def drone(dur, root=146.83):
    t = np.arange(int(dur * SR)) / SR
    out = np.zeros_like(t)
    for f, g in [(root / 2, .5), (root * 1.5 / 2, .32), (root, .38), (root * 1.5, .16), (root * 2, .12)]:
        for h in range(1, 7):
            det = 1 + 0.0012 * np.sin(2 * np.pi * 0.11 * h * t + h)
            out += g / h ** 1.3 * np.sin(2 * np.pi * f * h * det * t) * (0.6 + 0.4 * np.sin(2 * np.pi * (0.23 + 0.05 * h) * t + f) ** 2)
    return out / np.max(np.abs(out))


def dha(n=0.35):
    k = int(n * SR); t = np.arange(k) / SR
    f = 95 * np.exp(-t * 9) + 55
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 11)


def shaker(n=0.06):
    k = int(n * SR); x = rng.normal(0, 1, k)
    x = np.diff(x, prepend=0)  # crude high-pass
    return x * env_ad(k, 0.002, 0.018) * 0.3


def music(total, bpm):
    out = np.zeros(int((total + 1) * SR))
    dr = drone(total + 1) * 0.30
    fade = np.minimum(1, np.arange(len(dr)) / (0.8 * SR))
    out[:len(dr)] += dr * fade
    beat = 60 / bpm
    D = 293.66
    scale = [D, D * 9 / 8, D * 5 / 4, D * 3 / 2, D * 5 / 3, D * 2, D * 9 / 4]
    pattern = [0, 2, 3, 5, 4, 3, 2, 3, 0, 2, 4, 5, 6, 5, 4, 2]
    notes = {}
    step, i, t = beat / 2, 0, 0.0
    while t < total - 0.4:
        idx = pattern[i % len(pattern)]
        if idx not in notes:
            notes[idx] = pluck(scale[idx], 1.6, 0.6)
        s = int(t * SR)
        g = 0.22 if i % 2 == 0 else 0.13
        seg = notes[idx][: len(out) - s] * g
        out[s:s + len(seg)] += seg
        if i % 4 == 0:
            d = dha() * 0.55; out[s:s + len(d)] += d[: len(out) - s]
        if i % 2 == 1:
            sh = shaker(); out[s:s + len(sh)] += sh[: len(out) - s]
        i, t = i + 1, t + step
    # gentle ending swell into the end card is handled by the mix envelope
    return out


def sfx_bank():
    def tone(f, d, decay, g=1.0):
        k = int(d * SR); t = np.arange(k) / SR
        return g * np.sin(2 * np.pi * f * t) * env_ad(k, 0.002, decay)
    tap = tone(1800, 0.06, 0.012, 0.5) + np.diff(rng.normal(0, 1, int(0.06 * SR)), prepend=0) * env_ad(int(0.06 * SR), 0.0005, 0.004) * 0.25
    k = int(0.4 * SR); t = np.arange(k) / SR
    noise = rng.normal(0, 1, k)
    sweep = np.convolve(noise, np.ones(24) / 24, mode="same") * np.sin(np.pi * t / 0.4) ** 2
    whoosh = sweep * 0.35
    pop = tone(660, 0.18, 0.05, 0.5) + tone(990, 0.18, 0.04, 0.3)
    lock = np.concatenate([tone(880, 0.09, 0.03, 0.45), tone(1318.5, 0.5, 0.18, 0.5)])
    chime = sum(tone(f, 1.6, 0.6, g) for f, g in [(587.33, .45), (880, .35), (1174.66, .25), (1760, .12)])
    return {"tap": tap, "whoosh": whoosh, "pop": pop, "lock": lock, "chime": chime}


def read_wav(path):
    with wave.open(str(path)) as w:
        a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
        assert w.getframerate() == SR
    return a


def write_wav(path, x):
    x = np.clip(x, -1, 1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())


def main():
    cfg = load_config()
    tl = json.loads((BUILD / "timeline.json").read_text(encoding="utf-8"))
    total = tl["duration"]
    n = int(total * SR)
    vo = np.zeros(n)
    voice_on = np.zeros(n)
    for sc in tl["scenes"]:
        a = read_wav(AUDIO / "vo" / f"{sc['id']}.wav")
        s = int(sc["vo_start"] * SR)
        a = a[: n - s]
        vo[s:s + len(a)] += a
        voice_on[s:s + len(a)] = 1
    mix = vo.copy()
    if cfg["music"]["enabled"]:
        m = music(total, cfg["music"]["bpm"])[:n]
        m /= np.max(np.abs(m)) + 1e-9
        # duck envelope: smooth voice activity, -duck_db under speech
        k = int(0.25 * SR)
        cs = np.concatenate([[0], np.cumsum(voice_on)])
        idx = np.arange(n)
        lo, hi = np.clip(idx - k // 2, 0, n), np.clip(idx + k // 2, 0, n)
        act = (cs[hi] - cs[lo]) / k
        duck = 10 ** (cfg["music"]["duck_db"] * np.clip(act * 1.6, 0, 1) / 20)
        tail = np.ones(n)
        fo = int(1.2 * SR); tail[-fo:] = np.linspace(1, 0, fo)
        mix += m * 10 ** (cfg["music"]["gain_db"] / 20) * 3.0 * duck * tail
    if cfg["sfx"]["enabled"]:
        bank = sfx_bank()
        gains = {"tap": 0.35, "whoosh": 0.22, "pop": 0.3, "lock": 0.32, "chime": 0.3}
        for cue in tl["sfx"]:
            x = bank[cue["kind"]] * gains[cue["kind"]]
            s = max(0, int(cue["t"] * SR))
            x = x[: n - s]
            mix[s:s + len(x)] += x
    raw = AUDIO / "mix_raw.wav"
    write_wav(raw, mix / (np.max(np.abs(mix)) + 1e-9) * 0.7)
    run(["ffmpeg", "-y", "-v", "error", "-i", raw, "-af", "loudnorm=I=-14:TP=-1.5:LRA=9", "-ar", str(SR), "-ac", "2",
         AUDIO / "mix.wav"])
    print("  wrote", AUDIO / "mix.wav")


if __name__ == "__main__":
    main()

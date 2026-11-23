"""Generate one voiceover clip per scene and measure where caption chunk 2 starts.

Engines (config.voice.engine): edge (edge-tts), azure (Azure AI Speech REST, needs AZURE_SPEECH_KEY/REGION),
files (your own recordings: audio/vo_override/<scene id>.wav). Output: audio/vo/<id>.wav (48 kHz mono) + audio/vo/vo.json
"""
import asyncio
import json
import os
import sys
import urllib.request
from pathlib import Path

from common import AUDIO, load_config, placeholders, fill, ffprobe_duration, run

VO = AUDIO / "vo"


async def edge_tts_line(text, voice, rate, pitch, mp3_path):
    import edge_tts
    comm = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, boundary="WordBoundary")
    words = []
    with open(mp3_path, "wb") as fh:
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                fh.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                words.append({"t": chunk["offset"] / 1e7, "d": chunk["duration"] / 1e7, "text": chunk["text"]})
    return words


def azure_line(text, voice, rate, pitch, out_path):
    key, region = os.environ["AZURE_SPEECH_KEY"], os.environ["AZURE_SPEECH_REGION"]
    ssml = (f'<speak version="1.0" xml:lang="hi-IN"><voice name="{voice}"><prosody rate="{rate}" pitch="{pitch}">'
            f"{text}</prosody></voice></speak>").encode("utf-8")
    req = urllib.request.Request(f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1", data=ssml, headers={
        "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "riff-48khz-16bit-mono-pcm", "User-Agent": "vaishora-ad-build"})
    with urllib.request.urlopen(req) as r, open(out_path, "wb") as fh:
        fh.write(r.read())
    return []


def chunk_time(words, chunk1: str, chunk2: str, dur: float) -> float:
    """Time at which the second caption chunk should appear."""
    first2 = chunk2.split()[0].strip("—,.!?।") if chunk2.split() else ""
    n1 = len([w for w in chunk1.replace("—", " ").split() if w.strip(".,!?।…")])
    if words:
        for w in words:
            if first2 and w["text"].strip() and first2.startswith(w["text"].strip()[:3]):
                return w["t"]
        if len(words) > n1:
            return words[n1]["t"]
    c1, c2 = len(chunk1), len(chunk2)
    return dur * c1 / max(1, c1 + c2)


def main():
    cfg = load_config()
    vals = placeholders(cfg)
    v = cfg["voice"]
    VO.mkdir(parents=True, exist_ok=True)
    meta = {}
    for sc in cfg["scenes"]:
        raw = fill(sc["vo"], vals)
        parts = [p.strip() for p in raw.split("|")]
        text = " ".join(parts)
        wav = VO / f"{sc['id']}.wav"
        words, split = [], None
        if v["engine"] == "files":
            src = AUDIO / "vo_override" / f"{sc['id']}.wav"
            run(["ffmpeg", "-y", "-v", "error", "-i", src, "-ac", "1", "-ar", "48000", wav])
            dur = ffprobe_duration(wav)
            split = chunk_time([], parts[0], parts[1], dur) if len(parts) > 1 else None
        else:
            pieces = []
            for i, part in enumerate(parts):
                tmp = VO / f"{sc['id']}_{i}.src"
                piece = VO / f"{sc['id']}_{i}.wav"
                if v["engine"] == "azure":
                    w = azure_line(part, v["name"], v["rate"], v["pitch"], tmp)
                else:
                    w = asyncio.run(edge_tts_line(part, v["name"], v["rate"], v["pitch"], tmp))
                run(["ffmpeg", "-y", "-v", "error", "-i", tmp, "-af",
                     "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse",
                     "-ac", "1", "-ar", "48000", piece])
                tmp.unlink()
                lead = w[0]["t"] if w else 0.0
                pieces.append((piece, ffprobe_duration(piece), [{**x, "t": max(0.0, x["t"] - lead)} for x in w]))
            gap = float(v.get("chunk_gap", 0.12))
            t = 0.0
            for i, (piece, d, w) in enumerate(pieces):
                if i == 1:
                    split = t
                words += [{**x, "t": round(x["t"] + t, 3)} for x in w]
                t += d + gap
            inputs, filt = [], ""
            for i, (piece, d, w) in enumerate(pieces):
                inputs += ["-i", piece]
                pad = f"apad=pad_dur={gap}," if i < len(pieces) - 1 else ""
                filt += f"[{i}:a]{pad}anull[a{i}];"
            filt += "".join(f"[a{i}]" for i in range(len(pieces))) + f"concat=n={len(pieces)}:v=0:a=1[out]"
            run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", filt, "-map", "[out]", "-ac", "1", "-ar", "48000", wav])
            for piece, _, _ in pieces:
                piece.unlink()
            dur = ffprobe_duration(wav)
        meta[sc["id"]] = {"duration": round(dur, 3), "split": None if split is None else round(split, 3),
                          "words": words, "text": text}
        print(f"  {sc['id']:7s} {dur:5.2f}s split@{split}")
    (VO / "vo.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())

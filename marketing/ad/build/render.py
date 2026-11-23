"""Render the ad: compose.html (deterministic renderAt(t)) -> PNG frames -> ffmpeg H.264 + AAC.

  python render.py                     # all formats in config.output.formats
  python render.py --format 9x16
  python render.py --stills 0.5,3,8    # write review stills to .cache/stills/ instead of a video
"""
import argparse
import functools
import http.server
import json
import shutil
import subprocess
import sys
import threading

from playwright.sync_api import sync_playwright

from common import AD, AUDIO, BUILD, CACHE, PROJECT, RENDER, SLOTS, load_config, run

SIZES = {"9x16": (1080, 1920), "4x5": (1080, 1350)}


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = functools.partial(Quiet, directory=str(PROJECT))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


def extract_slots(tl, fmt):
    """Decode any Veo/live-action slot clips to JPEG frames sized for this format."""
    w, h = SIZES[fmt]
    counts = {}
    for sc in tl["scenes"]:
        if not sc.get("slot_video"):
            continue
        out = CACHE / "slots" / fmt / sc["slot"]
        if out.exists():
            shutil.rmtree(out)
        out.mkdir(parents=True)
        run(["ffmpeg", "-y", "-v", "error", "-i", SLOTS / sc["slot_video"], "-t", f"{sc['dur'] + 0.1:.3f}", "-vf",
             f"fps={tl['fps']},scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}", "-q:v", "2",
             out / "%05d.jpg"])
        counts[sc["slot"]] = len(list(out.glob("*.jpg")))
    return counts


def open_page(p, base, tl, fmt, slot_counts):
    w, h = SIZES[fmt]
    b = p.chromium.launch(headless=True, args=["--force-color-profile=srgb", "--font-render-hinting=none"])
    pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
    pg.on("pageerror", lambda e: print("  page error:", e))
    pg.goto(f"{base}/marketing/ad/build/compose.html", wait_until="load")
    pg.evaluate(f"setSlotDir('../.cache/slots/{fmt}/')")
    pg.evaluate("([tl, fmt, sc]) => setup(tl, fmt, sc)", [tl, fmt, slot_counts])
    return b, pg


def render_format(p, base, tl, fmt, cfg, stills=None):
    slot_counts = extract_slots(tl, fmt)
    b, pg = open_page(p, base, tl, fmt, slot_counts)
    fps = tl["fps"]
    try:
        if stills:
            out = CACHE / "stills"
            out.mkdir(parents=True, exist_ok=True)
            for t in stills:
                pg.evaluate(f"renderAt({t})")
                pg.screenshot(path=str(out / f"{fmt}_{t:05.2f}.png"))
            print(f"  stills -> {out}")
            return
        RENDER.mkdir(exist_ok=True)
        n = int(round(tl["duration"] * fps))
        silent = CACHE / f"video_{fmt}.mp4"
        CACHE.mkdir(exist_ok=True)
        enc = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "image2pipe", "-framerate", str(fps), "-c:v", "png",
                                "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", str(cfg["output"]["crf"]),
                                "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709",
                                "-colorspace", "bt709", "-movflags", "+faststart", str(silent)], stdin=subprocess.PIPE)
        for i in range(n):
            pg.evaluate(f"renderAt({i / fps})")
            enc.stdin.write(pg.screenshot(type="png"))
            if i % (fps * 5) == 0:
                print(f"  {fmt}: frame {i}/{n}")
        enc.stdin.close()
        enc.wait()
        final = RENDER / f"{cfg['output']['basename']}-{fmt}.mp4"
        run(["ffmpeg", "-y", "-v", "error", "-i", silent, "-i", AUDIO / "mix.wav", "-map", "0:v", "-map", "1:a",
             "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", "-movflags", "+faststart", final])
        print(f"  wrote {final}")
    finally:
        b.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--format", choices=list(SIZES))
    ap.add_argument("--stills")
    args = ap.parse_args()
    cfg = load_config()
    tl = json.loads((BUILD / "timeline.json").read_text(encoding="utf-8"))
    fmts = [args.format] if args.format else cfg["output"]["formats"]
    stills = [float(x) for x in args.stills.split(",")] if args.stills else None
    httpd, base = serve()
    try:
        with sync_playwright() as p:
            for fmt in fmts:
                render_format(p, base, tl, fmt, cfg, stills)
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    sys.exit(main())

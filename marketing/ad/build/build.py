"""One command to rebuild the VAISHORA ad.

  python marketing/ad/build/build.py                 # VO -> timeline -> audio -> render (uses existing captures)
  python marketing/ad/build/build.py --recapture     # re-record the website first (site must be running, see config.site)
  python marketing/ad/build/build.py --recapture-hand  # re-record only the 3D-hand shots, then render
  python marketing/ad/build/build.py --format 9x16   # one format only
  python marketing/ad/build/build.py --skip-vo       # reuse audio/vo (no TTS call)
"""
import argparse
import subprocess
import sys

from common import BUILD, RENDER, ffprobe_duration, load_config


def step(*args):
    print(f"\n== {' '.join(args)}")
    subprocess.run([sys.executable, *args], cwd=BUILD, check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--recapture", action="store_true")
    ap.add_argument("--recapture-hand", action="store_true")
    ap.add_argument("--skip-vo", action="store_true")
    ap.add_argument("--format")
    a = ap.parse_args()
    if not (BUILD / "brand" / "logo_full.png").exists():
        step("prep_brand.py")
    if a.recapture:
        step("capture_site.py")
    elif a.recapture_hand:
        step("capture_site.py", "--only", "hand")
    if not a.skip_vo:
        step("make_vo.py")
    step("timeline.py")
    step("make_audio.py")
    step("render.py", *(["--format", a.format] if a.format else []))
    cfg = load_config()
    print("\n== outputs")
    for f in sorted(RENDER.glob(f"{cfg['output']['basename']}-*.mp4")):
        print(f"  {f}  {ffprobe_duration(f):.2f}s  {f.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()

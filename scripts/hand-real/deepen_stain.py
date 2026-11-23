# Deepen the henna in the palm photos (public/designs/photo/*-palm-stain.webp) from orange-red to the deep
# maroon / chocolate-brown of mature bridal henna, matching the Codex back-of-hand photos (back_photos.py).
# Only henna pixels change (detected by chroma); skin, creases and alpha stay as they are. Line structure is kept
# because the new colour follows the original brightness. Originals are backed up once to scripts/out/palm-orig/.
#
#   python scripts/hand-real/deepen_stain.py [--strength 0.9]

import argparse
import pathlib
import shutil

import cv2
import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
PHOTO = ROOT / "public/designs/photo"
BACKUP = ROOT / "scripts/out/palm-orig"

ap = argparse.ArgumentParser()
ap.add_argument("--strength", type=float, default=0.9)
args = ap.parse_args()

DARK = np.array([82, 26, 18], np.float32) / 255.0    # dense fills / fingertip caps: dark chocolate-maroon
LIGHT = np.array([150, 62, 40], np.float32) / 255.0  # thin, lighter lines: warm maroon-brown

BACKUP.mkdir(parents=True, exist_ok=True)
for p in sorted(PHOTO.glob("*-palm-stain.webp")):
    bak = BACKUP / p.name
    if not bak.exists():
        shutil.copy(p, bak)
    rgba = np.asarray(Image.open(bak).convert("RGBA")).astype(np.float32) / 255.0
    rgb, a = rgba[..., :3], rgba[..., 3:]
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1e-3)
    # skin ≈ 0.35–0.5, palm creases ≈ 0.55–0.7, henna ≥ 0.8 (sRGB)
    h = np.clip((sat - 0.72) / 0.1, 0, 1)  # creases ≈ 0.55–0.7, henna ≥ 0.8
    h = cv2.GaussianBlur(h, (0, 0), 0.8)
    h *= np.clip((a[..., 0] - 0.5) / 0.4, 0, 1)  # only inside the hand, not the feathered/extended edge
    h = h[..., None]
    lum = (rgb @ np.array([0.299, 0.587, 0.114], np.float32))[..., None]
    k = np.clip((lum - 0.22) / 0.4, 0, 1)  # brighter henna → lighter maroon
    target = DARK * (1 - k) + LIGHT * k
    out = rgb * (1 - h * args.strength) + target * (h * args.strength)
    Image.fromarray((np.dstack([out, a[..., 0]]) * 255 + 0.5).astype(np.uint8), "RGBA").save(p, "WEBP", quality=92, method=6)
    prev = (np.clip(out * a + (1 - a), 0, 1) * 255).astype(np.uint8)
    cv2.imwrite(str(BACKUP / f"{p.stem}_deep.jpg"), cv2.cvtColor(cv2.resize(prev, (700, 700)), cv2.COLOR_RGB2BGR))
    print(f"{p.name}: henna pixels {(h[..., 0] > 0.5).mean():.1%}")

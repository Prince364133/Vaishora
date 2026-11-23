# Converts the Cycles stills to web assets and generates the henna stain colour fields for the 2D composite.
#
#   python scripts/hand-real/stills_web.py <stills_dir> public/hand
#
# Writes public/hand/palm.webp, back.webp (RGBA hand photos, 1000^2, aligned with the artwork frame) and
# stain-palm.webp, stain-back.webp: smooth multiply colours for the stain layer in HandIllustration — deep maroon-
# brown with low-frequency blotches, deepest at the fingertips and palm centre, lighter/browner on the back and the
# wrist (see docs/HAND_REALISM.md).
import pathlib
import sys

import numpy as np
from PIL import Image, ImageFilter

src = pathlib.Path(sys.argv[1])
dst = pathlib.Path(sys.argv[2])
dst.mkdir(parents=True, exist_ok=True)

for side in ("palm", "back"):
    im = Image.open(src / f"{side}.png").convert("RGBA")
    im.save(dst / f"{side}.webp", quality=84, method=6)
    print(side, (dst / f"{side}.webp").stat().st_size // 1024, "KB")

S = 256
rng = np.random.default_rng(11)
yy, xx = np.mgrid[0:S, 0:S] / (S - 1)


def noise(scale):
    n = rng.standard_normal((S // scale + 2, S // scale + 2)).astype(np.float32)
    im = Image.fromarray(((n - n.min()) / (n.max() - n.min()) * 255).astype(np.uint8)).resize((S, S), Image.BICUBIC)
    return np.asarray(im.filter(ImageFilter.GaussianBlur(2)), dtype=np.float32) / 255.0


blot = noise(24) * 0.6 + noise(8) * 0.4
for side, lift in (("palm", 1.0), ("back", 1.18)):
    # depth: fingertips (top) and palm centre deepest, wrist/forearm (bottom) lightest
    depth = 0.55 + 0.35 * np.clip(1 - yy * 1.4, 0, 1) + 0.18 * np.exp(-((xx - 0.47) ** 2 + (yy - 0.5) ** 2) / 0.03)
    depth = np.clip(depth - 0.25 * np.clip((yy - 0.68) * 3, 0, 1) + (blot - 0.5) * 0.3, 0, 1)
    thin = np.array([0.66, 0.31, 0.18])
    deep = np.array([0.42, 0.16, 0.095])
    col = thin[None, None] * (1 - depth[..., None]) + deep[None, None] * depth[..., None]
    col = np.clip(col * lift * (1 + (blot[..., None] - 0.5) * np.array([0.1, 0.16, 0.2])), 0, 1)
    Image.fromarray((col * 255).astype(np.uint8)).save(dst / f"stain-{side}.webp", quality=90)
    print("stain", side, (dst / f"stain-{side}.webp").stat().st_size // 1024, "KB")

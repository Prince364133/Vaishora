"""Extract a high-resolution transparent VAISHORA logo from the original logo PNG at the project root.

The original is light artwork on a dark plum background, so we use a GIMP-style "colour to alpha"
against the sampled background colour. Output (build/brand/): logo_full.png (emblem + wordmark + tagline),
emblem.png, wordmark.png, tagline.png - all RGBA, trimmed.
Usage: python prep_brand.py
"""
from pathlib import Path
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SRC = ROOT / "Vaishora_ Beauty, Made Personal.png"
OUT = HERE / "brand"


def color_to_alpha(rgb: np.ndarray, bg: np.ndarray) -> np.ndarray:
    c = rgb.astype(np.float64) / 255.0
    b = bg.astype(np.float64) / 255.0
    a_up = np.where(c > b, (c - b) / np.maximum(1 - b, 1e-6), 0)
    a_dn = np.where(c < b, (b - c) / np.maximum(b, 1e-6), 0)
    a = np.max(np.maximum(a_up, a_dn), axis=2)
    # kill background texture noise, keep anti-aliased edges
    lo, hi = 0.07, 0.30
    k = np.clip((a - lo) / (hi - lo), 0, 1)
    soft = k * k * (3 - 2 * k)
    a_out = np.where(a >= hi, a, a * soft)
    a_safe = np.maximum(a, 1e-6)[..., None]
    f = (c - b) / a_safe + b
    f = np.clip(f, 0, 1)
    out = np.dstack([f, np.clip(a_out, 0, 1)])
    return (out * 255 + 0.5).astype(np.uint8)


def trim(im: Image.Image, pad: int = 6) -> Image.Image:
    bbox = im.getchannel("A").point(lambda v: 255 if v > 60 else 0).getbbox()
    x0, y0, x1, y1 = bbox
    return im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))


def main():
    OUT.mkdir(exist_ok=True)
    im = np.array(Image.open(SRC).convert("RGB"))
    h, w, _ = im.shape
    corners = np.concatenate([im[:80, :80].reshape(-1, 3), im[:80, -80:].reshape(-1, 3),
                              im[-80:, :80].reshape(-1, 3), im[-80:, -80:].reshape(-1, 3)])
    bg = np.median(corners, axis=0)
    rgba = Image.fromarray(color_to_alpha(im, bg), "RGBA")
    full = trim(rgba)
    full.save(OUT / "logo_full.png")
    # regions measured on the 1536x1024 original
    regions = {"emblem": (600, 200, 940, 500), "wordmark": (270, 530, 1300, 680), "tagline": (250, 690, 1290, 765)}
    for name, box in regions.items():
        trim(rgba.crop(box)).save(OUT / f"{name}.png")
    print("background", bg, "->", {p.name: Image.open(p).size for p in OUT.glob("*.png")})


if __name__ == "__main__":
    main()

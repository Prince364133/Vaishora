# Post-processes the textures baked by build_hand.py into web assets.
#
#   python scripts/hand-real/postprocess.py <build_dir> <public_models_dir>
#
# Writes (into <public_models_dir>):
#   hand-albedo-2k.jpg / hand-albedo-1k.jpg   skin colour, toned towards a warm medium South-Asian complexion
#   hand-normal-2k.jpg / hand-normal-1k.jpg   tangent-space normal map: creases & knuckle wrinkles derived from the
#                                             photo texture (high-pass of luminance) + fine procedural pore detail
#   hand-detail-1k.jpg                        R = fingernail mask, G = cavity (crease depth), B = palm-crease emphasis
# Requires Pillow + numpy.

import pathlib
import sys

import numpy as np
from PIL import Image, ImageFilter

src = pathlib.Path(sys.argv[1])
dst = pathlib.Path(sys.argv[2])
dst.mkdir(parents=True, exist_ok=True)

alb = np.asarray(Image.open(src / "albedo.png").convert("RGB"), dtype=np.float32) / 255.0
nails = np.asarray(Image.open(src / "nails.png").convert("L"), dtype=np.float32) / 255.0
H, W = alb.shape[:2]
rng = np.random.default_rng(7)


def blur(a, r):
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8)) if a.dtype != np.uint8 else Image.fromarray(a)
    return np.asarray(im.filter(ImageFilter.GaussianBlur(r)), dtype=np.float32) / 255.0


def blurf(a, r):
    """Gaussian blur for float arrays in [-1, 1] range without 8-bit banding (separable box approximation)."""
    out = a.astype(np.float32)
    k = max(1, int(r))
    for _ in range(3):
        for axis in (0, 1):
            c = np.cumsum(np.pad(out, [(k + 1, k) if i == axis else (0, 0) for i in range(out.ndim)], mode="edge"), axis=axis)
            hi = np.take(c, range(2 * k + 1, c.shape[axis]), axis=axis)
            lo = np.take(c, range(0, c.shape[axis] - 2 * k - 1), axis=axis)
            out = (hi - lo) / (2 * k + 1)
    return out


# ------------------------------------------------------------------ fill empty UV space
def fill_empty(img, mask):
    """Fill pixels outside the UV islands with smooth averages of nearby skin (normalised convolution)."""
    out = img * mask[..., None]
    have = mask.copy()
    for r in (3, 8, 24, 64, 160):
        num = np.stack([blurf(img[..., c] * mask, r) for c in range(3)], axis=-1)
        den = blurf(mask, r)
        est = num / np.maximum(den, 1e-6)[..., None]
        take = (have < 0.5) & (den > 1e-4)
        out[take] = est[take]
        have = np.maximum(have, take.astype(np.float32))
    out[have < 0.5] = img[mask > 0.5].mean(axis=0)
    return out


raw_valid = (alb.max(axis=-1) > 0.015).astype(np.float32)
valid = (blurf(raw_valid, 2) > 0.999).astype(np.float32)  # erode: drop the dark anti-aliased rim
alb = fill_empty(alb, valid)

# ------------------------------------------------------------------ tone
# Linear-ish grade: lift yellow, pull magenta, slightly warmer and deeper. The MakeHuman texture is a little pink-grey.
lum = alb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
target = np.array([0.66, 0.45, 0.33], dtype=np.float32)  # warm medium-brown mid tone
mean = alb.reshape(-1, 3)[valid.reshape(-1) > 0.5].mean(axis=0)
gain = target / np.maximum(mean, 1e-3)
gain = 1.0 + (gain - 1.0) * 0.75
graded = alb * gain
# Damp blotchy local colour deviation (the source has red, painted-looking patches) while keeping luminance detail.
gY = graded @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
chroma = graded - gY[..., None]
local = np.stack([blurf(chroma[..., c], 22) for c in range(3)], axis=-1)
glob = chroma.reshape(-1, 3)[valid.reshape(-1) > 0.5].mean(axis=0)
chroma = glob + (local - glob) * 0.4 + (chroma - local) * 0.3
graded = np.clip(gY[..., None] + chroma, 0, 1)
# Flatten mid-scale luminance blotches (2-8 mm patches in the source) while keeping the large palm/back difference
# and all fine detail (creases, pores).
gY = graded @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
mid = np.maximum(blurf(gY, 12), 1e-3)
big = np.maximum(blurf(gY, 70), 1e-3)
graded = np.clip(graded * ((big / mid) ** 0.6)[..., None], 0, 1)
# keep palms/fingertip pads lighter than the back (they already are in the source, preserve the ratio)
graded = np.clip(graded, 0, 1)
# subtle sat boost in mid-tones
gl = graded @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
graded = np.clip(gl[..., None] + (graded - gl[..., None]) * 1.08, 0, 1)

# fine pigment mottling (freckle-scale) so the up-sampled texture is not mushy
mott = blurf(rng.standard_normal((H, W)).astype(np.float32), 2) * 0.9
mott2 = blurf(rng.standard_normal((H, W)).astype(np.float32), 9) * 2.2
graded = np.clip(graded * (1 + 0.02 * mott[..., None] + 0.012 * mott2[..., None]), 0, 1)

# ------------------------------------------------------------------ height from photo detail
L = graded @ np.array([0.3, 0.59, 0.11], dtype=np.float32)
hp_fine = L - blurf(L, 3)  # wrinkles, crease lines
hp_mid = L - blurf(L, 12)  # broader folds
height = hp_fine * 1.0 + hp_mid * 0.6
# pores: sparse small pits
pores = blurf((rng.random((H, W)) > 0.985).astype(np.float32), 1)
height -= pores * 0.06
height += blurf(rng.standard_normal((H, W)).astype(np.float32), 1) * 0.004
height *= 1 - nails  # nails are smooth
cavity = np.clip(-blurf(hp_fine + hp_mid * 0.5, 1) * 6.0, 0, 1)
# Creases in the source are painted red; real creases are just shadowed skin. Keep their darkness but give them the
# hue of the surrounding skin.
cav_soft = blurf(cavity, 2)[..., None]
gY2 = (graded @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))[..., None]
local_skin = np.stack([blurf(graded[..., c], 8) for c in range(3)], axis=-1)
graded = np.clip(graded + (local_skin * (gY2 / np.maximum(local_skin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32), 1e-3)[..., None]) - graded) * np.clip(cav_soft * 1.4, 0, 0.6), 0, 1)

gy, gx = np.gradient(height)
strength = 7.0 * (W / 2048)
nx, ny = -gx * strength, gy * strength
nz = np.ones_like(nx)
ln = np.sqrt(nx * nx + ny * ny + nz * nz)
normal = np.stack([nx / ln, ny / ln, nz / ln], axis=-1) * 0.5 + 0.5


def save(arr, name, size, q=86):
    im = Image.fromarray(np.clip(arr * 255 + 0.5, 0, 255).astype(np.uint8))
    if im.size[0] != size:
        im = im.resize((size, size), Image.LANCZOS)
    im.save(dst / name, quality=q, optimize=True, progressive=True)
    print(name, (dst / name).stat().st_size // 1024, "KB")


save(graded, "hand-albedo-2k.jpg", 2048, 84)
save(graded, "hand-albedo-1k.jpg", 1024, 86)
save(normal, "hand-normal-2k.jpg", 2048, 82)
save(normal, "hand-normal-1k.jpg", 1024, 85)
detail = np.stack([np.clip(nails, 0, 1), cavity, np.zeros_like(cavity)], axis=-1)
save(detail, "hand-detail-1k.jpg", 1024, 88)

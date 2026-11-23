# Post-processes the maps baked by build_hand.py into web textures.
#
#   python scripts/hand-real/postprocess.py <build_dir> <public_models_dir>
#
# The CC0 MakeHuman skin is photo-derived but blotchy. For a well-groomed, evenly toned
# hand (docs/HAND_REALISM.md §5) the albedo is composed:
#   colour  = warm golden-honey medium Indian complexion, soft peachy palm, clean manicured nails
#   detail  = fine, low-contrast pore & palm crease structure, free of muddy patches.

import pathlib
import sys

import numpy as np
from PIL import Image

src = pathlib.Path(sys.argv[1])
dst = pathlib.Path(sys.argv[2])
dst.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(7)


def load(name, mode="RGB"):
    return np.asarray(Image.open(src / name).convert(mode), dtype=np.float32) / 255.0


photo = load("albedo.png")
nails = load("nails.png", "L")
free = load("freeedge.png", "L")
nos = load("normal_os.png") * 2 - 1  # object-space normal (palm faces -X)
H, W = photo.shape[:2]


def blurf(a, r):
    """Separable box blur x3 (≈ Gaussian) on float arrays."""
    out = a.astype(np.float32)
    k = max(1, int(r))
    for _ in range(3):
        for axis in (0, 1):
            pad = [(k + 1, k) if i == axis else (0, 0) for i in range(out.ndim)]
            c = np.cumsum(np.pad(out, pad, mode="edge"), axis=axis)
            hi = np.take(c, range(2 * k + 1, c.shape[axis]), axis=axis)
            lo = np.take(c, range(0, c.shape[axis] - 2 * k - 1), axis=axis)
            out = (hi - lo) / (2 * k + 1)
    return out


def fill_empty(img, mask):
    """Fill pixels outside the UV islands with nearby values (normalised convolution)."""
    single = img.ndim == 2
    im = img[..., None] if single else img
    out = im * mask[..., None]
    have = mask.copy()
    for r in (3, 8, 24, 64, 160):
        num = np.stack([blurf(im[..., c] * mask, r) for c in range(im.shape[-1])], axis=-1)
        den = blurf(mask, r)
        est = num / np.maximum(den, 1e-6)[..., None]
        take = (have < 0.5) & (den > 1e-4)
        out[take] = est[take]
        have = np.maximum(have, take.astype(np.float32))
    out[have < 0.5] = im[mask > 0.5].mean(axis=0)
    return out[..., 0] if single else out


valid = (blurf((photo.max(axis=-1) > 0.015).astype(np.float32), 2) > 0.999).astype(np.float32)
photo = fill_empty(photo, valid)
nos = fill_empty(nos, valid)
nails = fill_empty(nails, valid)
free = fill_empty(free, valid)

srgb = lambda h: np.array([int(h[i : i + 2], 16) for i in (1, 3, 5)], dtype=np.float32) / 255.0  # noqa: E731

# ------------------------------------------------------------------ target tones (warm Indian female complexion)
BACK = srgb("#CCA080")      # back of hand: luminous warm golden-honey / warm wheatish complexion
PALM = srgb("#E8C2AC")      # palm: soft warm peachy ivory
FLUSH = srgb("#DF9C8B")     # delicate rosy warmth at fingertips and knuckle curves
NAILBED = srgb("#DB9D92")   # healthy, soft manicured natural pink nail bed
FREEEDGE = srgb("#EDE3DA")  # soft natural ivory edge (not harsh chalky white)
CUTICLE = srgb("#CBA091")   # smooth gentle border

nx = blurf(nos[..., 0], 3)
palm_w = np.clip((-nx + 0.05) / 0.6, 0, 1)
palm_w = palm_w * palm_w * (3 - 2 * palm_w)
base = BACK[None, None] * (1 - palm_w[..., None]) + PALM[None, None] * palm_w[..., None]

# Soft fingertip rosy flush
near_nail = np.clip(blurf(nails, 24) * 2.5, 0, 1)
base = base + (FLUSH[None, None] - base) * (near_nail * 0.28)[..., None]

# ------------------------------------------------------------------ micro-detail: smooth & clean
L = photo @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
fine = L / np.maximum(blurf(L, 3), 1e-3)
mid = blurf(L, 3) / np.maximum(blurf(L, 14), 1e-3)

# Keep fine micro-structure subtle so skin looks silky, not noisy
fine = np.clip(fine, 0.88, 1.12)
mid = np.clip(mid, 0.75, 1.25)

# Palm lines remain defined; back of hand is kept smooth without muddy splotches
detail = fine ** 0.35 * mid ** np.where(palm_w > 0.5, 0.28, 0.04)
pores = 1 - 0.015 * blurf((rng.random((H, W)) > 0.985).astype(np.float32), 1) * 2
skin = np.clip(base * (detail * pores)[..., None], 0, 1)

# ------------------------------------------------------------------ clean manicured nails
nm = np.clip((nails - 0.15) / 0.6, 0, 1)
fe = np.clip(free * 1.5, 0, 1)
# Natural soft gradient from nail bed to free edge
nail_col = NAILBED[None, None] * (1 - fe[..., None]) + FREEEDGE[None, None] * fe[..., None]
cuticle = np.clip(blurf(nm, 2) - blurf(nm, 6), 0, 1) * 0.9
skin = skin + (CUTICLE[None, None] - skin) * (cuticle * 0.25)[..., None]
albedo = skin * (1 - nm[..., None]) + nail_col * nm[..., None]

# Very subtle contact shading only (prevents muddy dark splotches between fingers)
ao_path = src / "ao.png"
if ao_path.exists():
    ao = fill_empty(load("ao.png", "L"), valid)
    ao = blurf(ao, 4)
    albedo = albedo * (0.88 + 0.12 * ao)[..., None]

# ------------------------------------------------------------------ refined normal map (smooth, delicate skin)
crease = np.log(np.clip(mid, 0.75, 1.25))
finel = np.log(np.clip(fine, 0.88, 1.12))
# Palm keeps natural creases; back of hand has gentle knuckle folds, not coarse roughness
height = finel * 0.3 + crease * np.where(palm_w > 0.5, 0.75, 0.22)
height = blurf(height, 1)
height *= 1 - nm
gy, gx = np.gradient(height)
strength = 3.5 * (W / 2048)  # soft, elegant relief
n3 = np.stack([-gx * strength, gy * strength, np.ones_like(gx)], axis=-1)
n3 /= np.linalg.norm(n3, axis=-1, keepdims=True)
normal = n3 * 0.5 + 0.5
cavity = np.clip(-blurf(crease, 1) * 4.0, 0, 1) * np.where(palm_w > 0.5, 1.0, 0.3)


def save(arr, name, size, q=88):
    im = Image.fromarray(np.clip(arr * 255 + 0.5, 0, 255).astype(np.uint8))
    if im.size[0] != size:
        im = im.resize((size, size), Image.LANCZOS)
    im.save(dst / name, quality=q, optimize=True, progressive=True)
    print(name, (dst / name).stat().st_size // 1024, "KB")


save(albedo, "hand-albedo-2k.jpg", 2048, 88)
save(albedo, "hand-albedo-1k.jpg", 1024, 88)
save(normal, "hand-normal-2k.jpg", 2048, 82)
save(normal, "hand-normal-1k.jpg", 1024, 85)
save(np.stack([nm, cavity, fe], axis=-1), "hand-detail-1k.jpg", 1024, 88)
print("Texture post-processing complete.")

# Post-processes the maps baked by build_hand.py into web textures.
#
#   python scripts/hand-real/postprocess.py <build_dir> <public_models_dir>
#
# The CC0 MakeHuman skin is photo-derived but blotchy (red/brown patches, dark knuckles, muddy nails). For a
# well-groomed, evenly toned hand (docs/HAND_REALISM.md §5) the albedo is *composed*:
#   colour  = designed target tones — warm honey-medium back of hand, lighter pinker palm, pink nail beds with a light
#             free edge — blended by a baked palm/back mask (object-space normal) and a soft fingertip flush;
#   detail  = only the fine, low-contrast structure of the photo (pores, fine lines, palm creases), luminance only.
# Writes (into <public_models_dir>):
#   hand-albedo-2k.jpg / -1k.jpg   composed skin colour
#   hand-normal-2k.jpg / -1k.jpg   soft normal map (creases strong on the palm, faint on the back), pores, smooth nails
#   hand-detail-1k.jpg             R = nail mask, G = crease cavity, B = nail free edge
# Requires Pillow + numpy.

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
    """Fill pixels outside the UV islands with nearby values (normalised convolution) so mips/seams stay clean."""
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

# ------------------------------------------------------------------ target tones (sRGB albedo, before lighting)
BACK = srgb("#C9956F")  # back of hand: warm honey / wheatish medium Indian complexion
PALM = srgb("#E3AF92")  # palm: lighter, pinker (thick stratum corneum, little melanin)
FLUSH = srgb("#D99A86")  # soft rosy flush at fingertips / knuckle tops (blood close to the surface)
NAILBED = srgb("#E9AFA3")  # healthy pink nail bed
FREEEDGE = srgb("#F6EADF")  # translucent white free edge
CUTICLE = srgb("#C8907A")

nx = blurf(nos[..., 0], 3)
palm_w = np.clip((-nx + 0.05) / 0.6, 0, 1)
palm_w = palm_w * palm_w * (3 - 2 * palm_w)
base = BACK[None, None] * (1 - palm_w[..., None]) + PALM[None, None] * palm_w[..., None]

# fingertip flush: near nails (pads and the skin around the nail) — a gentle, wide falloff
near_nail = np.clip(blurf(nails, 22) * 3.0, 0, 1)
base = base + (FLUSH[None, None] - base) * (near_nail * 0.35)[..., None]

# ------------------------------------------------------------------ fine photo detail, luminance only, low contrast
L = photo @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
fine = L / np.maximum(blurf(L, 3), 1e-3)  # pores, fine lines
mid = blurf(L, 3) / np.maximum(blurf(L, 14), 1e-3)  # creases / folds
fine = np.clip(fine, 0.7, 1.3)
mid = np.clip(mid, 0.6, 1.4)
detail = fine ** 0.55 * mid ** np.where(palm_w > 0.5, 0.32, 0.24)  # palm lines visible, back of hand smooth
pores = 1 - 0.035 * blurf((rng.random((H, W)) > 0.982).astype(np.float32), 1) * 4
tone = 1 + 0.012 * blurf(rng.standard_normal((H, W)).astype(np.float32), 18) * 6  # barely-there natural variation
skin = np.clip(base * (detail * pores * tone)[..., None], 0, 1)

# ------------------------------------------------------------------ nails
nm = np.clip((nails - 0.15) / 0.6, 0, 1)
fe = np.clip(free * 1.6, 0, 1)
nail_col = NAILBED[None, None] * (1 - fe[..., None]) + FREEEDGE[None, None] * fe[..., None]
nail_col = nail_col * (fine ** 0.15)[..., None]
cuticle = np.clip(blurf(nm, 2) - blurf(nm, 6), 0, 1) * 1.2  # thin soft edge just outside the plate
skin = skin + (CUTICLE[None, None] - skin) * (cuticle * 0.35)[..., None]
albedo = skin * (1 - nm[..., None]) + nail_col * nm[..., None]
# baked ambient occlusion (between the fingers, palm hollow, finger webs): soft, so it reads as contact shading
ao_path = src / "ao.png"
if ao_path.exists():
    ao = fill_empty(load("ao.png", "L"), valid)
    ao = blurf(ao, 2)
    albedo = albedo * (0.35 + 0.65 * ao)[..., None] ** 0.8

# ------------------------------------------------------------------ normal map
crease = np.log(np.clip(mid, 0.6, 1.4))
finel = np.log(np.clip(fine, 0.7, 1.3))
height = finel * 0.6 + crease * np.where(palm_w > 0.5, 0.9, 0.48)
height = blurf(height, 1)
height -= blurf((rng.random((H, W)) > 0.985).astype(np.float32), 1) * 0.03  # pores
height *= 1 - nm
gy, gx = np.gradient(height)
strength = 6.0 * (W / 2048)
n3 = np.stack([-gx * strength, gy * strength, np.ones_like(gx)], axis=-1)
n3 /= np.linalg.norm(n3, axis=-1, keepdims=True)
normal = n3 * 0.5 + 0.5
cavity = np.clip(-blurf(crease, 1) * 5.0, 0, 1) * np.where(palm_w > 0.5, 1.0, 0.4)


def save(arr, name, size, q=86):
    im = Image.fromarray(np.clip(arr * 255 + 0.5, 0, 255).astype(np.uint8))
    if im.size[0] != size:
        im = im.resize((size, size), Image.LANCZOS)
    im.save(dst / name, quality=q, optimize=True, progressive=True)
    print(name, (dst / name).stat().st_size // 1024, "KB")


save(albedo, "hand-albedo-2k.jpg", 2048, 84)
save(albedo, "hand-albedo-1k.jpg", 1024, 86)
save(normal, "hand-normal-2k.jpg", 2048, 80)
save(normal, "hand-normal-1k.jpg", 1024, 84)
save(np.stack([nm, cavity, fe], axis=-1), "hand-detail-1k.jpg", 1024, 85)

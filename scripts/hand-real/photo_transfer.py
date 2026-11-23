# Transfers the photographed palm (real skin + real henna) from the "Photo 3D" source images onto the sculpted hand.
#
#   python scripts/hand-real/photo_transfer.py [--src mehndi-3d-tryon/mehndi-3d-tryon] [--out public/models/photo]
#
# Inputs (read-only, from the Photo 3D project):
#   generated-images/bare-hands.jpg, <design>-paste.jpg, <design>-stain.jpg   two palm-up hands, fingers down
#   data/stage2/hand.json      landmarks of the image-LEFT hand (= the person's RIGHT hand) in the 1536x1920 canvas
#   data/stage1/ref_mask_L.png rough mask of that hand (same canvas)
#   data/designs.json          design id -> photo name
# Target: the sculpted hand's palm projection frame (src/lib/mehndi/hand-landmarks.json, 1000x1000 artwork units),
#   whose outline comes from scripts/out/silhouette-palm.path.txt (written by scripts/extract-landmarks.mjs).
#
# Method:
#   1. correspondences — fingertips, finger axes (base/web → tip, sampled along their length), finger and thumb
#      sides (from the landmark radii vs our measured finger widths), palm centre, wrist and forearm edges, ulnar and
#      radial palm edges (scanned on both outlines);
#   2. thin-plate-spline warp (target → source), evaluated on a coarse grid, upsampled, then cv2.remap with Lanczos4;
#   3. per-photo hand mask (colour vs the pink silk, inside the dilated reference mask), intersected over all photos
#      so every design shares one mask; eroded and feathered;
#   4. output in the shared "palm_photo" contract (same as admin photo uploads): square RGBA in the palm projection
#      frame (1000-unit square), sRGB colour, alpha = feathered hand coverage →
#      public/designs/photo/<id>-palm.webp (fresh paste) and <id>-palm-stain.webp (dried stain);
#   5. de-lighting (divide out the photo's large-scale shading of the bare hands) and colour match of the skin to the
#      sculpted palm tone, so the whole hand reads as one person; mild unsharp mask.
#
# Resolution independence: landmarks scale with the photo width (width / 1536). The output size follows the source
# density — 2048² for the current ~1.1K photos, 4096² automatically when 2–4K photos are dropped in with the same
# names and framing (see docs/HAND_REALISM.md §7). Mobile always gets ≤ 2048².

import argparse
import json
import math
import pathlib

import cv2
import numpy as np
from PIL import Image
from scipy.interpolate import RBFInterpolator

ap = argparse.ArgumentParser()
ap.add_argument("--src", default="mehndi-3d-tryon/mehndi-3d-tryon")
ap.add_argument("--out", default="public/designs/photo")
ap.add_argument("--preview", default="scripts/out/hand/photo-transfer")
args = ap.parse_args()
SRC = pathlib.Path(args.src)
OUT = pathlib.Path(args.out)
OUT.mkdir(parents=True, exist_ok=True)
PREV = pathlib.Path(args.preview)
PREV.mkdir(parents=True, exist_ok=True)

hand = json.loads((SRC / "data/stage2/hand.json").read_text())
lm = json.loads(pathlib.Path("src/lib/mehndi/hand-landmarks.json").read_text())
J = {k: np.array(v, dtype=np.float64) for k, v in lm["palm"].items()}
WIDTHS = lm["widths"]
CANVAS_W = 1536.0

# ------------------------------------------------------------------ our palm outline (artwork units)
U = 2  # raster scale for our outline: 2 px per artwork unit
ours = np.zeros((1000 * U, 1000 * U), np.uint8)
path = pathlib.Path("scripts/out/silhouette-palm.path.txt").read_text()
for tri in path.split("Z"):
    pts = [p for p in tri.replace("M", " ").replace("L", " ").split() if "," in p]
    if len(pts) == 3:
        poly = np.array([[float(a) * U for a in p.split(",")] for p in pts], np.int32)
        cv2.fillConvexPoly(ours, poly, 255)
ours = cv2.morphologyEx(ours, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))


def row_extent(mask, y, scale):
    """Leftmost/rightmost mask pixel on row y (given in mask units / scale)."""
    r = mask[int(round(y * scale))]
    xs = np.nonzero(r > 127)[0]
    return (xs.min() / scale, xs.max() / scale) if len(xs) else None


# ------------------------------------------------------------------ correspondences
def along(poly, t):
    poly = np.asarray(poly, np.float64)
    seg = np.linalg.norm(np.diff(poly, axis=0), axis=1)
    d = t * seg.sum()
    for i, l in enumerate(seg):
        if d <= l or i == len(seg) - 1:
            k = min(1.0, d / l) if l else 0.0
            p = poly[i] + (poly[i + 1] - poly[i]) * k
            dv = (poly[i + 1] - poly[i]) / (l or 1)
            return p, dv
        d -= l
    return poly[-1], np.array([0.0, -1.0])


perp = lambda v: np.array([-v[1], v[0]])  # noqa: E731
src_pts, dst_pts = [], []  # source = canvas coords of the photo hand, dst = artwork units


def pair(s, d):
    src_pts.append(np.asarray(s, np.float64))
    dst_pts.append(np.asarray(d, np.float64))


names = {"index": "index-finger", "middle": "middle-finger", "ring": "ring-finger", "pinky": "pinky-finger"}
for f, key in names.items():
    hf = hand["fingers"][f]
    B, T = np.array(hf["B"], float), np.array(hf["T"], float)
    dirp = (T - B) / np.linalg.norm(T - B)
    p_base = np.array([B[0], hf["web"]], float)
    p_tip = T + dirp * hf["rT"] * 0.45  # inside the photo fingertip so our tip pad gets the (dipped) photo tip
    photo_axis = [p_base, p_tip]
    o0, o1, o2, o3 = (J[f"{key}-phalanx-proximal"], J[f"{key}-phalanx-intermediate"], J[f"{key}-phalanx-distal"], J[f"{key}-tip"])
    o_base = o0 + (o1 - o0) * 0.4  # palm-side digital crease (same rule as src/lib/mehndi/hand2d.ts)
    our_axis = [o_base, o1, o2, o3]
    w = WIDTHS[f] if f != "pinky" else min(WIDTHS["pinky"], WIDTHS["ring"] * 0.88)
    for t in (0.0, 0.25, 0.5, 0.75, 1.0):
        ps, ds = along(photo_axis, t)
        po, do = along(our_axis, t)
        pair(ps, po)
        if 0.1 < t < 0.95:
            rs = hf["rB"] + (hf["rT"] - hf["rB"]) * t
            ro = w * 0.5 * (1 - 0.1 * t)
            for sgn in (-1, 1):
                # photo is rotated 180° relative to our palm view, so its "left" is our "right": match by side
                # of the finger relative to the thumb (thumb side = +1 in both after orientation handling below)
                pair(ps + perp(ds) * rs * sgn * 0.92, po + perp(do) * ro * sgn * 0.92)

th = hand["thumb"]
P = [np.array(p, float) for p in th["P"]]
R = th["R"]
dth = (P[2] - P[1]) / np.linalg.norm(P[2] - P[1])
photo_thumb = [P[0], P[1], P[2] + dth * R[2] * 0.45]
our_thumb = [J["thumb-phalanx-proximal"], J["thumb-phalanx-distal"], J["thumb-tip"]]
for t in (0.0, 0.33, 0.66, 1.0):
    ps, ds = along(photo_thumb, t)
    po, do = along(our_thumb, t)
    pair(ps, po)
    if 0.1 < t < 0.95:
        rs = R[0] + (R[2] - R[0]) * t
        ro = WIDTHS["thumb"] * 1.12 * 0.5 * (1 - 0.1 * t)
        for sgn in (-1, 1):
            pair(ps + perp(ds) * rs * sgn * 0.9, po + perp(do) * ro * sgn * 0.9)

# palm centre
mid_k = J["middle-finger-phalanx-proximal"]
our_center = J["wrist"] + (mid_k - J["wrist"]) * 0.5
pair(hand["palmCenter"], our_center)


def interp_contour(cont, y):
    """x of a forearm contour at height y. NOTE: hand.json stores forearmL / forearmR as [y, x] pairs."""
    c = np.array(cont, float)
    c = c[np.argsort(c[:, 0])]
    return float(np.interp(y, c[:, 0], c[:, 1]))


# wrist and forearm levels. Photo scale vs ours from the middle finger length.
hm = hand["fingers"]["middle"]
photo_len = np.linalg.norm(np.array(hm["T"]) - np.array([hm["B"][0], hm["web"]]))
o0, o1 = J["middle-finger-phalanx-proximal"], J["middle-finger-phalanx-intermediate"]
our_len = np.linalg.norm(J["middle-finger-tip"] - (o0 + (o1 - o0) * 0.4)) * 1.0
k = our_len / photo_len  # artwork units per canvas unit
wy = float(hand["wristY"])
for frac in (0.0, 0.35, 0.7):  # 0 = wrist, then up the forearm (photo y decreases, ours increases)
    py = wy - frac * 300
    oy = J["wrist"][1] + frac * 300 * k
    if oy > 985:
        continue
    pl, pr = interp_contour(hand["forearmL"], py), interp_contour(hand["forearmR"], py)
    ext = row_extent(ours, oy, U)
    if not ext:
        continue
    ol, orr = ext
    pair(((pl + pr) / 2, py), ((ol + orr) / 2, oy))
    # photo-left (radial / thumb side after the 180° turn) ↔ our right; photo-right (ulnar) ↔ our left
    pair((pl, py), (orr, oy))
    pair((pr, py), (ol, oy))

# ulnar palm edge between the wrist and the pinky web
pk_web = hand["fingers"]["pinky"]["web"]
our_pk_base = J["pinky-finger-phalanx-proximal"] + (J["pinky-finger-phalanx-intermediate"] - J["pinky-finger-phalanx-proximal"]) * 0.4
for frac in (0.3, 0.6, 0.85):
    py = wy + frac * (pk_web - wy)
    oy = J["wrist"][1] + frac * (our_pk_base[1] - J["wrist"][1])
    ext = row_extent(ours, oy, U)
    if ext:
        pair((interp_contour(hand["forearmR"], py), py), (ext[0], oy))

src_pts = np.array(src_pts)
dst_pts = np.array(dst_pts)
tps = RBFInterpolator(dst_pts, src_pts, kernel="thin_plate_spline", smoothing=2.0)


# ------------------------------------------------------------------ per-photo helpers
def hand_mask(img, scale):
    ref = np.asarray(Image.open(SRC / "data/stage1/ref_mask_L.png").convert("L"))
    ref = cv2.resize(ref, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_LINEAR)
    ref = cv2.dilate((ref > 127).astype(np.uint8), np.ones((int(25 * scale) | 1,) * 2, np.uint8))
    f = img.astype(np.float32) + 1
    br = f[..., 2] / f[..., 0]  # blue / red: silk ≈ 0.87, skin ≈ 0.6, henna ≈ 0.3
    gr = f[..., 1] / f[..., 0]
    m = ((br < 0.78) & (gr < 0.86)).astype(np.uint8) & ref
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((int(9 * scale) | 1,) * 2, np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m)
    if n > 1:
        big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        m = (lab == big).astype(np.uint8)
    return m


def remap_maps(size, scale):
    """Per-output-pixel source coordinates (photo pixels) for an output of size² covering the 1000-unit frame."""
    g = 64
    ys, xs = np.mgrid[0:g + 1, 0:g + 1] / g * 1000.0
    q = np.stack([xs.ravel(), ys.ravel()], axis=1)
    s = tps(q) * scale
    mx = s[:, 0].reshape(g + 1, g + 1).astype(np.float32)
    my = s[:, 1].reshape(g + 1, g + 1).astype(np.float32)
    mx = cv2.resize(mx, (size, size), interpolation=cv2.INTER_CUBIC)
    my = cv2.resize(my, (size, size), interpolation=cv2.INTER_CUBIC)
    return mx, my


# ------------------------------------------------------------------ sources
designs = json.loads((SRC / "data/designs.json").read_text())
jobs = [("bare", "paste", "bare-hands.jpg")]
for d in designs:
    if d["id"] == "bare":
        continue
    jobs.append((d["id"], "paste", f"{d['photo']}-paste.jpg"))
    if d.get("stain"):
        jobs.append((d["id"], "stain", f"{d['photo']}-stain.jpg"))
jobs = [j for j in jobs if (SRC / "generated-images" / j[2]).exists()]

bare = cv2.cvtColor(cv2.imread(str(SRC / "generated-images/bare-hands.jpg")), cv2.COLOR_BGR2RGB)
scale = bare.shape[1] / CANVAS_W


def load_img(fn):
    """Load a source photo at the bare-hands frame size (generators can be off by a pixel)."""
    im = cv2.cvtColor(cv2.imread(str(SRC / "generated-images" / fn)), cv2.COLOR_BGR2RGB)
    if im.shape[:2] != bare.shape[:2]:
        im = cv2.resize(im, (bare.shape[1], bare.shape[0]), interpolation=cv2.INTER_LANCZOS4)
    return im

# source density: photo pixels per artwork unit, measured on the middle finger
density = (photo_len * scale) / our_len
desk = int(min(4096, 2 ** math.ceil(math.log2(max(1024, density * 1000 * 1.5)))))
mob = min(2048, desk)
print(f"source {bare.shape[1]}x{bare.shape[0]}, scale {scale:.3f}, {density:.2f} px/unit "
      f"(~{density * 1000:.0f}px effective across the frame) -> desktop {desk}px, mobile {mob}px")

# shared mask: intersection of every photo's hand mask (so no design shows silk at the edges)
mask = None
for _, _, fn in jobs:
    img = load_img(fn)
    m = hand_mask(img, scale)
    mask = m if mask is None else (mask & m)
mask = cv2.erode(mask, np.ones((int(7 * scale) | 1,) * 2, np.uint8))

# shading of the bare hands (large-scale luminance), used to de-light every photo
bl = cv2.cvtColor(bare, cv2.COLOR_RGB2GRAY).astype(np.float32)
mf = mask.astype(np.float32)
sig = 40 * scale
shade = cv2.GaussianBlur(bl * mf, (0, 0), sig) / np.maximum(cv2.GaussianBlur(mf, (0, 0), sig), 1e-3)
shade_ref = float(np.median(shade[mask > 0]))
shade = np.clip(shade / shade_ref, 0.55, 1.6)

# colour target: the sculpted hand's palm albedo (sRGB) — same constants as scripts/hand-real/postprocess.py
PALM = np.array([0xE3, 0xAF, 0x92], np.float32)
bare_skin = np.median(bare[mask > 0].astype(np.float32) / shade[mask > 0][:, None], axis=0)
gain = PALM / bare_skin
print("bare skin", bare_skin.round(1), "gain", gain.round(3))

manifest = {"sizes": {"desktop": desk, "mobile": mob}, "density": round(density, 3), "source": f"{bare.shape[1]}x{bare.shape[0]}", "looks": {}}
mxd, myd = remap_maps(desk, scale)
mask_w = cv2.remap((mask * 255).astype(np.uint8), mxd, myd, cv2.INTER_LINEAR, borderValue=0)
fe = max(3, int(desk / 400))
mask_w = cv2.GaussianBlur(cv2.erode(mask_w, np.ones((fe, fe), np.uint8)), (0, 0), fe)

for pid, look, fn in jobs:
    img = load_img(fn).astype(np.float32)
    # de-light with the bare hands' low-frequency shading (same pose, so the same shading), then white-balance and
    # expose THIS photo's own skin to the sculpted palm tone: the AI-edited design photos differ in exposure/WB.
    dl = img / shade[..., None]
    px = dl[mask > 0]
    lum = px @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    skin_i = np.median(px[lum >= np.percentile(lum, 75)], axis=0)
    alb = dl * (PALM / skin_i)[None, None]
    # fill outside the hand with nearby hand colour so Lanczos/mip filtering never pulls in silk at the edges
    inv = (mask == 0).astype(np.uint8)
    filled = cv2.inpaint(np.clip(alb, 0, 255).astype(np.uint8), inv, 5, cv2.INPAINT_TELEA) if inv.any() else alb.astype(np.uint8)
    out = cv2.remap(filled, mxd, myd, cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT).astype(np.float32)
    # mild unsharp mask (the source is up-sampled ≈ desk/(density*1000)×)
    blur = cv2.GaussianBlur(out, (0, 0), 1.2 * desk / 2048)
    out = np.clip(out + (out - blur) * 0.45, 0, 255).astype(np.uint8)
    key = f"{pid}-{look}"
    # outside the hand nothing is visible: flatten it so the file stays small (alpha carries the coverage)
    far = cv2.GaussianBlur(out, (0, 0), desk / 64)
    a3 = (cv2.dilate(mask_w, np.ones((desk // 64 | 1,) * 2, np.uint8)) / 255.0)[..., None]
    out = (out * a3 + far * (1 - a3)).astype(np.uint8)
    rgba = np.dstack([out, mask_w])
    base = f"{pid}-palm" + ("-stain" if look == "stain" else "")
    files = {}
    for tier, size in (("desktop", desk), ("mobile", mob)):
        im = Image.fromarray(rgba, "RGBA")
        name = f"{base}.webp" if size == desk else f"{base}-{size}.webp"
        if size != desk:
            im = im.resize((size, size), Image.LANCZOS)
        im.save(OUT / name, quality=90, method=6, alpha_quality=90)
        files[tier] = f"/designs/photo/{name}"
    manifest["looks"][key] = files
    print(key, "skin", skin_i.round(1), {t: f"{(OUT / pathlib.Path(n).name).stat().st_size // 1024} KB" for t, n in files.items()})
    if pid in ("royal", "arabic", "bare"):
        prev = Image.fromarray(out).resize((1000, 1000), Image.LANCZOS)
        a = Image.fromarray(mask_w).resize((1000, 1000))
        bg = Image.new("RGB", (1000, 1000), (75, 29, 63))
        bg.paste(prev, (0, 0), a)
        bg.save(PREV / f"warp-{key}.jpg", quality=88)

# landmark overlay for QA
q = Image.open(OUT / "bare-palm.webp").convert("RGB").resize((1000, 1000))
qa = np.asarray(q).copy()
for p in dst_pts:
    cv2.circle(qa, (int(p[0]), int(p[1])), 4, (0, 255, 0), -1)
ol = cv2.Canny(ours, 50, 150)
ol = cv2.resize(ol, (1000, 1000)) > 0
qa[ol] = (255, 255, 0)
Image.fromarray(qa).save(PREV / "warp-landmarks.jpg", quality=88)
pathlib.Path("src/lib/mehndi/photo-palm.json").write_text(json.dumps(manifest, indent=1))
print("wrote", OUT, "and src/lib/mehndi/photo-palm.json")

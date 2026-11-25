# Repair the photo-left hand's thumb (shown on the RIGHT once the hands are turned fingers-up): in the source photo its
# thumb crotch is filled with a wedge of skin, so the thumb reads as pasted onto the palm. The other hand has a clean
# thumb and web, and the pair (and the mehndi) are mirror images, so the thumb area is rebuilt from that hand: mirrored,
# aligned with an ECC affine fit on the hand outlines, and feather-blended in. Applied identically to the outline
# (mask.png), the relief (hmap.png) and every design photo (atlas-*.jpg). Originals: scripts/out/tryon-orig2/.
#
#   python scripts/tryon/fix_thumb_mirror.py

import glob
import json
import pathlib
import shutil

import cv2
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
TRY = ROOT / "assets/tryon-source"  # Photo 3D source photos (mask, height map, design atlases, manifest); not served
BAK = ROOT / "scripts/out/tryon-orig2"
BAK.mkdir(parents=True, exist_ok=True)
files = [TRY / "mask.png", TRY / "hmap.png"] + [pathlib.Path(f) for f in sorted(glob.glob(str(TRY / "atlas-*.jpg")))]
for f in files:
    if not (BAK / f.name).exists():
        shutil.copy(f, BAK / f.name)

man = json.loads((TRY / "manifest.json").read_text())
G, T = man["geo"]["geo"], man["geo"]["tex"]
m = cv2.imread(str(BAK / "mask.png"), 0).astype(np.float32) / 255
H, W = m.shape
S = (T["x1"] - T["x0"]) / W

cols = (m > 0.5)[:, W // 2 - 60: W // 2 + 60].sum(0)
mid = W // 2 - 60 + int(np.argmin(cols))
L = m.copy()
L[:, mid:] = 0
R = m.copy()
R[:, :mid] = 0
Rf = cv2.flip(R, 1)
roi = np.zeros_like(m)
roi[950:, :] = 1
warp = np.eye(2, 3, dtype=np.float32)
_, warp = cv2.findTransformECC(cv2.GaussianBlur(L * roi, (0, 0), 3), cv2.GaussianBlur(Rf * roi, (0, 0), 3), warp,
                               cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 400, 1e-7), None, 5)
print("affine", np.round(warp, 4).tolist())

# blend weight (atlas px): the thumb and its web, feathered; never past the parting between the hands
wgt = np.zeros((H, W), np.float32)
wgt[1130:1450, 0:250] = 1
wgt = cv2.GaussianBlur(wgt, (0, 0), 14)
wgt[:, mid - 20:] = 0


def src_of(x, y):
    """atlas (x, y) of the bad hand → atlas coords of the matching point on the good hand."""
    xs = warp[0, 0] * x + warp[0, 1] * y + warp[0, 2]
    ys = warp[1, 0] * x + warp[1, 1] * y + warp[1, 2]
    return (W - 1) - xs, ys


# ---- atlas-space images (mask + design photos)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
sx, sy = src_of(xx, yy)
sx, sy = sx.astype(np.float32), sy.astype(np.float32)
for f in files:
    if f.name == "hmap.png":
        continue
    img = cv2.imread(str(BAK / f.name), cv2.IMREAD_UNCHANGED).astype(np.float32)
    moved = cv2.remap(img, sx, sy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    w = wgt if img.ndim == 2 else wgt[..., None]
    out = img * (1 - w) + moved * w
    if f.suffix == ".png":
        cv2.imwrite(str(f), np.clip(out, 0, 255).astype(np.uint8))
    else:
        cv2.imwrite(str(f), np.clip(out, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 92])
    print("fixed", f.name)

# ---- relief (16-bit heights packed in R high / G low, its own frame)
hm = cv2.imread(str(BAK / "hmap.png"), cv2.IMREAD_UNCHANGED)
h = (hm[..., 2].astype(np.float32) * 256 + hm[..., 1])
gh, gw = h.shape
v, u = np.mgrid[0:gh, 0:gw].astype(np.float32)
X = G["x0"] + (u + 0.5) * G["d"]
Y = G["y0"] + (v + 0.5) * G["d"]
ax = (X - T["x0"]) / S - 0.5
ay = (Y - T["y0"]) / S - 0.5
bx, by = src_of(ax, ay)
su = ((T["x0"] + (bx + 0.5) * S) - G["x0"]) / G["d"] - 0.5
sv = ((T["y0"] + (by + 0.5) * S) - G["y0"]) / G["d"] - 0.5
moved = cv2.remap(h, su.astype(np.float32), sv.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
hw = cv2.remap(wgt, ax.astype(np.float32), ay.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
hn = np.clip(np.round(h * (1 - hw) + moved * hw), 0, 65535).astype(np.uint32)
out = hm.copy()
out[..., 2] = (hn >> 8).astype(np.uint8)
out[..., 1] = (hn & 255).astype(np.uint8)
cv2.imwrite(str(TRY / "hmap.png"), out)
print("fixed hmap.png")

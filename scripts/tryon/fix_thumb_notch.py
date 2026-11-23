# Repair the notch on the image-right hand's outer thumb mound (an artefact of the generated bare-hands photo that the
# Photo 3D mask and height map inherited: the thumb looked pinched off, with pink silk showing through).
#
#   python scripts/tryon/fix_thumb_notch.py            # idempotent: always rebuilds from the backups
#
# 1. mask.png (texture frame): morphological closing inside a small box around the notch only
# 2. every atlas-*.jpg: the pixels outside the hand inside that box are inpainted from the surrounding skin, so the
#    newly covered sliver shows skin (and henna lines continue naturally)
# 3. hmap.png (geometry frame, 16-bit in R/G): heights inpainted over the new cells, tapered towards the new edge
# Originals are copied once to scripts/out/tryon-orig/.

import json
import pathlib
import shutil

import cv2
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
TRY = ROOT / "public/tryon"
BAK = ROOT / "scripts/out/tryon-orig"
BAK.mkdir(parents=True, exist_ok=True)

# Box around the notch in mask/atlas pixels (938×1680 texture frame), found with scripts/out/shots/thumb_atlas.jpg.
X0, X1, Y0, Y1 = 725, 845, 980, 1140
KERNEL = 75


def backup(p: pathlib.Path) -> pathlib.Path:
    b = BAK / p.name
    if not b.exists():
        shutil.copy(p, b)
    return b


man = json.loads((TRY / "manifest.json").read_text())
F, T = man["geo"]["geo"], man["geo"]["tex"]

# ---- 1. mask
mask = cv2.imread(str(backup(TRY / "mask.png")), cv2.IMREAD_GRAYSCALE)
H, W = mask.shape
on = (mask > 127).astype(np.uint8)
roi = np.zeros_like(on)
roi[Y0:Y1, X0:X1] = 1
closed = cv2.morphologyEx(on, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (KERNEL, KERNEL)))
fixed = np.where(roi > 0, np.maximum(on, closed), on)
added = (fixed > on).astype(np.uint8)
print(f"mask: {added.sum()} px added")
# keep the original anti-aliased edge elsewhere; soften the new edge a little
out_mask = mask.copy()
soft = cv2.GaussianBlur(fixed.astype(np.float32) * 255, (0, 0), 0.8)
out_mask[roi > 0] = np.maximum(mask, soft.astype(np.uint8))[roi > 0]
cv2.imwrite(str(TRY / "mask.png"), out_mask)

# ---- 2. atlases: inpaint everything outside the original hand inside the box from the skin around it
unknown = ((roi > 0) & (on == 0)).astype(np.uint8) * 255
unknown = cv2.dilate(unknown, np.ones((3, 3), np.uint8))
for p in sorted(TRY.glob("atlas-*.jpg")):
    img = cv2.imread(str(backup(p)))
    if img.shape[:2] != (H, W):
        print(f"skip {p.name}: size {img.shape[:2]}")
        continue
    rep = cv2.inpaint(img, unknown, 9, cv2.INPAINT_TELEA)
    img[unknown > 0] = rep[unknown > 0]
    cv2.imwrite(str(p), img, [cv2.IMWRITE_JPEG_QUALITY, 94])
print("atlases repaired")

# ---- 3. height map (geometry frame)
hm = cv2.imread(str(backup(TRY / "hmap.png")), cv2.IMREAD_UNCHANGED)  # BGRA
h = (hm[..., 2].astype(np.float32) * 256 + hm[..., 1].astype(np.float32))
gw, gh = F["w"], F["h"]
# texture px → reference px → geometry cell
sx, sy = (T["x1"] - T["x0"]) / W, (T["y1"] - T["y0"]) / H
gx = lambda x: (T["x0"] + x * sx - F["x0"]) / F["d"]
gy = lambda y: (T["y0"] + y * sy - F["y0"]) / F["d"]
# fixed mask resampled to the geometry grid
jj, ii = np.mgrid[0:gh, 0:gw]
tx = ((F["x0"] + (ii + 0.5) * F["d"] - T["x0"]) / sx).astype(np.float32)
ty = ((F["y0"] + (jj + 0.5) * F["d"] - T["y0"]) / sy).astype(np.float32)
mg = cv2.remap(fixed.astype(np.float32), tx, ty, cv2.INTER_LINEAR, borderValue=0)
mo = cv2.remap(on.astype(np.float32), tx, ty, cv2.INTER_LINEAR, borderValue=0)
groi = np.zeros((gh, gw), np.uint8)
groi[int(gy(Y0)) - 2:int(gy(Y1)) + 3, int(gx(X0)) - 2:int(gx(X1)) + 3] = 1
low = h < 0.35 * np.percentile(h[mo > 0.5], 50)
need = ((groi > 0) & (mg > 0.3) & low).astype(np.uint8)
hole = ((groi > 0) & ((mo < 0.5) | low)).astype(np.uint8) * 255
filled = cv2.inpaint(h, hole, 4, cv2.INPAINT_TELEA)
# taper: full height ≥ 3 cells inside the new outline, falling to ~0 at it (like the original feathered edges)
dist = cv2.distanceTransform((mg > 0.5).astype(np.uint8), cv2.DIST_L2, 3)
taper = np.clip(dist / 3.0, 0, 1) ** 0.6
new_h = np.where(need > 0, np.maximum(h, filled * taper), h)
print(f"height map: {int(need.sum())} cells raised")
v = np.clip(new_h, 0, 65535).astype(np.uint16)
hm[..., 2] = (v >> 8).astype(np.uint8)
hm[..., 1] = (v & 255).astype(np.uint8)
cv2.imwrite(str(TRY / "hmap.png"), hm)

# check image
chk = cv2.imread(str(TRY / "atlas-bare.jpg"))
cnt, _ = cv2.findContours((out_mask > 127).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
cv2.drawContours(chk, cnt, -1, (255, 255, 0), 2)
cv2.imwrite(str(ROOT / "scripts/out/shots/thumb_fixed.jpg"), chk[840:1344, 562:938])
print("done")

# Bare back-of-hand texture for the 3D model, made from a finished back view by painting the henna out (no Codex).
#   python scripts/model3d/bare_back.py [source_key]
import pathlib, sys
import cv2
import numpy as np
ROOT = pathlib.Path(__file__).resolve().parents[2]
src = sys.argv[1] if len(sys.argv) > 1 else "trail_stain"
img = cv2.imread(str(ROOT / f"scripts/out/model3d/back-{src}.png"))
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
# skin: light, moderately saturated; henna: darker and/or much more saturated red-brown. Nails (pink, light) stay.
L, Sat = lab[..., 0], hsv[..., 1]
mask = cv2.flip(cv2.imread(str(ROOT / "public/tryon/mask.png"), 0), 1) > 127
inner = cv2.erode(mask.astype(np.uint8), np.ones((15, 15), np.uint8)) > 0
skinL = np.median(L[inner & (Sat < 175)])
# henna: clearly darker than skin or strongly saturated red-brown; pale pink nails are kept
henna = mask & ((L < skinL - 14) | (Sat > 168))
henna = cv2.dilate(henna.astype(np.uint8), np.ones((5, 5), np.uint8), iterations=3)
henna = cv2.morphologyEx(henna, cv2.MORPH_CLOSE, np.ones((21, 21), np.uint8))
# smooth skin field from the henna-free skin around it (normalized convolution), a few sizes so small gaps keep
# local colour and big motifs get the broad tone
keep = ((henna == 0) & mask).astype(np.float32)
f = img.astype(np.float32)
num = cv2.GaussianBlur(f * keep[..., None], (0, 0), 22)
den = cv2.GaussianBlur(keep, (0, 0), 22)
num2 = cv2.GaussianBlur(f * keep[..., None], (0, 0), 70)
den2 = cv2.GaussianBlur(keep, (0, 0), 70)
fill = np.where((den > 0.08)[..., None], num / np.maximum(den, 1e-6)[..., None], num2 / np.maximum(den2, 1e-6)[..., None])
wsum = (den2 > 1e-4).astype(np.float32)
fill[wsum == 0] = np.median(f[keep > 0], 0)
a = cv2.GaussianBlur(henna.astype(np.float32), (0, 0), 4)[..., None]
out = (img * (1 - a) + fill * a).astype(np.uint8)
cv2.imwrite(str(ROOT / "scripts/out/model3d/back-bare.png"), out)
cv2.imwrite(str(ROOT / "public/tryon/model/back-bare.jpg"), out, [cv2.IMWRITE_JPEG_QUALITY, 88])
cv2.imwrite(str(ROOT / "scripts/out/model3d/bare-check.jpg"), cv2.resize(np.hstack([img, out]), None, fx=0.4, fy=0.4))
print("ok", skinL)

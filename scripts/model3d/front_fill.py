# Front textures for the 3D model: the design photos (assets/tryon-source/atlas-*.jpg) with everything outside the
# hand outline replaced by the neighbouring skin, so the rim and the blurred side-wall samples never pick up the
# photo's silk background. Inside the outline the pixels are untouched.
#   python scripts/model3d/front_fill.py
import glob, pathlib
import cv2
import numpy as np
ROOT = pathlib.Path(__file__).resolve().parents[2]
TRY = ROOT / "assets/tryon-source"  # Photo 3D source photos (mask, height map, design atlases, manifest); not served
m = cv2.imread(str(TRY / "mask.png"), 0).astype(np.float32) / 255
# a 2px skin margin inside the outline is rebuilt too: the photo's own edge pixels carry dark specks / silk colour
trusted = cv2.erode((m > 0.6).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
# where the two palms touch, the photo has a dark crease between them; the 3D hands are parted there, so rebuild it
H, W = m.shape
binm = (m > 0.5).astype(np.uint8)
cols = binm[:, W // 2 - 60: W // 2 + 60].sum(0)
mid = W // 2 - 60 + int(np.argmin(cols))
xx = np.arange(W)[None, :]
trusted &= ~(np.abs(xx - mid) < 9)
band = cv2.dilate((m > 0.02).astype(np.uint8), np.ones((41, 41), np.uint8)) > 0
for f in sorted(glob.glob(str(TRY / "atlas-*.jpg"))):
    img = cv2.imread(f)
    skin = np.median(img[trusted], 0)
    base = img.copy()
    base[~trusted] = skin
    filled = cv2.inpaint(base, ((~trusted) & band).astype(np.uint8) * 255, 6, cv2.INPAINT_TELEA)
    filled[~band] = skin
    a = cv2.GaussianBlur(trusted.astype(np.float32), (0, 0), 1.2)[..., None]
    out = (img * a + filled * (1 - a)).astype(np.uint8)
    dst = ROOT / "public/tryon/model" / pathlib.Path(f).name.replace("atlas-", "front-")
    cv2.imwrite(str(dst), out, [cv2.IMWRITE_JPEG_QUALITY, 90])
    print(dst.name)

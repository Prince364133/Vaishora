# Side-by-side check of the learned model vs the rule-based extractor on real photos the model never trained on.
#   python scripts/ml/visual_check.py  -> scripts/out/ml/visual-check.jpg
# Rows: photo | classic rules | AI model. Held-out photo palms (hand frame, alpha = hand) get both methods; raw
# photos (whole picture, background included) are model-only, as the rules need a hand mask.
import pathlib
import sys

import cv2
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import synth  # noqa: E402
import train  # noqa: E402

ROOT = synth.ROOT
model = train.load()


def tint(prob, cov):
    a = np.clip(prob, 0, 1) * cov
    bg = np.array([242, 211, 196], np.float32)
    ink = np.array([91, 31, 15], np.float32)
    return (bg * (1 - a[..., None]) + ink * a[..., None]).astype(np.uint8)


def frame_case(path):
    im = synth._read_rgba(path, 1024)
    cov = (im[..., 3] > 128).astype(np.float32)
    rgb = im[..., :3].copy()
    rgb[cov == 0] = 0
    rules = synth.heuristic(rgb, cov > 0)
    ai = train.predict_full(model, rgb) * cov
    show = rgb.copy()
    show[cov == 0] = 255
    return [show, tint(rules, cov), tint(ai, cov)]


def raw_case(path):
    im = cv2.cvtColor(cv2.imread(str(path)), cv2.COLOR_BGR2RGB)
    k = 1024 / max(im.shape[:2])
    im = cv2.resize(im, (int(im.shape[1] * k) // 16 * 16, int(im.shape[0] * k) // 16 * 16), interpolation=cv2.INTER_AREA)
    ai = train.predict_full(model, im)
    blank = np.full_like(im, 255)
    cv2.putText(blank, "rules need a hand mask", (30, im.shape[0] // 2), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (120, 120, 120), 2)
    return [im, blank, tint(ai, np.ones(ai.shape, np.float32))]


cases = []
for d in synth.HOLDOUT_DESIGNS:
    for v in ("", "-stain"):
        p = synth.PHOTO / f"{d}-palm{v}.webp"
        if p.exists():
            cases.append(frame_case(p))
gen = ROOT / "mehndi-3d-tryon" / "mehndi-3d-tryon" / "generated-images"
for name in ("minimal-mandala-stain.jpg", "peacock-trail-stain.jpg", "peacock-trail-paste.jpg"):
    if (gen / name).exists():
        cases.append(raw_case(gen / name))

H = 420
rows = []
for c in cases:
    tiles = [cv2.resize(t, (int(t.shape[1] * H / t.shape[0]), H), interpolation=cv2.INTER_AREA) for t in c]
    rows.append(np.concatenate([np.pad(t, ((4, 4), (4, 4), (0, 0)), constant_values=255) for t in tiles], 1))
W = max(r.shape[1] for r in rows)
rows = [np.pad(r, ((0, 0), (0, W - r.shape[1]), (0, 0)), constant_values=255) for r in rows]
sheet = np.concatenate(rows, 0)
out = ROOT / "scripts" / "out" / "ml" / "visual-check.jpg"
cv2.imwrite(str(out), cv2.cvtColor(sheet, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 85])
print("->", out)

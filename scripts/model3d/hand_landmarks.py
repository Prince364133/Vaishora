# Hand landmarks (MediaPipe, 21 per hand) on the 3D model's own front and back textures, so any design in the
# hand frame can be mapped onto the model (src/lib/photo-import/model-texture.ts). Also writes a per-hand mask
# (R = hand 0, G = hand 1) from the photo outline.
#   python scripts/model3d/hand_landmarks.py   -> public/tryon/model/landmarks.json, public/tryon/model/hands-mask.png
import base64
import json
import pathlib

import cv2
import numpy as np
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
MODEL = ROOT / "public" / "tryon" / "model"
SRC = ROOT / "assets" / "tryon-source"
MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3"
TASK = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"

PAGE = """<html><body><script type="module">
import { FilesetResolver, HandLandmarker } from "%MP%";
window.detect = async (dataUrl, flip) => {
  const vision = await FilesetResolver.forVisionTasks("%MP%/wasm");
  const hl = await HandLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: "%TASK%" }, numHands: 2, runningMode: "IMAGE",
    minHandDetectionConfidence: 0.2, minHandPresenceConfidence: 0.2 });
  const img = new Image(); img.src = dataUrl; await img.decode();
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  const g = c.getContext("2d"); if (flip) { g.translate(c.width, c.height); g.rotate(Math.PI); } g.drawImage(img, 0, 0);
  const r = hl.detect(c);
  return { w: img.width, h: img.height, hands: r.landmarks.map((lm, i) => ({ score: r.handedness[i][0].score, label: r.handedness[i][0].categoryName,
    pts: lm.map(p => flip ? [img.width - p.x * img.width, img.height - p.y * img.height] : [p.x * img.width, p.y * img.height]) })) };
};
window.ready = true;
</script></body></html>""".replace("%MP%", MP).replace("%TASK%", TASK)


def detect(pg, path):
    data = "data:image/jpeg;base64," + base64.b64encode(path.read_bytes()).decode()
    best = None
    for flip in (False, True):  # the photo has the hands hanging down; MediaPipe prefers fingers up
        r = pg.evaluate("([d, f]) => window.detect(d, f)", [data, flip])
        if len(r["hands"]) == 2 and (best is None or sum(h["score"] for h in r["hands"]) > sum(h["score"] for h in best["hands"])):
            best = r
    return best


with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page()
    pg.set_content(PAGE)
    pg.wait_for_function("window.ready === true", timeout=60000)
    out = {}
    for side, f in (("front", MODEL / "front-bare.jpg"), ("back", MODEL / "back-bare.jpg")):
        r = detect(pg, f)
        if not r:
            raise SystemExit(f"two hands not found on {f.name}")
        hands = sorted(r["hands"], key=lambda h: h["pts"][0][0])  # hand 0 = left in the image (by wrist x)
        out[side] = {"width": r["w"], "height": r["h"], "hands": [{"pts": [[round(x, 2), round(y, 2)] for x, y in h["pts"]], "score": round(h["score"], 3)} for h in hands]}
        print(side, [round(h["score"], 2) for h in hands])
    b.close()
(MODEL / "landmarks.json").write_text(json.dumps(out, indent=1))

# per-hand regions of the front photo outline (hand 0 left of the gap between the palms, hand 1 right)
m = cv2.imread(str(SRC / "mask.png"), 0)
H, W = m.shape
binm = (m > 127).astype(np.uint8)
cols = binm[:, W // 2 - 60 : W // 2 + 60].sum(0)
mid = W // 2 - 60 + int(np.argmin(cols))
xx = np.arange(W)[None, :]
r = np.where(xx < mid, m, 0).astype(np.uint8)
g = np.where(xx >= mid, m, 0).astype(np.uint8)
rgba = np.dstack([np.zeros_like(m), g, r, np.full_like(m, 255)])  # BGRA
cv2.imwrite(str(MODEL / "hands-mask.png"), rgba)
print("mask", W, H, "split at", mid)

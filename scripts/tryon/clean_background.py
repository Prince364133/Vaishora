# Clean Photo 3D backdrop: the hands were painted out of the original photo, leaving a smeared brownish hand-shaped
# band in the middle of the silk that shows when the 3D hands turn. Codex repaints the photo area as continuous pink
# silk and rose petals; the result is blended back into public/tryon/background.jpg (original kept in
# scripts/out/tryon-orig/).
#
#   python scripts/tryon/clean_background.py [--reuse]   (--reuse: skip Codex, re-blend the last raw result)

import argparse
import glob
import os
import pathlib
import shutil
import subprocess
import tempfile
import time

import cv2
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
BG = ROOT / "public/tryon/background.jpg"
BAK = ROOT / "scripts/out/tryon-orig"
RAW = ROOT / "scripts/out/shots/bg_codex.png"
ap = argparse.ArgumentParser()
ap.add_argument("--reuse", action="store_true")
args = ap.parse_args()

BAK.mkdir(parents=True, exist_ok=True)
if not (BAK / BG.name).exists():
    shutil.copy(BG, BAK / BG.name)
full = cv2.imread(str(BAK / BG.name))
h, w = full.shape[:2]
# photo area inside bgFrame (-760..2296 × -900..2820 reference px; photo = 0..1536 × 0..1920)
x0, x1 = int(w * 760 / 3056), int(w * (760 + 1536) / 3056)
y0, y1 = int(h * 900 / 3720), int(h * (900 + 1920) / 3720)
crop = full[y0:y1, x0:x1]

PROMPT = """Use your image generation tool to EDIT the attached photo base.png. It is a soft-focus background of pale
pink chiffon silk with cream rose petals. In the middle there is a smeared, darker brownish-pink band shaped like two
forearms and hands that were badly erased. Replace that whole middle band with continuous pale pink silk folds that
flow naturally from the left and right sides, with the same soft lighting, the same shallow depth of field and a few
cream rose petals, so it looks like one clean photograph of silk and petals with no hands, no shadows of hands and
no smears. Keep the left and right edges, the colours and the framing identical (same 4:5 portrait size).

When the image is generated, copy the final image file into the current working directory as out.png and reply with
just its path.
"""

if not args.reuse:
    work = pathlib.Path(tempfile.mkdtemp(prefix="vaishora_bg_"))
    cv2.imwrite(str(work / "base.png"), crop)
    t0 = time.time()
    print("codex → background …", flush=True)
    r = subprocess.run(["codex", "exec", "--skip-git-repo-check", "--sandbox", "workspace-write", "-C", str(work),
                        "-o", str(work / "last.txt"), "-i", "base.png", "-"], input=PROMPT, text=True, cwd=work,
                       capture_output=True, timeout=1800)
    (work / "log.txt").write_text(r.stdout + "\n" + r.stderr)
    out = work / "out.png"
    if not out.exists():
        cands = [p for p in glob.glob(os.path.expanduser("~/.codex/generated_images/*/*.png")) if os.path.getmtime(p) > t0]
        if cands:
            shutil.copy(max(cands, key=os.path.getmtime), out)
    if not out.exists():
        raise SystemExit(f"Codex returned no image; log: {work / 'log.txt'}")
    shutil.copy(out, RAW)
    print(f"saved {RAW.relative_to(ROOT)} ({time.time() - t0:.0f}s)")

new = cv2.resize(cv2.imread(str(RAW)), (x1 - x0, y1 - y0), interpolation=cv2.INTER_AREA)
# colour match to the original crop's edges (left/right strips), so the seam to the padded border is invisible
edge = np.zeros(crop.shape[:2], bool)
edge[:, : crop.shape[1] // 6] = True
edge[:, -crop.shape[1] // 6:] = True
gain = crop[edge].reshape(-1, 3).mean(0) / np.maximum(new[edge].reshape(-1, 3).mean(0), 1)
new = np.clip(new.astype(np.float32) * gain, 0, 255).astype(np.uint8)
# feathered paste: full strength, fading to the original only over the outer 6% at the LEFT and RIGHT (the
# original's top/bottom edges carry the smear too, so the new image runs to the edge there)
fh, fw = crop.shape[:2]
b = int(fw * 0.06)
ramp = np.clip(np.minimum(np.arange(fw), fw - 1 - np.arange(fw)) / b, 0, 1).astype(np.float32)
m = np.tile(ramp, (fh, 1))[..., None]
out = full.copy()
out[y0:y1, x0:x1] = (new * m + crop * (1 - m)).astype(np.uint8)
cv2.imwrite(str(BG), out, [cv2.IMWRITE_JPEG_QUALITY, 92])
cv2.imwrite(str(ROOT / "scripts/out/shots/bg_clean.jpg"), out[y0:y1, x0:x1])
print("background updated")

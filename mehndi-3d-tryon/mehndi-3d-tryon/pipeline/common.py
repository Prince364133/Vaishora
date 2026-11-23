"""Shared paths and helpers for the Mehndi 3D try-on pipeline.

Every stage script imports this module, so all paths are relative to the package
folder and the pipeline runs from anywhere.
"""
import base64
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

try:
    import cv2
    import numpy as np
except ImportError:  # pragma: no cover
    sys.exit("This pipeline needs OpenCV and NumPy:\n    python3 -m pip install -r pipeline/requirements.txt")

ROOT = Path(__file__).resolve().parent.parent
PIPE = ROOT / "pipeline"
TPL = PIPE / "templates"
DATA = ROOT / "data"
S1, S2, S4 = DATA / "stage1", DATA / "stage2", DATA / "stage4"
DESIGNS = DATA / "designs"
GEN = ROOT / "generated-images"
PROMPTS = GEN / "prompts"
REF = ROOT / "reference" / "reference.webp"
REGISTRY = DATA / "designs.json"
CONFIG = DATA / "config.json"
SITE = ROOT / "index.html"

W, H = 1536, 1920           # working canvas = the reference photo's size (px)


def K(r):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def load_json(p, default=None):
    p = Path(p)
    return json.loads(p.read_text()) if p.exists() else default


def save_json(p, obj):
    Path(p).write_text(json.dumps(obj, indent=2) + "\n")


def config():
    return load_json(CONFIG)


def read_canvas(path):
    """Read any photo and resize it to the working canvas."""
    img = cv2.imread(str(path))
    if img is None:
        raise FileNotFoundError(path)
    interp = cv2.INTER_AREA if img.shape[1] > W else cv2.INTER_CUBIC
    return cv2.resize(img, (W, H), interpolation=interp)


# ---------------------------------------------------------------- segmentation
def keep_hands(m, holes=15000):
    """Keep the two biggest blobs (the hands) and fill small holes."""
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    keep = np.zeros_like(m)
    for i in np.argsort(-st[1:, cv2.CC_STAT_AREA])[:2] + 1:
        keep[lab == i] = 255
    inv = 255 - keep
    n, lab, st, _ = cv2.connectedComponentsWithStats(inv)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] < holes:
            keep[lab == i] = 255
    return keep


def segment(img, prior, sure_fg=30, band=70, iters=6):
    """GrabCut the hands, seeded by a rough mask `prior` (0/255)."""
    gc = np.full((H, W), cv2.GC_BGD, np.uint8)
    gc[cv2.dilate(prior, K(band)) > 0] = cv2.GC_PR_BGD
    gc[cv2.dilate(prior, K(12)) > 0] = cv2.GC_PR_FGD
    gc[cv2.erode(prior, K(sure_fg)) > 0] = cv2.GC_FGD
    b, f = np.zeros((1, 65)), np.zeros((1, 65))
    cv2.grabCut(img, gc, None, b, f, iters, cv2.GC_INIT_WITH_MASK)
    m = np.where((gc == 1) | (gc == 3), 255, 0).astype(np.uint8)
    return keep_hands(cv2.morphologyEx(m, cv2.MORPH_OPEN, K(3)))


def iou(a, b):
    a, b = a > 127, b > 127
    return float((a & b).sum() / max(1, (a | b).sum()))


def ecc_align(img, m, target, blurs=(6, 12, 20)):
    """Best affine/euclidean ECC alignment of photo `img` (mask m) onto mask `target`.
    Returns (aligned_img, aligned_mask, iou, method)."""
    best = (iou(m, target), img, m, "none")
    for blur in blurs:
        for motion, name in ((cv2.MOTION_AFFINE, "affine"), (cv2.MOTION_EUCLIDEAN, "euclidean")):
            try:
                w = np.eye(2, 3, dtype=np.float32)
                crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-7)
                a = cv2.GaussianBlur(target.astype(np.float32) / 255, (0, 0), blur)
                b = cv2.GaussianBlur(m.astype(np.float32) / 255, (0, 0), blur)
                _, w = cv2.findTransformECC(a, b, w, motion, crit, None, 5)
            except cv2.error:
                continue
            ia = cv2.warpAffine(img, w, (W, H), flags=cv2.INTER_CUBIC | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT)
            ma = cv2.warpAffine(m, w, (W, H), flags=cv2.INTER_NEAREST | cv2.WARP_INVERSE_MAP)
            if iou(ma, target) > best[0]:
                best = (iou(ma, target), ia, ma, f"{name}/blur{blur}")
    return best[1], best[2], best[0], best[3]


def bleed(img, mask, iters=16):
    """Push hand colours outward past the outline so texture edges never show background."""
    img = img.astype(np.float32).copy()
    m = (mask > 127).astype(np.float32)
    for _ in range(iters):
        num = cv2.blur(img * m[..., None], (5, 5))
        den = cv2.blur(m, (5, 5))
        grow = (cv2.dilate(m, K(2)) > 0) & (m == 0)
        img[grow] = num[grow] / np.maximum(den[grow], 1e-3)[:, None]
        m[grow] = 1
    return img.clip(0, 255).astype(np.uint8)


def data_url(path, mime=None):
    path = Path(path)
    mime = mime or {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}[path.suffix.lower()]
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


# ---------------------------------------------------------------- Codex
CODEX_TAIL = ("\n\nWhen the image is generated, copy the final image file into the current working "
              "directory as out.png and reply with just its path.\n")


def codex_edit(inputs, prompt, out_path, timeout=1500):
    """Ask the Codex CLI (image_generation feature) to edit `inputs[0]` (extra inputs are
    reference images). Saves the result to `out_path` (.png or .jpg)."""
    if not shutil.which("codex"):
        sys.exit("The Codex CLI is not installed. Install it (e.g. `brew install codex`) and run `codex login`.")
    work = Path(tempfile.mkdtemp(prefix="mehndi_codex_"))
    names = []
    for i, p in enumerate(inputs):
        name = "base.png" if i == 0 else ("style.png" if i == 1 else f"ref{i}.png")
        img = cv2.imread(str(p))
        if img is None:
            raise FileNotFoundError(p)
        cv2.imwrite(str(work / name), img)
        names.append(name)
    cmd = ["codex", "exec", "--skip-git-repo-check", "--sandbox", "workspace-write",
           "-C", str(work), "-o", str(work / "last.txt")]
    for n in names:
        cmd += ["-i", n]
    cmd += ["-"]
    t0 = time.time()
    print(f"  · Codex is generating ({', '.join(names)}) — usually 1-3 minutes…", flush=True)
    r = subprocess.run(cmd, input=prompt.strip() + CODEX_TAIL, text=True, cwd=work, capture_output=True, timeout=timeout)
    (work / "log.txt").write_text(r.stdout + "\n" + r.stderr)
    out = work / "out.png"
    if not out.exists():  # fall back to the newest image Codex generated during this run
        cands = [p for p in glob.glob(os.path.expanduser("~/.codex/generated_images/*/*.png")) if os.path.getmtime(p) > t0]
        if cands:
            shutil.copy(max(cands, key=os.path.getmtime), out)
    if not out.exists():
        raise RuntimeError(f"Codex did not return an image. Log: {work / 'log.txt'}")
    img = cv2.imread(str(out))
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_path), img, [cv2.IMWRITE_JPEG_QUALITY, 95] if out_path.suffix.lower() in (".jpg", ".jpeg") else [])
    print(f"  · saved {out_path.relative_to(ROOT) if out_path.is_relative_to(ROOT) else out_path}  ({time.time() - t0:.0f}s)")
    return out_path

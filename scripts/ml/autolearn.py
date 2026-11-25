# Self-improving henna detector: the training worker (docs/HAND_AI_ARCHITECTURE.md §5.3).
#
# Run on a schedule on any machine with Python + PyTorch (this PC or a small server); the website itself never
# trains. Each run:
#   1. downloads the approved, consented photos from the site (GET /api/admin/training-export)
#   2. splits them for good: ~1 in 5 photos (by a hash of the photo id) is a "gold" test photo, never trained on
#   3. if there are at least --min-new new training photos since the last run, fine-tunes the live model on
#      synthetic data + the real photos
#   4. measures the candidate AND the live model on the same test sets (synthetic, the project's held-out photo
#      pair, the gold photos) with ONNX Runtime — the same engine the browser uses
#   5. uploads it (POST /api/admin/ml/models). The site makes it live only if it is better (promotionDecision in
#      src/server/ml.ts) and keeps the old version for one-click roll back.
#
#   python scripts/ml/autolearn.py --base https://your-site [--min-new 20] [--steps 1200] [--force] [--dry-run]
# Auth: ML_WORKER_TOKEN (env, or read from .env.local) — the same secret set on the website.
import argparse
import hashlib
import io
import json
import os
import pathlib
import sys
import time
import types
from urllib.parse import urljoin

import cv2
import numpy as np
import onnxruntime as ort
import requests
import torch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import synth  # noqa: E402
import train  # noqa: E402

OUT = train.OUT
REAL = OUT / "real"  # training photos (photo + label)
GOLD = OUT / "gold"  # held-out test photos
MODELS = OUT / "models"  # local weights per version (fine-tuning starts from these)
STATE = OUT / "autolearn-state.json"
CAND_THRESHOLD = 0.3


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def token() -> str:
    t = os.environ.get("ML_WORKER_TOKEN", "")
    env = synth.ROOT / ".env.local"
    if not t and env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("ML_WORKER_TOKEN="):
                t = line.split("=", 1)[1].strip().strip('"').strip("'")
    if len(t) < 32:
        raise SystemExit("ML_WORKER_TOKEN (32+ chars) is not set")
    return t


def is_gold(source_id: str) -> bool:
    return int(hashlib.sha1(source_id.encode()).hexdigest(), 16) % 5 == 0


def fetch_image(session, base, url) -> np.ndarray:
    r = session.get(urljoin(base + "/", url), timeout=120)
    r.raise_for_status()
    im = cv2.imdecode(np.frombuffer(r.content, np.uint8), cv2.IMREAD_UNCHANGED)
    if im is None:
        raise ValueError(f"not an image: {url}")
    if im.ndim == 2:
        im = cv2.cvtColor(im, cv2.COLOR_GRAY2BGRA)
    if im.shape[2] == 3:
        im = np.dstack([im, np.full(im.shape[:2], 255, np.uint8)])
    return cv2.resize(im, (synth.FRAME, synth.FRAME), interpolation=cv2.INTER_AREA)  # BGRA


def sync_photos(session, base) -> tuple[list[str], list[str]]:
    """Downloads new approved photos; returns (training run ids, gold run ids) currently approved."""
    items = session.get(f"{base}/api/admin/training-export", timeout=120).json()["items"]
    REAL.mkdir(parents=True, exist_ok=True)
    GOLD.mkdir(parents=True, exist_ok=True)
    tr, gd = [], []
    for it in items:
        if not it.get("frame_photo_url") or not it.get("mask_url"):
            continue
        dest = GOLD if is_gold(it["source_id"]) else REAL
        rid = it["run_id"]
        ph, lb = dest / f"{rid}_photo.png", dest / f"{rid}_label.png"
        if not (ph.exists() and lb.exists()):
            photo = fetch_image(session, base, it["frame_photo_url"])
            mask = fetch_image(session, base, it["mask_url"])
            cv2.imwrite(str(ph), photo)
            cv2.imwrite(str(lb), np.where(mask[..., 3] > 127, 255, 0).astype(np.uint8))
        (gd if dest is GOLD else tr).append(rid)
    # photos no longer approved (rejected / consent withdrawn) are removed so they are never trained on again
    keep = set(tr) | set(gd)
    for d in (REAL, GOLD):
        for f in d.glob("*.png"):
            if f.name.split("_")[0] not in keep:
                f.unlink()
    return tr, gd


# ------------------------------------------------------------------ evaluation (ONNX Runtime, like the browser)
def ort_predict(sess: ort.InferenceSession, rgb: np.ndarray) -> np.ndarray:
    h, w = rgb.shape[:2]
    H, W = -(-h // 16) * 16, -(-w // 16) * 16
    x = np.zeros((1, 3, H, W), np.float32)
    x[0, :, :h, :w] = (rgb / 255.0).transpose(2, 0, 1)
    return sess.run(None, {"image": x})[0][0, 0, :h, :w]


def evaluate(sess, thr, gold_pairs) -> dict:
    out = {}
    data, res = train.fixed_eval_set()
    acc = [0.0, 0.0, 0.0]
    for img, lab in data:
        s = train.scores(ort_predict(sess, img), lab, None, thr)
        acc = [a + b for a, b in zip(acc, s)]
    out["synthetic"] = {**train.summarise(acc), "n": len(data)}
    acc = [0.0, 0.0, 0.0]
    held = [p for p in res.pairs if p[2] in synth.HOLDOUT_DESIGNS]
    for photo, lab, _ in held:
        cov = photo[..., 3] > 128
        rgb = photo[..., :3].copy()
        rgb[~cov] = 0
        s = train.scores(ort_predict(sess, rgb) * cov, lab, cov, thr)
        acc = [a + b for a, b in zip(acc, s)]
    out["real_holdout"] = {**train.summarise(acc), "n": len(held)}
    if gold_pairs:
        acc = [0.0, 0.0, 0.0]
        for photo, lab in gold_pairs:
            cov = photo[..., 3] > 128
            rgb = photo[..., :3].copy()
            rgb[~cov] = 0
            s = train.scores(ort_predict(sess, rgb) * cov, lab, cov, thr)
            acc = [a + b for a, b in zip(acc, s)]
        out["real_gold"] = {**train.summarise(acc), "n": len(gold_pairs)}
    return out


def load_gold():
    pairs = []
    for ph in sorted(GOLD.glob("*_photo.png")):
        lb = ph.with_name(ph.name.replace("_photo.png", "_label.png"))
        if lb.exists():
            im = cv2.cvtColor(cv2.imread(str(ph), cv2.IMREAD_UNCHANGED), cv2.COLOR_BGRA2RGBA)
            pairs.append((im, (cv2.imread(str(lb), cv2.IMREAD_GRAYSCALE) > 127).astype(np.float32)))
    return pairs


def export_onnx(ckpt: pathlib.Path) -> bytes:
    model = train.UNet()
    model.load_state_dict(torch.load(ckpt, map_location="cpu"))
    model.eval()
    buf = io.BytesIO()
    torch.onnx.export(model, (torch.rand(1, 3, 256, 256),), buf, input_names=["image"], output_names=["henna"], opset_version=17,
                      dynamic_axes={"image": {2: "h", 3: "w"}, "henna": {2: "h", 3: "w"}}, dynamo=False)
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True, help="site URL, e.g. https://vaishora.example")
    ap.add_argument("--min-new", type=int, default=20, help="new approved training photos needed to retrain")
    ap.add_argument("--steps", type=int, default=1200)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="train and evaluate, but do not upload")
    a = ap.parse_args()
    base = a.base.rstrip("/")
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {token()}"
    state = json.loads(STATE.read_text()) if STATE.exists() else {"trained_runs": []}

    reg = s.get(f"{base}/api/admin/ml/models", timeout=60)
    reg.raise_for_status()
    live = reg.json()["live"]
    log("live model:", live["method"] if live else None)
    tr, gd = sync_photos(s, base)
    new = sorted(set(tr) - set(state["trained_runs"]))
    log(f"approved photos: {len(tr)} training, {len(gd)} gold test; new since last training: {len(new)}")
    if len(new) < a.min_new and not a.force:
        log(f"nothing to do (need {a.min_new} new training photos)")
        return

    # live model: ONNX for evaluation, local weights to fine-tune from (or train from scratch)
    live_bytes = s.get(urljoin(base + "/", live["url"]), timeout=300).content
    live_sess = ort.InferenceSession(live_bytes)
    MODELS.mkdir(parents=True, exist_ok=True)
    init = MODELS / f"v{live['version']}.pt"
    if not init.exists() and live["version"] == 0 and train.CKPT.exists():
        init.write_bytes(train.CKPT.read_bytes())
    steps = a.steps if init.exists() else a.steps * 3
    cand = MODELS / "candidate.pt"
    args = types.SimpleNamespace(steps=steps, batch=12, size=160, workers=4, threads=12, resume=False,
                                 init=str(init) if init.exists() else None, real_dir=str(REAL), lr=6e-4 if init.exists() else 2e-3, out=str(cand))
    log(f"training {steps} steps from {'v' + str(live['version']) if init.exists() else 'scratch'} with {len(tr)} real photos")
    train.train(args)

    onnx_bytes = export_onnx(cand)
    cand_sess = ort.InferenceSession(onnx_bytes)
    gold = load_gold()
    m_live = evaluate(live_sess, float(live["threshold"]), gold)
    m_cand = evaluate(cand_sess, CAND_THRESHOLD, gold)
    log("live     ", json.dumps(m_live))
    log("candidate", json.dumps(m_cand))
    metrics = {"base_version": live["version"], "candidate": m_cand, "live": m_live}
    trained_on = {"real_labels": len(tr), "gold_labels": len(gd), "steps": steps, "base_version": live["version"] if init.exists() else None}
    if a.dry_run:
        log("dry run: not uploading")
        return
    r = s.post(f"{base}/api/admin/ml/models", files={"model": ("henna.onnx", onnx_bytes, "application/octet-stream")},
               data={"metrics": json.dumps(metrics), "trained_on": json.dumps(trained_on), "threshold": str(CAND_THRESHOLD), "working_size": "1024"}, timeout=300)
    log("site:", r.status_code, r.text[:400])
    r.raise_for_status()
    v = r.json()["version"]
    (MODELS / f"v{v}.pt").write_bytes(cand.read_bytes())
    state["trained_runs"] = sorted(set(state["trained_runs"]) | set(tr))
    state["last"] = {"version": v, "status": r.json()["status"], "at": time.strftime("%Y-%m-%d %H:%M")}
    STATE.write_text(json.dumps(state, indent=2))


if __name__ == "__main__":
    main()

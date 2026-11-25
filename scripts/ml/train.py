# Henna segmentation model: a small U-Net trained from scratch on scripts/ml/synth.py data (CPU is enough).
#   python scripts/ml/train.py train  [--steps 6000] [--batch 16]   -> scripts/out/ml/henna-unet.pt
#   python scripts/ml/train.py eval                                  -> metrics vs the rule-based extractor
#   python scripts/ml/train.py export [--version 0]                  -> public/models/ml/henna-unet-v<N>.onnx + henna.json
# No pretrained weights are used, so the model is entirely our own (docs/HAND_AI_ARCHITECTURE.md §5.1).
import argparse
import json
import math
import pathlib
import sys
import time

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import synth  # noqa: E402

ROOT = synth.ROOT
OUT = ROOT / "scripts" / "out" / "ml"
CKPT = OUT / "henna-unet.pt"
STATE = OUT / "henna-unet.state.pt"  # full training state for --resume
PUBLIC = ROOT / "public" / "models" / "ml"
THRESHOLD = 0.3  # model cut-off chosen on the real held-out photos (precision/recall balance); rules keep 0.5


# ------------------------------------------------------------------ model
def block(i, o):
    return nn.Sequential(nn.Conv2d(i, o, 3, padding=1, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True),
                         nn.Conv2d(o, o, 3, padding=1, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True))


class UNet(nn.Module):
    """4-level U-Net, input RGB 0..1 (N,3,H,W) with H,W multiples of 16, output henna probability (N,1,H,W)."""

    def __init__(self, c=(12, 24, 48, 72, 96)):
        super().__init__()
        self.enc = nn.ModuleList([block(3, c[0])] + [block(c[i], c[i + 1]) for i in range(len(c) - 1)])
        self.up = nn.ModuleList([nn.ConvTranspose2d(c[i + 1], c[i], 2, stride=2) for i in reversed(range(len(c) - 1))])
        self.dec = nn.ModuleList([block(2 * c[i], c[i]) for i in reversed(range(len(c) - 1))])
        self.head = nn.Conv2d(c[0], 1, 1)

    def forward(self, x):
        x = (x - 0.5) / 0.25
        skips = []
        for i, e in enumerate(self.enc):
            x = e(x)
            if i < len(self.enc) - 1:
                skips.append(x)
                x = F.max_pool2d(x, 2)
        for up, dec in zip(self.up, self.dec):
            x = up(x)
            x = dec(torch.cat([x, skips.pop()], 1))
        return torch.sigmoid(self.head(x))


# ------------------------------------------------------------------ data
class SynthSet(torch.utils.data.IterableDataset):
    def __init__(self, seed: int, size: int):
        self.seed, self.size = seed, size

    def __iter__(self):
        info = torch.utils.data.get_worker_info()
        wid = info.id if info else 0
        res = synth.Resources()
        rng = np.random.default_rng(self.seed + 1000 * wid + int(time.time()) % 1000)
        while True:
            img, lab = synth.sample(res, rng, self.size)
            yield torch.from_numpy(img).permute(2, 0, 1).float() / 255, torch.from_numpy(lab)[None]


def fixed_eval_set(n=300, size=256, seed=999):
    res = synth.Resources()
    rng = np.random.default_rng(seed)
    return [synth.sample(res, rng, size) for _ in range(n)], res


# ------------------------------------------------------------------ metrics
def scores(pred: np.ndarray, lab: np.ndarray, valid: np.ndarray | None = None, thr: float = 0.5):
    p = pred > thr
    t = lab > 0.5
    if valid is not None:
        p, t = p[valid], t[valid]
    tp = float((p & t).sum())
    fp = float((p & ~t).sum())
    fn = float((~p & t).sum())
    return tp, fp, fn


def summarise(acc):
    tp, fp, fn = acc
    prec = tp / max(1, tp + fp)
    rec = tp / max(1, tp + fn)
    return {"iou": round(tp / max(1, tp + fp + fn), 4), "f1": round(2 * prec * rec / max(1e-9, prec + rec), 4), "precision": round(prec, 4), "recall": round(rec, 4)}


def predict_full(model, rgb: np.ndarray) -> np.ndarray:
    h, w = rgb.shape[:2]
    H, W = math.ceil(h / 16) * 16, math.ceil(w / 16) * 16
    x = np.zeros((H, W, 3), np.float32)
    x[:h, :w] = rgb / 255.0
    with torch.no_grad():
        y = model(torch.from_numpy(x).permute(2, 0, 1)[None])
    return y[0, 0, :h, :w].numpy()


def evaluate(model) -> dict:
    model.eval()
    data, res = fixed_eval_set()
    acc_m = [0.0, 0.0, 0.0]
    acc_h = [0.0, 0.0, 0.0]
    for img, lab in data:
        pm = predict_full(model, img)
        cov = img.sum(-1) > 0
        ph = synth.heuristic(img, cov)
        for acc, p, thr in ((acc_m, pm, THRESHOLD), (acc_h, ph, 0.5)):
            s = scores(p, lab, None, thr)
            for i in range(3):
                acc[i] += s[i]
    out = {"synthetic": {"model": summarise(acc_m), "rule_based": summarise(acc_h), "samples": len(data)}}
    # real held-out pairs (owner's photo palms, silver labels from the bare palm), full 1024 frame
    real_m = [0.0, 0.0, 0.0]
    real_h = [0.0, 0.0, 0.0]
    held = [p for p in res.pairs if p[2] in synth.HOLDOUT_DESIGNS]
    for photo, lab, _ in held:
        cov = photo[..., 3] > 128
        rgb = photo[..., :3].copy()
        rgb[~cov] = 0
        pm = predict_full(model, rgb) * cov
        ph = synth.heuristic(rgb, cov)
        for acc, p, thr in ((real_m, pm, THRESHOLD), (real_h, ph, 0.5)):
            s = scores(p, lab, cov, thr)
            for i in range(3):
                acc[i] += s[i]
    out["real_holdout"] = {"model": summarise(real_m), "rule_based": summarise(real_h), "designs": list(synth.HOLDOUT_DESIGNS), "images": len(held), "labels": "silver (difference to the bare palm)"}
    return out


# ------------------------------------------------------------------ commands
def train(args):
    torch.set_num_threads(args.threads)
    OUT.mkdir(parents=True, exist_ok=True)
    model = UNet()
    print("params", sum(p.numel() for p in model.parameters()))
    dl = torch.utils.data.DataLoader(SynthSet(7, args.size), batch_size=args.batch, num_workers=args.workers, persistent_workers=args.workers > 0)
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3, total_steps=args.steps, pct_start=0.1)
    start = 1
    if args.resume and STATE.exists():
        st = torch.load(STATE, map_location="cpu")
        model.load_state_dict(st["model"])
        opt.load_state_dict(st["opt"])
        sched.load_state_dict(st["sched"])
        start = st["step"] + 1
        print("resumed at step", start, flush=True)
    t0 = time.time()
    it = iter(dl)
    model.train()
    for step in range(start, args.steps + 1):
        x, y = next(it)
        p = model(x)
        bce = F.binary_cross_entropy(p.clamp(1e-6, 1 - 1e-6), y)
        inter = (p * y).sum((2, 3))
        dice = 1 - ((2 * inter + 1) / (p.sum((2, 3)) + y.sum((2, 3)) + 1)).mean()
        loss = bce + 0.5 * dice
        opt.zero_grad()
        loss.backward()
        opt.step()
        sched.step()
        if step % 100 == 0 or step == 1:
            print(f"step {step}/{args.steps} loss {loss.item():.4f} bce {bce.item():.4f} dice {dice.item():.4f} {time.time() - t0:.0f}s", flush=True)
        if step % 250 == 0 or step == args.steps:
            torch.save(model.state_dict(), CKPT)
            torch.save({"model": model.state_dict(), "opt": opt.state_dict(), "sched": sched.state_dict(), "step": step}, STATE)
    print("saved", CKPT)


def load():
    model = UNet()
    model.load_state_dict(torch.load(CKPT, map_location="cpu"))
    model.eval()
    return model


def cmd_eval(_):
    m = evaluate(load())
    (OUT / "metrics.json").write_text(json.dumps(m, indent=2))
    print(json.dumps(m, indent=2))


def export(args):
    model = load()
    PUBLIC.mkdir(parents=True, exist_ok=True)
    name = f"henna-unet-v{args.version}.onnx"
    x = torch.rand(1, 3, 256, 256)
    torch.onnx.export(model, (x,), str(PUBLIC / name), input_names=["image"], output_names=["henna"], opset_version=17,
                      dynamic_axes={"image": {2: "h", 3: "w"}, "henna": {2: "h", 3: "w"}}, dynamo=False)
    metrics = json.loads((OUT / "metrics.json").read_text()) if (OUT / "metrics.json").exists() else None
    manifest = {
        "version": args.version,
        "method": f"unet-v{args.version}",
        "url": f"/models/ml/{name}",
        "input": "RGB 0..1, NCHW, H and W multiples of 16; pixels outside the hand set to 0",
        "workingSize": 1024,
        "threshold": THRESHOLD,
        "trainedOn": "synthetic henna on the project's own bare-skin photos + silver pairs from its own photo palms (no third-party images or weights)",
        "metrics": metrics,
        "created": time.strftime("%Y-%m-%d"),
    }
    (PUBLIC / "henna.json").write_text(json.dumps(manifest, indent=2))
    print("exported", PUBLIC / name, f"{(PUBLIC / name).stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["train", "eval", "export"])
    ap.add_argument("--steps", type=int, default=6000)
    ap.add_argument("--batch", type=int, default=12)
    ap.add_argument("--size", type=int, default=160)
    ap.add_argument("--threads", type=int, default=12)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--version", type=int, default=0)
    ap.add_argument("--resume", action="store_true")
    a = ap.parse_args()
    {"train": train, "eval": cmd_eval, "export": export}[a.cmd](a)

# Back-of-hand photo henna for the Photo 3D viewer (and the sculpted hand), generated with the Codex CLI.
#
#   python scripts/hand-real/back_photos.py [--side back|palm] [--ids trail,royal] [--looks stain,paste] [--force]
#
# --side palm does the same on public/hand/palm.webp (the palm render). It replaces the warped photo palms
# (photo_transfer.py), which carried seam lines at the finger bases and smudged fingertips from stretching a
# fingers-together photo onto the 3D hand. Output <id>-palm-cx[-stain].webp, manifest section "palmCodex".
#
# Why this works without any warping: public/hand/back.webp is a render of the sculpted hand's back that covers
# exactly the back projection frame of src/lib/mehndi/hand-landmarks.json. Codex paints the mehndi ONTO that render
# (same outline, pose and framing), so the result drops straight into the "back_photo" contract:
#   square RGBA, sRGB colour, alpha = hand coverage  →  public/designs/photo/<id>-back[-stain].webp
# Each design's palm photo (mehndi-3d-tryon generated-images) is passed as a style reference, so the back matches
# the palm. Post-process: ECC alignment back onto the render (Codex drifts a few pixels), skin colour matched to the
# render, alpha from the render (eroded + feathered). Manifest: "back" section of src/lib/mehndi/photo-palm.json.
#
# Requires: Codex CLI logged in (`codex login`), python: opencv-python, numpy, pillow.

import argparse
import glob
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import time

import cv2
import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "mehndi-3d-tryon/mehndi-3d-tryon"
OUT = ROOT / "public/designs/photo"
MANIFEST = ROOT / "src/lib/mehndi/photo-palm.json"

ap = argparse.ArgumentParser()
ap.add_argument("--side", choices=["back", "palm"], default="back")
ap.add_argument("--ids", default="trail,royal,bridal,arabic,floral,minimal")
ap.add_argument("--looks", default="stain,paste")
ap.add_argument("--force", action="store_true", help="regenerate even if the raw Codex image exists")
args = ap.parse_args()
BASE = ROOT / f"public/hand/{args.side}.webp"
RAW = ROOT / ("scripts/out/back-photos" if args.side == "back" else "scripts/out/palm-photos")

designs = {d["id"]: d for d in json.loads((SRC / "data/designs.json").read_text())}

LOOK_TEXT = {
    "stain": "as a real, mature dried henna STAIN soaked into the skin, like professional bridal mehndi photographs: "
    "deep rich maroon to dark chocolate-brown (not orange), flat and matte, with natural slight colour variation, "
    "darkest on the fingertips and knuckles, a little lighter towards the wrist",
    "paste": "as FRESH henna PASTE, like professional mehndi artists' photographs: raised dark brown-black paste lines "
    "sitting on top of the skin, slightly 3D with tiny highlights, crisp cone-drawn edges",
}

PROMPT_BACK = """Use your image generation tool to EDIT the attached image base.png. It shows the BACK of a woman's right hand
(knuckles and nails visible) on a plain white background. Paint a professional mehndi design on the back of this hand,
{look}.

Design to match: the attached style.png shows the PALM side of the same person with this design. Create the matching
BACK-of-hand version of the same mehndi style: {style} Use the same motifs, line weight and density as style.png,
composed for the back of the hand: motifs on the back of the hand and wrist, decorated finger bands, and the fingertips
(around the nails, not on the nails) dipped in henna. Nails stay clean and natural pink.

CRITICAL: keep the hand EXACTLY as in base.png: identical outline, pose, finger positions, size and position in the
frame, same camera, same skin tone and soft studio lighting, same plain white background, same 1:1 square framing.
Do not move, resize, crop or re-pose the hand. The hand should read as a real, slender, elegant woman's hand with
natural healthy skin (fine pores, soft knuckle creases), photographed like a professional mehndi portfolio shot:
photorealistic close-up, sharp fine detail, dense crisp linework.

When the image is generated, copy the final image file into the current working directory as out.png and reply with
just its path.
"""

PROMPT_PALM = """Use your image generation tool to EDIT the attached image base.png. It shows the PALM of a woman's right
hand (palm towards the camera, fingers up) on a plain white background. Paint a professional mehndi design on this palm,
{look}.

Design to match: the attached style.png is a photo of the same design on a pair of palms. Recreate THAT design on this
single palm, as faithfully as possible: the same motifs in the same places (palm centre, wrist and forearm, each finger,
fingertips), same line weight and density: {style} Adapt the placement naturally to this hand's palm and finger
positions. Nails are not visible from this side.

CRITICAL: keep the hand EXACTLY as in base.png: identical outline, pose, finger positions, size and position in the
frame, same camera, same skin tone and soft studio lighting, same plain white background, same 1:1 square framing.
Do not move, resize, crop or re-pose the hand. Natural palm lines and fine skin texture should stay visible through the
stain. The hand should read as a real, slender, elegant woman's hand photographed like a professional mehndi portfolio
shot: photorealistic close-up, sharp fine detail, dense crisp linework.

When the image is generated, copy the final image file into the current working directory as out.png and reply with
just its path.
"""
PROMPT = PROMPT_BACK if args.side == "back" else PROMPT_PALM
SECTION = "back" if args.side == "back" else "palmCodex"


def codex_edit(base_png: pathlib.Path, style: pathlib.Path, prompt: str, dst: pathlib.Path) -> None:
    if not shutil.which("codex"):
        raise SystemExit("The Codex CLI is not installed / not on PATH.")
    work = pathlib.Path(tempfile.mkdtemp(prefix="vaishora_back_"))
    shutil.copy(base_png, work / "base.png")
    cv2.imwrite(str(work / "style.png"), cv2.imread(str(style)))
    cmd = ["codex", "exec", "--skip-git-repo-check", "--sandbox", "workspace-write", "-C", str(work),
           "-o", str(work / "last.txt"), "-i", "base.png", "-i", "style.png", "-"]
    t0 = time.time()
    print(f"  codex → {dst.name} …", flush=True)
    r = subprocess.run(cmd, input=prompt, text=True, cwd=work, capture_output=True, timeout=1800)
    (work / "log.txt").write_text(r.stdout + "\n" + r.stderr)
    out = work / "out.png"
    if not out.exists():
        cands = [p for p in glob.glob(os.path.expanduser("~/.codex/generated_images/*/*.png")) if os.path.getmtime(p) > t0]
        if cands:
            shutil.copy(max(cands, key=os.path.getmtime), out)
    if not out.exists():
        raise RuntimeError(f"Codex returned no image; log: {work / 'log.txt'}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(out, dst)
    print(f"  saved {dst.relative_to(ROOT)} ({time.time() - t0:.0f}s)", flush=True)


def load_base():
    rgba = np.asarray(Image.open(BASE).convert("RGBA")).astype(np.float32) / 255.0
    rgb, a = rgba[..., :3], rgba[..., 3]
    on_white = rgb * a[..., None] + (1 - a[..., None])
    return rgb, a, (on_white * 255).astype(np.uint8)


def postprocess(raw: pathlib.Path, base_rgb, base_a, base_white, dst: pathlib.Path) -> float:
    n = base_a.shape[0]
    img = cv2.cvtColor(cv2.imread(str(raw)), cv2.COLOR_BGR2RGB)
    h, w = img.shape[:2]
    if abs(w / h - 1) > 0.02:  # centre-crop to square if Codex changed the aspect
        s = min(w, h)
        img = img[(h - s) // 2:(h - s) // 2 + s, (w - s) // 2:(w - s) // 2 + s]
    img = cv2.resize(img, (n, n), interpolation=cv2.INTER_AREA)

    # Align Codex output onto the render with ECC (affine) on the hand silhouette (white background → mask edges).
    def sil(x):
        g = cv2.cvtColor(x, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
        return cv2.GaussianBlur((g < 0.93).astype(np.float32), (0, 0), 3)
    warp = np.eye(2, 3, dtype=np.float32)
    try:
        _, warp = cv2.findTransformECC(sil(base_white), sil(img), warp, cv2.MOTION_AFFINE,
                                       (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6), None, 5)
    except cv2.error:
        print("  ! ECC did not converge; using the unaligned image")
    img = cv2.warpAffine(img, warp, (n, n), flags=cv2.INTER_LANCZOS4 + cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)

    a_mask = base_a > 0.5
    ov = (sil(img) > 0.5) & a_mask
    overlap = ov.sum() / max(1, a_mask.sum())

    # Skin colour match: scale the photo so its bare-skin median equals the render's skin (3D skin blends seamlessly).
    f = img.astype(np.float32) / 255.0
    sat = (f.max(-1) - f.min(-1)) / np.maximum(f.max(-1), 1e-3)
    skin = a_mask & (sat < 0.42) & (f.max(-1) > 0.45)
    if skin.sum() > 500:
        ratio = np.median(base_rgb[skin], 0) / np.maximum(np.median(f[skin], 0), 1e-3)
        f = np.clip(f * np.clip(ratio, 0.8, 1.25), 0, 1)

    # alpha: render coverage, eroded a little and feathered; also fade out the forearm fade region like the render
    a = cv2.erode((base_a * 255).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32) / 255.0
    a = cv2.GaussianBlur(a, (0, 0), 2.0) * np.clip(base_a * 1.2, 0, 1)
    out = np.dstack([f, a])
    dst.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA").save(dst, "WEBP", quality=92, method=6)
    # check image: photo over the render, cyan outline of the render
    chk = (f * 255).astype(np.uint8).copy()
    cnts, _ = cv2.findContours(a_mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cv2.drawContours(chk, cnts, -1, (0, 220, 255), 2)
    cv2.imwrite(str(RAW / f"{dst.stem}_check.jpg"), cv2.cvtColor(chk, cv2.COLOR_RGB2BGR))
    return float(overlap)


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    base_rgb, base_a, base_white = load_base()
    base_png = RAW / "base.png"
    Image.fromarray(base_white).resize((1024, 1024), Image.LANCZOS).save(base_png)
    man = json.loads(MANIFEST.read_text())
    man.setdefault(SECTION, {})
    for did in [x for x in args.ids.split(",") if x]:
        d = designs[did]
        for look in [x for x in args.looks.split(",") if x]:
            if look == "stain" and not d.get("stain"):
                continue
            style = SRC / "generated-images" / f"{d['photo']}-{look}.jpg"
            raw = RAW / f"{did}-{args.side}-{look}.png"
            if args.force or not raw.exists():
                try:
                    codex_edit(base_png, style, PROMPT.format(look=LOOK_TEXT[look], style=d.get("style", "")), raw)
                except Exception as e:  # keep going with the other designs
                    print(f"  ! {did}/{look}: {e}")
                    continue
            stem = "back" if args.side == "back" else "palm-cx"
            name = f"{did}-{stem}{'-stain' if look == 'stain' else ''}.webp"
            ov = postprocess(raw, base_rgb, base_a, base_white, OUT / name)
            print(f"  {name}: silhouette overlap {ov:.1%}", flush=True)
            man[SECTION][f"{did}-{look}"] = f"/designs/photo/{name}"
            MANIFEST.write_text(json.dumps(man, indent=1) + "\n")


if __name__ == "__main__":
    main()

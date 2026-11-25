# Back-of-hand views for the 3D model built from the Photo 3D photograph.
#
# The 3D model's front IS the photo (assets/tryon-source/atlas-*.jpg). Seen from behind, the same pair of hands appears
# mirrored left-right, so the back texture must fit the MIRRORED photo outline exactly. Codex repaints the mirrored
# bare hands as the backs of the same hands (nails, knuckles) with a back-of-hand mehndi matching the front design;
# the result is aligned onto the mirrored mask (ECC affine on the silhouette) and saved as
# scripts/out/model3d/back-<key>.png (same size/frame as the atlas, already mirrored).
#
#   python scripts/model3d/back_views.py --keys trail_stain [--force]
#   python scripts/model3d/back_views.py --align-only --keys trail_stain   (re-align the last raw Codex image)

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
TRY = ROOT / "assets/tryon-source"  # Photo 3D source photos (mask, height map, design atlases, manifest); not served
OUT = ROOT / "scripts/out/model3d"
OUT.mkdir(parents=True, exist_ok=True)

STYLE = {
    "royal": "dense royal bridal work: mandalas, mesh nets, paisleys and bangles-style bands",
    "bridal": "full bridal: domes, peacocks, mesh fill and finger nets",
    "arabic": "bold Arabic trails of shaded fern leaves and flowers running diagonally",
    "trail": "a large flower on the wrist with a hanging tassel necklace motif, peacock feathers and swirling vines",
    "floral": "roses with leafy vines and fine finger nets",
    "minimal": "light, modern mandala and dotted lines with lots of bare skin",
    "bare": "no design at all",
}
LOOK = {
    "bare": "WITHOUT any mehndi: leave the skin completely clean and bare (ignore the design instructions below)",
    "stain": "as a DRIED STAIN: the paste is removed, the lines are a deep reddish-brown/orange-maroon stain in the skin",
    "paste": "as FRESH PASTE: raised dark brown-green henna paste lines sitting on the skin",
}

PROMPT = """Use your image generation tool to EDIT the attached image base.png. It shows a pair of a woman's forearms and
hands on a plain white background. Repaint them as the BACKS of the same two hands, seen from behind: nails visible on
every fingertip (natural clean pink nails), soft knuckles on the fingers, the back of the hand and the back of the wrist
and forearm, same skin tone and soft studio light. Then paint a professional back-of-hand mehndi design on both hands,
{look}.

Design to match: style.png shows the PALM side of these same hands with the design. Create the matching BACK-of-hand
version of the same style: {style}. Same motifs, line weight, colour and density as style.png, composed for the back:
a main motif on the back of each hand and wrist, a band or chain motif on the forearm, decorated finger bands and the
fingertips around the nails dipped in henna (nails themselves stay clean). Both hands mirror each other.

CRITICAL: keep both hands EXACTLY as in base.png: identical outlines, pose, closed fingers, thumbs, size and position in
the frame, same plain white background, same framing and aspect ratio. Do not move, resize, crop or re-pose anything.
Photorealistic, sharp fine detail, dense crisp linework, like a professional mehndi portfolio photo.

When the image is generated, copy the final image file into the current working directory as out.png and reply with just
its path.
"""


def load_mask():
    m = cv2.imread(str(TRY / "mask.png"), 0).astype(np.float32) / 255
    return m


def base_image(m):
    bare = cv2.imread(str(TRY / "atlas-bare.jpg")).astype(np.float32)
    on_white = bare * m[..., None] + 255 * (1 - m[..., None])
    return cv2.flip(on_white.astype(np.uint8), 1)


def pad_to(img, aspect=2 / 3, fill=255):
    h, w = img.shape[:2]
    W = int(round(h * aspect))
    if W <= w:
        return img, 0
    p = (W - w) // 2
    return cv2.copyMakeBorder(img, 0, 0, p, W - w - p, cv2.BORDER_CONSTANT, value=(fill,) * 3), p


def codex(base_png, style_png, prompt, dst):
    work = pathlib.Path(tempfile.mkdtemp(prefix="vaishora_mback_"))
    shutil.copy(base_png, work / "base.png")
    shutil.copy(style_png, work / "style.png")
    t0 = time.time()
    print(f"codex → {dst.name} …", flush=True)
    r = subprocess.run(["codex", "exec", "--skip-git-repo-check", "--sandbox", "workspace-write", "-C", str(work),
                        "-o", str(work / "last.txt"), "-i", "base.png", "-i", "style.png", "-"],
                       input=prompt, text=True, cwd=work, capture_output=True, timeout=2400)
    (work / "log.txt").write_text(r.stdout + "\n" + r.stderr)
    out = work / "out.png"
    if not out.exists():
        c = [p for p in glob.glob(os.path.expanduser("~/.codex/generated_images/*/*.png")) if os.path.getmtime(p) > t0]
        if c:
            shutil.copy(max(c, key=os.path.getmtime), out)
    if not out.exists():
        raise RuntimeError(f"Codex returned no image; log: {work / 'log.txt'}")
    shutil.copy(out, dst)
    print(f"  saved {dst.name} ({time.time() - t0:.0f}s)", flush=True)


def align(raw_path, m_flip, pad, dst):
    H, W = m_flip.shape
    img = cv2.imread(str(raw_path))
    ph, pw = H, W + 2 * pad
    img = cv2.resize(img, (pw, ph), interpolation=cv2.INTER_AREA)[:, pad:pad + W] if pad else cv2.resize(img, (W, H))
    # silhouette of the Codex image: not-white
    def sil(x):
        f = x.astype(np.float32) / 255
        s = (f.min(-1) < 0.9).astype(np.float32)
        return cv2.GaussianBlur(s, (0, 0), 3)
    warp = np.eye(2, 3, dtype=np.float32)
    try:
        _, warp = cv2.findTransformECC(cv2.GaussianBlur(m_flip, (0, 0), 3), sil(img), warp, cv2.MOTION_AFFINE,
                                       (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-6), None, 5)
    except cv2.error:
        print("  ! ECC did not converge")
    img = cv2.warpAffine(img, warp, (W, H), flags=cv2.INTER_CUBIC | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
    inside = m_flip > 0.5
    ov = ((sil(img) > 0.5) & inside).sum() / inside.sum()
    print(f"  overlap {ov:.3f}")
    # Clean the rim: Codex's white background can sit just inside the outline. Treat near-white pixels near the edge
    # and everything outside the outline as holes and fill them from the skin inside (the 3D rim samples these).
    f = img.astype(np.float32)
    white = (f.min(-1) > 215) & ((f.max(-1) - f.min(-1)) < 30)
    trusted = (m_flip > 0.5) & ~white
    trusted = cv2.erode(trusted.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    band = cv2.dilate((m_flip > 0.02).astype(np.uint8), np.ones((41, 41), np.uint8)) > 0
    hole = (~trusted) & band
    skin = np.median(img[trusted], 0)
    base = img.copy()
    base[~trusted] = skin  # nothing white may feed the fill
    filled = cv2.inpaint(base, hole.astype(np.uint8) * 255, 6, cv2.INPAINT_TELEA)
    filled[~band] = skin
    # same skin colour as the front photo of this design, so the two sides meet without a colour seam
    key = dst.stem.replace("back-", "")
    front = cv2.imread(str(TRY / f"atlas-{key}.jpg"))
    if front is not None:
        def skin_px(im, msk):
            hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
            ok = msk & (hsv[..., 1] < 165) & (hsv[..., 2] > 150)
            return im[ok].reshape(-1, 3).astype(np.float32)
        mf = cv2.erode((cv2.flip(m_flip, 1) > 0.5).astype(np.uint8), np.ones((15, 15), np.uint8)) > 0
        mb = cv2.erode((m_flip > 0.5).astype(np.uint8), np.ones((15, 15), np.uint8)) > 0
        gain = np.median(skin_px(front, mf), 0) / np.maximum(np.median(skin_px(filled, mb), 0), 1)
        filled = np.clip(filled.astype(np.float32) * gain, 0, 255).astype(np.uint8)
        print(f"  skin gain {np.round(gain, 3)}")
    cv2.imwrite(str(dst), filled)
    pub = ROOT / "public/tryon/model"
    pub.mkdir(exist_ok=True)
    cv2.imwrite(str(pub / dst.name.replace(".png", ".jpg")), filled, [cv2.IMWRITE_JPEG_QUALITY, 88])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", nargs="+", default=["trail_stain"])
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--align-only", action="store_true")
    a = ap.parse_args()
    m = load_mask()
    m_flip = cv2.flip(m, 1)
    base, pad = pad_to(base_image(m))
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="vaishora_mbase_"))
    cv2.imwrite(str(tmp / "base.png"), base)
    for key in a.keys:
        did, look = key.split("_") if "_" in key else (key, "bare" if key == "bare" else "paste")
        raw = OUT / f"back-{key}-raw.png"
        if not a.align_only and (a.force or not raw.exists()):
            style = tmp / f"style-{key}.png"
            cv2.imwrite(str(style), pad_to(cv2.imread(str(TRY / f"atlas-{key}.jpg")), fill=230)[0])
            try:
                codex(tmp / "base.png", style, PROMPT.format(look=LOOK[look], style=STYLE[did]), raw)
            except Exception as e:  # keep going with the other designs
                print(f"  ! {key}: {e}")
                continue
        align(raw, m_flip, pad, OUT / f"back-{key}.png")


if __name__ == "__main__":
    main()

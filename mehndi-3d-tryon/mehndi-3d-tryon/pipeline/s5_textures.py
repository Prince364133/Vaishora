"""Stage 5 — line every design photo up with the bare-hands photo and cut the textures.

  python3 pipeline/s5_textures.py            # all designs in data/designs.json + bare hands + background
  python3 pipeline/s5_textures.py royal trail  # only these designs

Input : generated-images/<photo>-paste.jpg / -stain.jpg, data/stage4/bare_aligned.jpg, bare_mask.png, bare_affine.npy
Output: data/designs/<id>/paste_atlas.jpg, stain_atlas.jpg (texture for the 3D mesh), paste_thumb.jpg, stain_thumb.jpg,
        data/designs/<id>/*_check.jpg (outline overlay), data/background.jpg (silk with hands removed, soft extension)
Alignment: GrabCut the hands (seeded by the bare outline) -> best of several ECC affine/euclidean fits
-> optional dense flow; whichever matches the bare outline best (IoU) wins.
"""
import sys
from common import *

TX0, TX1, TY0, TY1, S = 150, 1400, -300, 1940, 0.75
_cache = {}


def bare():
    if not _cache:
        img = cv2.imread(str(S4 / "bare_aligned.jpg")); M = cv2.imread(str(S4 / "bare_mask.png"), 0)
        _cache.update(img=img, M=M, WA=np.load(S4 / "bare_affine.npy"), bled=bleed(img, cv2.erode(M, K(2))))
    return _cache


def align_to_bare(img, label=""):
    """Returns (aligned photo, its hand mask, IoU vs bare outline, method)."""
    B = bare(); M = B["M"]
    cands = [img, cv2.warpAffine(img, B["WA"], (W, H), flags=cv2.INTER_CUBIC | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT)]
    best = None
    for c in cands:
        m = segment(c, M)
        a_img, a_m, score, how = ecc_align(c, m, M)
        if how != "none":
            m2 = segment(a_img, M)
            if iou(m2, M) > 0.9:
                a_m, score = m2, iou(m2, M)
        if best is None or score > best[2]:
            best = (a_img, a_m, score, how)
    a_img, a_m, score, how = best
    sdf = lambda mm: (np.clip(cv2.distanceTransform((mm > 127).astype(np.uint8), cv2.DIST_L2, 5) - cv2.distanceTransform((mm <= 127).astype(np.uint8), cv2.DIST_L2, 5), -80, 80) + 80) / 160 * 255
    flow = cv2.GaussianBlur(cv2.calcOpticalFlowFarneback(sdf(M).astype(np.uint8), sdf(a_m).astype(np.uint8), None, 0.5, 6, 41, 8, 7, 1.5, 0), (0, 0), 5)
    gx, gy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    f_m = cv2.remap(a_m, gx + flow[..., 0], gy + flow[..., 1], cv2.INTER_NEAREST)
    if iou(f_m, M) > score + 0.003:
        a_img = cv2.remap(a_img, gx + flow[..., 0], gy + flow[..., 1], cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
        a_m, score, how = f_m, iou(f_m, M), how + "+flow"
    print(f"  · {label}: matches the 3D hands at IoU {score:.3f} ({how})")
    return a_img, a_m, score, how


def tex_frame(img):
    """Crop to the texture frame; above the photo the forearm fades into (mirrored) bare skin."""
    bl = bare()["bled"]
    top = cv2.flip(bl[:-TY0], 0)
    full = np.vstack([top, img, np.repeat(img[-1:], TY1 - H, 0)]).astype(np.float32)
    base = np.vstack([top, bl, np.repeat(bl[-1:], TY1 - H, 0)]).astype(np.float32)
    w = np.clip((np.arange(full.shape[0]) + TY0 + 10) / 70, 0, 1)[:, None, None]
    crop = (full * w + base * (1 - w))[:, TX0:TX1].clip(0, 255).astype(np.uint8)
    return cv2.resize(crop, (round((TX1 - TX0) * S), round((TY1 - TY0) * S)), interpolation=cv2.INTER_AREA)


def write_look(img, mask, out_dir, look):
    out_dir.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_dir / f"{look}_atlas.jpg"), tex_frame(bleed(img, cv2.erode(mask, K(2)))), [cv2.IMWRITE_JPEG_QUALITY, 86])
    cv2.imwrite(str(out_dir / f"{look}_thumb.jpg"), cv2.resize(img[440:1940, 178:1358], (236, 300), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 82])
    vis = img.copy(); c, _ = cv2.findContours(bare()["M"], cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cv2.drawContours(vis, c, -1, (255, 255, 0), 1)
    cv2.imwrite(str(out_dir / f"{look}_check.jpg"), cv2.resize(vis[1250:1920, 150:1400], None, fx=0.6, fy=0.6), [cv2.IMWRITE_JPEG_QUALITY, 80])


def process_photo(path, design_id, look, min_iou=0.0):
    img, m, score, _ = align_to_bare(read_canvas(path), f"{design_id} {look}")
    if score < min_iou:
        raise ValueError(f"{Path(path).name} only matches the 3D hands at {score:.2f} (need {min_iou:.2f}). "
                         "Use a photo in the same pose as generated-images/bare-hands.jpg, or pass --force.")
    write_look(img, m, DESIGNS / design_id, look)
    return score


def process_bare():
    B = bare(); img, M = B["img"], B["M"]
    write_look(img, M, DESIGNS / "bare", "paste")
    hole = cv2.dilate(M, K(22))
    small = cv2.resize(img, (W // 2, H // 2), interpolation=cv2.INTER_AREA); hs = cv2.resize(hole, (W // 2, H // 2), interpolation=cv2.INTER_NEAREST)
    filled = cv2.resize(cv2.GaussianBlur(cv2.inpaint(small, hs, 18, cv2.INPAINT_TELEA), (0, 0), 3), (W, H), interpolation=cv2.INTER_CUBIC)
    soft = cv2.GaussianBlur(hole.astype(np.float32) / 255, (0, 0), 6)[..., None]
    bg = (img * (1 - soft) + filled * soft).astype(np.uint8)
    PX, PY = 760, 900
    pad = cv2.copyMakeBorder(bg, PY, PY, PX, PX, cv2.BORDER_REFLECT)
    blur = cv2.resize(cv2.GaussianBlur(cv2.resize(pad, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA), (0, 0), 9), (pad.shape[1], pad.shape[0]), interpolation=cv2.INTER_CUBIC)
    inside = np.zeros(pad.shape[:2], np.float32); inside[PY + 40:PY + H - 40, PX + 40:PX + W - 40] = 1
    inside = cv2.GaussianBlur(inside, (0, 0), 45)[..., None]
    o = (pad * inside + blur * (1 - inside)).astype(np.uint8)
    cv2.imwrite(str(DATA / "background.jpg"), cv2.resize(o, (round(o.shape[1] * 0.55), round(o.shape[0] * 0.55)), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 84])
    print("  · bare hands + background done")


def process_design(d):
    process_photo(GEN / f"{d['photo']}-paste.jpg", d["id"], "paste")
    if d.get("stain"):
        process_photo(GEN / f"{d['photo']}-stain.jpg", d["id"], "stain")


if __name__ == "__main__":
    reg = load_json(REGISTRY, [])
    only = set(sys.argv[1:])
    if not only:
        process_bare()
    for d in reg:
        if not only or d["id"] in only:
            process_design(d)
    print("stage 5 done → data/designs/, data/background.jpg")

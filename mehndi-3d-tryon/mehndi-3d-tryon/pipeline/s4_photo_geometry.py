"""Stage 4 — build the 3D hand shape from the bare-hands PHOTO itself.

Input : generated-images/bare-hands.jpg, data/stage1/traced_*.png, right_hand_affine.npy, hand_shape.py
Output: data/stage4/bare_aligned.jpg, bare_mask.png, bare_affine.npy  (photo placed on the 1536x1920 canvas)
        data/stage4/hmap.png (16-bit height in R/G), mask.png (soft cut-out), geo.json, seams_check.jpg, shade_preview.png
Steps
  A. place the photo on the canvas (ECC affine onto the traced outline) and cut the hands out (GrabCut, twice),
     then a clean re-cut that only trusts deep-inside pixels (drops background caught between thumb and index finger)
  B. find the dark seams between touching fingers (darkest vertical line near each predicted finger boundary)
  C. Poisson-inflate the outline (cut at the seams and between the hands) -> rounded fingers, palm, forearm
  D. compress thick parts, cup the palm, add thumb/pinky mounds, feather heights to 0 at the outline
"""
import base64, json
from common import *
from hand_shape import FINGERS

GX0, GX1, GY0, GY1, D = 150, 1400, -700, 1960, 4        # geometry frame (px) and grid cell
TX0, TX1, TY0, TY1, S = 150, 1400, -300, 1940, 0.75     # texture frame (matches the atlases) and scale
EXT = 1100                                              # arm extension above the photo for the solve
HMAX = 220.0


def place_and_cut():
    img = read_canvas(GEN / "bare-hands.jpg")
    traced = cv2.imread(str(S1 / "traced_both.png"), 0)
    m = segment(img, traced)
    w = np.eye(2, 3, dtype=np.float32)
    crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 150, 1e-6)
    a = cv2.GaussianBlur(traced.astype(np.float32) / 255, (0, 0), 8)
    b = cv2.GaussianBlur(m.astype(np.float32) / 255, (0, 0), 8)
    _, w = cv2.findTransformECC(a, b, w, cv2.MOTION_AFFINE, crit, None, 5)
    np.save(S4 / "bare_affine.npy", w)
    bare = cv2.warpAffine(img, w, (W, H), flags=cv2.INTER_CUBIC | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT)
    ma = segment(bare, cv2.warpAffine(m, w, (W, H), flags=cv2.INTER_NEAREST | cv2.WARP_INVERSE_MAP))
    ma = segment(bare, ma)
    # clean re-cut: only deep-inside pixels are certain, so pink pockets near the outline drop out
    gc = np.full((H, W), cv2.GC_BGD, np.uint8)
    gc[cv2.dilate(ma, K(25)) > 0] = cv2.GC_PR_BGD
    gc[ma > 0] = cv2.GC_PR_FGD
    gc[cv2.erode(ma, K(42)) > 0] = cv2.GC_FGD
    bg, fg = np.zeros((1, 65)), np.zeros((1, 65))
    cv2.grabCut(bare, gc, None, bg, fg, 8, cv2.GC_INIT_WITH_MASK)
    M = keep_hands(np.where((gc == 1) | (gc == 3), 255, 0).astype(np.uint8))
    M = cv2.morphologyEx(M, cv2.MORPH_OPEN, K(5))
    cv2.imwrite(str(S4 / "bare_aligned.jpg"), bare, [cv2.IMWRITE_JPEG_QUALITY, 95])
    cv2.imwrite(str(S4 / "bare_mask.png"), M)
    return bare, M


def poisson(inside):
    """Solve  -lap(u) = 1  inside, u = 0 outside (conjugate gradient)."""
    mb = inside.astype(bool)

    def lap(v):
        v = v * mb
        o = 4 * v
        o[1:] -= v[:-1]; o[:-1] -= v[1:]; o[:, 1:] -= v[:, :-1]; o[:, :-1] -= v[:, 1:]
        return o * mb
    b = np.where(mb, float(D * D), 0.0)
    x = np.zeros_like(b); r = b - lap(x); p = r.copy(); rs = (r * r).sum()
    for _ in range(5000):
        Ap = lap(p); al = rs / (p * Ap).sum(); x += al * p; r -= al * Ap; rn = (r * r).sum()
        if rn < 1e-10 * (b * b).sum():
            break
        p = r + (rn / rs) * p; rs = rn
    return x * mb


def build_heights(img, M):
    A = np.load(S1 / "right_hand_affine.npy")
    traced_L = cv2.imread(str(S1 / "traced_L.png"), 0); traced_R = cv2.imread(str(S1 / "traced_R.png"), 0)
    M = cv2.morphologyEx(M, cv2.MORPH_OPEN, K(5))
    cv2.imwrite(str(S4 / "bare_mask.png"), M)   # final outline used by stage 5
    lum = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)[..., 0].astype(np.float32)
    lum_v = cv2.GaussianBlur(lum, (0, 0), sigmaX=1.2, sigmaY=4)   # favour vertical seams over joint creases

    def tf(p, right):
        return np.array(p, np.float64) if not right else A @ np.array([p[0], p[1], 1.0])

    def axis_x(f, y, right):
        B, T = tf(f["B"], right), tf(f["T"], right)
        return B[0] + (y - B[1]) / (T[1] - B[1]) * (T[0] - B[0])

    # B. split the hands where the palms touch, and find the finger seams
    dL = cv2.distanceTransform(255 - traced_L, cv2.DIST_L2, 5); dR = cv2.distanceTransform(255 - traced_R, cv2.DIST_L2, 5)
    handR = dR < dL
    split = np.zeros_like(M); split[(cv2.dilate(handR.astype(np.uint8), K(1)) > 0) & (~handR) & (M > 0)] = 255
    seams = np.zeros_like(M)
    order = ["index", "middle", "ring", "pinky"]
    for right in (False, True):
        for a, b in zip(order[:-1], order[1:]):
            fa, fb = FINGERS[a], FINGERS[b]
            y0 = int(max(fa["web"], fb["web"]) + 8); y1 = int(min(fa["T"][1], fb["T"][1]) + 10)
            if right:
                y0 = int(tf((0, y0), True)[1] + tf((600, 0), True)[1] - tf((0, 0), True)[1]); y1 = y0 + (y1 - int(max(fa["web"], fb["web"]) + 8))
            xs = []
            for y in range(y0, min(y1, H - 1)):
                xb = 0.5 * (axis_x(fa, y, right) + axis_x(fb, y, right))
                lo, hi = int(xb - 16), int(xb + 16)
                row = lum_v[y, lo:hi]; inside = M[y, lo:hi] > 0
                if inside.sum() < 4:
                    xs.append(np.nan); continue
                xs.append(lo + int(np.argmin(np.where(inside, row, row.max() + 1))))
            xs = np.array(xs, np.float64); ys = np.arange(y0, y0 + len(xs)); ok = ~np.isnan(xs)
            if ok.sum() < 10:
                continue
            xs = np.interp(ys, ys[ok], xs[ok])
            if len(xs) > 30:
                xs = cv2.GaussianBlur(xs.reshape(-1, 1), (1, 0), 6).ravel()
            cv2.polylines(seams, [np.stack([xs, ys], 1).astype(np.int32)], False, 255, 2)

    # C. inflate (cut at seams) + a merged version that sets the groove depth
    def to_grid(mask_full):
        ext = np.vstack([np.repeat(mask_full[:1], EXT, 0), mask_full, np.zeros((40, W), mask_full.dtype)])
        crop = ext[:, GX0:GX1]
        return cv2.resize(crop, (crop.shape[1] // D, crop.shape[0] // D), interpolation=cv2.INTER_AREA) > 127
    cut = cv2.bitwise_and(M, cv2.bitwise_not(cv2.bitwise_or(seams, split)))
    merged = cv2.bitwise_and(M, cv2.bitwise_not(split))
    gc_, gm = to_grid(cut), to_grid(merged)
    S0 = 150.0
    hc = S0 * np.log1p(np.sqrt(2 * poisson(gc_)) / S0); hm = S0 * np.log1p(np.sqrt(2 * poisson(gm)) / S0)
    h = np.maximum(hc, 0.42 * hm)
    row0 = (EXT + GY0) // D; nrows = (GY1 - GY0) // D
    h = h[row0:row0 + nrows]; mask_g = gm[row0:row0 + nrows]
    gh, gw = h.shape

    # D. palm shaping per hand, then feather to the outline
    yy, xx = np.mgrid[0:gh, 0:gw].astype(np.float32); X = GX0 + (xx + 0.5) * D; Y = GY0 + (yy + 0.5) * D
    G = lambda cx, cy, sx, sy: np.exp(-(((X - cx) / sx) ** 2 + ((Y - cy) / sy) ** 2) / 2)
    for right in (False, True):
        pc, th, hy, wr = tf((585, 1300), right), tf((405, 1205), right), tf((722, 1235), right), tf((600, 960), right)
        palm = np.clip((Y - wr[1]) / 320, 0, 1); palm = palm * palm * (3 - 2 * palm)
        h *= 1 - 0.2 * palm * G(pc[0], pc[1], 260, 300)
        h -= 20 * G(pc[0], pc[1], 125, 115); h += 16 * G(th[0], th[1], 75, 95) + 10 * G(hy[0], hy[1], 55, 80)
    h = np.where(mask_g, np.maximum(h, 0), 0)
    full = np.vstack([np.repeat(M[:1], EXT, 0), M, np.zeros((40, W), np.uint8)])[:, GX0:GX1]
    dist = cv2.distanceTransform((full > 127).astype(np.uint8), cv2.DIST_L2, 5)
    dist = cv2.resize(dist, (full.shape[1] // D, full.shape[0] // D), interpolation=cv2.INTER_AREA)[row0:row0 + nrows]
    fz = np.clip(dist / 12.0, 0, 1); fz = fz * fz * (3 - 2 * fz)
    h = cv2.GaussianBlur((h * (0.15 + 0.85 * fz)).astype(np.float32), (0, 0), 0.7)

    # outputs
    q = np.clip(h / HMAX * 65535, 0, 65535).astype(np.uint16)
    rgba = np.zeros((gh, gw, 4), np.uint8); rgba[..., 0] = q >> 8; rgba[..., 1] = q & 255; rgba[..., 3] = 255
    cv2.imwrite(str(S4 / "hmap.png"), cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA), [cv2.IMWRITE_PNG_COMPRESSION, 9])
    soft = cv2.GaussianBlur(M, (0, 0), 1.0)
    ext = np.vstack([np.repeat(soft[:1], -TY0, 0), soft, np.zeros((TY1 - H, W), np.uint8)])[:, TX0:TX1]
    cv2.imwrite(str(S4 / "mask.png"), cv2.resize(ext, (round((TX1 - TX0) * S), round((TY1 - TY0) * S)), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_PNG_COMPRESSION, 9])
    save_json(S4 / "geo.json", dict(geo=dict(x0=GX0, x1=GX1, y0=GY0, y1=GY1, d=D, w=gw, h=gh, hmax=HMAX), tex=dict(x0=TX0, x1=TX1, y0=TY0, y1=TY1)))
    vis = img.copy(); vis[seams > 0] = (0, 255, 255); vis[split > 0] = (255, 0, 255)
    cv2.imwrite(str(S4 / "seams_check.jpg"), vis[1380:1920, 150:1400])
    gy_, gx_ = np.gradient(h, D); nz = 1 / np.sqrt(gx_ ** 2 + gy_ ** 2 + 1)
    l = np.array([-0.4, -0.5, 0.77]); l /= np.linalg.norm(l)
    cv2.imwrite(str(S4 / "shade_preview.png"), (np.clip((-gx_ * l[0] - gy_ * l[1] + l[2]) * nz, 0, 1) * mask_g * 255).astype(np.uint8))
    print(f"height grid {gw}x{gh}, max {h.max():.0f}px")


if __name__ == "__main__":
    S4.mkdir(parents=True, exist_ok=True)
    bare, M = place_and_cut()
    build_heights(bare, M)
    print("stage 4 done → data/stage4/ (bare_aligned.jpg, bare_mask.png, hmap.png, mask.png, geo.json)")

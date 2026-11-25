# Synthetic training data for henna segmentation (docs/HAND_AI_ARCHITECTURE.md §5.2).
#
# Every sample = a crop of REAL bare skin (our own photos) + a henna mask we know exactly, stained onto the
# skin with a physically motivated dye model, plus things that are NOT henna (creases, shadows, veins, moles)
# and camera effects. Labels are exact, so the model learns "henna vs everything else" without anyone's
# copyrighted photos. A share of samples are "silver" real pairs: the owner's photo palms minus the matching
# bare palm (same frame), labelled by colour difference.
#
# Sources (all owned by the project): public/designs/photo/bare-palm.webp, public/tryon/{atlas-bare,model/back-bare}.jpg,
# scripts/out/ml/masks/*.png (rasterised procedural designs, scripts/ml/render_svgs.py).
import math
import pathlib

import cv2
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
MASKS = ROOT / "scripts" / "out" / "ml" / "masks"
PHOTO = ROOT / "public" / "designs" / "photo"
FRAME = 1024
HOLDOUT_DESIGNS = ("trail",)  # real pairs kept out of training, used for the real-photo check
PAIR_DESIGNS = ("arabic", "bridal", "floral", "minimal", "royal", "trail")

# Stain colours measured on real henna (fresh orange → day-2 maroon) and paste colours (wet / dry).
STAIN = np.array([[215, 105, 50], [190, 85, 40], [165, 68, 34], [135, 50, 28], [110, 36, 24], [85, 30, 24]], np.float32)
PASTE = np.array([[62, 46, 30], [48, 38, 26], [56, 52, 32], [72, 50, 34]], np.float32)
SKIN_REF = np.array([225, 180, 150], np.float32)


def _read_rgba(path: pathlib.Path, size: int | None = None) -> np.ndarray:
    im = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if im is None:
        raise FileNotFoundError(path)
    if im.ndim == 2:
        im = cv2.cvtColor(im, cv2.COLOR_GRAY2BGRA)
    if im.shape[2] == 3:
        im = np.dstack([im, np.full(im.shape[:2], 255, np.uint8)])
    im = cv2.cvtColor(im, cv2.COLOR_BGRA2RGBA)
    if size:
        im = cv2.resize(im, (size, size), interpolation=cv2.INTER_AREA)
    return im


def silver_label(bare: np.ndarray, target: np.ndarray) -> np.ndarray:
    """Henna in `target` vs the aligned `bare` photo: colour-match globally, then darker-and-redder (0/1)."""
    cov = (bare[..., 3] > 128) & (target[..., 3] > 128)
    b = bare[..., :3].astype(np.float32)
    t = target[..., :3].astype(np.float32)
    keep = cov.copy()
    gain = np.ones(3, np.float32)
    for _ in range(3):  # robust per-channel gain on pixels that look like plain skin in both
        gain = np.array([np.median(t[..., c][keep] / np.maximum(b[..., c][keep], 1)) for c in range(3)], np.float32)
        d = np.abs(t - b * gain).sum(-1)
        keep = cov & (d < np.percentile(d[cov], 55))
    bm = b * gain
    lb = bm @ np.array([0.299, 0.587, 0.114], np.float32)
    lt = t @ np.array([0.299, 0.587, 0.114], np.float32)
    dark = (lb - lt) / np.maximum(lb, 1)
    red_t = (t[..., 0] - t[..., 1]) / (t[..., 0] + 1)
    red_b = (bm[..., 0] - bm[..., 1]) / (bm[..., 0] + 1)
    lab = cov & (((dark > 0.16) & (red_t - red_b > 0.03)) | (dark > 0.4))
    lab = cv2.morphologyEx(lab.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    return lab.astype(np.float32)


class Resources:
    def __init__(self):
        self.skins: list[np.ndarray] = []
        bare = _read_rgba(PHOTO / "bare-palm.webp", FRAME)
        self.skins.append(bare)
        for f in ("tryon/atlas-bare.jpg", "tryon/model/back-bare.jpg"):
            self.skins.append(_read_rgba(ROOT / "public" / f))
        self.masks = [_read_rgba(p)[..., 3] for p in sorted(MASKS.glob("*.png"))]
        if not self.masks:
            raise SystemExit("No masks: run python scripts/ml/render_svgs.py first")
        self.pairs: list[tuple[np.ndarray, np.ndarray, str]] = []  # (photo RGBA, label, design)
        for d in PAIR_DESIGNS:
            for v in ("", "-stain"):
                p = PHOTO / f"{d}-palm{v}.webp"
                if p.exists():
                    t = _read_rgba(p, FRAME)
                    self.pairs.append((t, silver_label(bare, t), d))
        self.train_pairs = [p for p in self.pairs if p[2] not in HOLDOUT_DESIGNS]


# ------------------------------------------------------------------ procedural henna patterns
def _pt(rng, r):
    return (int(rng.uniform(0.1, 0.9) * r), int(rng.uniform(0.1, 0.9) * r))


def draw_patterns(rng: np.random.Generator, r: int) -> np.ndarray:
    """Random mehndi-like motifs at 2x, returned as a soft r×r alpha mask (0..1)."""
    s = 2 * r
    m = np.zeros((s, s), np.uint8)
    lw = lambda: int(max(1, rng.uniform(1.5, 9.0)))  # noqa: E731  (line width at 2x)
    for _ in range(rng.integers(1, 4)):
        kind = rng.choice(["mandala", "vine", "lattice", "bands", "paisley", "dots", "fill", "hatch"], p=[0.2, 0.2, 0.12, 0.12, 0.12, 0.08, 0.06, 0.1])
        if kind == "mandala":
            c = _pt(rng, s)
            R = rng.uniform(0.15, 0.5) * s
            rings = rng.integers(2, 6)
            for k in range(rings):
                rr = R * (k + 1) / rings
                n = int(rng.integers(6, 20))
                w = lw()
                cv2.circle(m, c, int(rr), 255, w, cv2.LINE_AA)
                style = rng.integers(0, 3)
                for j in range(n):
                    a = 2 * math.pi * j / n + k * 0.3
                    px, py = int(c[0] + rr * math.cos(a)), int(c[1] + rr * math.sin(a))
                    if style == 0:
                        cv2.ellipse(m, (px, py), (int(R / rings * 0.45), int(R / rings * 0.2)), math.degrees(a), 0, 360, 255, w, cv2.LINE_AA)
                    elif style == 1:
                        cv2.circle(m, (px, py), max(2, w), 255, -1, cv2.LINE_AA)
                    else:
                        cv2.ellipse(m, (px, py), (int(R / rings * 0.35), int(R / rings * 0.14)), math.degrees(a), 0, 360, 255, -1, cv2.LINE_AA)
            cv2.circle(m, c, int(R / rings * 0.4), 255, -1, cv2.LINE_AA)
        elif kind == "vine":
            p0, p1, p2, p3 = [np.array(_pt(rng, s), np.float32) for _ in range(4)]
            ts = np.linspace(0, 1, 80)[:, None]
            curve = ((1 - ts) ** 3) * p0 + 3 * ((1 - ts) ** 2) * ts * p1 + 3 * (1 - ts) * ts**2 * p2 + ts**3 * p3
            w = lw()
            cv2.polylines(m, [curve.astype(np.int32)], False, 255, w, cv2.LINE_AA)
            for i in range(4, 76, int(rng.integers(6, 14))):
                d = curve[i + 1] - curve[i - 1]
                ang = math.degrees(math.atan2(d[1], d[0])) + (60 if (i // 6) % 2 else -60)
                L = rng.uniform(0.02, 0.06) * s
                off = np.array([math.cos(math.radians(ang)), math.sin(math.radians(ang))]) * L
                fill = -1 if rng.random() < 0.5 else w
                cv2.ellipse(m, tuple((curve[i] + off).astype(int)), (int(L), int(L * 0.4)), ang, 0, 360, 255, fill, cv2.LINE_AA)
        elif kind == "lattice":
            step = rng.uniform(0.04, 0.12) * s
            ang = rng.uniform(0, math.pi)
            w = lw()
            for sign in (1, -1):
                a = ang + sign * math.pi / 4
                dx, dy = math.cos(a), math.sin(a)
                for k in range(-30, 31):
                    o = k * step
                    cx, cy = s / 2 - dy * o, s / 2 + dx * o
                    cv2.line(m, (int(cx - dx * s), int(cy - dy * s)), (int(cx + dx * s), int(cy + dy * s)), 255, w, cv2.LINE_AA)
            if rng.random() < 0.5:  # filled alternate diamonds
                for _ in range(int(rng.integers(5, 25))):
                    q = _pt(rng, s)
                    sz = int(step * 0.35)
                    pts = np.array([[q[0], q[1] - sz], [q[0] + sz, q[1]], [q[0], q[1] + sz], [q[0] - sz, q[1]]], np.int32)
                    cv2.fillPoly(m, [pts], 255, cv2.LINE_AA)
        elif kind == "bands":
            ang = rng.uniform(0, math.pi)
            dx, dy = math.cos(ang), math.sin(ang)
            c = np.array(_pt(rng, s), np.float32)
            gap = rng.uniform(0.02, 0.05) * s
            for k in range(int(rng.integers(2, 6))):
                o = c + np.array([-dy, dx]) * gap * k
                cv2.line(m, tuple((o - np.array([dx, dy]) * s).astype(int)), tuple((o + np.array([dx, dy]) * s).astype(int)), 255, lw(), cv2.LINE_AA)
                if rng.random() < 0.5:
                    for j in range(-30, 30):
                        q = o + np.array([dx, dy]) * j * gap * 0.8 + np.array([-dy, dx]) * gap * 0.5
                        cv2.circle(m, tuple(q.astype(int)), max(2, int(gap * 0.18)), 255, -1, cv2.LINE_AA)
        elif kind == "paisley":
            c = np.array(_pt(rng, s), np.float32)
            L = rng.uniform(0.08, 0.25) * s
            rot = rng.uniform(0, 2 * math.pi)
            t = np.linspace(0, 2 * math.pi, 90)
            x = L * (np.sin(t) * (1 + 0.6 * np.cos(t)) * 0.55)
            y = L * (-np.cos(t))
            x = x + 0.25 * L * (1 - np.cos(t)) ** 1.5 * np.sign(np.sin(t)) * 0.0 + 0.3 * L * np.maximum(0, np.cos(t)) ** 3
            pts = np.stack([x * math.cos(rot) - y * math.sin(rot), x * math.sin(rot) + y * math.cos(rot)], 1) + c
            w = lw()
            cv2.polylines(m, [pts.astype(np.int32)], True, 255, w, cv2.LINE_AA)
            inner = (pts - c) * 0.6 + c
            cv2.polylines(m, [inner.astype(np.int32)], True, 255, max(1, w // 2), cv2.LINE_AA)
        elif kind == "dots":
            for _ in range(int(rng.integers(10, 80))):
                cv2.circle(m, _pt(rng, s), int(rng.uniform(2, 8)), 255, -1, cv2.LINE_AA)
        elif kind == "fill":
            c = np.array(_pt(rng, s), np.float32)
            n = int(rng.integers(6, 12))
            ang = np.sort(rng.uniform(0, 2 * math.pi, n))
            rad = rng.uniform(0.06, 0.2, n) * s
            pts = np.stack([c[0] + rad * np.cos(ang), c[1] + rad * np.sin(ang)], 1).astype(np.int32)
            cv2.fillPoly(m, [pts], 255, cv2.LINE_AA)
        else:  # hatch inside a circle
            c = _pt(rng, s)
            R = int(rng.uniform(0.06, 0.2) * s)
            region = np.zeros_like(m)
            cv2.circle(region, c, R, 255, -1)
            hatch = np.zeros_like(m)
            step = int(rng.uniform(5, 12))
            for k in range(-s, s, step):
                cv2.line(hatch, (k, 0), (k + s, s), 255, max(1, lw() // 2), cv2.LINE_AA)
            m = np.maximum(m, np.minimum(hatch, region))
            cv2.circle(m, c, R, 255, lw(), cv2.LINE_AA)
    return cv2.resize(m, (r, r), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0


# ------------------------------------------------------------------ compositing
def _smooth_field(rng, r, scale, lo, hi):
    g = rng.random((max(2, r // scale), max(2, r // scale))).astype(np.float32)
    f = cv2.resize(g, (r, r), interpolation=cv2.INTER_CUBIC)
    f = (f - f.min()) / max(1e-6, f.max() - f.min())
    return lo + (hi - lo) * f


def _skin_tone(rng, rgb: np.ndarray) -> np.ndarray:
    """Shift a skin crop across the range of Indian skin tones (lighter ↔ much darker), keeping its texture."""
    k = rng.uniform(0.42, 1.12)
    warm = np.array([1.0, rng.uniform(0.9, 1.04), rng.uniform(0.84, 1.06)], np.float32)
    out = rgb * k * warm
    if k < 0.75:  # darker skin: lower contrast, slightly more saturated brown
        mean = out.mean((0, 1), keepdims=True)
        out = mean + (out - mean) * rng.uniform(0.75, 1.0)
    return np.clip(out, 0, 255)


def _negatives(rng, rgb: np.ndarray, r: int) -> np.ndarray:
    """Dark things that are not henna: creases, soft shadows, veins, moles, flushed skin."""
    out = rgb
    if rng.random() < 0.6:  # palm creases / knuckle lines: neutral darkening, thin, soft
        lines = np.zeros((r, r), np.uint8)
        for _ in range(int(rng.integers(1, 7))):
            pts = np.cumsum(rng.normal(0, r * 0.06, (int(rng.integers(3, 8)), 2)), 0) + np.array(_pt(rng, r))
            cv2.polylines(lines, [pts.astype(np.int32)], False, 255, int(rng.integers(1, 3)), cv2.LINE_AA)
        a = cv2.GaussianBlur(lines.astype(np.float32) / 255, (0, 0), rng.uniform(0.6, 1.6)) * rng.uniform(0.15, 0.4)
        tint = np.array([1.0, rng.uniform(0.95, 1.02), rng.uniform(0.95, 1.05)], np.float32)
        out = out * (1 - a[..., None] * (1 - 0.6 * tint))
    if rng.random() < 0.45:  # shadows
        out = out * _smooth_field(rng, r, int(rng.integers(32, 128)), rng.uniform(0.45, 0.85), 1.0)[..., None]
    if rng.random() < 0.25:  # veins (bluish-green, faint)
        v = np.zeros((r, r), np.uint8)
        pts = np.cumsum(rng.normal(0, r * 0.05, (6, 2)), 0) + np.array(_pt(rng, r))
        cv2.polylines(v, [pts.astype(np.int32)], False, 255, int(rng.integers(2, 5)), cv2.LINE_AA)
        a = cv2.GaussianBlur(v.astype(np.float32) / 255, (0, 0), 2.0) * rng.uniform(0.08, 0.2)
        out = out * (1 - a[..., None]) + a[..., None] * np.array([90, 105, 120], np.float32) * (out.mean() / 180)
    if rng.random() < 0.15:  # moles / freckles
        for _ in range(int(rng.integers(1, 4))):
            q = _pt(rng, r)
            mm = np.zeros((r, r), np.float32)
            cv2.circle(mm, q, int(rng.integers(1, 3)), 1.0, -1, cv2.LINE_AA)
            mm = cv2.GaussianBlur(mm, (0, 0), 0.8) * rng.uniform(0.3, 0.6)
            out = out * (1 - mm[..., None]) + mm[..., None] * np.array([95, 70, 55], np.float32)
    if rng.random() < 0.2:  # flushed / reddish skin patches
        f = _smooth_field(rng, r, 64, 0, rng.uniform(0.05, 0.15))
        out = out * (1 - f[..., None]) + f[..., None] * np.array([210, 120, 110], np.float32)
    return out


def stain(rng, rgb: np.ndarray, m: np.ndarray) -> np.ndarray:
    """Applies henna (dye stain or paste) where mask m (0..1) is set."""
    r = m.shape[0]
    grain = _smooth_field(rng, r, 4, 0.85, 1.0) * _smooth_field(rng, r, 48, rng.uniform(0.7, 0.92), 1.0)
    if rng.random() < 0.78:  # dried-off stain: a dye multiplying skin reflectance
        c = STAIN[rng.integers(len(STAIN))] * rng.uniform(0.9, 1.1, 3)
        o = rng.uniform(0.62, 1.0)
        bleed = cv2.GaussianBlur(m, (0, 0), rng.uniform(0.3, 1.2))
        edge = np.clip(m - cv2.GaussianBlur(m, (0, 0), 2.0), 0, 1) * rng.uniform(0, 0.6)  # pooled outlines
        a = np.clip(bleed * o * grain + edge, 0, 1)[..., None]
        factor = np.clip(c / SKIN_REF, 0, 1.0)
        return rgb * (1 - a + a * factor)
    c = PASTE[rng.integers(len(PASTE))] * rng.uniform(0.85, 1.15, 3)  # paste: an opaque raised layer
    a = np.clip(cv2.GaussianBlur(m, (0, 0), 0.5) * rng.uniform(0.85, 1.0), 0, 1)[..., None]
    shade = (rgb.mean(-1, keepdims=True) / 200.0) ** 0.6
    paste = c * shade * (0.9 + 0.2 * grain[..., None])
    hl = np.clip(cv2.GaussianBlur(m, (0, 0), 1.0) - cv2.GaussianBlur(np.roll(m, (1, 1), (0, 1)), (0, 0), 1.0), 0, 1)[..., None] * rng.uniform(0, 120)
    return rgb * (1 - a) + a * paste + hl


def camera(rng, rgb: np.ndarray) -> np.ndarray:
    r = rgb.shape[0]
    out = rgb * _smooth_field(rng, r, int(rng.integers(64, 256)), rng.uniform(0.65, 0.95), rng.uniform(1.0, 1.25))[..., None]
    out = out * rng.uniform(0.92, 1.08, 3)
    out = 255 * np.clip(out / 255, 0, 1) ** rng.uniform(0.8, 1.25)
    if rng.random() < 0.6:
        out = cv2.GaussianBlur(out, (0, 0), rng.uniform(0.3, 1.3))
    out = out + rng.normal(0, rng.uniform(0, 6), out.shape)
    out = np.clip(out, 0, 255).astype(np.uint8)
    if rng.random() < 0.6:
        ok, buf = cv2.imencode(".jpg", cv2.cvtColor(out, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, int(rng.integers(45, 96))])
        out = cv2.cvtColor(cv2.imdecode(buf, cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB)
    return out


def _crop(rng, img: np.ndarray, cs: int, r: int, y=None, x=None):
    h, w = img.shape[:2]
    cs = min(cs, h, w)
    y = rng.integers(0, h - cs + 1) if y is None else y
    x = rng.integers(0, w - cs + 1) if x is None else x
    c = img[y : y + cs, x : x + cs]
    interp = cv2.INTER_AREA if cs > r else cv2.INTER_LINEAR
    return cv2.resize(c, (r, r), interpolation=interp), y, x


def sample(res: Resources, rng: np.random.Generator, r: int = 256) -> tuple[np.ndarray, np.ndarray]:
    """One (image uint8 r×r×3, label float r×r) training pair."""
    cs = int(rng.uniform(0.55, 2.2) * r)  # crop scale → line widths vary like different photo resolutions
    if res.train_pairs and rng.random() < 0.15:  # silver real pair
        photo, lab, _ = res.train_pairs[rng.integers(len(res.train_pairs))]
        for _ in range(10):
            img, y, x = _crop(rng, photo, cs, r)
            if (img[..., 3] > 128).mean() > 0.6:
                break
        lab_c, _, _ = _crop(rng, lab, cs, r, y, x)
        rgb = img[..., :3].astype(np.float32)
        if rng.random() < 0.5:
            rgb = _skin_tone(rng, rgb) * 0 + rgb * rng.uniform(0.6, 1.05)  # mild exposure change only (keep real colours)
        out = camera(rng, rgb)
        lab_c = (lab_c > 0.5).astype(np.float32) * (img[..., 3] > 128)
        out[img[..., 3] < 128] = 0
        return _aug_geo(rng, out, lab_c)

    skin = res.skins[rng.integers(len(res.skins))]
    for _ in range(10):
        img, y, x = _crop(rng, skin, cs, r)
        if (img[..., 3] > 128).mean() > 0.7:
            break
    rgb = _skin_tone(rng, img[..., :3].astype(np.float32))
    u = rng.random()
    if u < 0.08:
        m = np.zeros((r, r), np.float32)  # no henna at all
    elif u < 0.5:
        src = res.masks[rng.integers(len(res.masks))].astype(np.float32) / 255
        ang = rng.uniform(-180, 180)
        sc = rng.uniform(0.7, 1.4)
        M = cv2.getRotationMatrix2D((FRAME / 2, FRAME / 2), ang, sc)
        src = cv2.warpAffine(src, M, (FRAME, FRAME))
        for _ in range(10):  # prefer crops that contain some henna
            m, _, _ = _crop(rng, src, cs, r)
            if m.mean() > 0.02:
                break
    else:
        m = draw_patterns(rng, r)
    rgb = stain(rng, rgb, m)
    rgb = _negatives(rng, rgb, r)
    out = camera(rng, rgb)
    lab = (m > 0.35).astype(np.float32)
    if rng.random() < 0.15:  # hand silhouette edge: outside is black (as in the importer), label 0
        edge = np.zeros((r, r), np.uint8)
        pts = np.array([_pt(rng, r) for _ in range(int(rng.integers(3, 7)))], np.int32)
        cv2.fillPoly(edge, [cv2.convexHull(pts)], 255)
        if edge.mean() > 40:
            out[edge == 0] = 0
            lab[edge == 0] = 0
    return _aug_geo(rng, out, lab)


def _aug_geo(rng, img, lab):
    k = int(rng.integers(0, 4))
    img, lab = np.rot90(img, k), np.rot90(lab, k)
    if rng.random() < 0.5:
        img, lab = img[:, ::-1], lab[:, ::-1]
    return np.ascontiguousarray(img), np.ascontiguousarray(lab)


# ------------------------------------------------------------------ the current rule-based extractor (for comparison)
def heuristic(rgb: np.ndarray, cov: np.ndarray, sensitivity: float = 0.5) -> np.ndarray:
    """NumPy port of extractHenna() in src/lib/photo-import/warp.ts (returns 0..1 strength)."""
    f = rgb.astype(np.float32)
    L = f @ np.array([0.299, 0.587, 0.114], np.float32)
    RG = (f[..., 0] - f[..., 1]) / (f[..., 0] + 1)
    w = rgb.shape[1]
    rad = max(8, round(w / 48))

    def local_mean(v, c):
        k = (2 * rad + 1, 2 * rad + 1)
        s = cv2.boxFilter(v * c, -1, k, normalize=False, borderType=cv2.BORDER_CONSTANT)
        n = cv2.boxFilter(c, -1, k, normalize=False, borderType=cv2.BORDER_CONSTANT)
        return np.where(n > 0, s / np.maximum(n, 1e-6), 0)

    c = cov.astype(np.float32)
    sL = local_mean(L, c)
    skin = c * (L > sL * 0.9)
    sL, sRG = local_mean(L, skin), local_mean(RG, skin)
    dark_need = 0.3 - 0.18 * sensitivity
    red_need = 0.09 - 0.05 * sensitivity

    def sm(e0, e1, x):
        t = np.clip((x - e0) / (e1 - e0), 0, 1)
        return t * t * (3 - 2 * t)

    dl = np.where(sL > 0, (sL - L) / np.maximum(sL, 1e-6), 0)
    dr = RG - sRG
    a = sm(dark_need * 0.7, dark_need * 1.4, dl) * np.maximum(sm(red_need * 0.5, red_need * 1.5, dr), sm(0.5, 0.65, dl))
    return a * c


if __name__ == "__main__":  # preview sheet: python scripts/ml/synth.py
    res = Resources()
    rng = np.random.default_rng(1)
    tiles = []
    for i in range(24):
        img, lab = sample(res, rng, 256)
        lab3 = np.repeat((lab * 255).astype(np.uint8)[..., None], 3, -1)
        tiles.append(np.concatenate([img, lab3], 0))
    rows = [np.concatenate(tiles[i : i + 8], 1) for i in range(0, 24, 8)]
    sheet = np.concatenate(rows, 0)
    out = ROOT / "scripts" / "out" / "ml" / "synth-preview.jpg"
    cv2.imwrite(str(out), cv2.cvtColor(sheet, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 85])
    print("pairs:", len(res.pairs), "train pairs:", len(res.train_pairs), "masks:", len(res.masks), "->", out)

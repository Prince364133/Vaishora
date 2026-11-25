# Closed 3D mesh of the two photographed hands, built from the Photo 3D photograph itself.
#
#   outline  = the photo's exact hand outline (assets/tryon-source/mask.png), split into the two hands
#   depth    = real-hand anatomy (see anatomy()): round fingers, a thin palm with thumb mound, heel pad and hollow, a
#              flatter back of the hand with a knuckle ridge, an oval wrist and forearm. Front and back meet exactly on
#              the outline. (The photo's hmap.png relief is an inflated outline, which made the model look like a balloon.)
#
# Writes public/tryon/model/hands.bin + hands.json: per hand, a front and a back sheet (positions, normals, uv, index).
# Front uv maps the design photo as it is; back uv maps the mirrored back-of-hand image (u = 1 - u_front).
#
#   python scripts/model3d/build_mesh.py [--step 4]

import argparse
import json
import pathlib

import cv2
import numpy as np


def sample(img, ys, xs):
    """bilinear sample of a 2-D float image at (row, col) positions (clamped at the edges)."""
    img = np.asarray(img, np.float64)
    h, w = img.shape
    y = np.clip(np.asarray(ys, np.float64), 0, h - 1)
    x = np.clip(np.asarray(xs, np.float64), 0, w - 1)
    y0 = np.minimum(np.floor(y).astype(int), h - 2)
    x0 = np.minimum(np.floor(x).astype(int), w - 2)
    fy, fx = y - y0, x - x0
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy)
            + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy)


def smooth_closed(c, sigma):
    r = int(3 * sigma) + 1
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    ext = np.vstack([c[-r:], c, c[:r]])
    return np.stack([np.convolve(ext[:, i], k, mode="valid") for i in range(2)], 1)


def delaunay(p, w, h):
    sub = cv2.Subdiv2D((-2, -2, int(w) + 4, int(h) + 4))
    idx = {}
    for i, (x, y) in enumerate(p):
        sub.insert((float(x), float(y)))
    look = {(round(float(x), 3), round(float(y), 3)): i for i, (x, y) in enumerate(p)}
    out = []
    for t in sub.getTriangleList():
        k = [look.get((round(float(t[j]), 3), round(float(t[j + 1]), 3))) for j in (0, 2, 4)]
        if None not in k:
            out.append(k)
    return np.array(out, int)

ROOT = pathlib.Path(__file__).resolve().parents[2]
TRY = ROOT / "assets/tryon-source"  # Photo 3D source photos (mask, height map, design atlases, manifest); not served
DST = ROOT / "public/tryon/model"
DST.mkdir(exist_ok=True)

ap = argparse.ArgumentParser()
ap.add_argument("--step", type=float, default=4.5, help="interior point spacing (atlas px)")
ap.add_argument("--part", type=float, default=0.12, help="half the parting between the hands (scene units)")
ap.add_argument("--rim", type=int, default=61, help="window (atlas px) for the local half-width that rounds the sides")
args = ap.parse_args()

man = json.loads((TRY / "manifest.json").read_text())
T = man["geo"]["tex"]
mask = cv2.imread(str(TRY / "mask.png"), 0).astype(np.float32) / 255
H, W = mask.shape
S = (T["x1"] - T["x0"]) / W  # frame px per atlas px (≈1.333)
U, CX, CY = 0.01, 768, 960

# ---- split the outline into the two hands (they touch around the heel of the palms)
binm = (mask > 0.5).astype(np.uint8)
cols = binm[:, W // 2 - 60: W // 2 + 60].sum(0)
mid = W // 2 - 60 + int(np.argmin(cols))
cut = binm.copy()
cut[:, mid - 1: mid + 2] = 0
n, lab = cv2.connectedComponents(cut)
sizes = [(lab == i).sum() for i in range(1, n)]
hands = sorted(np.argsort(sizes)[-2:] + 1, key=lambda i: np.where(lab == i)[1].mean())
print(f"split at x={mid}, components {n - 1}, sizes {sorted(sizes)[-2:]}")


def laplace(z, tri, fixed, iters, lam=0.5):
    """smooth a per-vertex value over the triangle graph (rim vertices stay put)."""
    e = np.vstack([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]])
    e = np.vstack([e, e[:, ::-1]])
    deg = np.bincount(e[:, 0], minlength=len(z)).astype(np.float64)
    for _ in range(iters):
        acc = np.bincount(e[:, 0], weights=z[e[:, 1]], minlength=len(z))
        nz = z + lam * (acc / np.maximum(deg, 1) - z)
        z = np.where(fixed, z, nz)
    return z


def march(hm8, step):
    """Watertight 2-D triangulation of a filled shape by marching squares on a smooth signed distance field.

    Inside grid nodes are vertices; every grid edge that crosses the outline gets one vertex exactly on the smooth
    contour, shared by the two cells beside it. Each cell becomes the convex polygon of its inside corners and
    crossings, fanned into triangles. Returns points (atlas px), rim flags and triangles.
    """
    hm8 = hm8.copy()
    hm8[:2], hm8[-2:], hm8[:, :2], hm8[:, -2:] = 0, 0, 0, 0  # close the forearm ends at the image border
    din = cv2.distanceTransform(hm8, cv2.DIST_L2, 5)
    dout = cv2.distanceTransform(1 - hm8, cv2.DIST_L2, 5)
    sdf = cv2.GaussianBlur(din - dout, (0, 0), 1.2)
    gx = np.arange(0, W, step)
    gy = np.arange(0, H, step)
    nx, ny = len(gx), len(gy)
    X, Y = np.meshgrid(gx, gy)
    f = sample(sdf, Y.ravel(), X.ravel()).reshape(ny, nx)
    f[np.abs(f) < 0.08] = 0.08  # never exactly on the contour (keeps crossings well defined)
    ins = f > 0
    pts, rim = [], []
    node_id = -np.ones((ny, nx), int)
    yi, xi = np.where(ins)
    node_id[yi, xi] = np.arange(len(yi))
    pts.append(np.stack([X[yi, xi], Y[yi, xi]], 1).astype(np.float64))
    rim.append(np.zeros(len(yi), bool))
    nid = len(yi)

    def crossings(fa, fb, pa, pb, cond):
        t = fa / (fa - fb)
        return pa + (pb - pa) * t[:, None]

    # horizontal edges (j, i)-(j, i+1) and vertical edges (j, i)-(j+1, i)
    hx = ins[:, :-1] != ins[:, 1:]
    jj, ii = np.where(hx)
    pa = np.stack([X[jj, ii], Y[jj, ii]], 1).astype(np.float64)
    pb = np.stack([X[jj, ii + 1], Y[jj, ii + 1]], 1).astype(np.float64)
    hp = crossings(f[jj, ii], f[jj, ii + 1], pa, pb, None)
    h_id = -np.ones((ny, nx - 1), int)
    h_id[jj, ii] = nid + np.arange(len(jj))
    nid += len(jj)
    pts.append(hp)
    rim.append(np.ones(len(jj), bool))
    vx = ins[:-1, :] != ins[1:, :]
    jj, ii = np.where(vx)
    pa = np.stack([X[jj, ii], Y[jj, ii]], 1).astype(np.float64)
    pb = np.stack([X[jj + 1, ii], Y[jj + 1, ii]], 1).astype(np.float64)
    vp = crossings(f[jj, ii], f[jj + 1, ii], pa, pb, None)
    v_id = -np.ones((ny - 1, nx), int)
    v_id[jj, ii] = nid + np.arange(len(jj))
    nid += len(jj)
    pts.append(vp)
    rim.append(np.ones(len(jj), bool))
    P = np.vstack(pts)
    R = np.concatenate(rim)

    tris = []
    for j in range(ny - 1):
        row = ins[j:j + 2]
        cols = np.where(row[:, :-1].any(0) | row[:, 1:].any(0))[0]
        for i in cols:
            # corners in order a(j,i) b(j,i+1) c(j+1,i+1) d(j+1,i); edges ab (h j,i), bc (v j,i+1), cd (h j+1,i), da (v j,i)
            corner = [(j, i), (j, i + 1), (j + 1, i + 1), (j + 1, i)]
            edge = [h_id[j, i], v_id[j, i + 1], h_id[j + 1, i], v_id[j, i]]
            poly = []
            for q in range(4):
                cj, ci = corner[q]
                if ins[cj, ci]:
                    poly.append(node_id[cj, ci])
                if edge[q] >= 0:
                    poly.append(edge[q])
            if len(poly) < 3:
                continue
            if len(poly) == 6 and not (f[j, i] + f[j, i + 1] + f[j + 1, i + 1] + f[j + 1, i] > 0):
                # saddle with an outside centre: two separate corner triangles
                tris.append(poly[0:3])
                tris.append(poly[3:6])
                continue
            for q in range(1, len(poly) - 1):
                tris.append([poly[0], poly[q], poly[q + 1]])
    T = np.array(tris, int)
    # drop degenerate slivers' zero-area triangles
    e1, e2 = P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]]
    a = e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]  # 2-D cross product (np.cross no longer takes 2-D vectors)
    T = T[np.abs(a) > 1e-6]
    # pixel centres → continuous coords (matches the texture / distance sampling below)
    return P + 0.5, R, T


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def anatomy(handmask, allp, d, Rv, q):
    """Front (palm) and back heights (frame px, both positive) shaped like a real hand, not an inflated outline.

    Every part gets an elliptical cross-section whose depth is a fraction of its own half-width (Rv): fingers and the
    thumb are nearly round, the wrist and forearm a rounded oval, and the palm a thin plate (a real palm is about a
    third as thick as it is wide) with a padded heel, a thumb (thenar) mound and a shallow hollow in the middle. The back
    of the hand is flatter than the palm, as on a real hand.
    """
    rows = handmask.sum(1).astype(np.float64)
    ys = np.where(rows > 0)[0]
    tip = ys.max()  # fingertips (the photo's hands hang down)
    palm_row = ys[0] + int(np.argmax(rows[ys[0]:]))
    lo = max(ys[0] + 5, palm_row - 520)
    wrist = lo + int(np.argmin(rows[lo:palm_row - 60]))
    knuck = wrist + 0.63 * (tip - wrist)  # finger roots (hand proportions: palm ≈ 0.63 of wrist → fingertip)
    # which side the thumb is on (the side the outline flares out to below the wrist)
    cols = np.arange(handmask.shape[1])
    cen_w = (handmask[wrist] * cols).sum() / max(rows[wrist], 1)
    band = handmask[int(wrist + 0.25 * (knuck - wrist)): int(wrist + 0.55 * (knuck - wrist))]
    cen_b = (band * cols).sum() / max(band.sum(), 1)
    thumb_dir = 1.0 if cen_b > cen_w else -1.0
    # per-row centre line and half-width
    cen = np.where(rows > 0, (handmask * cols).sum(1) / np.maximum(rows, 1), cen_w)
    cen = cv2.GaussianBlur(cen.reshape(-1, 1), (1, 0), 25).ravel()
    halfw = cv2.GaussianBlur((rows / 2).reshape(-1, 1), (1, 0), 25).ravel()

    y = np.clip(allp[:, 1] - 0.5, 0, len(rows) - 1)
    yi = y.astype(int)
    s = (y - wrist) / (knuck - wrist)  # 0 at the wrist, 1 at the finger roots, < 0 along the forearm
    lat = (allp[:, 0] - 0.5 - cen[yi]) / np.maximum(halfw[yi], 1) * thumb_dir  # + toward the thumb

    fing = 1 - sstep(48, 105, Rv)  # fingers and thumb: thin limbs
    sp = [-0.7, -0.3, 0.0, 0.18, 0.55, 1.0, 1.2]
    rf = np.interp(s, sp, [0.72, 0.66, 0.60, 0.54, 0.42, 0.36, 0.36])  # palm side
    rb = np.interp(s, sp, [0.72, 0.64, 0.56, 0.40, 0.31, 0.28, 0.28])  # back of the hand
    rf = fing * 0.84 + (1 - fing) * rf
    rb = fing * 0.84 + (1 - fing) * rb

    t = np.clip(d / Rv, 0, 1)
    e = np.sqrt(np.clip(2 * t - t * t, 0, None))  # elliptical cross-section, vertical tangent on the outline
    zf = rf * Rv * e
    zb = rb * Rv * e

    broad = 1 - fing
    palm = sstep(0.0, 0.2, s) * (1 - sstep(0.85, 1.05, s)) * broad
    g = lambda v, m, w: np.exp(-0.5 * ((v - m) / w) ** 2)
    # shallow hollow in the middle of the palm, a little toward the little finger
    zf *= 1 - 0.24 * palm * g(s, 0.5, 0.2) * g(lat, -0.1, 0.38) * sstep(0.35, 0.9, t)
    # thumb (thenar) mound at the base of the thumb, and the softer pad on the little-finger side of the heel
    zf += Rv * e * palm * (0.16 * g(s, 0.3, 0.17) * g(lat, 0.55, 0.28) + 0.07 * g(s, 0.35, 0.2) * g(lat, -0.65, 0.25))
    # pads under the finger roots
    zf += Rv * e * broad * 0.06 * g(s, 0.9, 0.07)
    # knuckle ridge across the back where the fingers start
    zb += Rv * e * broad * 0.07 * g(s, 0.97, 0.06)
    print(f"  wrist row {wrist}, finger roots {knuck:.0f}, tips {tip}, thumb side {'+' if thumb_dir > 0 else '-'}x")
    return zf, zb


def build(handmask, xshift):
    # smooth outline: no pixel steps or lumps on the fingertips and the cut between the palms
    hm8 = (cv2.GaussianBlur(handmask.astype(np.float32), (0, 0), 2.5) > 0.5).astype(np.uint8)
    dist = cv2.distanceTransform(hm8, cv2.DIST_L2, 5)  # atlas px
    allp, isb, tri = march(hm8, args.step)

    # heights (frame px)
    X = T["x0"] + allp[:, 0] * S
    Y = T["y0"] + allp[:, 1] * S
    d = sample(dist, allp[:, 1] - 0.5, allp[:, 0] - 0.5) * S
    d[isb] = 0
    # local limb radius: climb the distance field from each vertex to the centre line of ITS limb (thumb, finger,
    # palm, wrist), so every part gets a round cross-section sized to itself (a thin thumb is round, not a flat flap)
    ds = cv2.GaussianBlur(dist, (0, 0), 1.0)
    gy_, gx_ = np.gradient(ds)
    q = allp - 0.5
    for _ in range(90):
        g = np.stack([sample(gx_, q[:, 1], q[:, 0]), sample(gy_, q[:, 1], q[:, 0])], 1)
        n_ = np.linalg.norm(g, axis=1, keepdims=True)
        q = q + np.where(n_ > 0.25, g / np.maximum(n_, 1e-9), 0) * 0.8
    Rv = np.maximum(sample(ds, q[:, 1], q[:, 0]) * S, d + 1e-3)
    zf, zb = anatomy(handmask, allp, d, Rv, q)
    zf[isb] = 0
    zb[isb] = 0
    zf = laplace(zf, tri, isb, 6, 0.45)  # even, creaseless skin
    zb = -laplace(zb, tri, isb, 8, 0.5)

    # welded mesh: front = all points, back = interior points (+ shared boundary)
    n = len(allp)
    inter = np.where(~isb)[0]
    bidx = np.arange(n)
    bidx[inter] = n + np.arange(len(inter))
    P = np.zeros((n + len(inter), 3))
    P[:n, 0] = (X - CX) * U + xshift
    P[:n, 1] = -(Y - CY) * U
    P[:n, 2] = zf * U
    P[n:, 0] = P[inter, 0]
    P[n:, 1] = P[inter, 1]
    P[n:, 2] = zb[inter] * U
    # image y goes down → triangle winding flips; make front face +z
    tf = tri[:, [0, 2, 1]]
    tb = bidx[tri]  # back: opposite winding
    allT = np.vstack([tf, tb])
    N = np.zeros_like(P)
    fn = np.cross(P[allT[:, 1]] - P[allT[:, 0]], P[allT[:, 2]] - P[allT[:, 0]])
    for i in range(3):
        np.add.at(N, allT[:, i], fn)
    N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
    if N[:n][~isb][:, 2].mean() < 0:  # orientation check
        allT = allT[:, [0, 2, 1]]
        tf, tb = tf[:, [0, 2, 1]], tb[:, [0, 2, 1]]
        N = -N

    # uv: rim vertices sample a little inside the outline (avoids the photo's background bleeding into the edge)
    gy, gx = np.gradient(cv2.GaussianBlur(dist, (0, 0), 1.5))
    q = allp.copy()
    dd = d / S
    near = dd < 4.5
    g = np.stack([sample(gx, q[near, 1] - .5, q[near, 0] - .5),
                  sample(gy, q[near, 1] - .5, q[near, 0] - .5)], 1)
    g /= np.linalg.norm(g, axis=1, keepdims=True) + 1e-9
    q[near] += g * (4.5 - dd[near])[:, None]
    uf = np.stack([q[:, 0] / W, 1 - q[:, 1] / H], 1)

    front = dict(pos=P[:n], nor=N[:n], uv=uf, idx=tf)
    # back sheet: its own copy of every vertex (boundary duplicated), mirrored uv
    bmap = np.concatenate([np.where(isb)[0], inter])  # source index into welded P for back sheet vertices
    src = bidx[bmap]
    order = -np.ones(n + len(inter), int)
    order[src] = np.arange(len(src))
    ub = uf[bmap].copy()
    ub[:, 0] = 1 - ub[:, 0]
    back = dict(pos=P[src], nor=N[src], uv=ub, idx=order[tb])
    return front, back, len(tri)


parts, blobs, off = [], [], 0
for hi, comp in enumerate(hands):
    # the photo's palms touch at the heel; a small parting keeps each hand's rounded edge whole (no seam / sliver)
    f, b, nt = build(lab == comp, (-1 if hi == 0 else 1) * args.part)
    for side, m in (("front", f), ("back", b)):
        entry = {"hand": hi, "side": side, "count": int(len(m["pos"])), "tris": int(len(m["idx"]))}
        # compact: float32 positions, int8 normals, uint16 uv (normalized), uint16 indices
        packed = {
            "pos": np.asarray(m["pos"], np.float32),
            "nor": np.clip(np.round(m["nor"] * 127), -127, 127).astype(np.int8),
            "uv": np.round(np.clip(m["uv"], 0, 1) * 65535).astype(np.uint16),
            "idx": np.asarray(m["idx"], np.uint16 if len(m["pos"]) < 65536 else np.uint32),
        }
        entry["idx32"] = packed["idx"].dtype == np.uint32
        for key, a in packed.items():
            b = np.ascontiguousarray(a).ravel().tobytes()
            entry[key] = off
            b += b"\0" * (-len(b) % 4)  # keep every array 4-byte aligned
            blobs.append(b)
            off += len(b)
        parts.append(entry)
    print(f"hand {hi}: {len(f['pos'])} front verts, {nt} tris")

(DST / "hands.bin").write_bytes(b"".join(blobs))
(DST / "hands.json").write_text(json.dumps({"parts": parts, "bytes": off}, indent=1))
print(f"wrote {off / 1e6:.2f} MB")

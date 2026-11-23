"""Convert the Photo 3D relief (mehndi-3d-tryon) into a standalone, solid 3D model (GLB).

Inputs (public/tryon/, extracted from mehndi-3d-tryon/index.html):
  hmap.png   16-bit height map packed in R (high byte) and G (low byte), geometry frame
  mask.png   hand mask in the texture frame (same frame as the photo atlases)
  atlas-bare.jpg  only used to pick the plain skin colour of the underside
Output:
  public/tryon/hands.glb  two primitives:
    "photo"     front surface, UVs into the photo atlases (texture applied at runtime, unchanged)
    "underside" back + side walls, plain skin colour (no texture)

Usage: python scripts/tryon/build_model.py [--step 2]
"""
import argparse
import json
import struct
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
TRY = ROOT / "public" / "tryon"
U, CX, CY = 0.01, 768, 960  # same constants as the original viewer


def load():
    man = json.loads((TRY / "manifest.json").read_text())
    F, T = man["geo"]["geo"], man["geo"]["tex"]
    hm = np.asarray(Image.open(TRY / "hmap.png").convert("RGBA")).astype(np.float64)
    heights = ((hm[..., 0] * 256 + hm[..., 1]) / 65535.0) * F["hmax"]
    mask = np.asarray(Image.open(TRY / "mask.png").convert("L"))
    return F, T, heights, mask


def build(step: int):
    F, T, H, mask = load()
    TW, TH = T["x1"] - T["x0"], T["y1"] - T["y0"]
    mh, mw = mask.shape
    js, is_ = np.arange(0, F["h"], step), np.arange(0, F["w"], step)
    ny, nx = len(js), len(is_)
    px = F["x0"] + (is_ + 0.5) * F["d"]
    py = F["y0"] + (js + 0.5) * F["d"]
    PX, PY = np.meshgrid(px, py)
    h = H[np.ix_(js, is_)]
    u = (PX - T["x0"]) / TW
    v = (PY - T["y0"]) / TH
    mx = np.clip((u * mw).astype(int), 0, mw - 1)
    my = np.clip((v * mh).astype(int), 0, mh - 1)
    inside = (h > 0.15) & (u >= 0) & (u <= 1) & (v >= 0) & (v <= 1) & (mask[my, mx] > 127)

    front = np.stack([(PX - CX) * U, -(PY - CY) * U, h * U], -1)
    # Underside: a gentle mirror of the relief, so the hands have real thickness when turned over.
    back = front.copy()
    back[..., 2] = -(h * 0.45) * U - 0.06
    uv = np.stack([u, 1 - v], -1)

    idx = np.arange(ny * nx).reshape(ny, nx)
    q = inside[:-1, :-1] & inside[1:, :-1] & inside[:-1, 1:] & inside[1:, 1:]
    a, b, c, d = idx[:-1, :-1][q], idx[:-1, 1:][q], idx[1:, :-1][q], idx[1:, 1:][q]
    tri_front = np.stack([np.stack([a, c, b], 1), np.stack([b, c, d], 1)], 1).reshape(-1, 3)

    # boundary edges of the front surface -> side walls
    edges = {}
    for t in tri_front:
        for e in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            k = (min(e), max(e))
            edges[k] = None if k in edges else e  # keep orientation of the only triangle using it
    boundary = [e for e in edges.values() if e is not None]

    # Smooth the outline: the grid gives staircase edges, so relax boundary vertices along the
    # boundary loop (x/y only) for both the front surface and the underside.
    nb = {}
    for e0, e1 in boundary:
        nb.setdefault(e0, set()).add(e1)
        nb.setdefault(e1, set()).add(e0)
    bverts = np.array(list(nb.keys()))
    if len(bverts):
        F2, B2 = front.reshape(-1, 3), back.reshape(-1, 3)
        for _ in range(12):
            avg = np.array([F2[list(nb[k]), :2].mean(0) for k in bverts])
            F2[bverts, :2] = 0.5 * F2[bverts, :2] + 0.5 * avg
        B2[bverts, :2] = F2[bverts, :2]
        # pull the underside rim up towards the front rim so the side wall is a soft rounded edge
        B2[bverts, 2] = 0.5 * (B2[bverts, 2] + F2[bverts, 2])

    # compact the vertex set
    used = np.unique(tri_front)
    remap = -np.ones(ny * nx, dtype=np.int64)
    remap[used] = np.arange(len(used))
    P_f = front.reshape(-1, 3)[used]
    P_b = back.reshape(-1, 3)[used]
    UV = uv.reshape(-1, 2)[used]
    tf = remap[tri_front]

    # underside primitive: back vertices + wall vertices (own copies for crisp edges)
    n = len(used)
    tb = tf[:, ::-1]  # reversed winding faces down
    wall_pos, wall_tri = [], []
    for e0, e1 in boundary:
        i0, i1 = remap[e0], remap[e1]
        base = n + len(wall_pos)
        wall_pos += [P_f[i0], P_f[i1], P_b[i1], P_b[i0]]
        # front edge runs e0->e1 inside its triangle, so the outward wall is (e1, e0, back)
        wall_tri += [[base + 1, base + 0, base + 3], [base + 1, base + 3, base + 2]]
    P_u = np.vstack([P_b, np.array(wall_pos)]) if wall_pos else P_b
    tu = np.vstack([tb, np.array(wall_tri)]) if wall_tri else tb
    return P_f, UV, tf, P_u, tu


def normals(P, T):
    N = np.zeros_like(P)
    fn = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])
    for k in range(3):
        np.add.at(N, T[:, k], fn)
    L = np.linalg.norm(N, axis=1, keepdims=True)
    L[L == 0] = 1
    return N / L


def skin_colour():
    img = np.asarray(Image.open(TRY / "atlas-bare.jpg").convert("RGB")).astype(np.float64) / 255
    mask = np.asarray(Image.open(TRY / "mask.png").convert("L")) > 127
    px = img[mask]
    lum = px.mean(1)
    mid = px[(lum > np.percentile(lum, 30)) & (lum < np.percentile(lum, 70))]
    srgb = np.median(mid, 0)
    lin = np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)
    return [float(x) for x in lin] + [1.0], srgb


def write_glb(path, P_f, UV, tf, P_u, tu, skin_lin):
    N_f, N_u = normals(P_f, tf), normals(P_u, tu)
    blobs, views, accessors = [], [], []

    def add(arr, comp, typ, target, minmax=False):
        data = arr.astype("<f4" if comp == 5126 else "<u4").tobytes()
        off = sum(len(b) for b in blobs)
        pad = (-len(data)) % 4
        blobs.append(data + b"\0" * pad)
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(data), "target": target})
        acc = {"bufferView": len(views) - 1, "componentType": comp, "count": int(arr.shape[0]) if arr.ndim > 1 else int(arr.size), "type": typ}
        if minmax:
            acc["min"], acc["max"] = arr.min(0).tolist(), arr.max(0).tolist()
        accessors.append(acc)
        return len(accessors) - 1

    a_pf = add(P_f, 5126, "VEC3", 34962, True)
    a_nf = add(N_f, 5126, "VEC3", 34962)
    a_uv = add(UV, 5126, "VEC2", 34962)
    a_if = add(tf.reshape(-1), 5125, "SCALAR", 34963)
    a_pu = add(P_u, 5126, "VEC3", 34962, True)
    a_nu = add(N_u, 5126, "VEC3", 34962)
    a_iu = add(tu.reshape(-1), 5125, "SCALAR", 34963)
    gltf = {
        "asset": {"version": "2.0", "generator": "vaishora tryon/build_model.py"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "hands"}],
        "materials": [
            {"name": "photo", "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0, "roughnessFactor": 0.62}},
            {"name": "underside", "pbrMetallicRoughness": {"baseColorFactor": skin_lin, "metallicFactor": 0, "roughnessFactor": 0.62}},
        ],
        "meshes": [{"name": "hands", "primitives": [
            {"attributes": {"POSITION": a_pf, "NORMAL": a_nf, "TEXCOORD_0": a_uv}, "indices": a_if, "material": 0},
            {"attributes": {"POSITION": a_pu, "NORMAL": a_nu}, "indices": a_iu, "material": 1},
        ]}],
        "buffers": [{"byteLength": sum(len(b) for b in blobs)}],
        "bufferViews": views,
        "accessors": accessors,
    }
    j = json.dumps(gltf, separators=(",", ":")).encode()
    j += b" " * ((-len(j)) % 4)
    binb = b"".join(blobs)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(j) + 8 + len(binb))
    out += struct.pack("<II", len(j), 0x4E4F534A) + j + struct.pack("<II", len(binb), 0x004E4942) + binb
    path.write_bytes(out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--step", type=int, default=2, help="grid step (1 = full resolution, 2 = quarter vertices)")
    args = ap.parse_args()
    P_f, UV, tf, P_u, tu = build(args.step)
    lin, srgb = skin_colour()
    out = TRY / "hands.glb"
    write_glb(out, P_f, UV, tf, P_u, tu, lin)
    print(f"{out.relative_to(ROOT)}: front {len(P_f)} verts / {len(tf)} tris, underside {len(P_u)} verts / {len(tu)} tris, "
          f"{out.stat().st_size // 1024} KB, underside colour sRGB {np.round(srgb * 255).astype(int).tolist()}")

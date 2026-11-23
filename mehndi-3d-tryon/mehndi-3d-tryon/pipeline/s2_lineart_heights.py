"""Stage 2a — 3D height map for the first (line-art) version.

Input : hand_shape.py (parametric left hand), data/stage1/right_hand_affine.npy
Output: data/stage2/hand.json (shape + landmarks for the page), hmap.b64 (16-bit height PNG), shade_preview.png
Height = Poisson "inflation" of the palm/forearm outline (solved with conjugate gradient),
compressed so wide parts stay realistic, plus rounded finger tubes, palm hollow and mounds.
"""
import base64, json, time
from common import *
import common
from hand_shape import *
W, H = common.W, common.H
LX0, LX1, LY0, LY1 = 150, 850, -700, 1960      # left-hand frame (px)
D = 4                                          # heightmap downsample
EXT = 500                                      # extra arm above frame for poisson
W = (LX1-LX0)//D; H = (LY1-LY0)//D; He = H + EXT//D
# coordinates of heightmap sample centres in px
def px_grid(h, y0):
    yy, xx = np.mgrid[0:h, 0:W].astype(np.float32)
    return LX0 + (xx+0.5)*D, y0 + (yy+0.5)*D
# ---- palm/forearm polygon poisson (in extended grid)
y0e = LY0 - EXT
poly = palm_poly()
# extend arm polygon further up for the solve
poly2 = []
for (x,y) in poly:
    poly2.append((x, y if y > -900 else y0e-200))
pts = np.array([((x-LX0)/D, (y-y0e)/D) for x,y in poly2], np.float32)
m = np.zeros((He, W), np.uint8)
cv2.fillPoly(m, [np.round(pts*16).astype(np.int32)], 1, shift=4)
mb = m.astype(bool); t=time.time()
def lap(v):
    v = v*mb
    out = 4*v
    out[1:] -= v[:-1]; out[:-1] -= v[1:]; out[:,1:] -= v[:,:-1]; out[:,:-1] -= v[:,1:]
    return out*mb
b = np.where(mb, float(D*D), 0.0)
x = np.zeros_like(b); r = b - lap(x); p = r.copy(); rs = (r*r).sum()
for it in range(4000):
    Ap = lap(p); a = rs/(p*Ap).sum(); x += a*p; r -= a*Ap; rn = (r*r).sum()
    if rn < 1e-10*(b*b).sum(): break
    p = r + (rn/rs)*p; rs = rn
U = (x*mb).astype(np.float32); n = int(mb.sum())
print("cg iters", it)
print("poisson", n, "unknowns", round(time.time()-t,2),"s")
s = np.sqrt(2*U)
S0 = 150.0
hp = S0*np.log1p(s/S0)
hp = hp[EXT//D:]                              # crop to frame
X, Y = px_grid(H, LY0)
def G(cx, cy, sx, sy=None):
    sy = sy or sx
    return np.exp(-(((X-cx)/sx)**2 + ((Y-cy)/sy)**2)/2)
# palm flattening + cupping + mounds
palmf = np.clip((Y-960)/320, 0, 1); palmf = palmf*palmf*(3-2*palmf)
hp = hp*(1-0.22*palmf)
hp -= 22*G(585,1300,125,115)
hp += 20*G(405,1205,75,95) + 12*G(722,1235,55,80)
for nm in ["index","middle","ring","pinky"]:
    bx,_ = FINGERS[nm]["B"]; hp += 9*G(bx,1440,30,26)
hp = np.maximum(hp, 0) * (cv2.resize(m[EXT//D:], (W,H))>0)
# ---- digits (analytic tubes with soft pads)
def smax(a, b, k=8.0):
    h = np.clip(k-np.abs(a-b), 0, None)/k
    return np.maximum(a,b) + h*h*k*0.25
hh = hp.copy()
DIGIT_H = 0.92
def finger_height(nm):
    segs = digit_segs(nm)
    best = np.full(X.shape, -1e9, np.float32); hb = np.zeros(X.shape, np.float32)
    for (Apt, Bpt, rA, rB) in segs:
        ax, ay = Apt; bx, by = Bpt
        dx, dy = bx-ax, by-ay; L = (dx*dx+dy*dy)**0.5; ux, uy = dx/L, dy/L
        t = (X-ax)*ux + (Y-ay)*uy; tc = np.clip(t, 0, L)
        r = rA + (rB-rA)*(tc/L)
        d = np.hypot(X-(ax+ux*tc), Y-(ay+uy*tc))
        q = 1 - d/r
        bt = q > best; best = np.where(bt, q, best)
        hb = np.where(bt, r*np.sqrt(np.clip(1-(d/r)**2,0,1)), hb)
    # finger pads: gentle bulges between creases (along y for fingers)
    if nm != "thumb":
        f = FINGERS[nm]; web, tip = f["web"], f["T"][1]
        fr = np.clip((Y-web)/(tip-web), 0, 1)
        pad = np.where(fr<0.47, np.sin(np.pi*fr/0.47), np.where(fr<0.73, np.sin(np.pi*(fr-0.47)/0.26), np.sin(np.pi*np.clip((fr-0.73)/0.27,0,1)*0.85)))
        hb = hb*(1+0.06*pad)
    return hb*DIGIT_H, best
digit_mask = np.zeros(X.shape, bool)
for nm in ["index","middle","ring","pinky","thumb"]:
    hb, q = finger_height(nm)
    hh = smax(hh, hb, 10.0)
    digit_mask |= q > 0
mask = (cv2.resize(m[EXT//D:], (W,H))>0) | digit_mask
hh = np.where(mask, hh, 0)
hh = cv2.GaussianBlur(hh, (0,0), 0.8)
print("height stats: max", hh.max(), "palm centre", hh[int((1300-LY0)/D), int((585-LX0)/D)], "wrist", hh[int((985-LY0)/D), int((600-LX0)/D)], "forearm y200", hh[int((200-LY0)/D), int((590-LX0)/D)], "middle finger", hh[int((1700-LY0)/D), int((521-LX0)/D)])
# cavity (ambient occlusion-ish): how much lower than neighbourhood
blur = cv2.GaussianBlur(hh, (0,0), 6)
cav = np.clip((blur-hh)/18, 0, 1)
cav[~mask] = 0
HMAX = 220.0
q16 = np.clip(hh/HMAX*65535, 0, 65535).astype(np.uint16)
rgba = np.zeros((H, W, 4), np.uint8)
rgba[...,0] = q16 >> 8; rgba[...,1] = q16 & 255; rgba[...,2] = (cav*255).astype(np.uint8); rgba[...,3] = 255
ok, buf = cv2.imencode(".png", cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA), [cv2.IMWRITE_PNG_COMPRESSION, 9])
b64 = base64.b64encode(buf.tobytes()).decode()
print("heightmap", W, "x", H, "png bytes", len(buf), "b64", len(b64))
# preview shading
gy, gx = np.gradient(hh, D)
nz = 1/np.sqrt(gx*gx+gy*gy+1); l = np.array([-0.4,-0.5,0.77]); l/=np.linalg.norm(l)
shade = np.clip((-gx*l[0]*nz - gy*l[1]*nz + nz*l[2]), 0, 1)
prev = (shade*255*mask).astype(np.uint8); S2.mkdir(parents=True, exist_ok=True); cv2.imwrite(str(S2 / "shade_preview.png"), cv2.resize(prev, (W*2, H*2)))
A = np.load(S1 / "right_hand_affine.npy").tolist()
data = dict(frame=dict(x0=LX0, x1=LX1, y0=LY0, y1=LY1, d=D, w=W, h=H, hmax=HMAX),
    palm=[list(map(float,p)) for p in palm_poly()], fingers=FINGERS, thumb=THUMB,
    palmCenter=PALM_CENTER, wristY=WRIST_Y, A=A,
    forearmL=FOREARM_L, forearmR=FOREARM_R)
json.dump(data, open(S2 / "hand.json", "w"))
open(S2 / "hmap.b64", "w").write(b64)
print("stage 2a done → data/stage2/hand.json, hmap.b64")

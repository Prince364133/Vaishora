"""Stage 1 model: the LEFT hand of the reference photo as a parametric shape
(forearm/palm polygon + tapered finger capsules), in reference pixels (1536x1920).
The right hand is this shape mirrored and turned (see s1_trace_hand.py)."""
import numpy as np, cv2
FOREARM_L = [(-900,376),(-600,380),(-300,384),(0,390),(100,389),(200,391),(300,401),(400,420),(500,437),(600,447),(700,456),(800,462),(900,463),(950,461),(1000,452)]
FOREARM_R = [(-900,805),(-600,800),(-300,795),(0,787),(100,789),(200,788),(300,787),(400,778),(500,770),(600,766),(700,759),(800,752),(900,746),(1000,744),(1050,750),(1100,760),(1150,769),(1200,776),(1300,779),(1400,777),(1450,770),(1480,762)]
# palm polygon (clockwise in image coords): down the right side, along finger bases, up the thumb side
def palm_poly():
    pts = [(x,y) for (y,x) in FOREARM_R]
    pts += [(715,1470),(668,1478),(610,1500),(565,1506),(520,1505),(478,1495),(430,1475),(385,1445),(368,1395),(355,1365),(330,1335),(300,1290),(298,1250),(305,1200),(325,1150),(362,1100),(408,1050),(432,1028)]
    pts += [(x,y) for (y,x) in reversed(FOREARM_L)]
    return pts
# digits: list of segments (A,B,rA,rB); tip end is rounded
FINGERS = {
  "index":  dict(B=(430,1400), T=(432,1843), rB=48, rT=42, web=1470),
  "middle": dict(B=(522,1420), T=(520,1906), rB=45, rT=42, web=1500),
  "ring":   dict(B=(610,1420), T=(609,1869), rB=43, rT=40, web=1495),
  "pinky":  dict(B=(718,1410), T=(716,1736), rB=38, rT=34, web=1470),
}
THUMB = dict(P=[(385,1150),(318,1335),(236,1508)], R=[46,45,42])
PALM_CENTER = (578,1283)
WRIST_Y = 985

def capsule_field(shape, segs):
    """returns (inside-signed 'radius-normalised' value, height) for chain of tapered segments.
    segs: list of (A, B, rA, rB). The end B of last seg is the extreme tip point (rounded)."""
    H, W = shape
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    best = np.full(shape, -1e9, np.float32)  # value: r(t)^2 - d^2 normalised -> use q = 1 - d/r
    hbest = np.zeros(shape, np.float32)
    for (A, B, rA, rB) in segs:
        ax, ay = A; bx, by = B
        dx, dy = bx-ax, by-ay; L = (dx*dx+dy*dy)**0.5
        ux, uy = dx/L, dy/L
        t = ((xx-ax)*ux + (yy-ay)*uy)
        tc = np.clip(t, 0, L)
        r = rA + (rB-rA)*(tc/L)
        cx = ax + ux*tc; cy = ay + uy*tc
        d = np.sqrt((xx-cx)**2 + (yy-cy)**2)
        q = 1 - d/np.maximum(r,1)
        better = q > best
        best = np.where(better, q, best)
        hh = r*np.sqrt(np.clip(1-(d/np.maximum(r,1))**2, 0, 1))
        hbest = np.where(better, hh, hbest)
    return best, hbest

def digit_segs(name):
    if name == "thumb":
        P, R = THUMB["P"], THUMB["R"]
        segs = [(P[0],P[1],R[0],R[1])]
        # last seg: shorten so rounded end reaches the tip point
        ax, ay = P[1]; bx, by = P[2]; L = ((bx-ax)**2+(by-ay)**2)**0.5
        ux, uy = (bx-ax)/L, (by-ay)/L
        segs.append((P[1], (bx-ux*R[2], by-uy*R[2]), R[1], R[2]))
        return segs
    f = FINGERS[name]
    ax, ay = f["B"]; bx, by = f["T"]; L = ((bx-ax)**2+(by-ay)**2)**0.5
    ux, uy = (bx-ax)/L, (by-ay)/L
    return [(f["B"], (bx-ux*f["rT"], by-uy*f["rT"]), f["rB"], f["rT"])]

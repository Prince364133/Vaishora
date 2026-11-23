"""Stage 1b — trace a clean hand shape and fit the right hand.

Input : data/stage1/ref_mask_R.png (+ hand_shape.py, the parametric left hand)
Output: data/stage1/traced_L.png, traced_R.png, traced_both.png,
        right_hand_affine.npy (left px -> right px: mirror + ~4° turn), trace_check.jpg
The right hand is the left shape mirrored, then rotated/moved by ECC alignment onto
the reference's real right-hand mask.
"""
from common import *
from hand_shape import palm_poly, capsule_field, digit_segs


def left_mask():
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.round(np.array(palm_poly(), np.float32) * 16).astype(np.int32)], 255, lineType=cv2.LINE_AA, shift=4)
    for nm in ["index", "middle", "ring", "pinky", "thumb"]:
        q, _ = capsule_field((H, W), digit_segs(nm))
        m[q > 0] = 255
    return (m > 127).astype(np.uint8) * 255


if __name__ == "__main__":
    L = left_mask()
    R_ref = cv2.imread(str(S1 / "ref_mask_R.png"), 0).astype(np.float32) / 255
    c = 818.0  # first guess: mirror about x = 818
    Mm = np.array([[-1, 0, 2 * c], [0, 1, 0]], np.float32)
    Lmir = cv2.warpAffine(L.astype(np.float32) / 255, Mm, (W, H))
    warp = np.eye(2, 3, dtype=np.float32)
    crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6)
    _, warp = cv2.findTransformECC(cv2.GaussianBlur(R_ref, (0, 0), 6), cv2.GaussianBlur(Lmir, (0, 0), 6), warp, cv2.MOTION_EUCLIDEAN, crit, None, 5)
    to3 = lambda a: np.vstack([a, [0, 0, 1]])
    left_to_right = np.linalg.inv(to3(Mm) @ to3(warp))[:2]
    np.save(S1 / "right_hand_affine.npy", left_to_right)
    R = cv2.warpAffine(L, left_to_right.astype(np.float32), (W, H), flags=cv2.INTER_NEAREST)
    cv2.imwrite(str(S1 / "traced_L.png"), L)
    cv2.imwrite(str(S1 / "traced_R.png"), R)
    cv2.imwrite(str(S1 / "traced_both.png"), cv2.bitwise_or(L, R))
    vis = read_canvas(REF)
    cnts, _ = cv2.findContours(cv2.bitwise_or(L, R), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cv2.drawContours(vis, cnts, -1, (255, 255, 0), 2)
    cv2.imwrite(str(S1 / "trace_check.jpg"), cv2.resize(vis, (768, 960)))
    print("right hand turn: %.2f°" % np.degrees(np.arctan2(warp[1, 0], warp[0, 0])),
          "| IoU right:", round(iou(R, (R_ref * 255).astype(np.uint8)), 3))
    print("stage 1b done → data/stage1/traced_*.png, right_hand_affine.npy")

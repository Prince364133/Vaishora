"""Stage 1a — cut both hands out of the reference photo (GrabCut).

Input : reference/reference.webp
Output: data/stage1/ref_mask_L.png, ref_mask_R.png, segmentation_check.jpg
Rough hand outlines (read off a pixel grid of the photo) seed GrabCut, which then
finds the real skin/henna edges against the pink silk.
"""
from common import *

LEFT = [(385, 0), (790, 0), (790, 300), (775, 500), (765, 700), (752, 900), (752, 1000), (770, 1150), (778, 1300), (770, 1420),
        (762, 1500), (752, 1600), (745, 1700), (710, 1735), (675, 1700), (665, 1500), (660, 1700), (655, 1850), (615, 1880),
        (570, 1850), (570, 1520), (565, 1880), (520, 1910), (480, 1880), (478, 1520), (490, 1700), (470, 1840), (430, 1845),
        (390, 1800), (380, 1600), (380, 1430), (330, 1470), (260, 1515), (210, 1505), (215, 1460), (260, 1380), (300, 1290),
        (300, 1200), (330, 1130), (400, 1060), (455, 990), (455, 700), (435, 500), (400, 300)]
RIGHT = [(855, 0), (1255, 0), (1250, 300), (1225, 500), (1180, 700), (1130, 900), (1125, 1000), (1165, 1060), (1240, 1150),
         (1260, 1250), (1290, 1330), (1310, 1430), (1325, 1530), (1290, 1545), (1230, 1480), (1200, 1420), (1170, 1400),
         (1160, 1500), (1150, 1700), (1140, 1820), (1105, 1855), (1070, 1830), (1065, 1550), (1060, 1880), (1020, 1910),
         (980, 1890), (975, 1550), (970, 1850), (935, 1880), (895, 1860), (885, 1560), (880, 1700), (845, 1725), (805, 1700),
         (795, 1600), (790, 1450), (785, 1300), (790, 1150), (820, 1000), (838, 900), (845, 700), (850, 500), (855, 300)]


def grabcut_hand(img, poly):
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.array(poly, np.int32)], 255)
    gc = np.full((H, W), cv2.GC_BGD, np.uint8)
    gc[cv2.dilate(m, K(45)) > 0] = cv2.GC_PR_BGD
    gc[m > 0] = cv2.GC_PR_FGD
    gc[cv2.erode(m, K(28)) > 0] = cv2.GC_FGD
    b, f = np.zeros((1, 65)), np.zeros((1, 65))
    cv2.grabCut(img, gc, None, b, f, 6, cv2.GC_INIT_WITH_MASK)
    out = np.where((gc == 1) | (gc == 3), 255, 0).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(out)
    out = np.where(lab == 1 + np.argmax(st[1:, cv2.CC_STAT_AREA]), 255, 0).astype(np.uint8)
    inv = 255 - out
    n, lab, st, _ = cv2.connectedComponentsWithStats(inv)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] < 20000:
            out[lab == i] = 255
    return out


if __name__ == "__main__":
    S1.mkdir(parents=True, exist_ok=True)
    img = read_canvas(REF)
    mL, mR = grabcut_hand(img, LEFT), grabcut_hand(img, RIGHT)
    cv2.imwrite(str(S1 / "ref_mask_L.png"), mL)
    cv2.imwrite(str(S1 / "ref_mask_R.png"), mR)
    vis = img.copy()
    cnts, _ = cv2.findContours(cv2.bitwise_or(mL, mR), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cv2.drawContours(vis, cnts, -1, (255, 255, 0), 3)
    cv2.imwrite(str(S1 / "segmentation_check.jpg"), cv2.resize(vis, (768, 960)))
    print("stage 1a done → data/stage1/ref_mask_L.png, ref_mask_R.png")

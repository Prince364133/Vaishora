# Renders one artwork over the hand silhouette at large size for line-quality QA.
#   python scripts/hand-real/art_zoom.py <design.svg> <palm|back> <out.png> [x0 y0 size]
import sys, pathlib
from playwright.sync_api import sync_playwright
svg, side, out = sys.argv[1], sys.argv[2], sys.argv[3]
x0, y0, sz = (int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6])) if len(sys.argv) > 6 else (0, 0, 1000)
sil = pathlib.Path(f"scripts/out/silhouette-{side}.path.txt").read_text()
art = pathlib.Path(svg).read_text().split(">", 1)[1].rsplit("</svg>", 1)[0].replace('fill="#ffffff"', 'fill="#5b1f0f"').replace('color="#ffffff"', 'color="#5b1f0f"')
html = f"<html><body style='margin:0'><svg xmlns='http://www.w3.org/2000/svg' viewBox='{x0} {y0} {sz} {sz}' width='1000' height='1000'><path d='{sil}' fill='#d9a07f' stroke='#d9a07f' stroke-width='1'/>{art}</svg></body></html>"
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1000, "height": 1000})
    pg.set_content(html); pg.wait_for_timeout(500); pg.screenshot(path=out); b.close()

# Rasterises the procedural design SVGs (assets/ml-source/designs/*.svg, white on transparent, 0..1000 hand frame) into
# 1024 px alpha masks for synthetic training data.
#   python scripts/ml/render_svgs.py            -> scripts/out/ml/masks/<name>.png (alpha = henna strength)
import pathlib

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "assets" / "ml-source" / "designs"  # procedural design SVGs used as training masks
OUT = ROOT / "scripts" / "out" / "ml" / "masks"
OUT.mkdir(parents=True, exist_ok=True)
SIZE = 1024

svgs = sorted(p for p in SRC.glob("*.svg") if "feet" not in p.name)
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": SIZE, "height": SIZE})
    for f in svgs:
        svg = f.read_text(encoding="utf-8").replace('width="1000" height="1000"', f'width="{SIZE}" height="{SIZE}"', 1)
        pg.set_content(f"<html><body style='margin:0;background:transparent'>{svg}</body></html>")
        pg.screenshot(path=str(OUT / f"{f.stem}.png"), omit_background=True, clip={"x": 0, "y": 0, "width": SIZE, "height": SIZE})
        print("mask", f.stem)
    b.close()

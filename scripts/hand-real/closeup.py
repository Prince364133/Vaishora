# Zoomed close-ups of the hero hand (desktop, dpr 2) for skin / stain QA.
#   python scripts/hand-real/closeup.py <url> <out_prefix> [design] [zoom_clicks]
import sys
from playwright.sync_api import sync_playwright

url, prefix = sys.argv[1], sys.argv[2]
design = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] != "-" else None
clicks = int(sys.argv[4]) if len(sys.argv) > 4 else 3
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu"])
    pg = b.new_page(viewport={"width": 1366, "height": 900}, device_scale_factor=2)
    pg.on("pageerror", lambda e: print("[pageerror]", e))
    pg.on("console", lambda m: print(f"[{m.type}]", m.text) if m.type == "error" else None)
    pg.goto(url, wait_until="networkidle")
    pg.wait_for_timeout(6000)
    if design:
        pg.get_by_role("radio", name=design).first.click()
        pg.wait_for_timeout(2000)
    for _ in range(clicks):
        pg.get_by_role("button", name="Zoom in").first.click()
        pg.wait_for_timeout(400)
    for view in ["Palm", "Back"]:
        pg.get_by_role("radio", name=view, exact=True).first.click()
        pg.wait_for_timeout(2500)
        pg.locator(".arch").first.screenshot(path=f"{prefix}-{view.lower()}.png")
    b.close()

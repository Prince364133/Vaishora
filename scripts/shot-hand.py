# Close-up screenshot of the hero hand stage. Usage: python scripts/shot-hand.py URL OUT [width] [height]
import sys
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]
w = int(sys.argv[3]) if len(sys.argv) > 3 else 1366
h = int(sys.argv[4]) if len(sys.argv) > 4 else 900
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'])
    pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=2)
    pg.goto(url, wait_until='networkidle'); pg.wait_for_timeout(6000)
    el = pg.locator('.arch').first
    el.screenshot(path=out)
    b.close()

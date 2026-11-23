# Usage: python scripts/shot-page.py URL OUT.png WIDTH HEIGHT [waitms] [fullpage 0/1]
import sys
from playwright.sync_api import sync_playwright
url, out, w, h = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
wait = int(sys.argv[5]) if len(sys.argv) > 5 else 2500
full = (sys.argv[6] == '1') if len(sys.argv) > 6 else False
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'])
    pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=1 if w > 800 else 2, is_mobile=w < 800, has_touch=w < 800)
    logs = []
    pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') else None)
    pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    pg.goto(url, wait_until='networkidle')
    pg.wait_for_timeout(wait)
    pg.screenshot(path=out, full_page=full)
    ow = pg.evaluate('document.documentElement.scrollWidth')
    print('scrollWidth', ow, 'viewport', w)
    for l in logs[:15]: print(l)
    b.close()

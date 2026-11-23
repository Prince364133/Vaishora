import sys
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--use-angle=d3d11', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1366, 'height': 900}, device_scale_factor=1)
    pg.goto(sys.argv[1], wait_until='networkidle'); pg.wait_for_timeout(5000)
    pg.get_by_role('radio', name='Royal Bridal').first.click(); pg.wait_for_timeout(1500)
    pg.screenshot(path='scripts/out/home-bridal.png')
    pg.get_by_role('radio', name='Back', exact=True).click(); pg.wait_for_timeout(2500)
    pg.locator('.arch').first.screenshot(path='scripts/out/hand-back.png')
    b.close()

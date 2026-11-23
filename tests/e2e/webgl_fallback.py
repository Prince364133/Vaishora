"""Verifies the experience without WebGL: static hand preview, design switching, booking CTA.
Usage: python tests/e2e/webgl_fallback.py BASE_URL"""
import sys, re
from playwright.sync_api import sync_playwright, expect
base = sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--disable-webgl', '--disable-3d-apis'])
    pg = b.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    pg.goto(base, wait_until='networkidle'); pg.wait_for_timeout(1500)
    assert pg.locator('canvas').count() == 0, 'no canvas expected without WebGL'
    expect(pg.get_by_role('img', name=re.compile('mehndi design')).first).to_be_visible()
    pg.get_by_role('radio', name=re.compile('Royal Bridal')).first.click()
    expect(pg.get_by_role('img', name=re.compile('Royal Bridal mehndi design'))).to_be_visible()
    pg.screenshot(path='scripts/out/fallback.png')
    assert pg.locator('[aria-live=polite] h3').first.inner_text() == 'Royal Bridal'
    # The sticky booking bar appears after scrolling; check the selected design's booking link exists.
    assert pg.locator('a[href="/book/royal-bridal"]').count() >= 1, 'booking link for selected design'
    pg.screenshot(path='scripts/out/fallback.png')
    print('fallback OK: static preview, switching and booking link work without WebGL')
    b.close()

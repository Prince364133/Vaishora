"""Production-mode QA (next start, no payment credentials, demo artists hidden by default).
Usage: python tests/e2e/production_qa.py BASE_URL ADMIN_EMAIL ADMIN_PASSWORD"""
import sys, re
from playwright.sync_api import sync_playwright, expect
base, email, pw = sys.argv[1:4]
out = "scripts/out"

def book_until_slots(pg):
    pg.goto(f"{base}/book/minimal-arabic-trail", wait_until='networkidle')
    pg.get_by_role('button', name='Continue').click()
    pg.get_by_role('button', name='Continue').click()
    pg.get_by_label('Your name').fill('QA Customer'); pg.get_by_label('Mobile number').fill('9123456780')
    pg.get_by_label('Service address').fill('House 12, QA Lane, Phase 2'); pg.get_by_label('Locality').select_option(label='Kondapur')
    pg.get_by_role('button', name='Continue').click()
    pg.get_by_role('radiogroup', name='Date').get_by_role('radio').nth(2).click()
    pg.wait_for_timeout(2500)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))

    # 1. No real artists yet -> no fake availability
    book_until_slots(pg)
    expect(pg.get_by_text('No artist is available on this date')).to_be_visible()
    print('1. production hides demo artists: no slots offered')

    # 2. Admin: change a price and enable demo artists for this QA DB only
    a = b.new_page(viewport={'width': 1280, 'height': 900})
    a.goto(f"{base}/admin/login"); a.get_by_label('Email').fill(email); a.get_by_label('Password').fill(pw); a.get_by_role('button', name='Sign in').click()
    expect(a.get_by_role('heading', name='Dashboard')).to_be_visible(timeout=20000)
    a.goto(f"{base}/admin/designs"); a.get_by_role('link', name=re.compile('Minimal Arabic Trail')).click()
    a.locator('input[name=price]').fill('549'); a.get_by_role('button', name='Save design').click()
    expect(a.get_by_text(re.compile('Saved'))).to_be_visible(timeout=20000)
    pg.goto(f"{base}/designs/minimal-arabic-trail", wait_until='networkidle')
    expect(pg.get_by_text('₹549').first).to_be_visible()
    print('2. admin price change is live on the site: ₹549')
    a.goto(f"{base}/admin/pricing"); a.get_by_label(re.compile('Show demo artists')).check(); a.get_by_role('button', name='Save settings').click()
    expect(a.get_by_text('Settings saved.')).to_be_visible(timeout=20000)

    # 3. Booking with availability; payment gateway not configured -> honest message, booking stays pending
    book_until_slots(pg)
    pg.locator('[aria-label="Start time"] button:not([disabled])').first.click()
    pg.get_by_role('button', name='Continue').click()
    pg.get_by_role('checkbox', name=re.compile('I have read and accept')).check()
    pg.get_by_role('button', name=re.compile('Continue to pay')).click()
    pg.wait_for_url(re.compile('/booking/'), timeout=20000)
    pg.get_by_role('button', name=re.compile(r'^Pay ')).click()
    expect(pg.get_by_text(re.compile('Online payment is not configured yet'))).to_be_visible(timeout=15000)
    expect(pg.get_by_text('Pending payment', exact=True)).to_be_visible()
    print('3. without gateway credentials the booking stays pending; no fake success')
    pg.screenshot(path=f"{out}/prod-payment-unconfigured.png", full_page=True)

    for path in ['/admin', '/admin/bookings', '/admin/artists', '/admin/customers', '/admin/pricing']:
        a.goto(base + path); a.wait_for_load_state('networkidle'); assert a.locator('h1').count() >= 1, path
    a.goto(base + '/admin'); a.screenshot(path=f"{out}/admin-dashboard.png", full_page=True)
    a.goto(base + '/admin/bookings'); a.locator('table a').first.click(); a.wait_for_load_state('networkidle'); a.screenshot(path=f"{out}/admin-booking.png", full_page=True)
    print('4. admin pages render')
    # 5. Public pages
    for path in ['/', '/designs', '/designs/royal-bridal', '/artists', '/artists/demo-artist-a', '/contact', '/become-an-artist', '/terms', '/privacy', '/cancellation-refund', '/about', '/booking/find']:
        r = pg.goto(base + path); assert r.status == 200, (path, r.status)
        w = pg.evaluate('document.documentElement.scrollWidth'); assert w <= 390, (path, w)
    print('5. public pages: 200 and no horizontal overflow at 390px')
    r = pg.goto(base + '/nope'); print('404 page status', r.status)
    print('page errors', errors[:5])
    b.close()

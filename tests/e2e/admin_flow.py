"""Admin journey: login, dashboard, confirm a booking, issue a refund, check customer view.
Usage: python tests/e2e/admin_flow.py BASE_URL ADMIN_EMAIL ADMIN_PASSWORD BOOKING_URL
"""
import sys, re, random
from playwright.sync_api import sync_playwright, expect
base, email, pw, booking_url = sys.argv[1:5]
out = "scripts/out"
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    # unique test IP so repeated runs don't trip the (intended) login rate limit
    pg = b.new_page(viewport={'width': 1280, 'height': 900}, extra_http_headers={'x-forwarded-for': f'10.9.{random.randint(0,255)}.{random.randint(1,254)}'})
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(f"{base}/admin")
    expect(pg).to_have_url(re.compile('/admin/login'))
    pg.get_by_label('Email').fill(email); pg.get_by_label('Password').fill('wrong-password')
    pg.get_by_role('button', name='Sign in').click()
    expect(pg.get_by_text('Email or password is incorrect.')).to_be_visible()
    pg.get_by_label('Password').fill(pw); pg.get_by_role('button', name='Sign in').click()
    expect(pg.get_by_role('heading', name='Dashboard')).to_be_visible(timeout=20000)
    pg.wait_for_timeout(1500)
    pg.screenshot(path=f"{out}/admin-dashboard.png", full_page=True)
    cust = b.new_page(); cust.goto(booking_url); code = cust.locator('h1:visible').first.inner_text(); cust.close()
    print('booking under test', code)
    pg.goto(f"{base}/admin/bookings?q={code}")
    pg.locator('table a').first.click()
    expect(pg.get_by_text('Awaiting artist confirmation').first).to_be_visible(timeout=15000)
    pg.locator('select[name=status][required]:visible').select_option('confirmed')
    pg.get_by_role('button', name='Update status').click()
    expect(pg.get_by_text('Status updated.')).to_be_visible(timeout=15000)
    pg.screenshot(path=f"{out}/admin-booking.png", full_page=True)
    # customer sees confirmed + artist name
    c = b.new_page(viewport={'width': 390, 'height': 844})
    c.goto(booking_url)
    expect(c.get_by_text('Confirmed', exact=True)).to_be_visible(timeout=15000)
    print('customer sees Confirmed')
    # refund
    pg.reload(wait_until='networkidle')
    expect(pg.get_by_role('button', name='Issue refund')).to_be_visible(timeout=20000)
    pg.locator('input[name=reason]:visible').fill('Customer requested, test')
    pg.get_by_role('button', name='Issue refund').click()
    expect(pg.locator('h1:visible + span').first).to_have_text('Refunded', timeout=20000)
    pg.reload(wait_until='networkidle')
    expect(pg.locator('h1:visible + span').first).to_be_visible(timeout=20000)
    status = pg.locator('h1:visible + span').first.inner_text()
    print('status after refund:', status)
    c.reload(wait_until='networkidle'); c.wait_for_timeout(1500); print('customer status:', c.locator('h1:visible + div').first.inner_text())
    for path in ['/admin/designs', '/admin/artists', '/admin/pricing', '/admin/customers', '/admin/designs/new']:
        pg.goto(base + path); pg.wait_for_load_state('networkidle')
        print(path, 'ok' if pg.locator('h1').count() else 'NO H1')
    pg.goto(base + '/admin/pricing'); pg.screenshot(path=f"{out}/admin-pricing.png", full_page=False)
    print('page errors', errors[:5])
    b.close()

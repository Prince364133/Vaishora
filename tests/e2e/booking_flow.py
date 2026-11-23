"""End-to-end customer journey against a dev server with PAYMENT_PROVIDER=mock and demo artists.
Usage: python tests/e2e/booking_flow.py http://localhost:3002 [width]
"""
import sys, re
from playwright.sync_api import sync_playwright, expect

base = sys.argv[1]
width = int(sys.argv[2]) if len(sys.argv) > 2 else 390
out = "scripts/out"

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--use-angle=d3d11', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': width, 'height': 844}, is_mobile=width < 800, has_touch=width < 800)
    pg = ctx.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(f"{base}/book/classic-mandala", wait_until='networkidle')
    expect(pg.get_by_role('heading', name=re.compile('Book Classic Mandala'))).to_be_visible()
    pg.get_by_role('button', name='Continue').click()

    # Step 2: service — both hands + feet add-on + 2 people, price must update from server
    pg.get_by_role('radio', name=re.compile('Both hands')).click()
    pg.get_by_role('checkbox', name=re.compile('Feet mehndi')).click()
    pg.get_by_role('button', name='More people').click()
    pg.wait_for_timeout(800)
    summary = pg.locator('summary').first.inner_text() if width < 1024 else pg.locator('aside').inner_text()
    print('summary after options:', summary.replace('\n', ' | ')[:200])
    pg.get_by_role('button', name='Continue').click()

    # Step 3: when & where (locality, date, time)
    pg.get_by_role('button', name='Continue').click()
    expect(pg.get_by_text('Choose your locality', exact=True)).to_be_visible()
    pg.get_by_label('Your locality in Hyderabad').select_option(label='Gachibowli')
    dates = pg.get_by_role('radiogroup', name='Date').get_by_role('radio')
    dates.nth(2).click()
    pg.wait_for_selector('[aria-label="Start time"] button:not([disabled])', timeout=15000)
    n_all, n_on = pg.locator('[aria-label="Start time"] button').count(), pg.locator('[aria-label="Start time"] button:not([disabled])').count()
    print('slots', n_all, 'available', n_on)
    pg.locator('[aria-label="Start time"] button:not([disabled])').first.click()
    pg.get_by_role('button', name='Continue').click()

    # Step 4: checkout — guest details (180 sign-in disabled) then review
    expect(pg.get_by_role('heading', name='A few details for your artist')).to_be_visible()
    pg.get_by_label('Full name').fill('Test Customer')
    pg.get_by_label('Mobile number').fill('9876543210')
    pg.get_by_label('Email').fill('test.customer@example.com')
    pg.get_by_role('radio', name='Female').click()
    pg.get_by_label('Address where the artist should come').fill('Flat 101, Test Residency, Road 5')
    pg.get_by_role('button', name='Save and continue').click()

    # Step 5: summary
    expect(pg.get_by_role('heading', name='Review and pay')).to_be_visible(timeout=15000)
    pg.get_by_role('button', name=re.compile(r'^Pay .* advance')).click()
    expect(pg.get_by_text('Please accept the cancellation')).to_be_visible()
    pg.get_by_role('checkbox', name=re.compile('I have read and accept')).check()
    pg.screenshot(path=f"{out}/e2e-summary.png", full_page=True)
    pg.get_by_role('button', name=re.compile(r'^Pay .* advance')).click()

    # Booking page: pending payment
    pg.wait_for_url(re.compile(r'/booking/'), timeout=20000)
    expect(pg.get_by_text('Pending payment', exact=True)).to_be_visible()
    code = pg.locator('h1:visible').first.inner_text()
    print('booking code', code)
    pg.get_by_role('button', name=re.compile(r'^Pay ')).click()
    # failure first
    pg.get_by_role('button', name='Simulate failed payment').click()
    expect(pg.get_by_text(re.compile('did not go through'))).to_be_visible(timeout=15000)
    pg.get_by_role('button', name=re.compile('Try again')).click()
    pg.get_by_role('button', name='Simulate successful payment').click()
    expect(pg.get_by_text('Awaiting artist confirmation', exact=True)).to_be_visible(timeout=20000)
    pg.screenshot(path=f"{out}/e2e-confirmed.png", full_page=True)
    print('final status OK; url', pg.url)
    with open(f"{out}/last-booking-url.txt", "w") as f: f.write(pg.url)
    print('page errors:', errors[:5])
    b.close()

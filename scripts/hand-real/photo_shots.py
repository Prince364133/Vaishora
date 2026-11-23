# Visual QA for the photo palm transfer: sculpted 3D model (photo albedo) vs the Photo 3D viewer.
#   python scripts/hand-real/photo_shots.py [base_url] [out_dir]
# For each design page and viewport: sculpted palm (stain + paste), zoomed sculpted palm, and Photo 3D (stain + paste).
import pathlib
import sys

from playwright.sync_api import sync_playwright

base = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3002"
out = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "scripts/out/hand/photo-transfer")
out.mkdir(parents=True, exist_ok=True)
DESIGNS = ["royal-bridal", "bold-arabic-back"]

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu"])
    for w, h in [(1366, 900), (390, 844)]:
        mobile = w < 800
        for slug in DESIGNS:
            pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=2, is_mobile=mobile, has_touch=mobile)
            pg.on("pageerror", lambda e: print("[pageerror]", e))
            pg.goto(f"{base}/designs/{slug}", wait_until="load", timeout=180000)
            pg.evaluate("localStorage.setItem('vaishora.viewer','sculpted')")
            pg.reload(wait_until="load", timeout=180000)
            pg.wait_for_timeout(9000)
            tb = pg.get_by_role("toolbar", name="3D hand controls").first
            stage = tb.locator("xpath=ancestor::div[contains(@class,'flex-col')][1]")
            for look in ["Stain", "Paste"]:
                grp = pg.get_by_role("radiogroup", name="Mehndi look")
                if grp.count():
                    grp.get_by_role("radio", name=look).click()
                    pg.wait_for_timeout(2500)
                pg.get_by_role("radio", name="Palm", exact=True).first.click()
                pg.wait_for_timeout(2500)
                stage.screenshot(path=str(out / f"{w}-{slug}-3d-{look.lower()}.png"))
            zoom = pg.get_by_role("button", name="Zoom in")
            for _ in range(4 if not mobile else 3):
                if zoom.first.is_visible():
                    zoom.first.click()
                    pg.wait_for_timeout(350)
            pg.wait_for_timeout(1500)
            stage.screenshot(path=str(out / f"{w}-{slug}-3d-zoom.png"))
            # Photo 3D for comparison
            pg.get_by_role("radio", name="Photo 3D").first.click()
            pg.wait_for_timeout(9000)
            ptb = pg.get_by_role("toolbar", name="Photo 3D controls").first
            pstage = ptb.locator("xpath=ancestor::div[contains(@class,'flex-col')][1]")
            for look in ["Stain", "Paste"]:
                r = pg.get_by_role("radiogroup", name="Henna look").get_by_role("radio", name=look)
                if r.count():
                    r.first.click()
                    pg.wait_for_timeout(2500)
                pstage.screenshot(path=str(out / f"{w}-{slug}-photo3d-{look.lower()}.png"))
            pg.evaluate("localStorage.setItem('vaishora.viewer','sculpted')")
            pg.close()
            print("done", w, slug)
    b.close()

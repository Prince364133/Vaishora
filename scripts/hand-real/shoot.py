# Screenshots of the homepage hero hand for visual QA.
#   python scripts/hand-real/shoot.py <url> <out_dir> <tag> [designs...]
# For each viewport (390x844 mobile, 1366x900 desktop) and design, captures palm and back views of the hero stage.
import sys, pathlib
from playwright.sync_api import sync_playwright

url, out, tag = sys.argv[1], pathlib.Path(sys.argv[2]), sys.argv[3]
designs = sys.argv[4:] or [None]
out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu"])
    for w, h in [(390, 844), (1366, 900)]:
        mobile = w < 800
        pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile)
        logs = []
        pg.on("console", lambda m: logs.append(f"[{m.type}] {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))
        pg.goto(url, wait_until="load", timeout=120000)
        pg.wait_for_timeout(7000)
        stage = pg.locator(".arch").first
        for d in designs:
            if d:
                pg.get_by_role("radio", name=d).first.click()
                pg.wait_for_timeout(2500)
            slug = (d or "default").lower().replace(" ", "-")
            for view in ["Palm", "Back"]:
                btn = pg.get_by_role("radio", name=view, exact=True)
                if btn.count() and btn.first.is_enabled():
                    btn.first.click()
                    pg.wait_for_timeout(2200)
                stage.screenshot(path=str(out / f"{tag}-{w}-{slug}-{view.lower()}.png"))
        if mobile:
            tb = pg.get_by_role("toolbar", name="3D hand controls")
            if tb.count():
                bb = tb.first.bounding_box()
                print("toolbar", w, bb)
        for l in logs[:10]:
            print(w, l)
        pg.close()
    b.close()
print("ok")

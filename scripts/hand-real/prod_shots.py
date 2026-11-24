# Production QA shots (same set as scripts/out/audit-shots.py) into an iteration folder, plus 390px and a sheet.
#   python scripts/hand-real/prod_shots.py <out_dir> [base_url]
import pathlib
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

out = pathlib.Path(sys.argv[1])
base = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3002"
out.mkdir(parents=True, exist_ok=True)
shots = [("royal-bridal", "palm"), ("royal-bridal", "back"), ("classic-mandala", "palm"), ("minimal-arabic-trail", "palm")]
import os  # noqa: E402

if os.environ.get("QUICK"):  # fast loop: 1366 only, no zoom on the back
    shots = shots[:3]
made = []
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-angle=d3d11", "--ignore-gpu-blocklist"])
    for w, h, dpr in [(1366, 900, 2)] + ([] if os.environ.get("QUICK") else [(390, 844, 2)]):
        mobile = w < 800
        for slug, side in shots if not mobile else shots[:2] + shots[3:]:
            pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=dpr, is_mobile=mobile, has_touch=mobile)
            pg.on("pageerror", lambda e: print("[pageerror]", e))
            pg.goto(f"{base}/designs/{slug}", wait_until="load", timeout=180000)
            pg.evaluate(f"localStorage.setItem('vaishora.viewer','{os.environ.get('VIEWER', 'realistic')}')")
            pg.reload(wait_until="load", timeout=180000)
            pg.wait_for_timeout(9000)
            if side == "back":
                pg.get_by_role("radio", name="Back", exact=True).first.click()
                pg.wait_for_timeout(2500)
            st = pg.locator(".arch").first
            tag = f"{w}-{slug}-{side}"
            st.screenshot(path=str(out / f"{tag}.png"))
            made.append(out / f"{tag}.png")
            zoom = pg.get_by_role("button", name="Zoom in")
            for _ in range(4):
                if zoom.count() and zoom.first.is_visible():
                    zoom.first.click()
                    pg.wait_for_timeout(450)
            pg.wait_for_timeout(1800)
            st.screenshot(path=str(out / f"{tag}-zoom.png"))
            made.append(out / f"{tag}-zoom.png")
            pg.close()
            print("shot", tag)
    b.close()

# contact sheet of the 1366 shots (2 rows) for quick review
desk = [m for m in made if m.name.startswith("1366-")]
cell = 560
cols = 4
rows = (len(desk) + cols - 1) // cols
sheet = Image.new("RGB", (cols * cell, rows * cell), "white")
for i, f in enumerate(desk):
    im = Image.open(f).convert("RGB")
    im.thumbnail((cell, cell))
    sheet.paste(im, ((i % cols) * cell + (cell - im.width) // 2, (i // cols) * cell + (cell - im.height) // 2))
sheet.save(out / "sheet.jpg", quality=88)
print("sheet", out / "sheet.jpg")

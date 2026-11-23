"""Capture real VAISHORA website states for the ad (mobile 390x844, device scale 3 by default).

Writes captures/<name>.png and captures/manifest.json with the CSS-pixel boxes of the elements the edit
zooms into or "taps". Nothing is booked: the flow stops on the summary step (before "Continue to pay").

  python capture_site.py              # everything
  python capture_site.py --only hand  # just the 3D-hand shots (studio_*), e.g. after the realistic hand lands
"""
import argparse
import json
import re
import sys

from playwright.sync_api import sync_playwright

from common import CAPTURES, load_config

HIDE_DEV = "nextjs-portal{display:none!important} *{caret-color:transparent!important}"
HAND_SHOTS = {"studio"}


def box(loc):
    b = loc.bounding_box()
    return [round(b["x"], 1), round(b["y"], 1), round(b["width"], 1), round(b["height"], 1)] if b else None


def settle(pg, ms=900):
    pg.wait_for_load_state("networkidle")
    pg.wait_for_timeout(ms)


def shot(pg, manifest, name, boxes, dsf, vw, vh, full=False):
    path = CAPTURES / f"{name}.png"
    pg.screenshot(path=str(path), full_page=full)
    h = pg.evaluate("document.documentElement.scrollHeight") if full else vh
    manifest[name] = {"file": path.name, "w": vw, "h": h, "dsf": dsf, "boxes": {k: v for k, v in boxes.items() if v}}
    print(f"  captured {name} ({len(manifest[name]['boxes'])} boxes)")


def scroll_to(pg, loc, top_offset):
    y = pg.evaluate("(e) => e.getBoundingClientRect().top + scrollY", loc.element_handle())
    pg.evaluate(f"window.scrollTo(0, {max(0, y - top_offset)})")
    pg.wait_for_timeout(500)


def capture_studio(pg, cfg, m, dsf, vw, vh):
    base = cfg["site"]["base_url"]
    pg.goto(base + "/", wait_until="networkidle")
    pg.add_style_tag(content=HIDE_DEV)
    pg.wait_for_selector("canvas", timeout=30000)
    settle(pg, 2500)
    group = pg.locator('[aria-label="Mehndi designs"]')
    stage = pg.locator("canvas").first
    scroll_to(pg, stage, 70)
    slugs = cfg["site"]["studio_designs"]
    for slug in slugs:
        card = group.locator(f'[data-slug="{slug}"]')
        card.scroll_into_view_if_needed()
        scroll_to(pg, stage, 70)
        card.click()
        pg.wait_for_timeout(1800)  # let the mehndi crossfade finish
        shot(pg, m, f"studio_{slug}", {"stage": box(stage), "tap": box(card)}, dsf, vw, vh)
    side = pg.get_by_role("radiogroup", name="Hand side")
    back = side.get_by_role("radio", name=re.compile("Back"))
    if back.count():
        back.click()
        pg.wait_for_timeout(2200)
        shot(pg, m, "studio_back", {"stage": box(stage), "tap": box(back)}, dsf, vw, vh)


def capture_catalogue(pg, cfg, m, dsf, vw, vh):
    pg.goto(cfg["site"]["base_url"] + "/designs", wait_until="networkidle")
    pg.add_style_tag(content=HIDE_DEV)
    settle(pg, 1500)
    anchor = cfg["prices"]["anchor_design"]
    name = cfg["prices"]["designs"][anchor]["name"]
    card = pg.locator("article, li, a").filter(has_text=name).last
    shot(pg, m, "catalogue_full", {"anchor": box(card)}, dsf, vw, vh, full=True)


def capture_booking(pg, cfg, m, dsf, vw, vh):
    """Design -> Service -> When & where (date + time) -> Checkout. Stops before any details are submitted."""
    pg.goto(cfg["site"]["base_url"] + f"/book/{cfg['site']['book_slug']}", wait_until="networkidle")
    pg.add_style_tag(content=HIDE_DEV)
    settle(pg)
    cont = lambda: pg.get_by_role("button", name="Continue", exact=True).click()
    cont(); pg.wait_for_timeout(800)          # design -> service
    cont(); pg.wait_for_timeout(800)          # service -> when & where
    loc = pg.get_by_label(re.compile("locality", re.I)).first
    loc.select_option(label="Gachibowli")
    dates = pg.get_by_role("radiogroup", name="Date").get_by_role("radio")
    dates.first.wait_for()
    pg.wait_for_timeout(600)
    pg.evaluate("window.scrollTo(0, 0)")
    date = dates.nth(2)
    date.click()
    pg.wait_for_selector('[aria-label="Start time"] button:not([disabled])', timeout=20000)
    pg.wait_for_timeout(800)
    grid = pg.locator('[aria-label="Start time"]')
    shot(pg, m, "slot_date", {"tap": box(date), "grid": box(grid)}, dsf, vw, vh)
    slot = pg.locator('[aria-label="Start time"] button:not([disabled])').nth(3)
    slot.click()
    pg.wait_for_timeout(700)
    shot(pg, m, "slot_time", {"tap": box(slot), "date": box(date), "grid": box(grid)}, dsf, vw, vh)
    cont()
    pg.get_by_role("heading", name="Checkout").wait_for()
    pg.wait_for_timeout(800)
    pg.evaluate("window.scrollTo(0, 0)")
    summ = pg.locator("summary").filter(has_text="Price summary").first
    if summ.count() and summ.is_visible():
        summ.click()
        pg.wait_for_timeout(800)
    adv = pg.locator("text=Advance to pay now >> visible=true").first.locator("xpath=..")
    bal = pg.locator("text=Balance to the artist >> visible=true").first.locator("xpath=..")
    pay = pg.get_by_role("button", name=re.compile(r"Pay .*advance|Continue to pay")).first
    total = pg.locator("text=/^Total$/ >> visible=true").first.locator("xpath=..")
    shot(pg, m, "summary_price", {"advance": box(adv), "balance": box(bal), "total": box(total), "pay": box(pay),
                                  "tap": box(summ)}, dsf, vw, vh)


def capture_policy(pg, cfg, m, dsf, vw, vh):
    pg.goto(cfg["site"]["base_url"] + "/cancellation-refund", wait_until="networkidle")
    pg.add_style_tag(content=HIDE_DEV)
    settle(pg, 1200)
    full = pg.get_by_text(re.compile(r"hours or more before the start time")).first
    full.wait_for()
    scroll_to(pg, pg.get_by_role("heading", name="Advance payment"), 120)
    shot(pg, m, "policy", {"full": box(full), "list": box(full.locator("xpath=..")),
                           "advance": box(pg.get_by_text(re.compile(r"To reserve a slot")).first)}, dsf, vw, vh)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["hand", "ui"], help="hand = studio shots only, ui = everything else")
    args = ap.parse_args()
    cfg = load_config()
    vw, vh = cfg["site"]["viewport"]
    dsf = cfg["site"]["device_scale"]
    CAPTURES.mkdir(exist_ok=True)
    mpath = CAPTURES / "manifest.json"
    m = json.loads(mpath.read_text()) if mpath.exists() else {}
    jobs = [("studio", capture_studio), ("catalogue", capture_catalogue), ("booking", capture_booking), ("policy", capture_policy)]
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=["--use-angle=d3d11", "--ignore-gpu-blocklist"])
        for name, fn in jobs:
            if args.only == "hand" and name not in HAND_SHOTS or args.only == "ui" and name in HAND_SHOTS:
                continue
            ctx = b.new_context(viewport={"width": vw, "height": vh}, device_scale_factor=dsf, is_mobile=True,
                                has_touch=True, locale="en-IN", timezone_id="Asia/Kolkata")
            pg = ctx.new_page()
            print(f"capturing {name}")
            fn(pg, cfg, m, dsf, vw, vh)
            ctx.close()
            mpath.write_text(json.dumps(m, indent=1))
        b.close()
    m.pop("_fallback", None)
    mpath.write_text(json.dumps(m, indent=1))


if __name__ == "__main__":
    sys.exit(main())

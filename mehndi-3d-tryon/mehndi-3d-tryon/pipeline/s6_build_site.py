"""Stage 6 — assemble index.html (single file) from the registry.

Input : templates/site_template.html, data/designs.json, data/designs/*/, data/background.jpg,
        data/stage4/geo.json, hmap.png, mask.png
Output: index.html — Three.js 0.160 scene: one mesh for both hands (heights from hmap.png),
        photo texture per design/look, photo backdrop, orbit controls, download button.
"""
import json
from common import *

BG_FRAME = {"x0": -760, "x1": 2296, "y0": -900, "y1": 2820}


def build(out=SITE):
    reg = load_json(REGISTRY, [])
    presets = [{"id": d["id"], "name": d["name"], "tag": d["tag"], "stain": bool(d.get("stain"))} for d in reg]
    presets.append({"id": "bare", "name": "Bare hands", "tag": "No mehndi", "stain": False})
    atlas, thumb = {}, {}
    for p in presets:
        dd = DESIGNS / p["id"]
        atlas[p["id"]] = data_url(dd / "paste_atlas.jpg"); thumb[p["id"]] = data_url(dd / "paste_thumb.jpg")
        if p["stain"]:
            atlas[p["id"] + "_stain"] = data_url(dd / "stain_atlas.jpg"); thumb[p["id"] + "_stain"] = data_url(dd / "stain_thumb.jpg")
    assets = {"presets": presets, "atlas": atlas, "thumb": thumb, "background": data_url(DATA / "background.jpg"), "bgFrame": BG_FRAME}
    t = (TPL / "site_template.html").read_text()
    t = t.replace("/*GEO*/null", json.dumps(load_json(S4 / "geo.json"), separators=(",", ":")))
    t = t.replace("/*HMAP*/", data_url(S4 / "hmap.png").split(",", 1)[1])
    t = t.replace("/*MASK*/", data_url(S4 / "mask.png").split(",", 1)[1])
    t = t.replace("/*ASSETS*/null", json.dumps(assets, separators=(",", ":")))
    Path(out).write_text(t)
    print(f"stage 6 done → {Path(out).name} ({len(t) / 1e6:.2f} MB, {len(presets) - 1} designs + bare hands)")


if __name__ == "__main__":
    build()

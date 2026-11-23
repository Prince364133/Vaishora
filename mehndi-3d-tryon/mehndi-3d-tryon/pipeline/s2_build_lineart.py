"""Stage 2b — build lineart.html, the first 3D version (drawn mehndi, no photos).

Input : templates/lineart_template.html, data/stage2/hand.json, data/stage2/hmap.b64
Output: lineart.html (single file; Three.js 0.160 from jsDelivr)
Six mehndi designs are drawn in code (canvas 2D) on the left hand and mirrored to the right;
paste/stain colours, skin tones and lighting are done in Three.js.
"""
import json
from common import *

if __name__ == "__main__":
    t = (TPL / "lineart_template.html").read_text()
    t = t.replace("/*HAND*/null", json.dumps(load_json(S2 / "hand.json"), separators=(",", ":")))
    t = t.replace("/*HMAP*/", (S2 / "hmap.b64").read_text().strip())
    out = ROOT / "lineart.html"
    out.write_text(t)
    print(f"stage 2b done → lineart.html ({len(t) / 1e6:.2f} MB)")

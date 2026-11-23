"""Build timeline.json: scene timings (driven by voiceover length), captions, camera moves, taps, stickers, SFX cues.

Each scene has a named SLOT. If marketing/ad/slots/<slot>.mp4 exists (e.g. a Veo clip), the compositor uses it
full-bleed for that scene instead of the website footage/motion graphic.
"""
import json
import re

from common import AUDIO, BUILD, CAPTURES, SLOTS, load_config, placeholders, fill, inr, advance_of

PRE = 0.12          # silence before each VO line inside its scene
POST = 0.24         # breathing room after each line
END_HOLD = 1.5      # end card hold after the last word


def caption_chunks(text):
    """'a *b* | c' -> [[(word, hl), ...], [...]] ; *...* marks gold highlight."""
    chunks = []
    for part in text.split("|"):
        words, hl = [], False
        for tok in part.strip().split():
            starts, ends = tok.startswith("*"), tok.endswith("*") and len(tok) > 1
            if starts:
                hl = True
            w = tok.strip("*")
            words.append([w, hl])
            if ends:
                hl = False
        chunks.append(words)
    return chunks


def visual_spec(kind, d, split, cfg, man):
    """Website footage specs. Times are relative to the scene start. Camera: top = CSS px at card top, zoom 1 = full width."""
    designs = cfg["prices"]["designs"]
    cur = cfg["prices"]["currency"]
    if kind == "catalogue":
        return {"states": [{"img": "catalogue_full", "at": 0}],
                "camera": [{"at": 0, "top": 300, "zoom": 1.0}, {"at": d + 0.3, "top": 1180, "zoom": 1.0, "ease": "inout"}]}
    if kind == "studio_prices":
        slugs = [s for s in cfg["site"]["studio_designs"] if f"studio_{s}" in man]
        n = max(1, len(slugs))
        lead = min(0.9, d * 0.2)
        step = (d - lead - 0.5) / max(1, n - 1) if n > 1 else d
        states, tags = [], []
        for i, s in enumerate(slugs):
            at = 0 if i == 0 else round(lead + step * i, 3)
            states.append({"img": f"studio_{s}", "at": at, "tap": "tap" if i else None})
            tags.append({"at": max(0.15, at + 0.1), "label": designs.get(s, {}).get("name", s),
                         "price": f"{cur}{inr(designs[s]['price'])}" if s in designs else ""})
        return {"states": states, "tags": tags,
                "camera": [{"at": 0, "top": 70, "zoom": 1.0}, {"at": d, "top": 92, "zoom": 1.06, "ease": "inout"}]}
    if kind == "summary_price":
        ex = designs[cfg["prices"]["example_design"]]
        adv = advance_of(ex["price"], cfg["prices"]["advance_percent"])
        return {"states": [{"img": "summary_price", "at": 0}],
                "camera": [{"at": 0, "top": 230, "zoom": 1.0}, {"at": 0.85, "top": 400, "zoom": 1.25, "ease": "inout"},
                           {"at": d, "top": 400, "zoom": 1.27, "ease": "inout"}],
                "highlights": [{"at": 1.0, "img": "summary_price", "box": "advance", "pad": 8},
                               {"at": split if split else d * 0.6, "img": "summary_price", "box": "balance", "pad": 8}],
                "advance": {"at": 0.55, "design": f"{ex['name']} · {cur}{inr(ex['price'])}", "value": f"{cur}{inr(adv)}",
                            "label": f"{cfg['prices']['advance_percent']}% advance"}}
    if kind == "studio_rotate":
        last = cfg["site"]["studio_designs"][-1]
        states = [{"img": f"studio_{last}", "at": 0}]
        if "studio_back" in man:
            states.append({"img": "studio_back", "at": round(min(0.75, d * 0.4), 3), "tap": "tap"})
        return {"states": states, "camera": [{"at": 0, "top": 64, "zoom": 1.75}, {"at": d, "top": 70, "zoom": 1.9, "ease": "inout"}]}
    if kind == "slot":
        return {"states": [{"img": "slot_date", "at": 0}, {"img": "slot_time", "at": round(d * 0.42, 3), "tap": "tap"}],
                "camera": [{"at": 0, "top": 250, "zoom": 1.0}, {"at": d, "top": 330, "zoom": 1.12, "ease": "inout"}],
                "taps": [{"at": 0.2, "img": "slot_date", "box": "tap"}]}
    if kind == "policy":
        return {"states": [{"img": "policy", "at": 0}],
                "camera": [{"at": 0, "top": 120, "zoom": 1.0}, {"at": 0.8, "top": 300, "zoom": 1.08, "ease": "inout"},
                           {"at": d, "top": 304, "zoom": 1.1, "ease": "inout"}],
                "highlights": [{"at": 0.95, "img": "policy", "box": "full", "pad": 8}]}
    return {}


VISUAL_KIND = {"studio": "catalogue", "studio_prices": "studio_prices", "summary_price": "summary_price",
               "studio_rotate": "studio_rotate", "slot": "slot", "policy": "policy"}


def build():
    cfg = load_config()
    vals = placeholders(cfg)
    vo = json.loads((AUDIO / "vo" / "vo.json").read_text(encoding="utf-8"))
    man = json.loads((CAPTURES / "manifest.json").read_text())
    t = 0.0
    scenes, sfx = [], []
    for i, sc in enumerate(cfg["scenes"]):
        v = vo[sc["id"]]
        pre = 0.06 if i == 0 else PRE
        post = END_HOLD if sc["id"] == "cta" else POST
        d = round(max(sc.get("min", 0), pre + v["duration"] + post), 3)
        split = round(pre + v["split"], 3) if v.get("split") is not None else None
        slot_file = next((p for p in [SLOTS / f"{sc['slot']}.mp4", SLOTS / f"{sc['slot']}.mov"] if p.exists()), None)
        kind = VISUAL_KIND.get(sc["visual"], sc["visual"])
        spec = visual_spec(kind, d, split, cfg, man) if kind in VISUAL_KIND.values() else {}
        scene = {"id": sc["id"], "slot": sc["slot"], "start": round(t, 3), "dur": d, "vo_start": round(t + pre, 3),
                 "vo_dur": v["duration"], "split": split, "kind": kind,
                 "chunks": caption_chunks(fill(sc["caption"], vals)),
                 "fineprint": fill(sc.get("fineprint", ""), vals), "sticker": sc.get("sticker"),
                 "spec": spec, "slot_video": slot_file.name if slot_file else None}
        scenes.append(scene)
        # SFX cues (absolute seconds)
        if i:
            sfx.append({"t": round(t - 0.12, 3), "kind": "whoosh"})
        for st in spec.get("states", []):
            if st.get("tap"):
                sfx.append({"t": round(t + st["at"] - 0.12, 3), "kind": "tap"})
        for tp in spec.get("taps", []):
            sfx.append({"t": round(t + tp["at"], 3), "kind": "tap"})
        if spec.get("advance"):
            sfx.append({"t": round(t + spec["advance"]["at"], 3), "kind": "lock"})
        if sc.get("sticker") == "dm" and split:
            sfx.append({"t": round(t + split, 3), "kind": "pop"})
        if sc["id"] == "cta":
            sfx.append({"t": round(t + 0.35, 3), "kind": "chime"})
        t += d
    cta = cfg["cta"]
    tl = {"duration": round(t, 3), "fps": cfg["output"]["fps"], "scenes": scenes, "sfx": sfx,
          "cta": {"primary": cta["primary"], "secondary": cta["secondary"], "line": cta["line"],
                  "fineprint": fill(cta["fineprint"], vals)},
          "manifest": man}
    (BUILD / "timeline.json").write_text(json.dumps(tl, ensure_ascii=False, indent=1), encoding="utf-8")
    # checks against the brief
    by = {s["id"]: s for s in scenes}
    anchor_t = by["price"]["start"] + (by["price"]["split"] or 0)
    offer_t = by["offer"]["vo_start"] + 0.4
    print(f"  duration {t:.2f}s | price anchor @{anchor_t:.1f}s | offer @{offer_t:.1f}s | CTA card @{by['cta']['start']:.1f}s")
    if not 25 <= t <= 35:
        print("  WARNING: duration outside 25-35 s")
    return tl


if __name__ == "__main__":
    build()

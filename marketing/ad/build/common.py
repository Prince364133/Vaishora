"""Shared helpers for the VAISHORA ad build: paths, config, placeholder filling."""
import json
import math
import re
import subprocess
from pathlib import Path

BUILD = Path(__file__).resolve().parent
AD = BUILD.parent
PROJECT = AD.parents[1]
CAPTURES = AD / "captures"
SLOTS = AD / "slots"
AUDIO = AD / "audio"
RENDER = AD / "render"
CACHE = AD / ".cache"


def load_config() -> dict:
    return json.loads((BUILD / "config.json").read_text(encoding="utf-8"))


def inr(n: float) -> str:
    """Indian digit grouping: 3999 -> 3,999 ; 125000 -> 1,25,000."""
    s = str(int(round(n)))
    if len(s) <= 3:
        return s
    head, tail = s[:-3], s[-3:]
    parts = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return ",".join(parts + [tail])


def advance_of(price: float, pct: float) -> int:
    return int(math.floor(price * pct / 100 + 0.5))


def placeholders(cfg: dict) -> dict:
    p = cfg["prices"]
    cur = p["currency"]
    d = p["designs"]
    anchor = d[p["anchor_design"]]["price"]
    ex = d[p["example_design"]]["price"]
    vals = {
        "advance": str(p["advance_percent"]),
        "full_hours": str(p["full_refund_hours"]),
        "partial_hours": str(p["partial_refund_hours"]),
        "partial_pct": str(p["partial_refund_percent"]),
        "minimal": f"{cur}{inr(anchor)}",
        "minimal_vo": f"{inr(anchor)} रुपये",
        "example": f"{cur}{inr(ex)}",
        "example_advance": f"{cur}{inr(advance_of(ex, p['advance_percent']))}",
        "example_balance": f"{cur}{inr(ex - advance_of(ex, p['advance_percent']))}",
    }
    for slug, v in d.items():
        key = slug.split("-")[-1]  # dots, mandala, bridal
        vals[key] = f"{cur}{inr(v['price'])}"
    vals["mandala_advance"] = vals["example_advance"]
    return vals


def fill(text: str, vals: dict) -> str:
    return re.sub(r"\{(\w+)\}", lambda m: vals.get(m.group(1), m.group(0)), text)


def ffprobe_duration(path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True).stdout.strip()
    return float(out)


def run(cmd, **kw):
    print("  $", " ".join(str(c) for c in cmd)[:200])
    return subprocess.run([str(c) for c in cmd], check=True, **kw)

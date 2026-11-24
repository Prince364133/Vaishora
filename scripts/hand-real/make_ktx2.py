# Builds the KTX2 (Basis Universal) skin maps next to the JPEG fallbacks in public/models.
#
#   python scripts/hand-real/make_ktx2.py <ktx2-encoder package dir> [public/models]
#
# Get the encoder once (pure wasm, MIT; not a project dependency):
#   mkdir <scratch> && cd <scratch> && npm pack ktx2-encoder@0.6.0 && tar xzf ktx2-encoder-0.6.0.tgz   → <scratch>/package
#
# Output (both tiers use 2K: GPU-compressed textures cost ~1/4–1/8 of the memory of RGBA, so phones can afford 2K):
#   hand-albedo-2k.ktx2   ETC1S (small download, sRGB)
#   hand-normal-2k.ktx2   ETC1S max quality (soft normal map; UASTC was 6.7x larger)
#   hand-detail-1k.ktx2   ETC1S (nail mask / cavity / free edge, linear; a mask needs no 2K)
import json
import pathlib
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

pkg = sys.argv[1]
models = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "public/models")
script = pathlib.Path(__file__).with_name("encode_ktx2.mjs")
import os  # noqa: E402

jobs_spec = [
    ("hand-albedo-2k.jpg", "hand-albedo-2k.ktx2", {"mode": "etc1s", "srgb": True, "quality": 200}),
    # ETC1S at max quality: 206 KB vs 1.39 MB for UASTC+Zstd; our normal map is soft (no hard edges), so ETC1S
    # block artefacts are not visible even at maximum zoom.
    ("hand-normal-2k.jpg", "hand-normal-2k.ktx2", {"mode": "etc1s", "normal": True, "quality": 255}),
    ("hand-detail-1k.jpg", "hand-detail-1k.ktx2", {"mode": "etc1s", "quality": 160}),
]
if os.environ.get("KTX_TRY"):  # size/quality experiment for the normal map
    jobs_spec = [
        ("hand-normal-2k.jpg", "try-normal-etc1s.ktx2", {"mode": "etc1s", "normal": True, "quality": 255}),
        ("hand-normal-2k.jpg", "try-normal-uastc-rdo4.ktx2", {"mode": "uastc", "normal": True, "rdo": 4.0}),
        ("hand-detail-1k.jpg", "hand-detail-1k.ktx2", {"mode": "etc1s", "quality": 160}),
    ]
with tempfile.TemporaryDirectory() as tmp:
    jobs = []
    for src, dst, spec in jobs_spec:
        im = Image.open(models / src).convert("RGBA")
        if spec.get("upscale"):
            im = im.resize((spec["upscale"], spec["upscale"]), Image.LANCZOS)
        raw = pathlib.Path(tmp) / (dst + ".rgba")
        w, h = im.size
        raw.write_bytes(np.array([w, h], "<u4").tobytes() + np.asarray(im, np.uint8).tobytes())
        jobs.append({"in": str(raw), "out": str(models / dst), **{k: v for k, v in spec.items() if k != "upscale"}})
    jf = pathlib.Path(tmp) / "jobs.json"
    jf.write_text(json.dumps(jobs))
    subprocess.run(["node", str(script), pkg, str(jf)], check=True)

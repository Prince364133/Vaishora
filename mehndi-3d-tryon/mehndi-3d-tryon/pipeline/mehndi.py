#!/usr/bin/env python3
"""Mehndi Studio design tool — add, list and remove designs on the 3D try-on page.

Generate a new design with Codex (fresh paste + dried stain), line it up with the 3D hands, rebuild index.html:
  python3 pipeline/mehndi.py add "Lotus Bloom" --style "Large lotus mandala in each palm, ..." [--tag "Lotus & dots"]
  python3 pipeline/mehndi.py add "Like My Photo" --style "..." --ref my_mehndi_photo.jpg      # copy a photo's style
  python3 pipeline/mehndi.py add "Paste Only" --style "..." --no-stain                        # skip the stain version

Drop in photos you already have (same pose as generated-images/bare-hands.jpg):
  python3 pipeline/mehndi.py add "Client Pick" --paste paste.jpg [--stain stain.jpg]

Other commands:
  python3 pipeline/mehndi.py list
  python3 pipeline/mehndi.py remove lotus-bloom
  python3 pipeline/mehndi.py build                 # rebuild index.html from data/designs.json
"""
import argparse
import re
import shutil
import sys

from common import *
import s3_generate_images as s3
import s5_textures as s5
import s6_build_site as s6


def slug(name):
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "design"


def cmd_list(_):
    reg = load_json(REGISTRY, [])
    for d in reg:
        print(f"  {d['id']:<16} {d['name']:<20} {'paste + stain' if d.get('stain') else 'paste only':<14} {d['tag']}")
    print(f"{len(reg)} designs (+ bare hands)")


def cmd_add(a):
    reg = load_json(REGISTRY, [])
    did = a.id or slug(a.name)
    if did == "bare":
        sys.exit("'bare' is reserved for the bare-hands option.")
    exists = next((d for d in reg if d["id"] == did), None)
    if exists and not a.replace:
        sys.exit(f"A design with id '{did}' already exists. Use --replace to overwrite it, or --id to pick another id.")
    if not a.paste and not a.style:
        sys.exit("Describe the design with --style \"...\" (Codex generates it), or pass your own photo with --paste.")
    d = {"id": did, "name": a.name, "tag": a.tag or (a.style or "Custom design")[:28].rstrip(" ,.") , "photo": did,
         "stain": bool(a.stain or (not a.no_stain and not a.paste)), "style": a.style or f"Photo supplied: {Path(a.paste).name}"}
    paste_photo, stain_photo = GEN / f"{did}-paste.jpg", GEN / f"{did}-stain.jpg"
    print(f"Adding '{a.name}' (id: {did})")
    # 1. fresh paste photo
    if a.paste:
        cv2.imwrite(str(paste_photo), cv2.imread(a.paste), [cv2.IMWRITE_JPEG_QUALITY, 95])
    else:
        s3.gen_paste(d, a.ref)
    min_iou = 0.0 if a.force else 0.9
    try:
        s5.process_photo(paste_photo, did, "paste", min_iou)
        # 2. dried stain photo
        if a.stain:
            cv2.imwrite(str(stain_photo), cv2.imread(a.stain), [cv2.IMWRITE_JPEG_QUALITY, 95])
        elif d["stain"]:
            s3.gen_stain(d)
        if d["stain"]:
            s5.process_photo(stain_photo, did, "stain", min_iou)
    except ValueError as e:
        if not exists:
            shutil.rmtree(DESIGNS / did, ignore_errors=True)
        if a.paste:  # drop-in copies are removed; Codex images are kept so a paid generation is never lost
            for p in (paste_photo, stain_photo):
                p.unlink(missing_ok=True)
        sys.exit(f"Not added: {e}")
    # 3. register + rebuild
    reg = [x for x in reg if x["id"] != did]
    if exists:
        reg.insert(next(i for i, x in enumerate(load_json(REGISTRY, [])) if x["id"] == did), d)
    else:
        reg.append(d)
    save_json(REGISTRY, reg)
    s6.build()
    print(f"Done. Open index.html and pick '{a.name}'. Alignment previews: data/designs/{did}/*_check.jpg")


def cmd_remove(a):
    reg = load_json(REGISTRY, [])
    if not any(d["id"] == a.id for d in reg):
        sys.exit(f"No design '{a.id}'. Run `list` to see ids.")
    save_json(REGISTRY, [d for d in reg if d["id"] != a.id])
    shutil.rmtree(DESIGNS / a.id, ignore_errors=True)
    s6.build()
    print(f"Removed '{a.id}' from the page (its photos stay in generated-images/).")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Mehndi Studio design tool", formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("add", help="generate or drop in a design")
    p.add_argument("name", help='display name, e.g. "Lotus Bloom"')
    p.add_argument("--style", help="what the mehndi should look like (sent to Codex)")
    p.add_argument("--ref", help="a mehndi photo whose style Codex should copy")
    p.add_argument("--tag", help="short subtitle on the design card")
    p.add_argument("--id", help="id to use (default: from the name)")
    p.add_argument("--paste", help="use this fresh-paste photo instead of generating one")
    p.add_argument("--stain", help="use this dried-stain photo instead of generating one")
    p.add_argument("--no-stain", action="store_true", help="paste only, no stain version")
    p.add_argument("--replace", action="store_true", help="overwrite a design with the same id")
    p.add_argument("--force", action="store_true", help="accept photos that do not line up well")
    sub.add_parser("list", help="show designs")
    r = sub.add_parser("remove", help="remove a design from the page")
    r.add_argument("id")
    sub.add_parser("build", help="rebuild index.html")
    args = ap.parse_args()
    {"add": cmd_add, "list": cmd_list, "remove": cmd_remove, "build": lambda _: s6.build()}[args.cmd](args)

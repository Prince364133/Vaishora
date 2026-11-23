"""Stage 3 — generate the photoreal images with the Codex CLI (image_generation feature).

  python3 pipeline/s3_generate_images.py bare                 # reference -> bare hands, same pose
  python3 pipeline/s3_generate_images.py design <id>          # bare hands -> fresh paste (style text from designs.json)
  python3 pipeline/s3_generate_images.py stain <id>           # paste photo -> dried stain, same design
  python3 pipeline/s3_generate_images.py royal                # the reference design: stain from the photo, then paste
  python3 pipeline/s3_generate_images.py all                  # everything above (about 25-35 minutes)

Output: generated-images/<photo>-paste.jpg / -stain.jpg, bare-hands.jpg, and the exact prompts in
generated-images/prompts/. Needs `codex` installed and logged in (ChatGPT account).
Every run makes NEW images (they will differ from the ones in this package).
"""
import sys
from common import *

BARE_PROMPT = (PROMPTS / "bare-hands.txt")

PASTE_COMMON = ("Use your image generation tool to EDIT the attached photo (base.png). Keep the photo exactly the same: "
                "the same two real human hands and forearms, the same pose (palms facing up, fingers pointing down, thumbs out "
                "to the sides), identical finger positions, spacing and lengths, identical size and position in the frame, the "
                "same camera angle, lighting, skin tone, pink silk cloth and rose petals. Only ADD freshly applied henna (mehndi) "
                "paste on BOTH palms, fingers and forearms as a matching mirrored bridal pair. The henna must look like real "
                "hand-piped cone paste: slightly raised glossy dark-brown lines with natural thickness variation, sitting on real "
                "skin with visible pores and palm lines. Photorealistic photograph, not an illustration.")
REF_NOTE = (" Copy the motifs, layout and density of the mehndi in the second attached photo (style.png) as closely as "
            "possible, adapted to these palms.")
STAIN_PROMPT = ("Use your image generation tool to EDIT the attached photo (base.png). The henna paste has dried and been scraped "
                "off. Show the EXACT SAME mehndi design, line for line and motif for motif, now as a real henna STAIN soaked into "
                "the skin: a rich deep orange-maroon / reddish-brown stain, flat and matte (not raised paste), with natural slight "
                "colour variation, darkest on the palms and fingertips and a little lighter on the forearms. Keep everything else "
                "identical: the same two hands and forearms, pose, finger positions, size and position in the frame, camera angle, "
                "lighting, skin texture with pores and palm lines, pink silk cloth and rose petals. Photorealistic photograph.")
PASTE_FROM_STAIN = ("Use your image generation tool to EDIT the first attached photo (base.png). It shows a henna design as a dried "
                    "orange-maroon stain. Turn it into FRESHLY APPLIED henna paste: the exact same design, line for line and motif "
                    "for motif, but as slightly raised, glossy, very dark brown cone paste like in the second attached photo "
                    "(style.png), with all fingertips fully dipped in solid dark paste caps exactly as in style.png. Keep everything "
                    "else in base.png identical: the same two hands and forearms, pose, finger positions and shapes, size and "
                    "position in the frame, camera angle, lighting, skin tone and texture, pink silk cloth and rose petals. "
                    "Photorealistic photograph.")


def paste_prompt(style, with_ref=False):
    return PASTE_COMMON + (REF_NOTE if with_ref else "") + "\n\nDesign style: " + style.strip()


def gen_bare():
    prompt = BARE_PROMPT.read_text().split("When the image is generated")[0]
    codex_edit([REF], prompt, GEN / "bare-hands.jpg")


def gen_paste(d, ref_image=None):
    prompt = paste_prompt(d["style"], bool(ref_image))
    (PROMPTS / f"{d['photo']}-paste.txt").write_text(prompt + CODEX_TAIL)
    codex_edit([GEN / "bare-hands.jpg"] + ([ref_image] if ref_image else []), prompt, GEN / f"{d['photo']}-paste.jpg")


def gen_stain(d):
    (PROMPTS / f"{d['photo']}-stain.txt").write_text(STAIN_PROMPT + CODEX_TAIL)
    codex_edit([GEN / f"{d['photo']}-paste.jpg"], STAIN_PROMPT, GEN / f"{d['photo']}-stain.jpg")


def gen_royal():
    # the reference design: stain straight from the reference photo, then back to paste with the reference as style
    codex_edit([REF], STAIN_PROMPT, GEN / "royal-bridal-stain.jpg")
    codex_edit([GEN / "royal-bridal-stain.jpg", REF], PASTE_FROM_STAIN, GEN / "royal-bridal-paste.jpg")


def find(design_id):
    for d in load_json(REGISTRY, []):
        if d["id"] == design_id:
            return d
    sys.exit(f"No design '{design_id}' in data/designs.json")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd = sys.argv[1]
    if cmd == "bare":
        gen_bare()
    elif cmd == "design":
        gen_paste(find(sys.argv[2]))
    elif cmd == "stain":
        gen_stain(find(sys.argv[2]))
    elif cmd == "royal":
        gen_royal()
    elif cmd == "all":
        gen_bare()
        gen_royal()
        for d in load_json(REGISTRY, []):
            if d["id"] != "royal":
                gen_paste(d)
                if d.get("stain"):
                    gen_stain(d)
    else:
        sys.exit(__doc__)

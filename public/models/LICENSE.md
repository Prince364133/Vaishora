# 3D hand — sources and licences

All files in this folder (`hand-hq.glb`, `hand-lq.glb`, `hand-albedo-*.jpg`, `hand-normal-*.jpg`, `hand-detail-1k.jpg`)
and the stills in `public/hand/` (`palm.webp`, `back.webp`) are **derived works of CC0 (public-domain dedication)
assets** and are therefore themselves free of copyright restrictions. They were built by the scripts in
`scripts/hand-real/` (see `docs/HAND_REALISM.md`).

| Input | Author | Source | Licence |
|---|---|---|---|
| MakeHuman base mesh (hm08), macro targets (gender/age/ethnicity/proportions), hand targets `r-hand-fingers-*`, default skeleton | MakeHuman team | shipped in MPFB2 2.0.18 (`extensions.blender.org/add-ons/mpfb/`), data folder | CC0 1.0 — "All core assets are shared under Creative Commons, CC0" (static.makehumancommunity.org/about/license.html) |
| Skin texture `cutoff3d_indian_female_enhanced` (`indian_skin3e.png`) | CutOff3D | MakeHuman asset pack **Skins 01** (`skins01_cc0.zip`, static.makehumancommunity.org/assets/assetpacks/skins01.html) | CC0 1.0 |
| Hand targets `mindfront_hand_fingers_correction`, `mindfront_hand_thenar_eminence`, `mindfront_hand_hypothenar` | Mindfront | asset pack **Hands 01** (`hands01_cc0.zip`) | CC0 1.0 |
| Hand target `jujube_knobby_knuckles` | jujube | asset pack **Hands 01** | CC0 1.0 |

Tools (not redistributed): Blender 4.5 LTS (GPL), MPFB2 add-on (GPL-3.0; its *code* is GPL, its bundled *assets* are CC0).
Output produced with GPL tools is not itself GPL-encumbered.

CC0 requires no attribution. We credit the authors anyway: **MakeHuman community, CutOff3D, Mindfront, jujube.**

The previous stylised hand (WebXR Input Profiles `generic-hand`, MIT, © 2019 Amazon) is no longer shipped.

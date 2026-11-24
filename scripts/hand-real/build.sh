#!/usr/bin/env bash
# Full, reproducible build of the realistic hand + mehndi assets. See docs/HAND_REALISM.md.
#
# Prerequisites (downloaded by hand into a work folder W, NOT committed):
#   W/blender/          Blender 4.5 LTS portable zip from download.blender.org, with an empty `portable/` folder
#                       next to blender.exe so all config stays inside it
#   W/blender/portable/extensions/user_default/mpfb/   MPFB2 2.0.18 from extensions.blender.org (unzipped)
#   W/mpfb_user/data/   MakeHuman CC0 asset packs unzipped: makehuman_system_assets_cc0, skins01_cc0, hands01_cc0
# On Windows keep W short (e.g. map it with `subst V: <folder>`): MPFB + Python hit the 260-char path limit.
#
# Usage: W=/v BLENDER=$W/x/blender/blender-4.5.16-windows-x64/blender.exe bash scripts/hand-real/build.sh
set -euo pipefail
: "${W:?set W to the work folder}"
: "${BLENDER:?set BLENDER to blender.exe}"
MPFB="$W/x/blender/blender-4.5.16-windows-x64/portable/extensions/user_default/mpfb"
SKIN="$W/mpfb_user/data/skins/cutoff3d_indian_female_enhanced/indian_skin3e.png"
OUT=scripts/out/hand-build

"$BLENDER" -b --factory-startup --python scripts/hand-real/setup_blender.py -- "$W/mpfb_user"   # once
"$BLENDER" -b --python scripts/hand-real/build_hand.py -- "$OUT" "$MPFB" "$SKIN" --preview     # mesh, bake
node scripts/build-hand.mjs "$OUT"                                                              # web GLBs
python scripts/hand-real/postprocess.py "$OUT" public/models                                   # textures
node scripts/extract-landmarks.mjs public/models/hand-hq.glb                                    # projection frame
pnpm artwork:generate                                                                           # designs/*.svg
"$BLENDER" -b --factory-startup --python scripts/hand-real/render_stills.py -- "$PWD" "$OUT/stills" 1000
python scripts/hand-real/stills_web.py "$OUT/stills" public/hand                               # 2D stills
python scripts/hand-real/make_env_micro.py "$W/dl/hdri/studio.hdr" public/models                    # micro normal (+ optional HDRI)
python scripts/hand-real/photo_transfer.py                                                       # photo palms (palm_photo contract)
# KTX2 skin maps: needs the pure-wasm encoder unpacked once in a scratch folder (see make_ktx2.py header)
[ -n "${KTX2_ENCODER:-}" ] && python scripts/hand-real/make_ktx2.py "$KTX2_ENCODER" public/models
cp node_modules/three/examples/jsm/libs/basis/basis_transcoder.{js,wasm} public/basis/              # local transcoder

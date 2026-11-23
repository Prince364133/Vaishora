#!/bin/sh
# Re-run the whole pipeline from the files in this package.
# Stage 3 (Codex image generation) is skipped by default because it makes NEW images
# and takes 25-35 minutes; run it with:  sh pipeline/rebuild_all.sh --with-codex
set -e
cd "$(dirname "$0")/.."
python3 pipeline/s1_segment_reference.py
python3 pipeline/s1_trace_hand.py
python3 pipeline/s2_lineart_heights.py
python3 pipeline/s2_build_lineart.py
if [ "$1" = "--with-codex" ]; then python3 pipeline/s3_generate_images.py all; fi
python3 pipeline/s4_photo_geometry.py
python3 pipeline/s5_textures.py
python3 pipeline/s6_build_site.py
echo "All stages done. Open index.html"

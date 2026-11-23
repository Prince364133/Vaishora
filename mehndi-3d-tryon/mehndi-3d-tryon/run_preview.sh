#!/bin/sh
# Serve the site locally (optional — index.html also opens by double-click).
cd "$(dirname "$0")" || exit 1
echo "Open http://localhost:8765  (Ctrl+C to stop)"
python3 -m http.server 8765

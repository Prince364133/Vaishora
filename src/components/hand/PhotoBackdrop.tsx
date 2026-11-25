"use client";

// The Photo 3D backdrop (pink silk and rose petals, public/tryon/background.jpg) as a fixed, full-frame image.
// The file is padded far beyond the original photo, so only the photo's own area (reference canvas 0..1536 ×
// 0..1920 inside the padded frame) is shown, cover-fitted and centred — the same placement the 3D model scene uses.

import { useEffect, useRef } from "react";

export const BACKDROP_URL = "/tryon/background.jpg";
const FRAME = { x0: -760, x1: 2296, y0: -900, y1: 2820 }; // = manifest.bgFrame
const PHOTO_W = 1536, PHOTO_H = 1920;

/** Placement of the backdrop image for a w×h box (px): size and top-left offset. */
export function backdropRect(w: number, h: number) {
  const k = Math.max(w / PHOTO_W, h / PHOTO_H);
  return { w: (FRAME.x1 - FRAME.x0) * k, h: (FRAME.y1 - FRAME.y0) * k, x: w / 2 - (PHOTO_W / 2 - FRAME.x0) * k, y: h / 2 - (PHOTO_H / 2 - FRAME.y0) * k };
}

export function PhotoBackdrop() {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const d = el.current;
    if (!d) return;
    const place = () => {
      const r = backdropRect(d.clientWidth, d.clientHeight);
      d.style.backgroundSize = `${r.w}px ${r.h}px`;
      d.style.backgroundPosition = `${r.x}px ${r.y}px`;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(d);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      ref={el}
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{ backgroundColor: "#efcfcf", backgroundImage: `url(${BACKDROP_URL})`, backgroundRepeat: "no-repeat" }}
    />
  );
}

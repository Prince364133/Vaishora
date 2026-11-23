// Static, non-WebGL hand preview used for every thumbnail, the WebGL fallback and while the 3D scene loads.
//
// A photographic still of the 3D hand (rendered with Blender Cycles by scripts/hand-real/render_stills.py, using the
// same projection frame as the 3D shader) with the design composited like a real henna stain:
//   1. a soft, lighter orange bleed (blurred mask, multiply)          — the halo around fresh lines
//   2. the stain itself: deep red-brown colour field (multiply)       — skin texture and creases show through
// Both layers are masked by the artwork *intersected with the hand* so nothing spills past the skin. Works with any
// artwork URL: the built-in SVGs or an admin-uploaded transparent PNG/WebP (only alpha is used).

import type { CSSProperties } from "react";

interface Props {
  side: "palm" | "back" | "feet";
  art?: string | null;
  className?: string;
  label?: string;
}

const cssUrl = (u: string) => `url("${u.replace(/["\\\n]/g, (c) => `\\${c}`)}")`;

function maskStyle(art: string, hand: string | null): CSSProperties {
  const images = hand ? `${cssUrl(art)}, url(${hand})` : cssUrl(art);
  return {
    WebkitMaskImage: images,
    maskImage: images,
    WebkitMaskSize: "100% 100%",
    maskSize: "100% 100%",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskComposite: hand ? "source-in" : undefined,
    maskComposite: hand ? "intersect" : undefined,
  };
}

export function HandIllustration({ side, art, className = "", label }: Props) {
  const hand = side === "feet" ? null : `/hand/${side}.webp`;
  const field = side === "back" ? "/hand/stain-back.webp" : "/hand/stain-palm.webp";
  return (
    <div
      className={`relative aspect-square ${className}`}
      style={{ isolation: "isolate", containerType: "inline-size" }}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {side === "feet" ? (
        <svg viewBox="0 0 1000 1000" className="absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            <radialGradient id="foot-shade" cx="45%" cy="40%" r="70%">
              <stop offset="0" stopColor="#d9a07f" />
              <stop offset="1" stopColor="#b97a58" />
            </radialGradient>
          </defs>
          <path
            d="M500 140c-70 0-120 60-128 150-10 110 20 200 10 300-8 90-40 160-40 230 0 70 60 120 158 120s158-50 158-120c0-70-32-140-40-230-10-100 20-190 10-300-8-90-58-150-128-150z"
            fill="url(#foot-shade)"
          />
          {[[392, 250, 34], [455, 212, 26], [515, 205, 24], [570, 222, 22], [620, 256, 20]].map(([x, y, r]) => (
            <circle key={x} cx={x} cy={y - 30} r={r} fill="url(#foot-shade)" />
          ))}
        </svg>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={hand!} alt="" className="absolute inset-0 h-full w-full select-none" draggable={false} decoding="async" />
      )}
      {art && (
        <>
          <div className="absolute inset-0" style={{ mixBlendMode: "multiply", filter: "blur(max(1px, 0.55cqw))", opacity: 0.5 }} aria-hidden>
            <div className="absolute inset-0" style={{ ...maskStyle(art, hand), backgroundColor: "#dc9a78" }} />
          </div>
          <div className="absolute inset-0" style={{ mixBlendMode: "multiply", filter: "blur(max(0.3px, 0.07cqw))" }} aria-hidden>
            <div
              className="absolute inset-0"
              style={{ ...maskStyle(art, hand), backgroundColor: "#8f3a1f", backgroundImage: `url(${field})`, backgroundSize: "100% 100%" }}
            />
          </div>
        </>
      )}
    </div>
  );
}

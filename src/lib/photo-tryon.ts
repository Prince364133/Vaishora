// "Photo 3D" try-on (mehndi-3d-tryon): photographed hands turned into a relief mesh with a height map,
// with photo atlases per design (fresh paste and dried stain). Assets: public/tryon/ (extracted from
// mehndi-3d-tryon/index.html). This viewer is offered side by side with the sculpted 3D hand via a switch.

export type ViewerMode = "sculpted" | "photo";
export type PhotoLook = "paste" | "stain";
export type PhotoTone = "natural" | "fair" | "tan" | "deep";

export const PHOTO_PRESETS = [
  { id: "royal", name: "Royal Bridal" },
  { id: "bridal", name: "Full Bridal" },
  { id: "arabic", name: "Bold Arabic" },
  { id: "trail", name: "Peacock Trail" },
  { id: "floral", name: "Rose Lattice" },
  { id: "minimal", name: "Minimal Mandala" },
  { id: "bare", name: "Bare hands" },
] as const;
export type PhotoPresetId = (typeof PHOTO_PRESETS)[number]["id"];

/** Catalogue design slug → closest photo look. `exact` = same design family. */
export const PHOTO_MATCH: Record<string, { id: PhotoPresetId; exact: boolean }> = {
  "royal-bridal": { id: "royal", exact: true },
  "traditional-full-hand": { id: "bridal", exact: true },
  "bold-arabic-back": { id: "arabic", exact: true },
  "minimal-arabic-trail": { id: "trail", exact: false },
  "floral-vine": { id: "floral", exact: true },
  "classic-mandala": { id: "minimal", exact: false },
  "minimal-dots": { id: "minimal", exact: false },
  "modern-geometric": { id: "minimal", exact: false },
  "engagement-ring": { id: "minimal", exact: false },
  "haath-phool": { id: "royal", exact: false },
};

export const PHOTO_TONES: Record<PhotoTone, { name: string; mul: [number, number, number]; sw: string }> = {
  natural: { name: "Natural", mul: [1, 1, 1], sw: "#d9a184" },
  fair: { name: "Fair", mul: [1.07, 1.05, 1.04], sw: "#ecc0a6" },
  tan: { name: "Tan", mul: [0.86, 0.79, 0.74], sw: "#b9825f" },
  deep: { name: "Deep", mul: [0.68, 0.58, 0.52], sw: "#8e5a3e" },
};

// ---------------------------------------------------------------- shared viewer mode (all stages stay in sync)
const KEY = "vaishora.viewer";
const EVT = "vaishora:viewer";

export function getViewerMode(): ViewerMode {
  try {
    return localStorage.getItem(KEY) === "photo" ? "photo" : "sculpted";
  } catch {
    return "sculpted";
  }
}

export function setViewerMode(m: ViewerMode) {
  try {
    localStorage.setItem(KEY, m);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new CustomEvent(EVT, { detail: m }));
}

export function subscribeViewerMode(cb: () => void) {
  window.addEventListener(EVT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener("storage", cb);
  };
}

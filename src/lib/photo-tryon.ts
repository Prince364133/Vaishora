// "Photo 3D" try-on: the mehndi-3d-tryon viewer — both hands as one 3D mesh shaped from the bare-hands photo itself
// (height map), with each design photo (fresh paste / dried stain) and the photo's own backdrop. Assets in
// public/tryon/ (same files as mehndi-3d-tryon/data). The default viewer; the sculpted hand stays as "3D model".

export type ViewerMode = "sculpted" | "photo" | "realistic";
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

export const TONE_ORDER: PhotoTone[] = ["natural", "fair", "tan", "deep"];

// ---------------------------------------------------------------- shared skin tone (both viewers, all stages)
const TONE_KEY = "vaishora.tone";
const TONE_EVT = "vaishora:tone";

export function getSkinTone(): PhotoTone {
  try {
    const v = localStorage.getItem(TONE_KEY) as PhotoTone | null;
    return v && v in PHOTO_TONES ? v : "natural";
  } catch {
    return "natural";
  }
}

export function setSkinTone(t: PhotoTone) {
  try {
    localStorage.setItem(TONE_KEY, t);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new CustomEvent(TONE_EVT, { detail: t }));
}

export function subscribeSkinTone(cb: () => void) {
  window.addEventListener(TONE_EVT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(TONE_EVT, cb);
    window.removeEventListener("storage", cb);
  };
}

// ---------------------------------------------------------------- shared viewer mode (all stages stay in sync)
const KEY = "vaishora.viewer";
const EVT = "vaishora:viewer";

export function getViewerMode(): ViewerMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "sculpted" || v === "realistic" ? v : "photo";
  } catch {
    return "photo";
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

// Photographed-hands looks for the "3D model" viewer (both hands as a closed mesh built from the photo,
// scripts/model3d -> public/tryon/model) and the skin tones shared by every 3D stage. The source photos the
// model is built from live in assets/tryon-source/ (not served). Viewer modes: "sculpted" = 3D model (default),
// "realistic" = the CC0 hand. The old "Photo 3D" viewer was removed.

export type ViewerMode = "sculpted" | "realistic";
export type PhotoLook = "paste" | "stain";
export type PhotoTone = "natural" | "fair" | "tan" | "deep";

export const PHOTO_PRESETS = [{ id: "bare", name: "Bare hands" }] as const;
export type PhotoPresetId = (typeof PHOTO_PRESETS)[number]["id"];

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
    return v === "realistic" ? "realistic" : "sculpted";
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

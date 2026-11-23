// Photo albedo for the sculpted hand ("palm_photo" assets). Built-in looks come from the Photo 3D source photos,
// warped onto the sculpted hand's palm frame by scripts/hand-real/photo_transfer.py (manifest: photo-palm.json).
// Admin-uploaded designs provide their own palm_photo / back_photo URLs, which take precedence.

import { PHOTO_MATCH } from "@/lib/photo-tryon";
import manifest from "./photo-palm.json";

export type PhotoPalmLook = "paste" | "stain";

const palmCodex = ((manifest as { palmCodex?: Record<string, string> }).palmCodex ?? {}) as Record<string, string>;
const looks = manifest.looks as Record<string, { desktop: string; mobile: string }>;

/**
 * Built-in photo palm for a catalogue design, or null. Only exact PHOTO_MATCH entries are used so the sculpted hand
 * never shows a different design from the one being booked.
 */
export function catalogPhotoPalm(slug: string | undefined, look: PhotoPalmLook, quality: "high" | "low"): string | null {
  const m = slug ? PHOTO_MATCH[slug] : undefined;
  if (!m?.exact) return null;
  const cx = palmCodex[`${m.id}-${look}`];
  if (cx) return cx; // painted by Codex directly on the 3D palm render: no warp seams
  const entry = looks[`${m.id}-${look}`] ?? looks[`${m.id}-paste`];
  if (!entry) return null;
  return quality === "high" ? entry.desktop : entry.mobile;
}

/** Whether a catalogue design has a built-in photo look with a separate dried-stain version. */
export function catalogHasStain(slug: string | undefined): boolean {
  const m = slug ? PHOTO_MATCH[slug] : undefined;
  return !!m?.exact && !!looks[`${m.id}-stain`];
}

const backs = ((manifest as { back?: Record<string, string> }).back ?? {}) as Record<string, string>;

/** Built-in back-of-hand photo (Codex, scripts/hand-real/back_photos.py) for an exact catalogue match, or null. */
export function catalogPhotoBack(slug: string | undefined, look: PhotoPalmLook): string | null {
  const m = slug ? PHOTO_MATCH[slug] : undefined;
  if (!m?.exact) return null;
  return backs[`${m.id}-${look}`] ?? backs[`${m.id}-paste`] ?? null;
}

import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import type { Queryable } from "./db";
import { storeImage } from "./storage";

// Records a photo import (original photo, hand points, settings, final henna) so it shows in the admin review queue
// and, with the owner's consent, can teach the henna detector (docs/HAND_AI_ARCHITECTURE.md §5.3).
// Used by the artist portal's 3D maker; the admin importer stores the same rows in createDesignFromPhotoAction.

const point = z.tuple([z.number().finite(), z.number().finite()]);
const landmarksSchema = z.object({
  w: z.number().int().min(16).max(8192),
  h: z.number().int().min(16).max(8192),
  side: z.enum(["palm", "back"]),
  landmarks: z.array(point).length(21),
  auto: z.array(point).length(21).nullable(),
});
const paramsSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));
const methodSchema = z.string().regex(/^(heuristic-v1|unet-v\d{1,4})$/);

export interface CaptureInput {
  designId: string;
  uploadedBy: string | null;
  source: File;
  landmarksJson: string;
  paramsJson: string;
  maskUrl: string;
  frameVersion: number;
  consentTraining: boolean;
}

/** Stores the original photo and creates the capture source + run. Returns the run id, or null if the input is invalid. */
export async function recordCapture(q: Queryable, c: CaptureInput): Promise<string | null> {
  let lm: z.infer<typeof landmarksSchema>;
  let params: z.infer<typeof paramsSchema>;
  try {
    lm = landmarksSchema.parse(JSON.parse(c.landmarksJson));
    params = paramsSchema.parse(JSON.parse(c.paramsJson));
  } catch {
    return null; // a capture is a bonus for learning; never block saving the design over it
  }
  const buf = Buffer.from(await c.source.arrayBuffer());
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const photoUrl = await storeImage(c.source, "captures");
  const src = await q.query<{ id: string }>(
    `INSERT INTO capture_sources(design_id, side, photo_url, sha256, width, height, uploaded_by, rights_confirmed, consent_training)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8) RETURNING id`,
    [c.designId, lm.side, photoUrl, sha256, lm.w, lm.h, c.uploadedBy, c.consentTraining],
  );
  const unc = typeof params.uncertainty === "number" ? Math.min(100, Math.max(0, params.uncertainty)) : null;
  const run = await q.query<{ id: string }>(
    `INSERT INTO capture_runs(source_id, method, params, auto_landmarks, landmarks, landmarks_edited, edits_url, frame_version, created_by, uncertainty, mask_url)
     VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10) RETURNING id`,
    [
      src[0].id,
      methodSchema.catch("heuristic-v1").parse(params.method),
      JSON.stringify({ ...params, source: "artist" }),
      lm.auto ? JSON.stringify(lm.auto) : null,
      JSON.stringify(lm.landmarks),
      !lm.auto || JSON.stringify(lm.auto) !== JSON.stringify(lm.landmarks),
      c.frameVersion,
      c.uploadedBy,
      unc,
      c.maskUrl,
    ],
  );
  return run[0].id;
}

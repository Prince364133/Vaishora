import "server-only";
import { Queryable } from "./db";

// Artist designs are reviewed before anything reaches the store:
//  - a NEW (or rejected / still-pending) design is edited in place and stays out of the store until approved;
//  - an edit of a LIVE design is stored as a snapshot in designs.pending_changes. The live version keeps
//    selling, and the snapshot replaces it in one step when an admin approves it.

export const ASSET_KINDS = ["palm", "back", "feet", "palm_photo", "back_photo", "model_front", "model_back"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export interface DesignSnapshot {
  name: string;
  category_slug: string;
  description: string;
  includes: string;
  region: "palm" | "back" | "palm_back" | "feet";
  complexity: "simple" | "moderate" | "intricate" | "bridal";
  duration_minutes: number;
  base_price_paise: number;
  video_url: string | null;
  /** Gallery photo URLs in order (first = cover). */
  photos: string[];
  /** 3D artwork: henna mask and fitted hand photo per side. */
  assets: Partial<Record<AssetKind, string>>;
}

/** The design as the artist last submitted it: the pending edit if there is one, else the stored version. */
export async function currentSnapshot(q: Queryable, designId: string): Promise<DesignSnapshot | null> {
  const r = (
    await q.query<Omit<DesignSnapshot, "photos" | "assets"> & { pending_changes: DesignSnapshot | null; photos: string[]; assets: Partial<Record<AssetKind, string>> }>(
      `SELECT d.name, d.category_slug, d.description, d.includes, d.region, d.complexity, d.duration_minutes, d.base_price_paise, d.video_url, d.pending_changes,
              COALESCE((SELECT array_agg(p.url ORDER BY p.sort, p.created_at) FROM design_photos p WHERE p.design_id = d.id), '{}') AS photos,
              COALESCE((SELECT jsonb_object_agg(a.kind, a.url) FROM design_assets a WHERE a.design_id = d.id), '{}'::jsonb) AS assets
       FROM designs d WHERE d.id = $1`,
      [designId],
    )
  )[0];
  if (!r) return null;
  if (r.pending_changes) return r.pending_changes;
  const { pending_changes: _ignored, ...live } = r;
  void _ignored;
  return live;
}

/** Writes a snapshot onto the design (columns, gallery photos, 3D assets). */
export async function applySnapshot(q: Queryable, designId: string, s: DesignSnapshot) {
  await q.query(
    `UPDATE designs SET name=$2, category_slug=$3, description=$4, includes=$5, region=$6, complexity=$7, duration_minutes=$8,
       base_price_paise=$9, video_url=$10, updated_at=now() WHERE id=$1`,
    [designId, s.name, s.category_slug, s.description, s.includes, s.region, s.complexity, s.duration_minutes, s.base_price_paise, s.video_url],
  );
  await q.query(`DELETE FROM design_photos WHERE design_id = $1`, [designId]);
  for (let i = 0; i < s.photos.length; i++) await q.query(`INSERT INTO design_photos(design_id, url, sort) VALUES ($1,$2,$3)`, [designId, s.photos[i], i]);
  const kinds = Object.keys(s.assets) as AssetKind[];
  await q.query(`DELETE FROM design_assets WHERE design_id = $1 AND kind = ANY($2::text[]) AND source = 'upload' AND NOT (kind = ANY($3::text[]))`, [
    designId,
    ASSET_KINDS,
    kinds,
  ]);
  for (const k of kinds)
    await q.query(
      `INSERT INTO design_assets(design_id, kind, url, source) VALUES ($1,$2,$3,'upload')
       ON CONFLICT (design_id, kind) DO UPDATE SET url = EXCLUDED.url, source = 'upload'`,
      [designId, k, s.assets[k]],
    );
}

/** Field-by-field summary of what an edit changes, for the admin review screen. */
export function describeChanges(live: DesignSnapshot, next: DesignSnapshot): string[] {
  const out: string[] = [];
  const f = (label: string, a: unknown, b: unknown, fmt: (v: unknown) => string = String) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${label}: ${fmt(a)} → ${fmt(b)}`);
  };
  f("Name", live.name, next.name);
  f("Category", live.category_slug, next.category_slug);
  f("Price", live.base_price_paise, next.base_price_paise, (v) => `₹${(Number(v) / 100).toLocaleString("en-IN")}`);
  f("Duration", live.duration_minutes, next.duration_minutes, (v) => `${v} min`);
  f("Where", live.region, next.region);
  f("Detail", live.complexity, next.complexity);
  if (live.description !== next.description) out.push("Description changed");
  if (live.includes !== next.includes) out.push("“What the price covers” changed");
  f("Video", live.video_url ?? "none", next.video_url ?? "none");
  if (JSON.stringify(live.photos) !== JSON.stringify(next.photos)) out.push(`Photos: ${live.photos.length} → ${next.photos.length}`);
  if (JSON.stringify(live.assets) !== JSON.stringify(next.assets)) out.push("3D preview changed");
  return out;
}

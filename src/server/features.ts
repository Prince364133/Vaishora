import "server-only";
import { getDb, Queryable } from "./db";

// Feature flags (settings table, key "feature_flags"). Off unless an admin switches them on.
//   realistic3d: show the "Realistic 3D" hand to customers (hero, design pages). While off it is only visible in
//                the admin Realistic 3D page; customers see the 3D model only.
export interface Features {
  realistic3d: boolean;
}
export const DEFAULT_FEATURES: Features = { realistic3d: false };

export async function getFeatures(q?: Queryable): Promise<Features> {
  const db = q ?? (await getDb());
  const rows = await db.query<{ value: Partial<Features> }>(`SELECT value FROM settings WHERE key = 'feature_flags'`);
  return { ...DEFAULT_FEATURES, ...(rows[0]?.value ?? {}) };
}

export async function setFeature(q: Queryable, name: keyof Features, on: boolean) {
  const next = { ...(await getFeatures(q)), [name]: on };
  await q.query(
    `INSERT INTO settings(key, value, updated_at) VALUES ('feature_flags', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(next)],
  );
  return next;
}

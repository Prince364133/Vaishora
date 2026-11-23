import "server-only";
import { getDb, Queryable } from "./db";
import type { PricingRule, Region } from "@/lib/pricing";

export interface DesignCategory {
  slug: string;
  name: string;
  description: string;
  sort: number;
  active: boolean;
}

export interface Design {
  id: string;
  slug: string;
  name: string;
  category_slug: string;
  category_name: string;
  description: string;
  region: Region;
  complexity: "simple" | "moderate" | "intricate" | "bridal";
  duration_minutes: number;
  base_price_paise: number;
  artist_eligibility: "standard" | "senior" | "bridal_specialist";
  status: "active" | "draft" | "unavailable";
  featured: boolean;
  sort: number;
  assets: { palm?: string; back?: string; feet?: string };
}

const DESIGN_SELECT = `
  SELECT d.id, d.slug, d.name, d.category_slug, c.name AS category_name, d.description, d.region,
         d.complexity, d.duration_minutes, d.base_price_paise, d.artist_eligibility, d.status,
         d.featured, d.sort,
         COALESCE((SELECT jsonb_object_agg(a.kind, a.url) FROM design_assets a WHERE a.design_id = d.id), '{}'::jsonb) AS assets
  FROM designs d JOIN design_categories c ON c.slug = d.category_slug`;

export async function listDesigns(opts: { includeInactive?: boolean } = {}, q?: Queryable): Promise<Design[]> {
  const db = q ?? (await getDb());
  const where = opts.includeInactive ? "" : "WHERE d.status <> 'draft' AND c.active";
  return db.query<Design>(`${DESIGN_SELECT} ${where} ORDER BY d.featured DESC, d.sort, d.name`);
}

export async function getDesignBySlug(slug: string, q?: Queryable): Promise<Design | null> {
  const db = q ?? (await getDb());
  const rows = await db.query<Design>(`${DESIGN_SELECT} WHERE d.slug = $1`, [slug]);
  return rows[0] ?? null;
}

export async function getDesignById(id: string, q?: Queryable): Promise<Design | null> {
  const db = q ?? (await getDb());
  const rows = await db.query<Design>(`${DESIGN_SELECT} WHERE d.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listCategories(opts: { includeInactive?: boolean } = {}, q?: Queryable): Promise<DesignCategory[]> {
  const db = q ?? (await getDb());
  return db.query<DesignCategory>(
    `SELECT slug, name, description, sort, active FROM design_categories ${opts.includeInactive ? "" : "WHERE active"} ORDER BY sort, name`,
  );
}

export async function listPricingRules(opts: { includeInactive?: boolean } = {}, q?: Queryable): Promise<PricingRule[]> {
  const db = q ?? (await getDb());
  const rows = await db.query<PricingRule>(
    `SELECT code, group_code, label, description, price_multiplier::float8 AS price_multiplier, flat_paise,
            duration_multiplier::float8 AS duration_multiplier, flat_minutes, is_default, sort, active
     FROM pricing_rules ${opts.includeInactive ? "" : "WHERE active"} ORDER BY group_code, sort`,
  );
  return rows;
}

export interface Locality {
  id: number;
  name: string;
  zone: string;
  city: string;
  active: boolean;
}

export async function listLocalities(opts: { includeInactive?: boolean } = {}, q?: Queryable): Promise<Locality[]> {
  const db = q ?? (await getDb());
  return db.query<Locality>(`SELECT id, name, zone, city, active FROM localities ${opts.includeInactive ? "" : "WHERE active"} ORDER BY name`);
}

export interface PublicArtist {
  id: string;
  slug: string;
  name: string;
  bio: string;
  photo_url: string | null;
  instagram: string | null;
  experience_years: number | null;
  experience_verified: boolean;
  skill_level: string;
  verified: boolean;
  is_demo: boolean;
  specialties: string[];
  localities: string[];
  portfolio: { image_url: string; caption: string }[];
  rating: number | null;
  review_count: number;
}

export async function listPublicArtists(opts: { includeDemo: boolean; slug?: string }, q?: Queryable): Promise<PublicArtist[]> {
  const db = q ?? (await getDb());
  const params: unknown[] = [opts.includeDemo];
  let extra = "";
  if (opts.slug) {
    params.push(opts.slug);
    extra = ` AND a.slug = $2`;
  }
  return db.query<PublicArtist>(
    `SELECT a.id, a.slug, a.name, a.bio, a.photo_url, a.instagram,
            CASE WHEN a.experience_verified THEN a.experience_years END AS experience_years,
            a.experience_verified, a.skill_level, (a.verified_at IS NOT NULL) AS verified, a.is_demo,
            COALESCE((SELECT array_agg(c.name ORDER BY c.sort) FROM artist_services s JOIN design_categories c ON c.slug = s.category_slug WHERE s.artist_id = a.id), '{}') AS specialties,
            COALESCE((SELECT array_agg(l.name ORDER BY l.name) FROM artist_service_areas sa JOIN localities l ON l.id = sa.locality_id WHERE sa.artist_id = a.id), '{}') AS localities,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('image_url', p.image_url, 'caption', p.caption) ORDER BY p.sort) FROM artist_portfolios p WHERE p.artist_id = a.id), '[]'::jsonb) AS portfolio,
            (SELECT round(avg(r.rating)::numeric, 1)::float8 FROM reviews r WHERE r.artist_id = a.id AND r.status = 'published') AS rating,
            (SELECT count(*)::int FROM reviews r WHERE r.artist_id = a.id AND r.status = 'published') AS review_count
     FROM artists a
     WHERE a.status = 'active' AND (NOT a.is_demo OR $1)${extra}
     ORDER BY a.is_demo, a.verified_at NULLS LAST, a.name`,
    params,
  );
}

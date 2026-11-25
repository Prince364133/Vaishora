import "server-only";
import type { Db } from "./db";
import { hashPassword } from "./crypto";

export const categories = [
  ["arabic", "Arabic", "Flowing diagonal trails with bold florals and open skin."],
  ["indian-traditional", "Indian Traditional", "Dense, symmetric patterns with lattice fills and paisleys."],
  ["bridal", "Bridal", "Full, intricate coverage for the wedding day."],
  ["minimal", "Minimal", "Light, quick designs for everyday occasions."],
  ["mandala", "Mandala", "A centred mandala framed by finger detailing."],
  ["floral", "Floral", "Roses and leafy vines across palm and fingers."],
  ["modern", "Modern", "Geometric lines and negative space."],
  ["engagement", "Engagement", "Ring-finger focus with a refined palm motif."],
  ["full-hand", "Full Hand", "Coverage from fingertips to wrist."],
  ["back-hand", "Back Hand", "Designs made for the back of the hand."],
  ["feet", "Feet", "Mehndi for feet, for brides and festive occasions."],
] as const;

export const rules = [
  // code, group, label, description, price_mult, flat ₹, dur_mult, flat_min, default, sort
  ["hands_one", "hands", "One hand", "", 1, 0, 1, 0, true, 1],
  ["hands_both", "hands", "Both hands", "", 1.8, 0, 1.8, 0, false, 2],
  ["side_front", "side", "Front (palm)", "", 1, 0, 1, 0, true, 1],
  ["side_back", "side", "Back of hand", "", 1, 0, 1, 0, false, 2],
  ["side_front_back", "side", "Front and back", "", 1.7, 0, 1.7, 0, false, 3],
  ["coverage_full", "coverage", "Full hand", "Fingertips to wrist, as shown", 1, 0, 1, 0, true, 1],
  ["coverage_half", "coverage", "Half hand", "Fingers and upper palm only", 0.65, 0, 0.65, 0, false, 2],
  ["addon_feet", "addon", "Feet mehndi (pair)", "Matching design on both feet", 1, 699, 1, 45, false, 1],
  ["addon_bridal_custom", "addon", "Bridal customisation", "Hidden initials, portraits or story elements", 1, 1499, 1, 60, false, 2],
  ["people_additional", "people", "Additional person", "Each extra person, same design and options", 0.85, 0, 0.9, 0, false, 1],
] as const;

export const localities = [
  ["Gachibowli", "West"], ["Kondapur", "West"], ["Madhapur", "West"], ["Hitech City", "West"], ["Kukatpally", "West"],
  ["Miyapur", "West"], ["Manikonda", "West"], ["Jubilee Hills", "Central"], ["Banjara Hills", "Central"], ["Ameerpet", "Central"],
  ["Begumpet", "Central"], ["Somajiguda", "Central"], ["Mehdipatnam", "Central"], ["Tolichowki", "Central"], ["Secunderabad", "North"],
  ["Kompally", "North"], ["Uppal", "East"], ["Dilsukhnagar", "East"], ["LB Nagar", "East"], ["Saroornagar", "East"], ["Meerpet", "East"],
  ["Charminar", "South"], ["Attapur", "South"],
] as const;

export interface SeedOptions {
  demo?: boolean;
  adminEmail?: string;
  adminPassword?: string;
}

export async function seedDatabase(db: Db, opts: SeedOptions = {}) {
  void opts.demo; // demo data is no longer seeded
  await db.tx(async (q) => {
    for (const [i, [slug, name, desc]] of categories.entries()) {
      await q.query(
        `INSERT INTO design_categories(slug, name, description, sort) VALUES ($1,$2,$3,$4)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, sort = EXCLUDED.sort`,
        [slug, name, desc, i],
      );
    }

    for (const r of rules) {
      const [code, group, label, desc, pm, flat, dm, fm, def, sort] = r;
      await q.query(
        `INSERT INTO pricing_rules(code, group_code, label, description, price_multiplier, flat_paise, duration_multiplier, flat_minutes, is_default, sort)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (code) DO NOTHING`,
        [code, group, label, desc, pm, flat * 100, dm, fm, def, sort],
      );
    }

    for (const [name, zone] of localities) {
      await q.query(`INSERT INTO localities(name, zone) VALUES ($1,$2) ON CONFLICT (name) DO NOTHING`, [name, zone]);
    }

    const email = (opts.adminEmail ?? process.env.ADMIN_EMAIL ?? "admin@vaishora.local").toLowerCase();
    const existing = await q.query(`SELECT 1 FROM users WHERE email = $1`, [email]);
    if (!existing.length) {
      const password = opts.adminPassword ?? process.env.ADMIN_PASSWORD ?? "admin123";
      await q.query(`INSERT INTO users(email, name, password_hash, role) VALUES ($1, 'VAISHORA Admin', $2, 'admin')`, [email, hashPassword(password)]);
      console.log(`\nAdmin user created:\n  email:    ${email}\n  password: ${password}\n`);
    }

    // Artist logins are never seeded: artists apply on the site and sign in with 180 Identity.

  });
}

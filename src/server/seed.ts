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

// [slug, name, category, style, region, complexity, minutes, price ₹, eligibility, featured, description]
export const designs = [
  ["minimal-arabic-trail", "Minimal Arabic Trail", "arabic", "arabic-trail", "palm", "simple", 30, 499, "standard", true,
    "A single diagonal trail of paisleys and leaves from the index finger to the wrist, with fingertip caps."],
  ["floral-vine", "Floral Vine", "floral", "floral-vine", "palm_back", "moderate", 45, 799, "standard", true,
    "A rose at the centre of the palm with leafy vines climbing each finger."],
  ["classic-mandala", "Classic Mandala", "mandala", "mandala-classic", "palm", "moderate", 60, 999, "standard", true,
    "A four-ring mandala centred on the palm, banded fingers and a dotted wrist cuff."],
  ["traditional-full-hand", "Traditional Full Hand", "full-hand", "traditional-full", "palm_back", "intricate", 90, 1499, "senior", true,
    "Lattice-filled palm with paisleys, banded fingers and a three-row bracelet."],
  ["royal-bridal", "Royal Bridal", "bridal", "bridal-royal", "palm_back", "bridal", 180, 3999, "bridal_specialist", true,
    "Our most intricate design: lattice mandala, fully detailed fingers and a four-row bridal cuff."],
  ["modern-geometric", "Modern Geometric", "modern", "modern-geometric", "palm_back", "simple", 35, 599, "standard", false,
    "Interlocking triangles, a dotted halo and clean finger lines."],
  ["engagement-ring", "Engagement Ring", "engagement", "engagement-ring", "palm", "moderate", 50, 899, "standard", false,
    "A ring of mehndi on the ring finger, framed by a delicate palm mandala."],
  ["minimal-dots", "Minimal Dots", "minimal", "minimal-dots", "palm_back", "simple", 20, 399, "standard", false,
    "A small sunburst with dotted trails — light and quick."],
  ["bold-arabic-back", "Bold Arabic Back", "arabic", "arabic-bold-back", "back", "moderate", 45, 899, "standard", false,
    "Shaded paisleys and roses flowing across the back of the hand."],
  ["haath-phool", "Haath Phool", "back-hand", "haathphool-back", "back", "moderate", 50, 999, "standard", false,
    "Inspired by the haath phool ornament: finger rings chained to a back-hand mandala."],
  ["classic-feet", "Classic Feet", "feet", "feet-classic", "feet", "moderate", 60, 1199, "standard", false,
    "A centred mandala with toe dots and an ankle band. Shown as an illustration — 3D preview is for hands."],
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
  const demo = opts.demo ?? false;
  await db.tx(async (q) => {
    for (const [i, [slug, name, desc]] of categories.entries()) {
      await q.query(
        `INSERT INTO design_categories(slug, name, description, sort) VALUES ($1,$2,$3,$4)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, sort = EXCLUDED.sort`,
        [slug, name, desc, i],
      );
    }

    for (const [i, d] of designs.entries()) {
      const [slug, name, cat, style, region, complexity, minutes, price, elig, featured, desc] = d;
      const rows = await q.query<{ id: string }>(
        `INSERT INTO designs(slug, name, category_slug, description, region, complexity, duration_minutes, base_price_paise, artist_eligibility, status, featured, sort)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$11)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category_slug = EXCLUDED.category_slug, description = EXCLUDED.description,
           region = EXCLUDED.region, complexity = EXCLUDED.complexity, featured = EXCLUDED.featured
         RETURNING id`,
        [slug, name, cat, desc, region, complexity, minutes, price * 100, elig, featured, i],
      );
      const kinds = region === "palm_back" ? ["palm", "back"] : [region];
      for (const k of kinds) {
        await q.query(
          `INSERT INTO design_assets(design_id, kind, url, source) VALUES ($1,$2,$3,'generated')
           ON CONFLICT (design_id, kind) DO NOTHING`,
          [rows[0].id, k, `/designs/${style}-${k}.svg`],
        );
      }
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

    if (demo) {
      const allCats = categories.map((c) => c[0]);
      const demoArtists = [
        ["demo-artist-a", "Demo Artist A", "bridal_specialist", ["Gachibowli", "Kondapur", "Madhapur", "Hitech City", "Jubilee Hills", "Banjara Hills"], allCats],
        ["demo-artist-b", "Demo Artist B", "senior", ["Kukatpally", "Miyapur", "Ameerpet", "Begumpet", "Secunderabad", "Gachibowli"], allCats.filter((c) => c !== "bridal")],
        ["demo-artist-c", "Demo Artist C", "standard", ["Dilsukhnagar", "LB Nagar", "Uppal", "Saroornagar", "Meerpet", "Charminar"], ["arabic", "minimal", "floral", "modern", "mandala", "engagement", "back-hand"]],
      ] as const;
      for (const [slug, name, skill, locs, cats] of demoArtists) {
        const a = await q.query<{ id: string }>(
          `INSERT INTO artists(slug, name, phone, bio, skill_level, status, is_demo)
           VALUES ($1, $2, '+910000000000', 'Sample profile for development and testing. Not a real artist.', $3, 'active', true)
           ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
          [slug, name, skill],
        );
        const id = a[0].id;
        for (const c of cats) await q.query(`INSERT INTO artist_services VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, c]);
        for (const l of locs) await q.query(`INSERT INTO artist_service_areas SELECT $1, id FROM localities WHERE name = $2 ON CONFLICT DO NOTHING`, [id, l]);
        const has = await q.query(`SELECT 1 FROM artist_availability WHERE artist_id = $1`, [id]);
        if (!has.length) for (let wd = 0; wd < 7; wd++) await q.query(`INSERT INTO artist_availability(artist_id, weekday, start_minute, end_minute) VALUES ($1,$2,$3,$4)`, [id, wd, 9 * 60, 20 * 60]);
        const pf = await q.query(`SELECT 1 FROM artist_portfolios WHERE artist_id = $1`, [id]);
        if (!pf.length) {
          const styles = ["mandala-classic-palm", "floral-vine-palm", "haathphool-back-back"];
          for (const [idx, s] of styles.entries()) await q.query(`INSERT INTO artist_portfolios(artist_id, image_url, caption, sort) VALUES ($1,$2,'Sample artwork',$3)`, [id, `/designs/${s}.svg`, idx]);
        }
      }
      console.log("Demo artists created (flagged is_demo = true).");
    }
  });
}

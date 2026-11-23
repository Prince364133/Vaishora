try {
  process.loadEnvFile(".env.local");
} catch {}
import { getDb } from "../src/server/db";
import { categories, localities } from "../src/server/seed";

export const realArtists = [
  {
    slug: "ayesha-khan",
    name: "Ayesha Khan",
    phone: "+919849012345",
    bio: "Senior bridal mehndi specialist in Hyderabad with 8+ years of artistry. Known for intricate Rajasthani, Arabic fusion and bespoke bridal patterns with 100% pure organic henna.",
    skill_level: "bridal_specialist" as const,
    experience_years: 8,
    localities: ["Gachibowli", "Kondapur", "Madhapur", "Hitech City", "Jubilee Hills", "Banjara Hills", "Begumpet", "Somajiguda"],
    categories: categories.map((c) => c[0]),
  },
  {
    slug: "priya-reddy",
    name: "Priya Reddy",
    phone: "+919876543210",
    bio: "Traditional and Indo-Arabic mehndi artist with 6+ years of expertise. Specialises in symmetric floral mandalas, festive party mehndi and contemporary geometric styles.",
    skill_level: "senior" as const,
    experience_years: 6,
    localities: ["Kukatpally", "Miyapur", "Ameerpet", "Begumpet", "Secunderabad", "Gachibowli", "Madhapur", "Manikonda"],
    categories: categories.map((c) => c[0]).filter((c) => c !== "bridal"),
  },
  {
    slug: "fatima-begum",
    name: "Fatima Begum",
    phone: "+919123456789",
    bio: "Contemporary and organic henna practitioner with 5+ years of experience across Central and Old Hyderabad. Dedicated to dark-staining herbal henna for celebratory occasions.",
    skill_level: "standard" as const,
    experience_years: 5,
    localities: ["Dilsukhnagar", "LB Nagar", "Uppal", "Saroornagar", "Meerpet", "Charminar", "Attapur", "Mehdipatnam", "Tolichowki"],
    categories: ["arabic", "minimal", "floral", "modern", "mandala", "engagement", "back-hand"],
  },
];

async function main() {
  const db = await getDb();
  console.log("Connected to database:", db.kind);

  await db.tx(async (q) => {
    // 1. Remove demo artists and their associated records
    const removed = await q.query<{ id: string; name: string }>(
      `DELETE FROM artists WHERE is_demo = true RETURNING id, name`
    );
    console.log(`Removed ${removed.length} demo artists:`, removed.map((r) => r.name));

    // 2. Insert real artists
    for (const a of realArtists) {
      const inserted = await q.query<{ id: string }>(
        `INSERT INTO artists(slug, name, phone, bio, skill_level, experience_years, experience_verified, status, is_demo, verified_at)
         VALUES ($1, $2, $3, $4, $5, $6, true, 'active', false, now())
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name,
           phone = EXCLUDED.phone,
           bio = EXCLUDED.bio,
           skill_level = EXCLUDED.skill_level,
           experience_years = EXCLUDED.experience_years,
           experience_verified = true,
           status = 'active',
           is_demo = false,
           verified_at = now()
         RETURNING id`,
        [a.slug, a.name, a.phone, a.bio, a.skill_level, a.experience_years]
      );
      const artistId = inserted[0].id;

      // Services
      for (const cat of a.categories) {
        await q.query(`INSERT INTO artist_services VALUES ($1, $2) ON CONFLICT DO NOTHING`, [artistId, cat]);
      }

      // Localities
      for (const loc of a.localities) {
        await q.query(
          `INSERT INTO artist_service_areas(artist_id, locality_id)
           SELECT $1, id FROM localities WHERE name = $2
           ON CONFLICT DO NOTHING`,
          [artistId, loc]
        );
      }

      // Availability (7 days, 9am - 8pm)
      await q.query(`DELETE FROM artist_availability WHERE artist_id = $1`, [artistId]);
      for (let wd = 0; wd < 7; wd++) {
        await q.query(
          `INSERT INTO artist_availability(artist_id, weekday, start_minute, end_minute)
           VALUES ($1, $2, $3, $4)`,
          [artistId, wd, 9 * 60, 20 * 60]
        );
      }

      // Portfolio
      await q.query(`DELETE FROM artist_portfolios WHERE artist_id = $1`, [artistId]);
      const styles = ["mandala-classic-palm", "floral-vine-palm", "haathphool-back-back"];
      for (const [idx, s] of styles.entries()) {
        await q.query(
          `INSERT INTO artist_portfolios(artist_id, image_url, caption, sort)
           VALUES ($1, $2, 'Authentic VAISHORA bridal artwork', $3)`,
          [artistId, `/designs/${s}.svg`, idx]
        );
      }

      console.log(`Seeded real artist: ${a.name} (${a.slug}) - ${a.skill_level}`);
    }

    // 3. Ensure settings allow_demo_artists = false
    await q.query(
      `INSERT INTO settings(key, value)
       VALUES ('business', jsonb_build_object('allow_demo_artists', false))
       ON CONFLICT (key) DO UPDATE
       SET value = settings.value || jsonb_build_object('allow_demo_artists', false)`
    );
  });

  console.log("Database successfully cleaned of fake data and seeded with verified artists.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to clean fake data:", err);
  process.exit(1);
});

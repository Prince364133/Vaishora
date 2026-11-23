// Seeds catalogue, pricing rules, settings and localities. Safe to re-run (upserts).
//   npm run db:seed                 -> catalogue + admin user (from ADMIN_EMAIL / ADMIN_PASSWORD)
//   npm run db:seed -- --demo       -> also creates clearly flagged DEMO artists for local testing
// Demo artists are hidden from customers in production unless allow_demo_artists is enabled.
import { getDb } from "../src/server/db";
import { seedDatabase } from "../src/server/seed";

async function main() {
  const demo = process.argv.includes("--demo");
  const db = await getDb();
  await seedDatabase(db, { demo });
  console.log("Seed complete.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

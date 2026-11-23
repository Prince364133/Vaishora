// Applies pending SQL migrations from db/migrations to DATABASE_URL (or local PGlite).
import { runMigrations } from "../src/server/db";
runMigrations()
  .then(() => { console.log("Migrations up to date."); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });

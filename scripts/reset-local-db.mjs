// Deletes the LOCAL development databases (PGlite folders under .data/) so every dev server starts from a clean,
// freshly seeded database (admin user + categories, pricing rules, localities — no designs, artists, bookings or
// uploads). Never touches Postgres/production. Stop the dev servers first: PGlite keeps the database in memory, so a
// running server keeps showing the old data until it is restarted. A database whose lock belongs to a live process
// is skipped.
//   pnpm db:reset-local
import fs from "node:fs";
import path from "node:path";

if (process.env.NODE_ENV === "production" || process.env.DATABASE_URL) {
  console.error("Refusing: this only resets local PGlite databases (DATABASE_URL is set or NODE_ENV=production).");
  process.exit(1);
}
const dataDir = path.join(process.cwd(), ".data");
if (!fs.existsSync(dataDir)) {
  console.log("No .data folder: nothing to reset.");
  process.exit(0);
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};
/** PID holding `<folder>.lock` (or `<base>.lock` for the folder named in `<base>.current`), if that process runs. */
function holder(folder) {
  const locks = [`${folder}.lock`];
  for (const f of fs.readdirSync(dataDir).filter((f) => f.endsWith(".current"))) {
    const target = fs.readFileSync(path.join(dataDir, f), "utf8").trim();
    if (path.resolve(target) === path.resolve(folder)) locks.push(path.join(dataDir, f.replace(/\.current$/, ".lock")));
  }
  for (const l of locks) {
    if (!fs.existsSync(l)) continue;
    const pid = Number(fs.readFileSync(l, "utf8")) || 0;
    if (pid && alive(pid)) return pid;
  }
  return 0;
}

let removed = 0;
let skipped = 0;
for (const name of fs.readdirSync(dataDir)) {
  const full = path.join(dataDir, name);
  if (!name.startsWith("pglite") || !fs.existsSync(full) || !fs.statSync(full).isDirectory()) continue;
  const pid = holder(full);
  if (pid) {
    console.log(`skipped ${name}: open by a running dev server (process ${pid}). Stop it and run this again.`);
    skipped++;
    continue;
  }
  fs.rmSync(full, { recursive: true, force: true }); // stale lock files are harmless: the server takes them over
  console.log(`deleted ${name}`);
  removed++;
}
// pointers to folders that no longer exist
for (const f of fs.readdirSync(dataDir).filter((f) => f.endsWith(".current"))) {
  const target = fs.readFileSync(path.join(dataDir, f), "utf8").trim();
  if (!fs.existsSync(target)) {
    fs.rmSync(path.join(dataDir, f), { force: true });
    console.log(`removed pointer ${f} (its database was deleted)`);
  }
}
const uploads = path.join(process.cwd(), "public", "uploads");
if (fs.existsSync(uploads)) {
  fs.rmSync(uploads, { recursive: true, force: true });
  console.log("deleted public/uploads (local uploaded images)");
}
console.log(`\n${removed} database(s) deleted${skipped ? `, ${skipped} skipped (still running)` : ""}. Start the dev server to create a fresh one.`);
process.exit(skipped ? 2 : 0);

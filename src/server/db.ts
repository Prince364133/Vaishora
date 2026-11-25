import "server-only";
import fs from "node:fs";
import path from "node:path";

// Database access. Production uses PostgreSQL (e.g. Supabase) through DATABASE_URL.
// Without DATABASE_URL — local development and tests — an embedded PGlite database
// (real Postgres compiled to WASM) persists under .data/pglite, so the exact same SQL,
// constraints and exclusion rules run everywhere.

export type Row = Record<string, unknown>;

export interface Queryable {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  kind: "postgres" | "pglite";
}

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

async function migrate(db: Db) {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await db.query<{ name: string }>(`SELECT name FROM schema_migrations`)).map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    await db.tx(async (q) => {
      await q.query(sql);
      await q.query(`INSERT INTO schema_migrations(name) VALUES ($1)`, [file]);
    });
    console.info(`[db] applied migration ${file}`);
  }
}

async function createPostgres(rawUrl: string): Promise<Db> {
  const url = rawUrl.trim().replace(/^\uFEFF/, "");
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    ssl: process.env.DATABASE_SSL === "false" ? undefined : { rejectUnauthorized: false },
  });
  const wrap = (c: { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }): Queryable => ({
    async query<T>(sql: string, params?: unknown[]) {
      const r = await c.query(sql, params);
      return r.rows as T[];
    },
  });
  return {
    kind: "postgres",
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn(wrap(client));
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

async function createPglite(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
  const base = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  // After a recovery the active database may live in another folder, recorded in `<base>.current`.
  let dir = base;
  try {
    const current = fs.readFileSync(`${base}.current`, "utf8").trim();
    if (current && fs.existsSync(current)) dir = current;
  } catch {
    /* no pointer: use the base folder */
  }
  if (dir !== "memory://") {
    fs.mkdirSync(dir, { recursive: true });
    acquireLock(base);
  }
  let pg: InstanceType<typeof PGlite>;
  try {
    pg = await PGlite.create(dir, { extensions: { btree_gist } });
  } catch (e) {
    // A local database left damaged (e.g. two servers wrote to it, or a process was killed
    // mid-write) aborts on open. In development, keep it as a backup and start fresh; the
    // auto-seed below refills the catalogue, admin and demo data.
    if (dir === "memory://" || process.env.NODE_ENV === "production") throw e;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    try {
      fs.renameSync(dir, `${base}-damaged-${stamp}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.rmSync(`${base}.current`, { force: true });
      if (dir !== base) dir = base;
    } catch {
      // Windows keeps the damaged files open in this process: start fresh in a new folder and
      // point future starts at it. The damaged folder can be deleted once the server stops.
      dir = `${base}-${stamp}`;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(`${base}.current`, dir);
    }
    console.warn(`[db] local database could not be opened (${(e as Error).message}); started a fresh one at ${dir}`);
    pg = await PGlite.create(dir, { extensions: { btree_gist } });
  }
  // PGlite is single-connection and serialises queries/transactions internally.
  const exec = async <T,>(q: { query: typeof pg.query; exec: typeof pg.exec }, sql: string, params?: unknown[]) => {
    if (!params?.length && /;\s*\S/.test(sql.trim())) {
      // multi-statement script (migrations)
      await q.exec(sql);
      return [] as T[];
    }
    const r = await q.query<T>(sql, params as unknown[]);
    return r.rows;
  };
  const db: Db = {
    kind: "pglite",
    async query<T>(sql: string, params?: unknown[]) {
      return exec<T>(pg, sql, params);
    },
    tx<T>(fn: (q: Queryable) => Promise<T>) {
      return pg.transaction(async (t) => fn({ query: <R,>(s: string, p?: unknown[]) => exec<R>(t as never, s, p) })) as Promise<T>;
    },
  };
  return db;
}

/**
 * PGlite is single-process: two servers writing to one directory corrupt it. A lock file next to
 * the database records the owning process; a second live process gets a clear error instead.
 */
function acquireLock(dir: string) {
  // `next build` prerenders in several worker processes that only read; don't lock there.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const lock = `${dir}.lock`;
  let owner = 0;
  try {
    owner = Number(fs.readFileSync(lock, "utf8")) || 0;
  } catch {
    owner = 0;
  }
  if (owner && owner !== process.pid) {
    let alive = false;
    try {
      process.kill(owner, 0);
      alive = true;
    } catch {
      alive = false; // stale lock from a process that has exited
    }
    if (alive) {
      throw new Error(
        `The local database ${dir} is already used by another process (pid ${owner}). Stop that dev server, or give this one its own database with PGLITE_DIR=.data/pglite-2`,
      );
    }
  }
  fs.writeFileSync(lock, String(process.pid));
  process.once("exit", () => {
    try {
      if (Number(fs.readFileSync(lock, "utf8")) === process.pid) fs.unlinkSync(lock);
    } catch {
      /* already gone */
    }
  });
}

const g = globalThis as unknown as { __vaishoraDb?: Promise<Db>; __vaishoraMigSig?: string };

const migrationSignature = () => fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort().join("|");

export function getDb(): Promise<Db> {
  // Local development: apply newly added migration files without restarting the server.
  if (g.__vaishoraDb && !process.env.DATABASE_URL && process.env.NODE_ENV !== "production") {
    const sig = migrationSignature();
    if (sig !== g.__vaishoraMigSig) {
      g.__vaishoraMigSig = sig;
      g.__vaishoraDb = g.__vaishoraDb.then(async (db) => {
        await migrate(db);
        return db;
      });
    }
  }
  if (!g.__vaishoraDb) {
    g.__vaishoraDb = (async () => {
      const raw = process.env.DATABASE_URL;
      const url = raw ? raw.trim().replace(/^\uFEFF/, "") : undefined;
      const db = url ? await createPostgres(url) : await createPglite();
      if (!url || process.env.DATABASE_AUTO_MIGRATE === "true") await migrate(db);
      if (!url && process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
        try {
          const counts = await db.query<{ count: string }>("SELECT count(*) FROM design_categories");
          if (Number(counts[0]?.count ?? 0) === 0) {
            const { seedDatabase } = await import("./seed");
            await seedDatabase(db, { demo: true, adminPassword: process.env.ADMIN_PASSWORD || "admin123" });
            console.info("[db] auto-seeded initial catalogue, admin user and demo artists");
          }
        } catch (err) {
          console.warn("[db] auto-seed check skipped:", err);
        }
      }
      g.__vaishoraMigSig = migrationSignature();
      return db;
    })().catch((e) => {
      g.__vaishoraDb = undefined;
      throw e;
    });
  }
  return g.__vaishoraDb;
}

export async function runMigrations() {
  const db = await getDb();
  await migrate(db);
  return db;
}

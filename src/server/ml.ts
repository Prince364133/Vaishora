import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/server/db";
import { currentUser } from "@/server/auth";

// Self-improving henna detector: model registry + the rule that decides whether a new version goes live.
// docs/HAND_AI_ARCHITECTURE.md §5.3. Training happens outside the web app (scripts/ml/autolearn.py).

export interface LiveModel {
  version: number;
  method: string;
  url: string;
  threshold: number;
  workingSize: number;
}

export async function liveModel(): Promise<LiveModel | null> {
  const db = await getDb();
  const rows = await db.query<{ version: number; method: string; url: string; threshold: number; working_size: number }>(
    `SELECT version, method, url, threshold, working_size FROM ml_models WHERE task = 'henna' AND status = 'live' LIMIT 1`,
  );
  const r = rows[0];
  return r ? { version: r.version, method: r.method, url: r.url, threshold: Number(r.threshold), workingSize: r.working_size } : null;
}

/**
 * The training worker authenticates with ML_WORKER_TOKEN (server-only secret, 32+ chars) as a Bearer token;
 * an admin session works too (for running the worker by hand from a logged-in browser export).
 */
export async function mlCaller(req: Request): Promise<{ kind: "worker" } | { kind: "admin"; userId: string } | null> {
  const token = process.env.ML_WORKER_TOKEN;
  const auth = req.headers.get("authorization") ?? "";
  if (token && token.length >= 32 && auth.startsWith("Bearer ")) {
    const a = Buffer.from(auth.slice(7));
    const b = Buffer.from(token);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return { kind: "worker" };
  }
  const user = await currentUser();
  if (user?.role === "admin") return { kind: "admin", userId: user.id };
  return null;
}

type Scores = { f1?: number; iou?: number; precision?: number; recall?: number; n?: number };
export interface CandidateMetrics {
  /** Candidate and live model measured by the worker on the SAME test sets. */
  candidate: Record<string, Scores>;
  live: Record<string, Scores>;
}

export const MIN_GAIN = 0.005; // primary test set must improve by at least this much (F1)
export const MAX_DROP = 0.01; // no test set may get worse by more than this (F1)

/**
 * Promotion rule (pure, unit-tested): the candidate goes live only if it is at least MIN_GAIN better on the
 * primary test set (real approved photos held out from training when there are enough, otherwise the
 * project's held-out photo pair) and no test set drops by more than MAX_DROP.
 */
export function promotionDecision(m: CandidateMetrics, minGold = 5): { promote: boolean; reason: string } {
  const sets = Object.keys(m.candidate).filter((k) => typeof m.candidate[k]?.f1 === "number" && typeof m.live[k]?.f1 === "number");
  if (!sets.length) return { promote: false, reason: "No comparable test results." };
  const goldOk = (m.candidate.real_gold?.n ?? 0) >= minGold;
  const primary = goldOk && sets.includes("real_gold") ? "real_gold" : sets.includes("real_holdout") ? "real_holdout" : sets[0];
  for (const k of sets) {
    const drop = (m.live[k].f1 as number) - (m.candidate[k].f1 as number);
    if (drop > MAX_DROP) return { promote: false, reason: `Worse on ${k}: F1 ${m.candidate[k].f1!.toFixed(3)} vs live ${m.live[k].f1!.toFixed(3)}.` };
  }
  const gain = (m.candidate[primary].f1 as number) - (m.live[primary].f1 as number);
  if (gain < MIN_GAIN) return { promote: false, reason: `Not better enough on ${primary}: F1 ${m.candidate[primary].f1!.toFixed(3)} vs live ${m.live[primary].f1!.toFixed(3)}.` };
  return { promote: true, reason: `Better on ${primary}: F1 ${m.candidate[primary].f1!.toFixed(3)} vs live ${m.live[primary].f1!.toFixed(3)}, no regressions.` };
}

/** Stores an ONNX model file (Supabase Storage when configured, else public/uploads in development). */
export async function storeModelFile(file: File, version: number): Promise<string> {
  if (!file.size || file.size > 25 * 1024 * 1024) throw new Error("Model file must be 1 byte to 25 MB.");
  const buf = Buffer.from(await file.arrayBuffer());
  const name = `models/henna-unet-v${version}-${crypto.randomBytes(4).toString("hex")}.onnx`;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "public-assets";
  if (url && key) {
    const res = await fetch(`${url}/storage/v1/object/${bucket}/${name}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/octet-stream", "x-upsert": "false" },
      body: buf,
    });
    if (!res.ok) throw new Error(`Model upload failed (${res.status}).`);
    return `${url}/storage/v1/object/public/${bucket}/${name}`;
  }
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_LOCAL_UPLOADS) throw new Error("File storage is not configured.");
  const dest = path.join(process.cwd(), "public", "uploads", name);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, buf);
  return `/uploads/${name}`;
}

/** Makes `version` the live model (retiring the current one). */
export async function promote(version: number, by: string | null, reason: string) {
  const db = await getDb();
  await db.tx(async (q) => {
    await q.query(`UPDATE ml_models SET status = 'retired' WHERE task = 'henna' AND status = 'live'`);
    const r = await q.query<{ id: string }>(
      `UPDATE ml_models SET status = 'live', promoted_at = now(), promoted_by = $2, decision = $3 WHERE task = 'henna' AND version = $1 RETURNING id`,
      [version, by, reason],
    );
    if (!r.length) throw new Error("Model version not found.");
  });
}

export function autoPromoteEnabled() {
  return process.env.ML_AUTO_PROMOTE !== "off";
}

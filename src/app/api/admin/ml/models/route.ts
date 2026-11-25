import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db";
import { audit } from "@/server/auth";
import { autoPromoteEnabled, liveModel, mlCaller, promote, promotionDecision, storeModelFile } from "@/server/ml";

const scores = z.object({ f1: z.number().min(0).max(1).optional(), iou: z.number().min(0).max(1).optional(), precision: z.number().min(0).max(1).optional(), recall: z.number().min(0).max(1).optional(), n: z.number().int().min(0).optional() });
const metricsSchema = z.object({
  base_version: z.number().int().min(0),
  candidate: z.record(z.string(), scores),
  live: z.record(z.string(), scores),
});

/** GET: model versions (newest first). */
export async function GET(req: Request) {
  if (!(await mlCaller(req))) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const db = await getDb();
  const rows = await db.query(`SELECT version, method, url, threshold, working_size, metrics, trained_on, status, decision, created_at::text, promoted_at::text FROM ml_models WHERE task = 'henna' ORDER BY version DESC`);
  return NextResponse.json({ live: await liveModel(), models: rows }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST (multipart): the training worker registers a new version.
 *   model: ONNX file · metrics: JSON {base_version, candidate, live} · trained_on: JSON · threshold, working_size
 * The version number is assigned here. It goes live automatically when promotionDecision() says it beats the live
 * model on the same test sets (and ML_AUTO_PROMOTE is not "off"); otherwise it stays a candidate / is rejected.
 */
export async function POST(req: Request) {
  const caller = await mlCaller(req);
  if (!caller) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  try {
    const form = await req.formData();
    const file = form.get("model");
    if (!(file instanceof File)) return NextResponse.json({ error: "model file missing" }, { status: 400 });
    const metrics = metricsSchema.parse(JSON.parse(String(form.get("metrics") ?? "null")));
    const trainedOn = z.record(z.string(), z.unknown()).parse(JSON.parse(String(form.get("trained_on") ?? "{}")));
    const threshold = z.coerce.number().gt(0).lt(1).parse(form.get("threshold"));
    const workingSize = z.coerce.number().int().min(256).max(4096).parse(form.get("working_size"));
    const live = await liveModel();
    if (live && metrics.base_version !== live.version) {
      // the live model changed while this candidate trained: its "live" scores are for an older model
      return NextResponse.json({ error: `Live model is now v${live.version}; re-evaluate against it.` }, { status: 409 });
    }
    const db = await getDb();
    const next = (await db.query<{ v: number }>(`SELECT COALESCE(MAX(version), -1) + 1 AS v FROM ml_models WHERE task = 'henna'`))[0].v;
    const url = await storeModelFile(file, next);
    const d = promotionDecision(metrics);
    const auto = autoPromoteEnabled();
    const status = d.promote ? "candidate" : "rejected";
    await db.query(
      `INSERT INTO ml_models(task, version, method, url, threshold, working_size, metrics, trained_on, status, decision)
       VALUES ('henna', $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [next, `unet-v${next}`, url, threshold, workingSize, JSON.stringify(metrics), JSON.stringify(trainedOn), status, d.reason],
    );
    let promoted = false;
    if (d.promote && auto) {
      await promote(next, caller.kind === "admin" ? caller.userId : null, `Automatic: ${d.reason}`);
      promoted = true;
    }
    await audit(caller.kind === "admin" ? caller.userId : null, promoted ? "ml_model_promoted" : "ml_model_registered", "ml_model", String(next), { decision: d.reason, auto });
    return NextResponse.json({ version: next, status: promoted ? "live" : status, decision: d.reason, autoPromote: auto });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid request" }, { status: 400 });
  }
}

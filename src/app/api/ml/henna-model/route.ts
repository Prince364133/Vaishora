import { NextResponse } from "next/server";
import { connection } from "next/server";
import { liveModel } from "@/server/ml";

// The live henna-detector version for the photo importer (no secrets; the model file itself is public).
export async function GET() {
  await connection();
  const m = await liveModel();
  if (!m) return NextResponse.json({ error: "No live model" }, { status: 404 });
  return NextResponse.json(m, { headers: { "Cache-Control": "no-store" } });
}

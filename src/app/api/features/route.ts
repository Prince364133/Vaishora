import { NextResponse } from "next/server";
import { connection } from "next/server";
import { getFeatures } from "@/server/features";

// Public feature flags for the browser (no secrets). Short cache so a switch reaches customers within a minute.
export async function GET() {
  await connection();
  return NextResponse.json(await getFeatures(), { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" } });
}

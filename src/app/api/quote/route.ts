import { getDb } from "@/server/db";
import { quoteForDesign } from "@/server/bookings";
import { handleError, limit, ok, readJson } from "@/server/http";
import { quoteRequestSchema } from "@/lib/schemas";

export async function POST(req: Request) {
  const limited = limit(req, "quote", 120, 60_000);
  if (limited) return limited;
  try {
    const body = quoteRequestSchema.parse(await readJson(req));
    const db = await getDb();
    const { quote, design } = await quoteForDesign(db, body.designSlug, body.options, body.couponCode);
    return ok({ quote, design: { slug: design.slug, name: design.name, region: design.region } });
  } catch (e) {
    return handleError(e);
  }
}

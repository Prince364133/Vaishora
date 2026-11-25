import { getDb } from "@/server/db";
import { quoteForDesign } from "@/server/bookings";
import { computeDaySlots, expireStaleHolds } from "@/server/availability";
import { handleError, limit, ok, readJson } from "@/server/http";
import { slotRequestSchema } from "@/lib/schemas";

export async function POST(req: Request) {
  const limited = limit(req, "slots", 90, 60_000);
  if (limited) return limited;
  try {
    const body = slotRequestSchema.parse(await readJson(req));
    const db = await getDb();
    await expireStaleHolds(db);
    const { design, quote, settings } = await quoteForDesign(db, body.designSlug, body.options);
    const day = await computeDaySlots(
      db,
      {
        date: body.date,
        durationMinutes: quote.duration_minutes,
        localityId: body.localityId,
        categorySlug: design.category_slug,
        eligibility: design.artist_eligibility,
        artistId: design.artist_id,
      },
      settings,
    );
    // Only availability is exposed, never which artists are free.
    return ok({ date: day.date, durationMinutes: quote.duration_minutes, slots: day.slots });
  } catch (e) {
    return handleError(e);
  }
}

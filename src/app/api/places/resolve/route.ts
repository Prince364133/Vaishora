import { z } from "zod";
import { getDb } from "@/server/db";
import { MapsError, placeDetails, resolveLocality, reverseGeocode, staticMapUrl } from "@/server/maps";
import { fail, handleError, limit, ok, readJson } from "@/server/http";

// A chosen suggestion (or "use my current location") → exact address, coordinates, the Hyderabad locality
// artists serve, whether any artist covers it, and a map preview.
const schema = z.union([
  z.object({ placeId: z.string().min(10).max(300), session: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional() }),
  z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }),
]);

export async function POST(req: Request) {
  const limited = limit(req, "places-resolve", 40, 60_000);
  if (limited) return limited;
  try {
    const b = schema.parse(await readJson(req, 2000));
    const place = "placeId" in b ? await placeDetails(b.placeId, b.session) : await reverseGeocode(b.lat, b.lng);
    const db = await getDb();
    const locality = await resolveLocality(db, place);
    const served = (
      await db.query(
        `SELECT 1 FROM artist_service_areas sa JOIN artists a ON a.id = sa.artist_id WHERE sa.locality_id = $1 AND a.status = 'active' LIMIT 1`,
        [locality.id],
      )
    ).length > 0;
    return ok({
      placeId: place.placeId,
      formatted: place.formatted,
      lat: place.lat,
      lng: place.lng,
      locality,
      served,
      mapUrl: staticMapUrl(place.lat, place.lng),
    });
  } catch (e) {
    if (e instanceof MapsError) return fail(e.message, e.status);
    return handleError(e);
  }
}

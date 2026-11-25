import { z } from "zod";
import { getDb } from "@/server/db";
import { devLoginEnabled, startArtistSession } from "@/server/artist-auth";
import { fail, handleError, limit, ok, readJson } from "@/server/http";

// Local development only (NODE_ENV !== production and ALLOW_DEV_LOGIN=1): sign in as an artist by
// application email when 180 Identity cannot be used on localhost. Returns 404 everywhere else.
export async function POST(req: Request) {
  if (!devLoginEnabled()) return fail("Not found", 404);
  const limited = limit(req, "artist-dev", 20, 10 * 60_000);
  if (limited) return limited;
  try {
    const { email } = z.object({ email: z.string().trim().toLowerCase().email() }).parse(await readJson(req));
    const db = await getDb();
    const a = (await db.query<{ id: string }>(`SELECT id FROM artists WHERE email = $1`, [email]))[0];
    if (!a) return fail("No artist application uses this email.", 404);
    await startArtistSession(a.id, null);
    return ok({ role: "artist", redirect: "/artist-portal" });
  } catch (e) {
    return handleError(e);
  }
}

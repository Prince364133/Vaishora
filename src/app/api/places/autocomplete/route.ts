import { z } from "zod";
import { autocomplete, MapsError } from "@/server/maps";
import { fail, handleError, limit, ok, readJson } from "@/server/http";

// Address / area suggestions inside Hyderabad (Google Places, server-side key).
const schema = z.object({
  input: z.string().trim().min(2).max(120),
  session: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  kind: z.enum(["address", "region"]).default("address"),
});

export async function POST(req: Request) {
  const limited = limit(req, "places-ac", 120, 60_000);
  if (limited) return limited;
  try {
    const b = schema.parse(await readJson(req, 2000));
    return ok({ suggestions: await autocomplete(b.input, b.session, b.kind) });
  } catch (e) {
    if (e instanceof MapsError) return fail(e.message, e.status);
    return handleError(e);
  }
}

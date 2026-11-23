import { z } from "zod";
import { getDb } from "@/server/db";
import { fail, handleError, limit, ok, readJson } from "@/server/http";
import { phoneSchema } from "@/lib/schemas";

const schema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  phone: phoneSchema,
  email: z.string().trim().email("Enter a valid email").max(120).optional().or(z.literal("").transform(() => undefined)),
  localities: z.string().trim().max(300).default(""),
  experience: z.string().trim().max(300).default(""),
  instagram: z.string().trim().max(120).optional(),
  message: z.string().trim().max(1000).default(""),
  website: z.string().max(0).optional(),
});

export async function POST(req: Request) {
  const limited = limit(req, "apply", 5, 10 * 60_000);
  if (limited) return limited;
  try {
    const raw = (await readJson(req)) as Record<string, unknown>;
    if (raw?.website) return fail("Request rejected", 400);
    const b = schema.parse(raw);
    const db = await getDb();
    await db.query(
      `INSERT INTO artist_applications(name, phone, email, localities, experience, instagram, message) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [b.name, b.phone, b.email ?? null, b.localities, b.experience, b.instagram || null, b.message],
    );
    return ok({ received: true }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}

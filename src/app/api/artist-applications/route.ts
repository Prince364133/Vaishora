import { z } from "zod";
import { getDb } from "@/server/db";
import { fail, handleError, limit, ok, readJson } from "@/server/http";
import { phoneSchema } from "@/lib/schemas";
import { notifyTeam, queueEmail } from "@/server/email";
import { uniqueArtistSlug } from "@/server/artist-portal";

// "Become an artist" form. Creates the artist account in 'pending' status (awaiting verification by
// the VAISHORA team). The applicant then signs in with 180 Identity using the same email and lands in
// the artist portal, which shows the verification status.
const optText = (max: number) => z.string().trim().max(max).optional().default("");
const schema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(80),
  phone: phoneSchema,
  email: z.string().trim().toLowerCase().email("Enter a valid email — you will sign in with it").max(120),
  localities: z.string().trim().min(2, "Tell us which areas you can travel to").max(300),
  experience_years: z.coerce.number().int("Enter whole years").min(0).max(60),
  experience: optText(500),
  instagram: z
    .string()
    .trim()
    .max(200)
    .optional()
    .default("")
    .refine((v) => !v || /^(@?[A-Za-z0-9._]{1,30}|https?:\/\/\S+)$/.test(v), "Enter an Instagram handle (@name) or a link"),
  languages: optText(120),
  message: optText(1000),
  consent: z.literal(true, { error: "Please confirm the details are yours and accurate" }),
  website: z.string().max(0).optional(),
});

export async function POST(req: Request) {
  const limited = limit(req, "apply", 5, 10 * 60_000);
  if (limited) return limited;
  try {
    const raw = (await readJson(req)) as Record<string, unknown>;
    if (raw?.website) return fail("Request rejected", 400);
    const b = schema.parse({ ...raw, consent: raw?.consent === true || raw?.consent === "on" || raw?.consent === "true" });
    const db = await getDb();
    const existing = (await db.query<{ id: string; status: string }>(`SELECT id, status FROM artists WHERE email = $1`, [b.email]))[0];
    // A rejected applicant may apply again: the same account goes back for verification with the new details.
    const reapply = existing?.status === "rejected";
    if (existing && !reapply) {
      const msg =
        existing.status === "active"
          ? "This email already has an artist account. Sign in to your artist portal."
          : "You have already applied with this email. Sign in to the artist portal to see your status.";
      return fail(msg, 409, { field: "email", redirect: "/account?artist=1" });
    }
    const staff = await db.query(`SELECT 1 FROM users WHERE email = $1 AND role <> 'artist'`, [b.email]);
    if (staff.length) return fail("This email is used by a VAISHORA staff account. Please use another email.", 409, { field: "email" });

    const portfolio = b.instagram && !b.instagram.startsWith("http") ? `https://instagram.com/${b.instagram.replace(/^@/, "")}` : b.instagram || null;
    const artistId = await db.tx(async (q) => {
      if (reapply) {
        await q.query(
          `UPDATE artists SET name=$2, phone=$3, instagram=$4, portfolio_url=$5, experience_years=$6, experience_text=$7, areas_text=$8, languages=$9,
             application_note=$10, applied_at=now(), status='pending', rejection_reason=NULL, updated_at=now() WHERE id=$1`,
          [existing!.id, b.name, b.phone, b.instagram || null, portfolio, b.experience_years, b.experience, b.localities, b.languages, b.message],
        );
        return existing!.id;
      }
      const slug = await uniqueArtistSlug(q, b.name);
      const r = await q.query<{ id: string }>(
        `INSERT INTO artists(slug, name, phone, email, instagram, portfolio_url, experience_years, experience_text, areas_text, languages,
           application_note, applied_at, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),'pending') RETURNING id`,
        [slug, b.name, b.phone, b.email, b.instagram || null, portfolio, b.experience_years, b.experience, b.localities, b.languages, b.message],
      );
      return r[0].id;
    });
    queueEmail({
      to: b.email,
      template: "artist_application_received",
      artistId,
      subject: "We received your VAISHORA artist application",
      heading: `Thank you, ${b.name.split(" ")[0]}`,
      paragraphs: [
        "Your application to join VAISHORA as a mehndi artist has been received and is now under verification.",
        "Our team reviews your work and details, usually within 2–3 working days. We will email you as soon as your account is approved.",
        `You can sign in to your artist portal at any time with this email (${b.email}) to check your status.`,
      ],
      cta: { label: "Open artist portal", path: "/account?artist=1" },
    });
    notifyTeam({
      template: "artist_application",
      artistId,
      subject: `${reapply ? "Re-application" : "New artist application"}: ${b.name}`,
      heading: "New artist application",
      paragraphs: [`${b.name} (${b.email}, ${b.phone}) applied to join as an artist.`, `Areas: ${b.localities}. Experience: ${b.experience_years} years.`],
      path: "/admin/verification?tab=artists",
    });
    return ok({ received: true, redirect: "/account?artist=1&applied=1" }, { status: 201 });
  } catch (e) {
    const pg = e as { code?: string };
    if (pg?.code === "23505") return fail("You have already applied with this email or phone. Sign in to the artist portal.", 409, { redirect: "/account?artist=1" });
    return handleError(e);
  }
}

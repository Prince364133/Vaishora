import { getDb } from "@/server/db";
import { sendDueReviewRequests } from "@/server/reviews";
import { safeEqual } from "@/server/crypto";
import { fail, ok } from "@/server/http";

// Scheduler entry point (e.g. every 15 minutes): emails "rate your artist" for bookings whose time is over.
// Requires `Authorization: Bearer <CRON_SECRET>`. The site also runs this automatically during normal
// traffic, so a scheduler is optional.
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return fail("Not found", 404);
  const sent = await sendDueReviewRequests(await getDb(), 200);
  return ok({ sent });
}

export const GET = run;
export const POST = run;
